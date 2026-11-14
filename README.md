# ZCode-Tools · ZCode 客户端一站式原生增强套件

<p align="left">
  <a href="https://github.com/QiAn0107/ZCode-Tools/releases"><img src="https://img.shields.io/badge/version-0.6.34-blue.svg?style=flat-square" alt="Version"></a>
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
| ⚡ | **设置页模型拉取** | 设置页新增「⚡ 自动拉取模型」按钮，自动从供应商同步可用模型并批量写入 | `app.asar` 注入脚本 + IPC |

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
