# 运行时性能优化记录

- 日期：2026-11-20
- 范围：`zcode-toolkit` 的 asar 检查/注入、TPS 快照、看护轮询、注入到渲染层的四个脚本、插件 hooks
- 版本：随 `0.6.53` 发布

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

# 全量回归（本次：378 tests OK，6 skipped）
python -m unittest discover -s tests -v
```

## 回滚与边界

- 所有改动目前**未提交**；先用 `git diff` 审阅。
- `zcode-tps.js` 同时包含「上方布局塌陷修复」与本次性能改动；不要对它做整文件回退。
- 未升版本号：本地重新注入 TPS 即可生效；插件市场分发仍需发布时统一 bump。
- 快照逐会话路径依赖客户端现有索引；如果未来客户端移除
  `model_usage_session_turn_idx`，应重新评估 `tests/bench_perf.py` 的两种方案。
