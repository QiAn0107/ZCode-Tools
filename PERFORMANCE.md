# 运行时性能优化记录

- 日期：2026-11-20
- 范围：`zcode-toolkit` 的 asar 检查/注入、开关同步、TPS 快照、看护轮询、注入到渲染层的四个脚本、插件 hooks
- 版本：第一轮随 `0.6.53` 发布；第二轮（进程探测/同步缓存）随 `0.6.54` 发布

## 测量环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.26100 x64 |
| Python | 3.12.8（SQLite 3.45.3） |
| Node | 24.16.0 |
| 客户端 | ZCode 3.18.2，`app.asar` 367.2MB |
| 真实用量库 | 17,944 行 / 297 个 completed 会话 |
| 关键索引 | `model_usage_session_turn_idx(session_id, turn_id)` |

## 已采用的优化

### 1. asar 只读所需条目（最大收益）

旧实现为了读 `package.json` / `index.html` / preload / main / 注入脚本，先把整个
`app.asar` `read_bytes()` 再切片。`sync` 一次 SessionStart 会起 4 个 `--check`
子进程，每个又先读一次版本，合计约 **8 次整包读（≈2.9GB I/O）**，4 个并发进程
瞬时占用约 **1.2–1.6GB**。

新实现 `_asar_read_entry()` 按 header 的 `offset/size` 直接 `seek+read`，并校验
读取长度，截断时抛错。`asar_version()`、`_process_script_inject()`、
`_process_ipc_patch()` 全部改走 ranged read；旧的 `_asar_header_raw()` /
`_asar_entry_bytes()` 仅保留给测试与全量场景。

真实客户端 `--check --all`（单进程，含 5 次检查）：

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 耗时（2–3 次） | 2.31s / 2.38s | 1.69–1.71s |
| `tracemalloc` 峰值 | 407.0MB | 44.4MB |

合成 64MB asar（`tests/bench_perf.py`）：

| 场景 | 旧实现（整包读取） | 当前实现（ranged） |
|---|---|---|
| 版本号读取 | 21.2ms / 峰值 64.1MB | 0.2ms / 峰值 0.0MB |
| `index.html` 条目读取 | 20.7ms / 峰值 64.1MB | 0.3ms / 峰值 0.1MB |

剩余 44.4MB 峰值来自 `out/main/index.js` 这个必需条目（注入锚点/内容比对需要
完整内容），不再是整包 367MB，也不再随包体线性放大。

### 2. 移除 PostToolUse 钩子

`PostToolUse` 在每次工具调用时启动一个 Python 进程；即使 `--min-age 30` 命中，
也要付解释器启动 + `setting.json` 解析。本机 `python -c pass` 中位数 **30ms**，
一个 300 次工具调用的长回合约 **9 秒 CPU**（未计进程创建开销）。

改动：`hooks/hooks.json` 只保留 `SessionStart` / `Stop`。回合内刷新由注入到
main 的 watcher 负责（DB 写入 → 300ms 去抖 → 2.5s 限频 + 30s stat 心跳），
轮末仍有 `Stop` 钩子。

代价：如果 watcher 不可用（补丁未注入 / 指针过期），回合内只能等 `Stop` 刷新。
这是有意的取舍，排障说明已写入 `SKILL.md`。

### 3. 看护自适应轮询

`apply_after_exit.py` 原来固定每 3s 调一次 `zcode_running()`（Windows 上每次
spawn `tasklist`），最长等 24h。

新逻辑 `_poll_interval(waited)`：前 2 分钟仍 3s（正常退出很快），之后 10s。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| `tasklist` 次数/24h | 28,800 | ≈8,668（约 −70%） |
| 快照 watcher spawn（生成期间） | ≤40 次/分钟 | ≤24 次/分钟（限频 1500→2500ms） |
| 退出后最坏检测延迟 | 3s | 前 2 分钟 3s，之后 10s |

### 4. 渲染层降频 + 缓存快路径

| 脚本 | 旧 | 新 |
|---|---|---|
| `zcode-enhance-prompt.js` | 500ms 巡检；每 tick 3 次 `findDock()` | 1000ms；dock/输入框/挂载点走缓存，正常 tick 0 次 `findDock()` |
| `zcode-model-puller.js` | 350ms 全局查询（≈2.86 次/s） | 1500ms（≈0.67 次/s）；点击/按键 50ms 立即检查 |
| `zcode-tps.js` | 500ms 巡检；`prune` O(n²)；`statsOf` 每次 filter | 1000ms；`prune` O(n)；双指针窗口，无数组分配 |

- enhance 缓存用 `isConnected` + `offsetParent` + `contains` 校验；会话键变化时清空。
- 模型拉取按钮缓存用 `isConnected` + `offsetParent` 校验；点击/按键先清空再检查。
- TPS 流式期间仍由 `MessagePort` 消息帧事件驱动，实时性不变；1000ms 只负责挂载/会话态巡检。
- 上方布局防线（`isRealComposerCard`、`MAX_FIT_GAP`）保留；1s 巡检下问题卡出现后 ≤1s 隐藏/自愈。

### 5. `--min-age` 快路径提前

`tps_snapshot.main()` 把 `--min-age` 的 stat 判断移到 `resolve_cli_db()` 之前；
快照仍新时不再解析 `setting.json`。PostToolUse 移除后，这条路径主要服务手动/兜底调用。

## 评估后放弃：快照批量 SQL

曾计划把 `build_snapshot()` 从「`select distinct session_id` + 每会话 2 条 SQL」
改成「1 条 GROUP BY + 1 条窗口查询」，把 297 个会话的 **594 条 SELECT 降到 3 条**。

实测输出完全一致，但**更慢**：

| 数据源 | 逐会话索引查询（保留） | GROUP BY + 窗口（放弃） |
|---|---|---|
| 真实 DB（17,944 行 / 297 会话） | 59.3ms / 594 条 SELECT | 108.3ms / 3 条 SELECT |
| 合成 DB（297×60，含同款索引） | 15.0ms / 596 条 SELECT | 53.2ms / 3 条 SELECT |

原因：真实库有 `(session_id, turn_id)` 索引，逐会话查询是**索引 seek**（每次约
0.1ms）；批量方案为了算 `ctx` 和可见的 `last_*`，要做两次全表扫描 + 窗口排序，
单次查询更贵。查询数不是性能指标。

结论：保留逐会话路径，并在 `build_snapshot()` docstring 里写明这次实测，避免
以后又按“查询数越少越好”重做一遍。

## 第二轮（0.6.54）

第二轮针对「每次会话启动 / 每次轮询都会跑」的系统调用与重复检查。

### 6. Windows 进程探测改 ctypes（最大收益）

旧实现有两条子进程探测：

- `_from_running_processes()` 用 **PowerShell** `Get-Process | Select Path` 找客户端安装位置；
  **每个 `--check` 子进程**都会跑一次；
- `zcode_running()` 用 **tasklist** 判断 ZCode 是否在运行，**看护每 3–10s** 跑一次。

本机实测单次开销：PowerShell **986ms**、tasklist **320ms**（都是进程启动成本）。

新实现 `_win_process_paths()`：`EnumProcesses` + `QueryFullProcessImageNameW`
（ctypes，无子进程，**2.4ms**）。取不到（非 Windows / 老系统 / 权限异常）时回退原命令，
判定口径不变（进程名 `ZCode.exe`）。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 安装位置探测（每次 `--check`） | 986ms | 2.4ms |
| `zcode_running()`（看护每次轮询） | 320ms | 2.5–3.5ms |
| 看护 24h 进程探测 CPU（≈8,700 次） | ≈46 分钟 | ≈22 秒 |
| 单个 `--check`（含启动） | 1.31s | 0.30s |
| `--check --all`（4 补丁） | 1.71s | 0.49s |

`--check --all` 的剩余时间主要是 Python 启动 + 读 asar 条目 + 正则比对，不再是进程探测。

### 7. SessionStart 预检结论缓存

`sync.py --worker` 每次会话启动都跑 4 个 `--check`（≈0.3s CPU / ≈44MB 峰值每个）。
但**绝大多数会话启动时客户端和插件都没有变化**，这 4 次检查的结论必然与上次相同。

`run_sync()` 现在先算缓存键：

```
asar 列表 [(绝对路径, size, mtime_ns), …]
+ 5 个注入源文件 sha256（zcode_patcher.py / tps / enhance / puller / inject-status）
+ SYNC_CACHE_VERSION
```

命中则直接复用上次的 `{补丁: on/off/na}` 结论，**一个子进程都不起**；否则并行跑 4 个
`--check`，并在「状态全部明确 + 本次没有任何写入/延期/失败」时写回 `_sync_state.json`。

| 场景 | 优化前 | 优化后 |
|---|---|---|
| 常规会话启动（客户端/插件未变） | 4 进程、≈1.2s CPU、4×44MB 峰值 | 一次指纹比对 ≈25ms |
| 客户端升级 / 插件更新 / 看护写入后首次启动 | 4 进程 | 4 进程（指纹必然失效，重新检查） |

失效条件覆盖了所有已知的「客户端状态会变」的来源：看护写入、`--revert`、客户端升级都会
改变 asar 的 size/mtime；插件更新会改变源文件哈希。`unknown`（瞬时失败）从不写缓存。
这样既拿回启动开销，又不会重现 0.6.1 的「插件更新了但结论还是已一致」静默失效。

### 8. 客户端指纹复用版本号

`sync.py --detach` 在**会话启动内联路径**上调 `get_client_fingerprint()`，其中
`asar_version()` 要读 8.3MB header 再 `json.loads`（≈60ms）。指纹文件里已有同一份
`(路径, size, mtime)` 时直接复用 `version`，日常启动省掉这次解析；asar 一旦变化
（size/mtime 不同）照旧重新读取。

### 9. asar header 单进程复用

同一次 `--check --all` 里 `_read_asar_header()` 会被调用 5 次（版本号 + 4 个补丁），
每次 `json.loads` 8.3MB ≈22ms。新增按 `(path, size, mtime_ns)` 校验的进程内缓存，
只读路径共享同一份解析结果；**重打包路径显式 `use_cache=False`**，因为它会原地改写
header 树（插入/删除条目、重排 offset）。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| `--check --all` header 解析次数 | 5 | 1 |
| `--check --all` 耗时 | 0.69s | 0.49s |

## 复现

```bash
# 合成 asar + 快照决策对比（含真实索引）
python tests/bench_perf.py

# 真实客户端只读检查耗时
time python skills/zcode-tools/scripts/zcode_patcher.py --check --all

# 真实客户端检查峰值内存（tracemalloc，单进程）
python -c "import sys,io,tracemalloc,contextlib; sys.path.insert(0,'skills/zcode-tools/scripts'); import zcode_patcher as zp; sys.argv=['zcode_patcher.py','--check','--all']; tracemalloc.start();
with contextlib.redirect_stdout(io.StringIO()):
 rc=zp.main()
print('rc=%s peak=%.1fMB' % (rc, tracemalloc.get_traced_memory()[1]/1048576))"

# 第二轮：进程探测 / 同步缓存的耗时都在同一支基准里（Windows 才测 PowerShell/tasklist）
python tests/bench_perf.py

# 全量回归（本次：387 tests OK，6 skipped）
python -m unittest discover -s tests -v
```

## 回滚与边界

- 第一轮（asar ranged read / PostToolUse 移除 / 轮询降频 / 渲染层缓存）已随 `0.6.53` 发布。
- 第二轮（ctypes 进程探测 / 同步预检缓存 / 指纹复用 / header 缓存）与「排队消息布局修复」
  已随 `0.6.54` 发布。
- `_sync_state.json` 只是预检结论缓存，删掉无害：下次会话启动会重新跑 4 个 `--check`。
  若怀疑它导致误判，直接删除或置 `SYNC_CACHE_ENABLED = False`。
- ctypes 进程探测失败会自动回退 PowerShell / `tasklist`；两者行为与旧版完全一致。
- `zcode-tps.js` 同时包含「上方布局塌陷修复」「排队消息锚点」与性能改动；不要对它做整文件回退。
- 快照逐会话路径依赖客户端现有索引；如果未来客户端移除
  `model_usage_session_turn_idx`，应重新评估 `tests/bench_perf.py` 的两种方案。
