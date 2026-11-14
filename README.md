# ZCode-Tools · ZCode 客户端一站式原生增强套件

<p align="left">
  <a href="https://github.com/QiAn0107/ZCode-Tools/releases"><img src="https://img.shields.io/badge/version-0.6.44-blue.svg?style=flat-square" alt="Version"></a>
  <img src="https://img.shields.io/badge/python-3.10+-3776AB.svg?style=flat-square&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/dependencies-0%20(std%20only)-success.svg?style=flat-square" alt="Dependencies">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
</p>

为 ZCode 桌面客户端补齐极致原生体验与生产力增强：
- 📊 **实时 TPS 与性能状态栏**：首 Token 延迟、tok/s 生成速度、会话轮数/步数、输入/输出与平均命中率、今日总耗常驻展示。
- ✨ **提示词智能增强**：输入框旁一键重写润色草稿；**右键自由选择**润色所用模型，支持一键恢复。
- ⚡ **设置页模型自动拉取**：设置页一键获取供应商可用模型，批量同步写入配置。
- ⚡ **一键模型同步**：设置页一键获取供应商 `/models` 模型列表，勾选即刻自动建条目并写入。
- 🛡️ **无感自愈看护（0.6.11 新特性）**：自动感知客户端与插件升级，后台单例看护静默守护，**彻底解决“客户端一升级补丁就失效”！**

> **纯 Python 标准库驱动**：零第三方依赖、免编译；改动仅作用于**本地客户端文件**；  
> 全量操作严格幂等，支持状态核查与逐项/全量精确还原。
>
> ⚠️ **声明**：非官方开源套件，与 ZCode 官方团队无关联。第三方声明见 [NOTICE.md](NOTICE.md)。
> 本仓库 fork 自 [c80361619/zcode-toolkit](https://github.com/c80361619/zcode-toolkit)，市场名与插件名统一为 `zcode-tools`。

---

## ⚡ 三分钟极速上手（推荐，全程零命令）

适合所有使用 ZCode 桌面端的用户，安装过程**完全无需打开命令行**：

| 步骤 | 操作说明 |
|:---:|---|
| **1. 环境确认** | 确认电脑已安装 **Python 3.10+**（系统自带或环境变量已配置）及 **ZCode 客户端**（实测支持 3.11.2 ~ 3.15.1） |
| **2. 添加市场** | 打开 ZCode **设置 → 插件 → 右上角「创建」→「添加插件市场」**，来源填：<br>`QiAn0107/ZCode-Tools` |
| **3. 安装插件** | 在「个人」分段找到 **ZCode-Tools**，点 **安装**（装好默认启用） |
| **4. 自动激活** | **完全退出并重启 ZCode**（托盘右键退出），在新会话中发任意一条消息，后台看护进程将自动完成注入并在下次启动后展现全部增强功能！ |

> 💡 **全自动开箱即用**：插件清单内所有功能默认全开，无需打开配置页。如需关闭某项，在插件配置页拨成关并保存即可。

---

## 🧩 核心功能矩阵

| 特性 | 功能名称 | 核心效果 | 改动范围 |
|:---:|:---|:---|:---|
| 🛡️ | **升级自动自愈** | 动态监控客户端与插件版本，升级后自动感知并调度看护静默修复 | 状态监控器 |
| 📊 | **实时 TPS 状态栏** | 输入框常驻：即时指标（首 token / tok/s）+ 会话累计（N轮N步 / 输入 / 输出 / 平均命中）+ 今日总耗，右键自由切换位置 | `app.asar` 注入脚本 |
| ✨ | **提示词增强润色** | 输入框旁「增强提示词」按钮，右键支持按供应商自选润色模型，持久化且免重启 | `app.asar` 注入脚本 + IPC |
| 🏷️ | **注入状态角标** | 左上角黑底金字「待注入」角标（补丁待写入时出现），点击确认后自动退出 → 看护注入 → 自动重启 | `app.asar` 注入脚本 + IPC |
| ⚡ | **设置页模型拉取** | 设置页「添加模型」左侧的下载图标按钮，点开弹窗自动同步供应商可用模型并批量写入 | `app.asar` 注入脚本 + IPC |

---

## 🛠️ 故障排查与一键自愈

> 💡 **0.6.11 自愈机制**：客户端升级会覆盖官方原版文件导致补丁失效。本插件在检测到升级后会自动重新排期看护，**通常只需在会话中收到提示后，完全退出并重启一次 ZCode 即可自动恢复！**

若遇到特殊情况（如杀毒软件拦截、网络断开等）导致功能未生效，请按以下方式排查与一键修复：

### 方案 A：客户端内一键修复（推荐，无需打开终端）
在 ZCode 任意对话窗口直接输入内置斜杠命令，AI 助手将自动帮您检测或打补丁：
- 输入 `/zcode-patch-doctor`：一键诊断健康状态与卡点；
- 输入 `/zcode-patch-apply`：一键自动重新应用所有增强补丁。

### 方案 B：全电脑通用单行自愈命令（适配所有电脑，任何路径直接粘贴）
无论您是否克隆过本仓库，也不管您在哪个路径打开终端，**直接复制并运行以下命令**（脚本会自动在系统插件缓存中搜寻并执行自愈，纠正启用状态并自动补齐所有补丁）：

```powershell
# Windows (CMD 或 PowerShell 任意路径直接运行)
python -c "import pathlib,subprocess,sys; p=next(pathlib.Path.home().glob('.zcode/**/doctor.py'),None); subprocess.run([sys.executable,str(p),'--fix']) if p else print('未找到已安装的 ZCode 插件，请先在客户端内安装')"
```

```bash
# macOS / Linux (任意终端直接运行)
python3 -c "import pathlib,subprocess,sys; p=next(pathlib.Path.home().glob('.zcode/**/doctor.py'),None); subprocess.run([sys.executable,str(p),'--fix']) if p else print('未找到已安装的 ZCode 插件，请先在客户端内安装')"
```

---

## 🎯 常用特性使用技巧

### 1. 增强提示词（右键自由指定模型）
- **左键点击**：根据当前选定模型一键润色重写草稿，支持一键「恢复原文」；
- **右键点击**：弹出供应商模型列表，可自由指定轻量、快速或专用模型（如 Claude 3.5 Haiku、GPT-4o-mini）专门用于润色，选择后**持久化保存且立即生效**。



---

## 🔄 卸载与还原

若您想完全停用增强补丁并恢复官方纯净状态：
1. 打开终端运行全域还原命令：
   ```powershell
   python -c "import pathlib,subprocess,sys; p=next(pathlib.Path.home().glob('.zcode/**/zcode_patcher.py'),None); subprocess.run([sys.executable,str(p),'--all','--revert']) if p else None"
   ```
2. 在 ZCode **设置 → 插件 → 管理已安装** 中，点击本插件的「卸载」即可。

---

## 📚 进阶文档与技术档案

<details>
<summary><b>🛠️ 开发者指南：本地离线安装、纯 CLI 与自动化构建</b></summary>

### 方式 B：本地源码离线安装
适合内网、GitHub 网络受限或本地二次开发的场景：
```bash
git clone https://github.com/QiAn0107/ZCode-Tools.git
```
在 ZCode「设置 → 插件 → 创建 → 添加插件市场」中选择该仓库目录，校验通过后即可安装。

### 方式 C：纯命令行模式（不装插件）
克隆仓库后，直接通过主脚本打补丁：
```bash
# 只读体检（自动探测 ZCode 安装位置）
python skills/zcode-tools/scripts/zcode_patcher.py --all --check

# 先完全退出 ZCode，然后一次性注入全部补丁
python skills/zcode-tools/scripts/zcode_patcher.py --all

# 单独还原某项（例如还原 TPS 状态栏）
python skills/zcode-tools/scripts/zcode_patcher.py --tps-footer --revert
```

### 方式 D：一键引导脚本（开发者专用）
```bash
python bootstrap.py            # macOS/Linux 使用 python3 bootstrap.py
```
自动执行平台环境校验、标准库检查、语法构建与 280+ 项回归测试。

### 方式 E：全自动流水线
```bash
./run.sh                       # Linux / macOS
run.cmd                        # Windows
```

</details>

<details>
<summary><b>🔬 自动注入机制与 ASAR 安全设计</b></summary>

### 1. 为什么补丁需要退出后写入？
`zcode_patcher.py` 具有严格的运行预检机制：只要系统中存在 `ZCode.exe` 进程便拒绝写盘。这是因为客户端运行时 `app.asar` 文件会被底层文件系统锁定，强行改写会导致文件损坏。因此本套件设计了看护单例（Watchdog）：在会话中记录期望状态，待客户端完全退出的一瞬间原子完成写入并自动重新拉起。

### 2. ASAR 重打包安全性
- **全域 Integrity 校验**：重打包时对所有 entry 的 SHA-256 与 offset 排布进行全局自洽检验，杜绝错位加载失败；
- **跨进程互斥锁**：写入全程施加文件锁，避免多进程并发争抢冲突。

</details>

<details>
<summary><b>📜 历史版本审计与故障排查记录</b></summary>

#### 0.6.44（角标代码烙版本号：每次发版必判 stale → 插件更新即亮角标；`__zinjDiag.ver` 可查客户端注入侧版本）
- **为什么需要**：0.6.43 修好了「更新后角标不亮」，但前提是**生成内容确实变了**——若某次发版没动注入组件，check_state 判「已一致」，角标不亮（语义上没错：没东西可注入），但用户无法确认修复链路是否已生效。0.6.44 起把插件版本号烙进注入的 main handler（`_plugin_version()` 向上找最近 `.zcode-plugin/plugin.json`，替换 `__ZP_VER__` 占位符）：**每次发版生成内容必变 → 必判 stale → 插件一更新完角标数秒内必亮**（0.6.43 的双源定位 + syncer_dir 漂移检测在客户端里生效后的第一个验证版本）；
- **诊断增益**：IPC 返回体与 `__zinjDiag.ver` 暴露注入侧代码版本，一眼可知客户端里跑的是哪版角标代码，排查「行为不符」不再靠猜；
- **副本一致性红线不受影响**：版本串不是本机路径——同版本副本烙同一串，字节仍一致；
- **测试**：全量 366 项通过（新增版本烙入断言：占位符清零、版本读自本副本清单、生成内容含 `ver:"x.y.z"`；冒烟补 `diag.ver` 捕获断言）；JS 语法验证（node --check 生成块）继续钉住模板转义——本次就靠它拦住一处模板残留的多余 `}`。

#### 0.6.43（修「插件更新后角标不亮、重开才亮」：sync 定位改双源 + 判定者漂移检测）
- **根因（0.6.42 用户实测）**：0.6.41 的 stale 补触发按**指针文件**定位 sync.py —— 指针由上一次跑 sync 的副本写入，插件更新后仍指向**旧版本副本**；补触发跑的是旧副本的 sync，它判客户端匹配**旧副本**内容 →「已一致」→ 写回 `pending:false`，角标要等重开 ZCode 后新副本的 SessionStart 才亮；
- **修复①sync 定位双源**：`installed_plugins.json` 的 `installPath` 优先（客户端在**更新那一刻**就改写的权威来源，实测 0.6.42 更新即指向 0.6.42），指针文件兜底；解释器仍取指针的 `python`（Electron 的 process.execPath 不能当 Python 用）；
- **修复②判定者漂移检测**：status 文件新增 `syncer_dir`（sync 与看护都写「谁产出的这份结论」），handler 发现 syncer_dir ≠ 当前 installPath（路径规整化后比对）→ **即使时间戳新鲜也立即重判**，消灭「更新后 30s 内 stamp 还新鲜」的窗口；
- **端到端测试真抓到一个拼接 bug**：installPath 是**插件根**，spawn 路径漏拼 `skills/zcode-tools/scripts` 段 → ENOENT 被 `ch.on("error")` 静默吞掉 → 补触发无声失效 —— 若非真跑断言（假家目录 + installed 清单 + 两个惰性 sync 桩 + 真 handler，断言 marker 来自安装清单副本）必然带病发布；
- **测试**：全量 365 项通过（新增端到端 respawn 钉子、READ handler 双源断言、syncer_dir 断言）；发布前泄漏终验：跑套件后无新进程、真实副本日志/指针/状态文件零污染。

#### 0.6.42（TPS 结算层实时化：移植参考实现的「DB 一变就重算 + 主动推送」链路 + 权威 tok/s 兜底）
- **刷新不及时根因**：快照新鲜度由钩子节奏决定（Stop 每轮 / PostToolUse 30s 节流 / SessionStart），没有任何机制「DB 一变就重算」——长回合中事件层漏采（scid 关联失败 / pending 回放失败）时轮/步/用量要冻到下次结算，最坏 30s+；渲染层再叠 3s TTL 拉取；
- **移植主进程 watcher**（对齐 xhwxt/zcode-token-usage-statusbar 的 inject-main.cjs）：`ztps-snapshot` main 块尾部新增 watcher 段——`fs.watch` 库目录（db.sqlite/-wal/-shm，WAL 写入也要感知）→ 300ms 去抖 → 1500ms 限频 + busy 单飞（限频窗口结束必补拉）→ 按指针文件 spawn 只读的 `tps_snapshot.py --quiet` 重算 → 读回快照 → `webContents.send("zcode:tps-push")` 推给渲染层；另监听快照文件本身（钩子写的同样推）。30s stat 心跳兜底 fs.watch 丢事件，挂失 5s 重连；**空闲零进程零轮询**。DB 落库 → 状态栏可见 ≈1-2s（与参考实现同级）；
- **安全边界收紧为白名单模式**：main 块从「只读、不起子进程」改为「spawn 仅限安全模式」——只允许「指针文件 `zcode-patches-scripts.json` 里的 python + scripts_dir/tps_snapshot.py + --quiet + windowsHide」这一个模式（异步单飞、15s 超时杀），仍禁 sqlite/shell/同步子进程/联网/写文件；白名单测试逐字节锁死该模式（经确认放开）；非 electron 环境 import 失败整体 no-op，真跑 harness 照常；
- **渲染层接推送**：`refreshSnapshot` 的缓存写入抽为 `acceptSnapshot`，拉取与推送共用；`onSnapshotPush` 按 stamp 去重、推送即重置 TTL 窗口；preload 桥新增 `onTpsPush(cb)`；无桥/旧版补丁时静默跳过，拉取兜底照旧。钩子（Stop/PostToolUse/SessionStart）保留为兜底写入者，与 watcher 并发写走 mkstemp+os.replace 原子替换；
- **不准确根因①②（tok/s 与首token 的估算误差）**：快照会话级新增最近一条**可见** completed 请求的权威指标 `last_tps = output ÷ (completed_at − first_token_at)`（可见=main_turn/compact，剔除 session_title/subagent 隐藏请求——实测某会话最后落库行是标题生成，直接取会显示「标题速度」；缺 first_token_at 退化 duration_ms，gen_ms<100 或 0 输出记 0）与 `last_ttft_ms`（SNAPSHOT_VERSION 1→2，老渲染层忽略新字段向后兼容）；渲染层只在**事件漏采（DB 比事件层最新活动还新 3s+）或事件层算不出**两处兜底，事件层有值绝不覆盖，流式轮一律排除（DB 只在请求完成时落行，流中没有权威数据）——流式 tok/s 照旧走事件层 0 延迟，其余指标 max 合并逻辑不动；
- **顺手纠正**：`tps_daily_smoke.js` §⑧ 还在断言 0.6.35 的 `+streamTurns` 旧形态（该冒烟未接 CI，对现行 pure-max 代码必挂），已改成现行形态并补 §⑨ 推送/兜底检查；
- **测试**：全量 364 项通过（快照新增 last_* 数学 10 项：退化/倒挂/0 输出/分母过小/id 平局/非 completed/隐藏请求剔除/compact 可选/老库缺列；patcher 白名单改写 + watcher 安全模式逐字节锁死；`scriptVersion` 3.22-turnstep→3.23-settle）。

#### 0.6.41（角标秒级亮起 + 退出后注入全程可见：主进程 stale 补触发 / check 并行 / 黑底金字进度小卡）
- **角标不亮根因①（不依赖开会话）**：`SessionStart` 只在新会话第一轮触发——刚打开 ZCode 不开会话时 status 文件是上一会话的旧结论，插件刚更新时旧值 `pending:false` 让角标一直不亮（用户实测「有时候不显示」）。修复：`zcode:inject-status` 只读 handler 发现 status 缺失/损坏/时间戳过期(>30s)时，主进程按**指针文件**后台补触发一次 `sync.py --worker`（`windowsHide+detached+stdio:ignore`，一次性守卫防重复，失败静默不影响返回值；生成内容依旧零本机路径）；
- **角标延迟根因②（sync 太慢）**：4 个 `--check` 子进程串行（每个在 385MB asar 上 2~3s，共 ~10s），status 文件最后才写。修复：`run_sync` 线程池并行预检（≈3s），判定循环按 `PATCHES` 原序串行不变；
- **角标延迟根因③（渲染层轮询）**：固定 10s 轮询 + 首次挂载只有一次机会。修复：立即首查 + 1/2/4/8s 突发重查 + focus 补查；350ms 自愈升级为「待注入但未挂载也创建」（首轮 DOM 未就绪不再等 10s）；
- **退出后注入进度可见（新）**：看护检测到 ZCode 退出、开始应用时弹右下角置顶**黑底金字 tkinter 进度小卡**（与角标同语言）：TPS 快照 → 各补丁批写入（绿=完成/红=失败）→ 指纹刷新 → 重启 ZCode；成功 ~1.5s 自动关窗，失败/预检未通过/找不到主程序**常驻到用户点掉**。应用阶段抽为 `_apply_phase`（工作线程）+ 主线程泵窗口（600s 子进程期间窗口不「未响应」）；无 tkinter 整体降级为旧行为，`_write_status` 新增 `phase` 字段兜底诊断；
- **顺手纠正**：看护有失败项时退出码按 docstring 约定返回 1（旧代码失败也返回 0，与文档自相矛盾）；
- **测试卫生（二次泄漏拆除）**：`TestDoctor.test_auto_fix_enables_plugin` 曾不打桩 sync 侧——mock 的「ZCode 运行中」走进 `auto_fix` 激活看护分支，真 `start_watchdog`（真 schtasks）全天在用户机器武装 DEV 树看护（`_sync.log` 08:32→12:59 十余条 arm 实证），未打桩类还会把真实指针文件改写指向开发仓库。现补齐全部桩（resolve_wanted/start_watchdog/resolve_v2_root/tps.main/LOG），跑套件后零新进程、零 arm、指针零污染；
- **测试**：全量 353 项通过（新增并行屏障回归、READ handler 补触发断言、进度窗口 5 项、phase 字段；两个挂载冒烟更新）。

#### 0.6.40（根治「注入→判旧→重排」死循环：生成内容副本无关 + sync 排期灭掉可见 cmd 窗口）
- **死循环根因（日志实锤）**：apply-now handler 把插件副本的 scripts 目录/解释器在**注入期烤进**生成的 JS——cache / marketplaces / 开发仓库三个副本烤入的字节不同，任一副本应用后，其它副本的同步必判「含旧版组件」→ 应用→判旧→重排死循环；实测两代旧看护（0.6.38 副本 + 开发仓库副本）在同一退出点赛跑，仓库副本抢先写入旧内容并重启，角标于是再次亮起；
- **修复①生成内容副本无关**：apply-now handler **不再烤入任何本机路径**——看护脚本位置只读指针文件 `<v2>/zcode-patches-scripts.json`（sync 每次同步写、`existsSync` 校验），缺失回 `no-pointer` 结构化报错引导重启；同一版本的任何副本注入结果**字节完全一致**；
- **修复②sync 排期灭掉可见 cmd 窗口**：sync 自己的排期此前仍走 `.cmd` 包装——Task Scheduler 以交互方式跑 .cmd，整个看护等待期挂一个**可见 cmd.exe 控制台**（用户实测截图）。现 `sync._start_watchdog_task` 同样直写 `/TR "pythonw" "apply_after_exit.py"`（不带 `--want` 参数避免 262 字符上限，看护合并 `_watchdog.want`），pythonw 为 GUI 子系统全程零窗口；残留的 `_watchdog_task.cmd` 文件与可见 cmd 进程已清理；
- **测试**：全量 345 项通过；新增「生成内容副本无关」回归钉（不得含本插件副本本机路径）、`TestWatchdogScheduledTask` 断言改写（/TR 直写、无 .cmd、无 --want）。

#### 0.6.39（修注入状态角标首战两雷：点击退出后看护静默夭折 / 拉起后角标残留；看护链路加固）
- **雷①：点角标关闭 ZCode 后无人注入拉起**——「退出并应用」handler 写的看护启动 `.cmd` 用 Node 默认 **UTF-8**，而 cmd.exe 按 **ANSI/GBK** 解析 `.cmd`，安装路径含中文（`实用小工具`）时变乱码 `瀹炵敤灏忓伐鍏穃` → pythonw 静默夭折、看护日志一片空白。**修复**：彻底不落 `.cmd` 中间文件——`schtasks /TR` 直接给「pythonw + apply_after_exit.py」两个带引号路径（Task Scheduler 以 UTF-16 存任务，天然免疫代码页）；/Create、/Run 结果强制追加进看护日志（`[apply-now]` 行），静默失败从此有迹可循；
- **雷②根因之一：烤入路径过期**——handler 的看护脚本路径在**注入期烤入**，插件升级后指向旧副本（0.6.38 实测甚至指向开发仓库副本）。**修复**：sync.py 每次同步写指针文件 `<v2>/zcode-patches-scripts.json`（scripts_dir + python），handler 优先读指针（`existsSync` 校验），烤入路径仅作兜底；
- **雷②：拉起后角标残留一段时间才消失**——`_write_status(failed == 0)` 参数写反，补丁全部成功却写 `pending:true`（日志实锤：「处理完成（失败 0 项）」与「pending=True」同屏）。**修复**：改 `failed > 0`；
- **加固①看护单例跨版本共享锁**：`<v2>/zcode-watchdog.pid`——每个插件版本副本各有自己的 `_watchdog.pid`，升级前后两版看护可能同时等待，退出后并发重打包同一个 asar（一方必 rc!=0）；共享锁保证全机同时只有一个看护；
- **加固②指纹刷新**：看护应用成功后调 `sync.refresh_client_fingerprint()`——重打包改了 asar 尺寸，不刷新的话下次启动会被误判成「客户端升级」弹假通知（0.6.38 实测每次都误报）；
- **测试卫生**：`test_detach_falls_back_to_foreground_when_spawn_fails` 曾不打桩跑真 run_sync——真 check_state 子进程 + 真 start_watchdog（真 schtasks）把开发树看护武装到了用户机器（本机实测泄漏的看护用开发树打了 4 个补丁）。现补齐桩补丁，`TestSyncModes` 同步隔离 `CLIENT_FINGERPRINT`；
- **测试**：全量 344 项通过；新增共享锁/指针文件/指纹刷新回归测试，`TestInjectStatusBlock` 断言更新（禁 .cmd、/TR 直写、指针、日志留痕）。

#### 0.6.38（新增注入状态角标：补丁待写入时出现，点击确认后自动退出→看护注入→自动重启）
- **新功能（第 4 项重打包级补丁 `--inject-status`，默认开）**：主窗口左上角标题条挂黑底金字「待注入」24px 角标（`#141414` 底 + `#E8B339` 金字金边），仅在补丁待写入时出现；点击弹原生风格确认弹窗（说明将**完全退出 ZCode**、未发送草稿会中断，列出待写入项；✕/取消/Esc/点遮罩均可关闭），确认后：main handler 复核 pending → 重写看护启动 `_watchdog_task.cmd` → `schtasks /Create+/Run ZCodePatchApply`（计划任务是唯一能逃出 ZCode Job 对象的启动方式）→ 200ms 后 `app.quit()`（被拦时 5s `app.exit(0)` 强退兜底）→ 看护等退出、写补丁、自动拉起，角标随 `pending:false` 消失；
- **状态真相源双写**：`<v2>/zcode-patches-status.json` 由 sync.py（SessionStart，按同步分歧写）与看护（应用后回写，失败保持 pending + 原因）双写，任一环失败角标也不会说谎；渲染层 10s 轮询只读 IPC，缺文件/无桥静默降级隐藏，绝不打扰；
- **挂载兜底**：优先结构挂载到标题条返回/前进按钮所在行，找不到锚点退化为固定位置（两者都带 `-webkit-app-region:no-drag`——标题条是拖拽区，不加就点不动）；`__zinjDiag.mountMode` 可查实况；
- **异常兜底**：pending 复核失败 / schtasks Create/Run 任一失败 → 原样返回**绝不退出**（假成功比不成功更危险），渲染层 toast 说明原因；
- **顺手拆弹**：`apply_after_exit.parse_wants` 对 `_watchdog.want` 历史残留键（0.6.34 移除的 usage_chart，merge 只增不删会永远留着）直接 KeyError——看护无人值守崩溃且无声（本机日志实测三连崩），整条退出→注入→拉起链路随之断裂；现跳过未知键并留痕；
- **拉取按钮贴右**：原生「模型列表」行容器是 space-between，图标按钮虽 DOM 紧贴添加模型却被摊到行中间——加 `margin-left:auto` 吃掉左侧富余空间，让「图标 + 添加模型」成对贴右（窄窗换行/两子元素/flex-start 等布局下同样成立）；
- **测试**：全量 341 项通过；新增 `TestInjectStatusBlock`（安全白名单：read handler 纯只读禁写禁网；apply handler 禁网、失败路径绝不 quit；路径烤入断言）、`TestPatchStatusFile`（双写）、`TestParseWantsUnknownKeys`（拆弹回归）、`TestInjectStatusSmoke` 接线 `tests/inject_status_mount_smoke.js`（六场景：标题条挂载/固定兜底/三种关弹窗/确认调用链/失败兜底/无桥降级）；全链路注册 16 处（ALL_PATCH_FLAGS / sync.PATCHES / doctor / 看护 / plugin.json / autopilot / commands 四表）。

#### 0.6.37（修压缩续接轮虚增轮数：可见 8 轮显示 9轮；拉取按钮改下载图标并移至「添加模型」左侧）
- **轮数虚增根因**：上下文压缩会把一个可见轮拆成两个 turn_id——压缩时上下文耗尽，续接段是新 turn_id 且整段 `query_source='compact'`、parent 为 NULL，转录里**没有新轮块**（用户看不见），但快照按 `count(distinct turn_id)` 计轮把它 +1——用户实测可见 8 轮显示 9轮。事件层按 DOM 可见 section 计数本来就是对的，幽灵轮全来自快照层；
- **修复**：快照 `turns` 只数含 `query_source='main_turn'` 行的 turn_id（compact 续接轮、纯 session_title/git_commit_message 隐藏请求轮都不算轮）；steps 口径不变（compact 续接请求是真实计费请求，照常计入）；老库无 `query_source` 列自动退回旧口径；顺带钉死「计划批准不分裂轮」（计划+批准+实施是同一个 turn_id，无需处理）；
- **测试**：新增 `test_compact_continuation_not_a_round` / `test_null_query_source_rows_still_count` / `test_legacy_db_without_query_source_column`；
- **模型拉取按钮重做**：「⚡ 自动拉取模型」文字胶囊按钮改为 28px 下载图标按钮，挂在「添加模型」**左侧**（原为右侧），含义靠 tooltip + `aria-label`；loading 态只转圈不换字（图标按钮尺寸不抖）；350ms 自愈循环顺带做位置再校准（React 重排挤偏自动插回原位）；弹窗与拉取/保存逻辑不变；
- **测试**：新增 `TestPullerTriggerStyle` 4 项源文本回归钉（禁止 after/文字 span/胶囊样式回潮）+ `tests/puller_mount_smoke.js` 最小 DOM 桩真跑脚本（左侧挂载 / 纯图标 / 挤偏自愈 / tooltip+aria）；全量 325 项通过；

#### 0.6.36（修复轮数/步数虚增：空闲 5 轮显示 6轮、回合中 3轮 215步）
- **根因**：轮/步合并公式是 `max(事件流累计, 快照.turns/requests + streaming 轮轮次/步数)`，依赖「快照只在轮末写入、流式中的轮一定没落库」这一前提，两点都塌了：①终态 `turnHeader` 行偶发缺失时，已结束的轮永远卡在 `streaming:true`，`+streamTurns` 把它当新轮再 +1——重启重放后 usage 不回放、卡住轮的 steps=0，于是空闲时刻 5 轮 149 请求显示 6轮 149步（步数碰巧对、轮数多 1）；运行中旧轮卡住则轮步齐虚（2 轮 ~115 请求显示 3轮 215步）；②0.6.35 的 PostToolUse 让快照在回合内也刷新，in-flight 轮一落库就进快照，`+stream` 变成双重计数（回合越长虚增越多）；
- **修复**：轮/步合并改为纯 `max(事件流实时累计, 快照结算值)`，删除 `+streamTurns/streamSteps` 补偿——新轮由事件流立即 +1，快照 ≤30s 追平；重开旧会话由快照兜底全历史；
- **测试**：新增 `TestTpsRoundsStepsMerge` 钉死公式（不得再出现 `+ streamTurns/streamSteps`）与根因注释；

#### 0.6.35（修复长回合中途「今日总耗/会话累计」冻结在回合初值，远低于官方用量页）
- **根因**：状态栏数值 = max(事件流实时捕获, DB 快照)，但快照只在 SessionStart / Stop(轮末) / 看护时刷新；一个回合跑几十分钟、上百步工具调用时，快照一直冻在回合开始值，而官方用量页直接读 DB（每请求落库）实时领先——用户实测官方 15.9M、状态栏 9m，轮末快照一写才跳到 20m；事件流层还收不到其它会话（侧边栏/旧会话）的 usage.delta，同样只能等快照；
- **修复**：新增 `PostToolUse` 钩子（每次工具调用触发）跑 `tps_snapshot.py --quiet --min-age 30`，快照 30s 内刷新过就只 stat 一次文件秒退、不碰 DB——回合中快照全程 ≤30s 新鲜，状态栏总耗/会话累计每 ≤30s 追上官方页，轮末 `Stop` 仍无条件精确刷一次；
- **测试**：新增 `TestSnapshotMinAge`（新鲜秒退且不碰 DB——用不存在的 db 路径钉死、超龄/缺失走 DB、节流门是纯 stat）与 `test_post_tool_use_keeps_snapshot_fresh_mid_turn`（钩子必须带 --min-age 节流）；

#### 0.6.34（移除用量页去截断功能，精简为 3 项补丁）
- **功能移除**：删除用量页去截断补丁（趋势图/饼图全量）——`--usage-chart` 参数、字节级补丁实现与 `app.asar.chart-patch.json` sidecar 机制整体下线，`--all`、插件开关清单、看护默认任务、doctor 检查项同步收敛为 TPS 状态栏 / 增强提示词 / 模型拉取按钮 3 项；
- **顺手清债**：0.6.23 移除模型弹窗加宽时遗留的不可达代码（失去函数头的 WIDTH 补丁体，及 `_load_sidecar` / `_asar_sync_integrity` / `_relocate_sidecar`）一并删除；sidecar 刷新函数更名 `_refresh_repack_sidecars`，只保留重打包级 sidecar 的指纹同步；
- **废弃产物清理**：`app.asar.chart-patch.json` 移入自动清理清单（与 slider/width sidecar 同待遇）；已打上的图表字节随下一次客户端升级被官方文件覆盖，自然回到原版行为；
- **配置兼容**：已保存过的 `usage_chart` 开关键不会被再执行（sync 按开关清单逐项遍历），doctor 里显示为「未知键」，无副作用，下次保存插件配置时自然消失；
- **测试**：全量 311 项通过；引擎「非重打包级当场重跑」分支改用桩补丁钉住（当前三个真实补丁均为重打包级）；

#### 0.6.33（修复 ZCode 退出时看护被连带结束，导致升级后补丁永远不写入）
- **根因**：Electron/Chromium 把子进程放进带 `KILL_ON_JOB_CLOSE` 的 Windows Job 对象；ZCode 退出时整棵进程树被结束，`DETACHED_PROCESS` 的退出看护也一起被杀。实测 `CREATE_BREAKAWAY_FROM_JOB` 会被 Job 拒绝（WinError 5），所以看护永远等不到「ZCode 已退出」，升级覆盖后的补丁也就一直不写入；
- **修复**：Windows 上改用一次性计划任务（`schtasks`）启动看护——Task Scheduler 启动的进程不在 ZCode 的 Job 里，能活到退出之后；`/Run` 后立即 `/Delete` 任务定义（删除定义不会终止已运行实例），不留定时残留；计划任务创建失败时回退原分离进程；
- **看护侧兜底**：`apply_after_exit.py` 退出清理时再次删除计划任务定义；命令写入短路径 `.cmd`，避开 `schtasks /TR` 的 262 字符限制；
- **测试**：新增 `TestWatchdogScheduledTask`（Create→Run→Delete 序列、创建失败回退、计划任务优先、Job 根因注释），全量通过。

#### 0.6.32（状态栏新增会话轮数/步数）
- **会话累计新增「N轮N步」**：轮=当前会话已完成轮数（快照 `count(distinct turn_id)`），步=已完成模型请求数（`count(*)`，一次模型请求=一步，含工具调用链）；事件流按 `usage.delta.requestId` 去重实时累加，快照按 `Math.max` 补历史，重开旧会话/轮次滚出视口也能显示完整值；
- **流式补差**：快照只在轮末由 `Stop` 钩子写入，流式中的轮一定还没落库，合并时把它补回快照基线，重开旧会话后首轮也能立即 `+1`；
- **展示层**：段位在会话累计组最前（`29轮671步 · 输入 …`），不改变输入/输出/平均命中/总耗口径；窄窗渐进降级顺序变为 总耗 → 首 token → tok/s → 轮步；
- **诊断**：`__ztpsDiag.aggRounds/aggSteps/snapTurns/snapRequests`；
- **测试**：新增步数 `requestId` 去重、快照合并、`N轮N步` 渲染断言，全量 312 项通过。

#### 0.6.31（回滚 0.6.30 的状态栏外观改动，恢复 0.6.29 样式）
- 0.6.30 的 DeepSeek 风重构（透明单行 / 线性图标 / 统一灰 / 无胶囊底）整体撤回，状态栏恢复为 0.6.25~0.6.29 的浅灰胶囊 + 绿点 + `·`/`│` 分组样式；
- 版本号前进而非回退：插件市场只认新版本，退版本号会导致「更新」不可用，故以 0.6.31 承载 0.6.29 的展示层；
- **保留** 0.6.27~0.6.29 的功能修复（快照 IPC 参数、会话 id 兜底、Stop 钩子按轮刷新、间距实测补偿），这些是数据正确性与间距 bug，不属于本次外观回滚范围；
- 测试与文档随回滚一并恢复，全量 312 项通过。

#### 0.6.29（状态栏与底部边框的距离）
- **末位元素负 margin 收不掉下方留白**：胶囊是父容器最后一个子元素时，`marginBottom` 负值只会压缩容器总高（父高 auto 时容器底同步上移，偏差恒定），**胶囊自己不会下移**，那段 `padding-bottom` 怎么调都还在。改为按「父容器边框盒底 − 胶囊下沿 − 2px」算下沉量，用 `translateY` 做视觉位移沉进 padding，上限 `MAX_SINK=16px`，不越过父容器、不压其它 UI；
- 有后继兄弟时仍用负 margin（那条路径有效），两条路径分开处理，互不干扰；
- 诊断：`__ztpsDiag.gapSink`（实际下沉像素）/`gapNext`（是否末位）；
- **测试**：冒烟新增 `MAX_SINK`、`translateY` 下沉、`room` 反算断言，全量 312 项通过。

#### 0.6.28（会话 id 兜底：让快照回填真正落到当前会话）
- **会话 id 取不到 = 输入/命中永远不显示**：3.17.x 把 `data-session-id` 挂在 composer 卡片上（无会话时是 `"draft"`），不在 `[data-workspace-conversation-frame]` 上；原逻辑只查 frame → `domSess=null` → 按会话查快照直接跳过。兜底顺序：① 事件流轮次自带的 `sessionId`（取最近有活动的一轮）② 主会话 DOM 里任一非 `draft` 的 `data-session-id`（排除侧边栏）；
- **重开旧会话也有累计**：数据态判定新增「快照有量」，此前只看事件流轮次，打开旧会话时只有「● 总耗」；同时 `statsOf` 允许无轮次（只渲染累计区），不会因 `latest=null` 崩；
- **测试**：冒烟新增 `draft` 判据、轮次 sessionId 兜底、DOM 兜底排除侧边栏、`snapHas`/`statsOf(null)` 断言，全量 312 项通过。

#### 0.6.27（修复输入/命中不显示、今日总耗不变化、状态栏下方间距、增强菜单与实际模型列表不符）
- **增强菜单与设置页开关逐项一致**：补上客户端的三层启用状态 —— ①`providerRules[].enabled=false` 整组关闭（火山方舟 Agent Plan 关了仍显示）；②`providerModelRules[].config.enabled=false` 单模型关闭（关掉的模型仍在列表）；③内置模板 `zcode-builtin.json` 的 `builtinModelIds` + `templateModelRules` 默认开关（小米 MiMo Token Plan 的 `personalModelIds` 为空，模型只在模板里 → 整组消失）。生效顺序：用户规则 > 模板默认 > 开启；`baseUrl`/`type` 缺失时回退模板（Responses 组不再需要借道 Chat）；旧格式 `config.json` 不再给权威源补模型（chat 侧多出的 11 个设置页不存在的模型即「关了还在」的来源）；
- **快照 IPC handler 参数误用（输入/命中缺失真因）**：`ipcMain.handle` 的第二参数是渲染层实参，0.6.26 却当 `path` 模块调 `.join()`；preload 不传参 → `undefined` → 每次调用抛 TypeError → 永远返回 `read-failed`，快照回填整条链路静默失效。改用 `import` 进来的 `r`，并加「真跑 handler 读真实快照」回归测试；
- **今日总耗不再冻在会话开始**：新增 `Stop` 钩子，每轮结束跑 `tps_snapshot.py --quiet` 刷新结算快照（DB 只有轮末落库）；渲染层 3s TTL 且轮次结束强制失效，本轮结算值即时可见；
- **状态栏下方间距按实测像素对齐**：不再猜父容器 `gap`（`space-y-*`/margin 布局读不到，0.6.25 方案会静默失效），改为量「胶囊上沿↔卡片下沿」「下沿↔下一元素」并用增量 margin 抵到 2px，偏差 <0.5px 停写、1s 节流重量；
- **诊断**：`__ztpsDiag` 新增 `snapshotOk/snapshotErr/snapshotToday`，失败原因可直接定位（`read-failed` / `no-snapshot` / 无桥）；
- **测试**：新增 handler 真跑回归 + `Stop` 钩子断言 + 间距增量修正断言 + 三层开关/模板回退回归，全量 312 项通过。

#### 0.6.26（TPS 双源混合：事件流实时 + DB 快照结算）
- **输入/命中缺失根治**：早到 `usage.delta` 暂存 `pendingUsage` 待桥接建成后回放（不再丢弃），`resetTurnStats` 追加清理会话/命令 ID，`diag` 新增 pending 计数；
- **DB 快照结算层**：新增 `tps_snapshot.py` 只读 `db.sqlite` 聚合（口径移植自 `xhwxt/zcode-token-usage-statusbar` MIT），TPS 补丁升级为 4 组件（含快照 preload 桥 + main 只读 handler），渲染层 `Math.max` 回填会话/今日，旧会话也有累计，失败静默降级为纯事件流；
- **测试**：新增 `test_tps_snapshot.py`（内存库口径）+ `TestTpsSnapshotBlock`（桥白名单/定界/迁移）+ 冒烟 pending/快照断言。

#### 0.6.25（增强菜单清单对齐实际 + 状态条间距修复）
- **菜单清单与设置页对齐**：候选表合并从 pid 级改为模型级（`config.json` 独有模型不再被丢弃）；`systemDisabledReason` 补拷，禁用供应商正确过滤；跨供应商重名模型标注供应商后缀；空模型组整组隐藏（不再显示"没有可用模型"占位）；
- **状态条下方间距**：composer-below 模式读父容器纵向 gap 并以等量负 `marginBottom` 自适应抵消，gap 变化自动刷新；
- **测试**：新增 `TestListModelsCompleteness`（真跑 handler：模型合并/空组隐藏/dup 标记/禁用过滤），挂载冒烟追加空组+dup 断言，TPS 冒烟锁 gap 补偿。

#### 0.6.24（TPS 状态栏改版：会话输入/输出/平均命中 + 今日总耗）
- **累计区重构**：删除第 N 轮、总用、命中绝对值、累思与思考显示，会话累计精简为 `输入 xx · 输出 xx · 平均命中 xx%`（输入>0 即显示，含 `0.00%`）；
- **新增今日总耗**：`总耗 xx` 显示今日 Σ(input+output) 精确值，按 `occurredAt` 本地日期分桶存 `localStorage`（保留 30 天，重复事件幂等去重），空会话也常驻显示；仅补丁运行期间捕获；
- **测试**：新增 `tests/tps_daily_smoke.js`（分桶/去重/裁剪/容错），更新百分比冒烟与回归断言。

#### 0.6.16（解决思考档位关闭导致退出无限重启死循环，Issue #5）
- **语义修正为“不托管”**：3.14+ 思考档位配置目标为客户端自带的 `provider_config.json`；当开关关闭时语义明确为“停止托管与同步”，插件不再主动写入，且绝不主动还原该文件，彻底切断“退出还原 → 客户端重启写回 → 再次检测冲突 → 再次看护还原”的无限死循环；
- **看护空任务守卫**：`apply_after_exit.py` 严格过滤 `reasoning_config=off` 任务；若最终无待执行补丁任务，看护直接安全退出，杜绝空任务挂起等待与退出自动重启 ZCode。
- **全平台兼容吸收**：完整吸纳 PR #4 对 macOS 看护链路的跨平台支持与 crashpad 僵尸进程排除。

#### 0.6.20（彻底修复提示词润色失败与“显示已完成但不出现文案”问题）
- **根治会话隔离误杀（不出现润色文案）**：重构跨会话防护判定，当当前输入框依然处于聚焦/就绪状态且文本未被篡改时，直接写入润色结果；改进草稿会话临时键生成机制，杜绝 DOM 重绘导致的虚假跨会话切换误杀（不再提示“原会话提示词润色已完成未写入当前会话”）；
- **深度思考（Reasoning）与空内容兜底**：适配 DeepSeek-R1、GLM-5.3 等带深度思考的模型，当 `content` 处于空字符串时自动从 `reasoning_content` 提取润色文本，消除“模型返回了空内容”误报；
- **智能故障转移（Fallback Recovery）**：当当前所选模型遭遇余额不足（400/402）、上游超时、服务异常或返回空回复时，自动无缝尝试其他可用供应商的备用模型完成润色并给出友好提示，彻底避免润色中断；
- **补齐 Anthropic 必填协议头**：针对 `anthropic-messages` 协议自动补齐 `anthropic-version: 2023-06-01` 请求头，解决部分中转站与官方端点 400 Bad Request 拒绝问题。

#### 0.6.19（对齐官方开源代码仓库规范与深度全方位优化）
- **DOM 锚点全面对齐官方 `test-ids` 契约**：根据上游官方开源代码规范（`v3.15.1`，commit `aac4755`），重构模型拉取按钮挂载点（对齐 `[data-testid="model-provider-add-model-button"]`）、提示词增强与思考强度滑条探针（优先对接官方 `[data-testid="v4-model-config"]`），彻底根除基于脆弱文案或坐标扫描的失效隐患；
- **TPS 状态栏深度遥测与校准**：捕获官方下发的 `turnHeader.modelDurationMs`，扣除网络排队与流式波动，精准校准整轮纯模型生成速度；捕获 `usage.delta` 原生 `reasoningTokens` 与 `cacheWriteTokens`，实时与会话累计段新增思考 Token 消耗指标（`思考 xx` / `累思 xx`）；
- **Composer 工具栏双态按钮追踪**：升级支持 `[data-testid='v4-composer-send'], [data-testid='v4-stop']`，在流式生成期间精准锁定工具栏位置，彻底消除回退漂移；
- **用量图表补丁自适应正则匹配**：用量图表去截断补丁升级为弹性正则嗅探引擎，免受版本混淆压缩变量名变更影响；
- **配置侧原生支持 `maxOutputTokens`**：`--reasoning-config` 同步引擎深度支持 `maxOutputTokens` CEL map 映射及上限写入，完美适配新版 OptionSpecs 规范；
- **官方版本认证**：全量通过 316+ 项单元与集成测试，实测认证覆盖 3.11.2 ~ 3.15.1。

#### 0.6.15（彻底根治会话生成中润色模型漂移与失败问题）
- **会话粘性记忆与侧边栏隔离**：`zcode-enhance-prompt.js` 引入 `lastKnownModel` 会话粘性记忆，流式生成中当原生工具栏处于禁用/重绘瞬态时无缝沿用该会话最新选中的模型；全局搜索强制排除侧边栏，杜绝抓取辅助对话的模型；
- **跨脚本实时事件信源联动**：`zcode-tps.js` 捕获 ServicePort 事件流的底层实时 `ev.modelId` 并暴露全局，形成模型定位双保险；
- **主进程坚守当前供应商**：`zcode_patcher.py` 优化解析引擎，中转站与自定义模型只要所属供应商有效即坚守在该供应商发请求，彻底杜绝越界 Fallback 到系统其他无关供应商导致 400 失败的问题。

#### 0.6.14（TPS 状态栏优化：去除 out 替换为会话总用量）
- **即时指标精简**：彻底去除含义模糊的单轮 `out`，本轮指标聚焦于「首 Token 延迟」与「生成速率」，视觉更清爽；
- **会话总 Token 展示**：在会话累计组新增 `总用 xx` Token 消耗量统计（`累计输入 + 累计输出`），一目了然看清当前会话整体 Token 消耗。

#### 0.6.13（提示词增强侧边栏隔离、看护批处理重打包与 3.14.5 适配）
- **提示词增强侧边栏隔离**：`zcode-enhance-prompt.js` 补齐侧边栏边界判定（`isInsideSidePane`）与等高靠左优先保序，自愈分支杜绝误挂，彻底根治侧边栏辅助对话导致润色按钮飘移的竞态；
- **看护批处理极速重打包**：`apply_after_exit.py` 重构任务调度引擎，同方向（应用或还原）多项补丁合并为单次批量调用，ASAR 重打包耗时从 20s+ 缩短至 2~3s，消除用户快速重启造成的进程冲突隐患；
- **客户端版本认证**：完成最新客户端版本 `3.14.5` 实测认证，全量 250+ 项单元与集成测试全绿通过。

#### 0.6.12（修复侧边栏辅助对话双 Composer 竞态跳动）
- 修复当侧边栏开启「辅助对话」时双输入框在同一高度竞态导致 TPS 状态栏来回跳动的问题；
- 新增 `isInsideSidePane` 与 `isInsideMainConversation` 边界判断，严格限定只在主界面对话框下显示，彻底消除跳动与轮次数据串台。

#### 0.6.11（升级自愈与看护优化）
- `sync.py` 引入客户端指纹比对，自动识别客户端升级并重置通知标记，自动调度看护；
- `apply_after_exit.py` 补齐 7 项补丁，并实现 `_watchdog.pid` + `_watchdog.want` 单例互斥与需求合并；
- `doctor.py` 增加 `--fix` 一键自愈命令。

#### 0.6.10（旧脚本失效检测）
- 修复 `_process_script_inject` 的 check 分支仅检查结构未比对内容的缺陷，新增内容哈希比对并标记 stale。

#### 0.6.8 - 0.6.9（TPS 精度与菜单交互）
- 状态栏平均命中率改为精确到两位小数；
- 优化提示词右键菜单的关闭机制，消除滚动与多频事件误关问题。

#### 0.6.5（ASAR 布局错位保护）
- 引入 `_AsarWriteLock` 进程锁与文件锁；
- 全域逐条 integrity 校验，防范错位启动崩溃。

</details>

---

## 许可协议

本项目采用 [MIT License](LICENSE) 开源协议。第三方组件声明见 [NOTICE.md](NOTICE.md)。
