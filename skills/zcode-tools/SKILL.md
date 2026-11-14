---
name: zcode-tools
description: "[仅手动调用，禁止自动触发] ZCode 客户端本地补丁注入工具：①TPS 状态栏（输入框统计条：本轮指标+会话累计）②增强提示词按钮（一键润色输入框草稿，右键可选润色所用模型）③设置页一键模型拉取按钮。全部幂等、可 --check、可 --revert 精确还原。只有当用户明确要求执行本 skill、或明确点名「zcode-tools」时才加载；用户只是泛泛提到状态栏、补丁等话题时，一律不要自动触发本 skill。"
---

# ZCode 客户端补丁工具

> 本 skill 由 **zcode-tools 插件**提供，脚本就在本 skill 目录下的 `scripts/`（下文所有 `<skill目录>` 均指本目录）。

**先跑这一条**（只读，不改任何文件，一条命令看全部 3 项功能的状态）：

```bash
python "<skill目录>/scripts/zcode_patcher.py" --all --check
```

`--all` = 对所有功能生效，等价于把所有补丁参数都写一遍；配合 `--check` 是体检、不带参数是全装、
配合 `--revert` 是全还原。要单项操作时仍按后文的单功能命令来（`--all` 会覆盖单个参数）。

**用户说「插件装了但没生效」时，先跑安装自检**（同样只读；它会检查插件是否启用、
配置是否保存过、钩子是否跑过，并直接给出卡点结论）：

```bash
python "<skill目录>/scripts/doctor.py"          # 可读报告
python "<skill目录>/scripts/doctor.py" --json   # 结构化输出，便于贴给别人
python "<skill目录>/scripts/doctor.py" --where  # 只查「插件装在哪」+ 可直接复制的绝对路径
```

> **别站在插件的缓存目录里敲相对路径**——用户最常踩的坑，报错长这样：
> `can't open file '...\.zcode\cli\plugins\cache\zcode-tools\skills\...\doctor.py'`。
> `cache\<市场名>\` 是**市场目录**，插件根在更深一层：GitHub 来源的市场缓存成
> **`cache\<市场名>\<插件名>\<版本>\`**，`skills\` 在**版本目录里面**。
> 找不到时：`--where` 列命中路径；或用系统命令搜
> （PowerShell `Get-ChildItem "$env:USERPROFILE\.zcode\cli\plugins" -Recurse -Filter doctor.py`；
> macOS/Linux `find ~/.zcode/cli/plugins -name doctor.py`）。

插件这条路要过「安装 → 启用 → 钩子触发 → 自动注入 → 打补丁」五关，任何一关没走通，
界面上的表现都一样是「什么也没发生」。**最常见的卡点是「插件没启用」**。
钩子是否真的执行过，看 `scripts/_sync.last` 心跳文件；不存在 = 钩子从未被调用。

> **装完即用，不需要打开配置页。** 插件清单里 3 个开关的 `default` 全是 `true`，没保存过配置时
> `sync.py` 就按这份默认值注入。ZCode 的插件清单**没有「安装时钩子」**——官方规范
> `plugin-json-spec.md` 原文只允许声明 `skills` / `commands` / `hooks` / `mcpServers`
> 四类组件（「Optional components: `skills` and `commands` point to directories; `hooks` points to
> `hooks/hooks.json`; `mcpServers` can point to `.mcp.json` or contain the server configuration」），
> 没有任何「点下安装按钮时执行」的入口。所以最早能自动触发的时机是
> **下一次会话启动的 `SessionStart`** —— 这是规范决定的，不是实现取巧。

## 版本现状（动手前先看）

补丁会随 ZCode 升级失效或过时，先确认目标版本，再决定打哪个：

| 补丁 | 3.11.2 及更早 | 3.14.x ~ 3.15.x（实测 3.14.1 / 3.14.3 / 3.15.1） |
|---|---|---|
| ① TPS 状态栏 | 需要 | 需要（支持原生思考 Token 统计、耗时精准校准与双态按钮常驻追踪） |
| ② 模型拉取按钮 | 需要 | 需要，优先对齐官方 `model-provider-add-model-button` 契约，模板按 `optionSpecs` 新格式写入 |
| ③ 增强提示词 | —（新功能） | 需要：优先对接官方 `v4-model-config` 契约锚点；支持右键按供应商自选模型，持久化且免重启 |

> **升级会整体覆盖 app.asar**：升级后需重跑补丁。
> 三项都是**重打包级**，重跑时会按内容比对自动热更新脚本，无需先 `--revert`。

- 通用开关（所有补丁适用）：`--all` 对所有功能生效（等价于写全所有补丁参数）·
  `--dry-run` 只报告改动不写盘 · `--verbose` 打印安装探测细节 ·
  `--force` 跳过备份指纹校验（慎用）· `--prune` 清理安装目录里的补丁产物
  （`--prune --deep` 连当前 `.bak` 与 sidecar 一起清，之后无法 `--revert`，需重打才有记录）。
  每次执行结束会打印「执行汇总」表（补丁 × 目标 × 成功/失败），失败项返回退出码 1。
- **打补丁/还原前会预检 ZCode 进程**：运行中直接拒绝（退出码 2）。只读 `--check` 与 `--dry-run` 不受限。
- 备份带**版本指纹**（`*.bak.meta.json`）：客户端升级后旧备份自动归档（改名 `.stale-<时间>`），
  还原时若当前文件与备份不是同一版本会**拒绝执行**，避免把旧内核/asar 盖回新客户端。
- 确认版本：看客户端「关于」，或安装根目录（如 `D:\ZCode`）的版本信息。

### 插件开关（配置区）

插件在 ZCode 的「设置 → 插件 → 已安装 → 点开插件 → 高级信息 → 配置」里声明了 3 个开关。**不拨也能用**：没保存过配置时按清单默认值（全开）注入。拨动开关并点「保存配置」后，插件会在**下次会话启动时登记期望状态**，再由 `apply_after_exit.py` 在 **ZCode 退出时写入**客户端（写完自动重启 ZCode），不需要手动跑命令（插件的安装方式见仓库 README 的「安装」章节）：

> **为什么三项一律等退出**：`zcode_patcher.py` 的运行预检是**全局**的 —— `zcode_running()` 只查
> `tasklist` 里有没有 `ZCode.exe`，与 target 无关，命中就直接 `return 2` 拒绝写入（app.asar 被锁、
> `config.json` / `provider_config.json` 会被客户端回写覆盖）。而会话钩子**必然**在 ZCode 运行中触发，
> 所以「会话内立即生效」这条路走不通。`sync.py` 的策略是**先试立即写，被拒就自动转交退出后看护**，
> 这样纯 CLI 场景（没有 ZCode.exe 在跑）仍能即时生效。

| 开关 | 控制的功能 | 默认 | 生效时机 |
|---|---|---|---|
| TPS 状态栏 | `--tps-footer` | 开 | ZCode 退出时自动应用，**再启动**才生效（两次启停） |
| 设置页模型拉取按钮 | `--model-puller` | 开 | ZCode 退出时自动应用，**再启动**才生效（两次启停） |
| 增强提示词按钮 | `--enhance-prompt` | 开 | ZCode 退出时自动应用，**再启动**才生效（两次启停） |
| 注入状态角标 | `--inject-status` | 开 | ZCode 退出时自动应用，**再启动**才生效（两次启停） |

行为约定（`scripts/sync.py`，由 SessionStart hook 调用）：

- **零配置自动注入**：`resolve_wanted()` 的合并规则是**已保存的开关优先，没保存过的键退回
  `plugin.json` 里 `userConfig.*.default` 声明的默认值**。三种情形：
  ① 从没保存过 → 全部用默认值（这就是「装完即用」）；② 保存过一部分 → 保存的照做、缺的键补默认值
  （插件升级新增开关时不会漏）；③ 显式关掉 → 保存值是 `false`，优先于默认值，会被正常还原。
  **这一条是「安装成功但不生效」的根治点**：ZCode 只在用户点过「保存配置」后才写
  `plugins.options`，旧逻辑把「没表态」当成「不要做」，于是装完重启什么都没发生、界面上也看不出原因。
- **`na` 是必需的第三态**：`check_state()` 除了 `on` / `off` 还要能报 `na`（本版本不适用）。
  ≤3.11 专用的内核补丁在 3.14+ 会打印「本补丁不适用」，若只看「未打」→ 去执行 → 脚本空转一圈，
  最后却报成「已生效」。默认值全开之后这个误报每次装完都会出现，必须单独成一态、只标注不执行。
- **钩子是「登记心跳 + 后台化」就返回**（`sync.py --detach` → 子进程 `--worker`）。
  原因：hook 是**内联**执行的（`async` 字段当前无运行时效果），而同步要跑多次 `--check`
  （每次约 2 秒），同步做完再返回会拖住会话启动，还可能撞上钩子超时被砍掉。
- **`--check` 并行跑**（0.6.41）：`run_sync` 用线程池并发跑全部 wanted 键的 `--check`
  （纯只读子进程、互相独立），4 项串行 ≈10s → ≈3s——status 文件在全部 check 完成后才写，
  这 10s 直接拖后角标亮起时间。判定循环仍按 `PATCHES` 原序串行（`run_patcher` 保持串行）。
- **主进程 stale 补触发**（0.6.41，0.6.43 修定位源）：`SessionStart` 只在**新会话第一轮**
  触发——应用刚启动、用户还没开会话时 status 文件是上一会话的旧结论（插件刚更新时旧值
  `pending:false` 会让角标一直不亮）。所以 `zcode:inject-status` 只读 handler 发现 status
  缺失/损坏/时间戳过期(>30s)**或判定者漂移**时，后台补触发一次 `sync.py --worker`
  （守卫保证每次主进程运行最多一次；`windowsHide+detached+stdio:ignore`，失败静默不影响
  返回值）。**sync 位置是双源**：`installed_plugins.json` 的 `installPath` 优先（插件更新
  那一刻即更新的权威来源；拼路径必须补 `skills/zcode-tools/scripts` 段——installPath 是
  **插件根**不是 scripts 目录），指针文件兜底；解释器仍取指针的 `python`（Electron 的
  process.execPath 不能当 Python 用）。0.6.41 只认指针的缺陷：插件更新后指针滞后一版，
  旧副本的 sync 判客户端「已一致」写回 `pending:false`，角标在重开前永远不亮（0.6.42
  用户实测）。判定者漂移 = status 的 `syncer_dir`（sync/看护写入「谁写的」）≠ 当前
  installPath（路径规整化后比对）→ 即使时间戳新鲜也立即重判。
  **生成内容依旧零本机路径**（副本字节一致性红线）。
- **退出后注入进度可见**（0.6.41）：看护检测到 ZCode 退出、开始应用时，弹黑底金字
  tkinter 进度小卡（右下角置顶，与角标同语言），逐步显示 TPS 快照 → 各补丁批写入
  （完成/失败）→ 指纹刷新 → 重启 ZCode；成功 ~1.5s 自动关窗，**失败常驻到用户点掉**。
  应用阶段抽为 `_apply_phase`（工作线程）+ 主线程泵窗口（避免子进程最长 600s 期间
  「未响应」）；无 tkinter / 建窗失败 → 无窗降级，行为与旧版一致，`_write_status` 的
  `phase` 字段（正在写入补丁…/完成/完成（失败 N 项））仍可事后诊断。有失败项时退出码
  对齐 docstring 约定返回 1（旧代码失败也返回 0，与文档自相矛盾，顺手纠正）。
- **首次自动注入时往会话里发一条说明**（`emit_notice()`），让「到底做没做」看得见；
  标记文件 `scripts/_autoinject.done` 保证只出一次。输出只用**顶层 `additionalContext`**：
  内核 `Lio()` 里 `t.additionalContext && n.additionalContexts.push(...)` 是**无条件**消费的，
  而 `hookSpecificOutput` 还要校验 `hookEventName` 与本次事件一致（写错 → 「Hook returned wrong
  event name」→ 这次钩子被标成失败）。另外 stdout 只在 `wQs()` 的 `startsWith("{")` 成立时才解析。
- 重打包级补丁（TPS / 增强 / 拉取）写进退出后看护
  `scripts/apply_after_exit.py`，等 ZCode 完全退出时自动应用（**asar 本身没有被锁**，实测
  `CreateFileW(share=0)` 能独占打开；真正的原因是 ZCode **只在启动时读一次** app.asar，
  运行期写入不影响当前会话）。
- 开关状态与客户端实际状态不一致是正常的：清单里的默认值是静态声明，不反映历史补丁状态。
  **把开关拨成你想要的状态并保存**，同步后两者就一致了。
- 日志与心跳：`scripts/_sync.log`（同步日志）、`scripts/_sync.last`（每次被调用都刷新，
  证明「钩子到底跑没跑」）。没找到配置时会记录 `config.json` 里 `plugins` 的实际键名。
- 一键自检：`python scripts/doctor.py`（只读）——插件是否安装/启用、配置是否保存过、
  钩子是否跑过、三项补丁状态，末尾直接给卡点结论。`--where` 只查安装位置，
  `--where-all` 连扫过的全部候选目录一起列（本机 120 个，默认只列命中项）。
- **插件副本的三种落点**（判断「装没装」要**按清单里的 name 认**，不能靠目录名）：
  - `<数据>/cli/plugins/marketplaces/<市场 id>/` —— directory 来源；`source: "./"` 时**市场根即插件根**
  - `<数据>/cli/plugins/cache/<市场名>/<插件名>/<版本>/` —— GitHub/URL 来源，**插件根在版本目录里**
    （实测 `cache/zcode-plugins-official/computer-use/0.5.13/.zcode-plugin/plugin.json`）
  - `<数据>/cli/plugins/cache/<市场名>/plugins/<插件名>/` —— 市场仓库里带 `plugins/` 子目录时
  - **缓存会堆积多个历史版本**（本机 `cache/zcode-tools/zcode-tools/` 下有 0.3.1、0.5.x 等，
    更早还有 `dev-default-22da16fd/zcode-patcher/` 的 0.1.0/0.1.1/0.2.0/0.2.1），
    所以自检会报出全部命中项并按 mtime 提示最新的那份。
- **配置键格式是 `<插件名>@<市场名>`**（实测 `computer-use@zcode-plugins-official`）——
  匹配时只认 `<插件名>@…`，别用裸 `startswith`。

### 钩子机制要点（官方 `diagnosing-hooks` skill + 内核实测）

排查钩子问题时按这些硬事实对照，别凭直觉猜：

- **插件钩子无需额外开关**：只要**任意一个插件**提供了钩子，钩子运行器就自动启用。
  而配置文件（`~/.zcode/cli/config.json` 的顶层 `hooks`）里的钩子**默认关闭**，
  必须写 `hooks.enabled: true`；它的形状是 `{enabled, timeoutMs, maxOutputBytes, events:{<事件>:[...]}}`
  （比插件 `hooks/hooks.json` 多一层 `events`）。
- **没有信任门禁**：官方明确说明「所有插件钩子都是 runnable」，第三方与内置一视同仁；
  早期「未信任前仅诊断」的说法已过时。
- **事件名只有 7 个**：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PermissionRequest` /
  `PostToolUse` / `PostToolUseFailure` / `Stop`。`Notification` / `SubagentStop` / `PreCompact` **不支持**。
- **matcher 是大小写敏感的正则**，测试值随事件不同：`SessionStart` 的值是
  `startup` / `resume` / `clear` / `compact`（**省略 matcher = 匹配全部**）。
  ⚠️ 本插件的钩子**故意不写 matcher**：只写 `startup|clear|compact` 会漏掉 `resume`，
  而「重开 ZCode 恢复上次会话」走的正是 `resume`——那就会静默不触发。
- **`SessionStart` 在新会话的第一轮触发**（日志里表现为 `turnNumber: 0` 的 `session_start_hooks` 阶段），
  不是开机自启那一刻。所以「重启后必须真的开个会话」。
- **超时单位**：`type:"command"` 的 `timeout` 是**秒**，`process` 的 `timeoutMs` 是**毫秒**；
  解析顺序 `timeoutMs` → `timeout×1000` → 配置的 `timeoutMs` → 默认 60000ms。
- **字段不能混用**：`process` 只认 `command`/`args`/`timeoutMs`；`command` 认 `command`/`shell`/`timeout`/`timeoutMs`。混了钩子会被丢弃。
- **`async` 字段当前无运行时效果**，钩子一律内联执行。
- **钩子的 stdout 会被按严格 JSON schema 解析**：输出非 JSON（或含多余键）会被判为
  「运行失败」并丢弃输出。所以 `sync.py` 在后台路径上**一声不吭**（要反馈就写日志/心跳）。
- **模板变量**：`${CLAUDE_PLUGIN_ROOT}` / `${ZCODE_PLUGIN_ROOT}`（仅插件钩子）、
  `${CLAUDE_PROJECT_DIR}` / `${ZCODE_PROJECT_DIR}`、`${CLAUDE_SESSION_ID}`；
  这些变量同时会注入为环境变量。**`userConfig` 的值不在其中**——所以 `sync.py` 必须自己读
  `config.json` 的 `plugins.options`。
- **执行记录在 ZCode 日志里**：`~/.zcode/cli/log/zcode-<日期>.jsonl`。两类记录最有用：
  - `turn.phase.*` 且 `context.phase == "session_start_hooks"` —— 会话启动阶段跑过（链路本身是通的）；
  - `bootstrap.app.startup.plugins.completed` —— context 带 `pluginCount` /
    `enabledPluginCount` / **`hookCount`** / `diagnosticCount` / `skillRootCount`。
    **`hookCount` 是最靠前的一层证据**：它表示这次启动 ZCode 到底注册了几个钩子。
    为 0 就说明「插件没启用 / hooks.json 没被读到」——**轮不到讨论钩子有没有执行**。
    `doctor.py` 第 7 节会直接读它并给出结论，不用让用户自己去翻日志。
- **⚠ 中文 Windows 的编码坑（本插件踩过一次真故障）**：控制台是 cp936（GBK）。
  输出**走管道**时（`> log.txt`、`subprocess.run(capture_output=True)`）Python 不再走
  WriteConsoleW，而是按 cp936 编码 —— print 一个 GBK 里没有的字符（`✓` `✗` `⚠` `✅` `↻`）
  会抛 `UnicodeEncodeError`，**把整段输出打断**。实测：doctor 捕获 patcher 输出时，
  汇总表在 `✓ 用量页去截断补丁` 那行崩掉，用户只看到半张表 + traceback，
  还以为是补丁本身失败。交互式控制台不受影响 → **这个坑只在管道里露头，手跑脚本测不出来**。
  → 所有会 print 的脚本都从 `_console.py` 取 `safe_stdio()`（`errors=replace` 兜底，
  永不崩）与 `ok_mark()` / `bad_mark()` / `warn_mark()` / `glyph()`（编不出就换 ASCII 备选）。
  **`√` `×` `→` `·` `□` 在 cp936 里是有的**，所以标记用 `√`/`×` 而不是 `✓`/`✗`。
  新增会打印的符号前，先 `'字'.encode('cp936')` 试一下。

> **如果详情页「高级信息」里没有出现「配置」区**：这是 ZCode 侧的渲染问题，与插件清单无关——界面拿到的插件信息里 `userConfig` 为空时，配置区整个不渲染（`Y2t` 组件里 `userConfig` 为空直接 `return null`）。清单本身是正确的（Agent 侧 `M5s` 完整解析、`f5s` 赋 `userConfig: e.manifest.userConfig`、`jGo` 条件展开，链路已逐环节核对）。此时**直接写配置文件**，效果完全一样：
>
> `~/.zcode/cli/config.json` → `plugins.options["zcode-tools@<市场名>"]`（`@` 后面按实际安装的市场填；本机是 `zcode-tools`）：
> ```json
> "plugins": {
>   "options": {
>     "zcode-tools@zcode-tools": { "tps_footer": false, "model_puller": true }
>   }
> }
> ```
> 键名见上表；写入后同样由 `sync.py` 在会话启动时读取并应用。也可以直接打 `/zcode-patch-toggle` 让 AI 代改（会先展示"配置值 vs 实际状态"再改）。改 `config.json` 前先备份一份。

### 退出后自动注入

重打包级补丁（TPS 状态栏、拉取按钮）要求 ZCode **完全退出**。插件里由 `scripts/apply_after_exit.py` 承担：轮询等 ZCode 退出 → 按期望状态应用/还原 → 写日志。它由开关同步（`sync.py`）在检测到重打包级差异时自动拉起，平时不运行，**不需要常驻服务**。

> **为什么必须等退出（不是「文件被锁」）**：实测用 Win32 `CreateFileW(..., share=0, ...)` 能对
> `app.asar` 与 `zcode.cjs` 取得独占句柄，ZCode 运行期间**并没有锁住它们**，直接写也能成功。
> 真正的原因是 ZCode **只在启动时读一次** `app.asar` —— 运行期改写不会影响当前会话，
> 所以延迟到退出后写入纯粹是为了「让下一次启动读到的就是新内容」，而不是绕开锁定。

手动执行同类操作时，直接跑命令即可（ZCode 已退出的前提下）：

```bash
python "<skill目录>/scripts/zcode_patcher.py" --tps-footer
python "<skill目录>/scripts/zcode_patcher.py" --model-puller
```

> 也可以自己挂一条计划任务调用 `scripts/apply_after_exit.py`（它自行探测安装位置，
> 退出后按期望状态应用补丁并重启 ZCode）；不需要时删掉该任务即可。

三项补丁，均幂等、可检查、可还原、ZCode 升级后需重打：

| 能力 | 说法 | 命令 | 改哪里 |
|---|---|---|---|
| 打开状态栏 | 输入框下方居中统计条（**v2 纯 DOM 观测，3.12.2+ 安全**；右键可切工具栏/会话顶部 sticky）：即时指标（首 token/tok/s）+ 会话累计（N轮N步、输入/输出/平均命中率）+ 今日总耗 | `python zcode_patcher.py --tps-footer [--check/--revert]` | app.asar（重打包级：注入脚本 + 挂载 index.html） |
| 模型拉取按钮 | 设置页一键拉取/勾选模型 | `python zcode_patcher.py --model-puller [--check/--revert]` | app.asar（重打包级：renderer 脚本 + index.html + preload 桥 + main IPC） |
| **增强提示词** | 输入框旁一键润色草稿（可恢复原文）；**右键**弹出菜单选择使用哪个模型 | `python zcode_patcher.py --enhance-prompt [--check/--revert]` | app.asar（重打包级：renderer 脚本 + index.html + preload 桥 + main IPC） |
| **注入状态角标** | 主窗口左上角黑底金字「待注入」角标（补丁待写入时出现），点击弹确认窗 → 退出 ZCode → 看护注入 → 自动重启 | `python zcode_patcher.py --inject-status [--check/--revert]` | app.asar（重打包级：renderer 脚本 + index.html + preload 桥 + main IPC） |

两个及以上功能可一次执行：`python zcode_patcher.py --tps-footer --model-puller`。
全部功能一条命令：`python zcode_patcher.py --all [--check/--revert]`（等价于写全上表所有补丁参数）。
另有命令行版拉模型（不动 asar，直接同步 config.json + provider_config.json）：`python scripts/model_pull.py --all [--dry-run]`。

**通用开关**：`--all`（对所有功能生效）· `--dry-run`（只报告改动不写盘）· `--verbose`（打印探测细节）· `--force`（跳过备份指纹校验，慎用）。

## 标准执行流程（AI 代执行与人工自助通用）

调用本 skill 时按以下序列执行，**AI 代执行时必须走完全部步骤，不得跳过核实与展示**：

1. **定位安装**：脚本自动探测（运行中进程 → 注册表 → 常见目录，跨 Windows/macOS/Linux，见「跨平台约定」）；探测不到就把安装根目录作为位置参数传入（加 `--verbose` 看每一步探测结果）。
2. **只读核实**（能否生效的判断，全部只读，可放心先跑）：
   - `python zcode_patcher.py --all --check`：**一条命令看全部 3 项**（含客户端版本、3 行执行汇总表）。
     用户问「现在什么状态」「装好了吗」时先跑这条；下面各条是单项细看。
   - `python zcode_patcher.py --tps-footer --check`：index.html 是否找到、注入状态。
   - `python zcode_patcher.py --model-puller --check`：四组件（renderer / index 挂载 / preload 桥 / main handler）逐个是否就位。
   - `python zcode_patcher.py --enhance-prompt --check`：同上四组件（增强提示词与拉取按钮共用 preload/main 锚点，
     注入段按 `/*zp:begin:<块名>*/` 标记定界，两者可独立装卸、互不干扰）。
   - 脚本对「表达式出现次数 ≠1」「锚点不唯一」等情况一律拒绝盲改并报告原因——报告即结论，不要绕过。
3. **确认备份就绪并展示还原命令**（打补丁前必须完成，AI 代执行时明确提示用户保存还原命令）：
   - 状态栏/拉取按钮：首次注入自动生成 `app.asar.<补丁>.bak`（整包备份，带 `.meta.json` 指纹）+ sidecar json
   - **备份带版本指纹**：客户端升级覆盖内核/asar 后，旧备份指纹失配会被自动归档（改名 `.stale-<时间>`），
     还原时若当前文件与备份不同版本会**拒绝执行**（提示用 `--force` 或 `restore_clean.py`），
     避免"把旧版内核/asar 盖回新客户端"。
4. **展示执行命令与还原命令**——**单功能单命令，按用户点名的功能给对应命令，不要捆绑其他功能**（各补丁相互独立；重打包级的状态栏/拉取按钮/增强提示词交由用户执行）。以「打开状态栏」为例：
   ```bash
   # 执行
   python "<skill目录>/scripts/zcode_patcher.py" --tps-footer
   # 还原（万一异常，保存备用；完全退出 ZCode 后执行，还原后重启 ZCode）
   python "<skill目录>/scripts/zcode_patcher.py" --tps-footer --revert
   ```
   人工自助时用户自行执行；AI 代执行时经用户确认后由 AI 运行，或用户复制命令自己跑。
   不确定会改什么时先加 `--dry-run` 预演（不写盘）。
5. **重启验证**：完全退出并重启 ZCode（Windows 运行中锁 app.asar，打补丁前必须退出；脚本已内置进程预检）后，按各功能的「验证」说明确认。
6. **失败回退**：执行上面展示的还原命令 → 重启 ZCode → 重新核实。思考等级补丁还原走 zcode.cjs.bak；状态栏还原自动清理 `.tps.bak` 与 sidecar。

## 全自动流水线（`autopilot.py`，无人值守场景用这条）

用户在**会话里**要求「一把跑完」「自动部署」「全自动」「不用我管」时，不要手敲上面那一串单命令，
直接用仓库根的流水线 —— 它把「环境自检 → 装依赖 → 构建 → 测试 → 部署 → 验证」串成一条链，
并自带重试、双通道日志与精确退出码。

```bash
python autopilot.py                                  # 本机全自动（含部署）
python autopilot.py --no-deploy                      # 只跑到测试，完全不碰客户端
python autopilot.py --unattended --report ci.md      # 无人值守 + 汇总另存（CI 用）
python autopilot.py --dry-run                        # 全程预演，不写任何文件
python autopilot.py --only build,test --verbose      # 只跑指定步骤，看调试细节
python autopilot.py --max-retries 5                  # 提高可恢复错误的默认重试次数
```

跨平台入口：`./run.sh`（macOS / Linux / Git Bash）与 `run.cmd`（Windows，双击可用）——
自动探测可用的 Python、切到脚本所在目录、参数原样透传。仓库里**没有任何写死的本机路径**。

### ★ 无人值守的核心矛盾与解法（AI 代执行前必须理解）

`zcode_patcher.zcode_running()` 是**全局运行守卫**：只要 `ZCode.exe` 还在进程表里就拒绝写入。
而无人值守的调用**恰恰总是发生在 ZCode 运行中**（SessionStart 钩子、用户在会话里喊「跑一遍」）。
所以 `deploy` 步骤不会去硬闯守卫，而是**自动挂载 `apply_after_exit.py` 看护**：

- 客户端没跑 → 立即 `--all` 注入，本步当场完成；
- 客户端在跑 → 挂看护并记 `deferred_step["scheduled"] = True`，报告里写「已排期」。

看护会等 ZCode **完全退出**、自动写入、再把 ZCode 拉起来 —— 全程无需人工。
汇报给用户时务必说清：**「本次改动已排期，下次完全退出 ZCode 时自动生效」**，
不要说成「已完成」，否则用户会以为补丁没起作用。

> 想让改动**立刻**生效（不想等下次退出）：请用户完全退出 ZCode，然后前台跑
> `python "<插件目录>/skills/zcode-tools/scripts/sync.py"`（结论打终端 + `_sync.log`）。
> 沙箱/工具进程**无法**起脱离进程，所以这件事只能请用户做。

### 错误处理：重试与否只看类别，不看「是否致命」

`ErrorKind.RETRYABLE = {transient, network, timeout, lock}` 这四类会退避重试
（1s → 2s → 4s → 8s 封顶）；build / test / permission / env / dep 立刻停下并给出修复建议。

**这里有个已经踩过的退化，改动 `execute_step()` 时别踩回去**：早先写成
`retryable = exc.kind in RETRYABLE and not exc.fatal`，而 `StepFailure.fatal` 默认 `True`
—— 于是所有可恢复错误都被静默剥夺了重试机会，重试机制**看起来实现、实际从未生效**，
且不报任何错，只表现为「偶尔失败」。`fatal` 的语义是「这一步最终会记为失败」，
**不是**「禁止重试」。

### 日志与退出码（汇报时引用这两个）

每次运行在 `logs/`（已 gitignore）同时写两份：`autopilot-<时间戳>.log`（人读）与
`.jsonl`（机器读，含 `step`/`kind`/`duration`/`attempts`/`retries`，结尾 `summary` 带 `exit_code`）。

| 码 | 含义 |
|---|---|
| `0` | 全绿 |
| `1` | 有步骤失败 |
| `2` | 命令行参数写错（步骤名拼错、过滤后无事可做） |
| `3` | 环境不满足（Python < 3.10、目录结构不对） |
| `4` | 依赖无法自动满足且不可忽略 |
| `5` | 部署被阻塞（客户端在运行且看护挂不上） |
| `130` | 被 Ctrl-C 中断 |

`2` 与 `1` 分开是有意为之：CI 里「参数写错」和「测试没过」得往完全不同的方向查。

### CI

`.github/workflows/ci.yml` 用 `matrix.include` 覆盖 `ubuntu-latest`（py 3.10 / 3.12 / 3.13）、
`windows-latest`（3.12）、`macos-latest`（3.12），主步骤为
`python autopilot.py --no-deploy --unattended --report ci-report.md`（CI 不注入 app.asar）。
仓库里还没有 `autopilot.py` 时会自动回退到逐项语法检查 + `unittest discover`。
报告与日志用 `actions/upload-artifact@v4` 在 `always()` 下上传，便于定位偶发失败。

## 跨平台约定

| 系统 | 安装根目录（resources 的上一级） | 典型位置 |
|---|---|---|
| Windows | `D:\ZCode`、`%LOCALAPPDATA%\Programs\ZCode` 之类 | 探测顺序：运行中进程路径 → 注册表卸载信息 → Program Files 系目录 |
| macOS | `/Applications/ZCode.app/Contents` | 探测 /Applications 与 ~/Applications 下的 `.app` 包（自动进入 `Contents`） |
| Linux | `/opt/ZCode`、`/usr/share/ZCode` 之类 | 探测 /opt、/usr/share |

- 关键文件相对安装根目录固定：`resources/glm/zcode.cjs`（内核）、`resources/app.asar`（桌面端资源包）
- Python ≥ 3.10，用系统可用的 `python3`/`python` 即可，脚本仅用标准库
- 改动脚本后先跑回归测试：`python -m unittest discover -s tests -v`（纯标准库；含 asar 重打包往返、
  备份指纹、档位配置迁移、注入代码语法、峰值内存约束等用例（数量以 `tests/` 实际为准）；
  本机装了 ZCode 时还会只读校验真实 asar 的 integrity）
- 一键跑完整链（含只读核实与自动部署排期）用仓库根的全自动流水线，见上节「全自动流水线」
- Program Files / /Applications 类目录可能需要管理员/sudo 权限
- 执行 AI 可按上述规则自行定位安装（如 `ls /Applications`、查运行中进程的 exe 路径）

## 升级后自查清单

ZCode 升级会覆盖 zcode.cjs 与 app.asar，升级后过一遍（**先完全退出 ZCode**；`--check` 不受此限）：

```bash
python zcode_patcher.py --tps-footer --check
python zcode_patcher.py --model-puller --check
python zcode_patcher.py --enhance-prompt --check
```

失配的按「标准执行流程」重打；
重打包级补丁（状态栏/拉取按钮/增强提示词）被升级覆盖后直接重跑即可——旧备份会被自动归档，不会误还原。

## 一、打开状态栏：TPS 统计胶囊

> **实现：`zcode-tps.js`（双源混合）—— 事件流做流式实时层 + DB 快照做精确结算层**
>
> 数据来自 preload 转交的端口事件流：`usage.delta`（真实 outputTokens/inputTokens）、
> `stream.chunk`、行事件（turnHeader/userInput/reasoning/assistantText/row.delta）。
>
> ⚠️ **脚本内绝不调用 `port.start()`**（这是唯一但关键的约束）
>
> MessagePort 队列一旦启用，消息只派发给"启用瞬间已注册的监听器"。脚本是普通 script，
> 早于 `type=module` 的应用主包执行；若先 `start()` 就会消费掉服务端的 `Initialize`
> 启动握手 → 应用协议客户端永远收不到握手 → **ZCode 3.12.2 卡在启动界面**。
> 正确做法：只 `addEventListener`，把 `start()` 留给应用（届时双方都收到消息）。
>
> 真实 Chrome / MessageChannel 实测（双方持有同一 port）：
>
> | 做法 | 我们收到 | 应用收到 | 结果 |
> |---|---|---|---|
> | 我们先 `start()` | `["Initialize"]` | `[]` | ✗ 卡启动界面 |
> | 只监听、不 start | `["Initialize"]` | `["Initialize"]` | ✓ 双方正常 |
>
> **注意：不可用 Node 验证此语义** —— Node 的 MessagePort 在 `addEventListener` 时隐式
> start，会让"不 start"也失败，从而误判为"方案不可行"（曾据此绕过一圈）。
>
> **已知特性**：tok/s 在开始生成后约 1~4 秒才出现（滑动窗口需 ≥2 个采样点，且思考阶段
> 无文本增量），期间只显示 `●`（今日有消耗时附带 `总耗 xx`），属预期。
>
> 本脚本基于社区分享版本实现，只删除了 `port.start()` 一行并补充自诊断，**计算逻辑与原版一致**。
> ⚠️ **回滚预案**：改动 asar 前先 `python scripts/restore_clean.py --backup` 存一份干净副本，
> 若客户端异常，完全退出后 `python scripts/restore_clean.py --latest` 秒级还原，无需重装 ZCode。

> 本能力与思考等级补丁基于社区分享版本实现（原作者已授权"可以直接借鉴定制"）；本仓库在原基础上做了打包内核重写（纯 Python、保留 unpacked、原子替换）、跨平台/跨版本适配、全外科手术式还原等工程化改造。

**默认挂在输入框（composer 卡片）下方、水平居中**的独立统计行（右键可切到工具栏行内居中或会话顶部 sticky），左组为即时指标，中组为**当前会话累计**，右组为**今日总耗**（不含时间）：

```
生成中:  ● 32 tok/s │ 12轮34步 · 输入 45.2k · 输出 12.3k · 平均命中 84.00% │ 总耗 58.1k
结束后:  ● 首 token 37s · 45 tok/s │ 12轮34步 · 输入 45.2k · 输出 12.3k · 平均命中 84.00% │ 总耗 58.1k
空会话:  ● 总耗 58.1k（今日无消耗时仅显示 ●）
```

- **轮/步口径**：轮=本会话真实用户轮数（快照只数含 `query_source='main_turn'` 行的 `turn_id`，0.6.37——上下文压缩会把一个可见轮拆成两个 turn_id，续接段整段 `query_source='compact'`、parent 为 NULL、转录里**没有新轮块**，`distinct turn_id` 会虚 +1，用户实测可见 8 轮显示 9轮；老库无该列退回旧口径）；步=已完成模型请求数（快照 `count(*)`，一次模型请求=一步，一轮含工具调用会有多步，compact 续接请求照常计入）。事件流按 `usage.delta.requestId` 去重实时累加，且轮数**按 DOM 可见 section 计数**（`visible.has(t.msgId)`，天然等于用户看到的轮块数）；与快照合并取 `max(事件流累计, 快照结算值)`——**不得再 +「流式中轮次」补偿**（0.6.35 起 PostToolUse 让快照在回合内也刷新，in-flight 轮落库即进快照，+stream 会双重计数；且终态 turnHeader 行偶发缺失时旧轮卡在 streaming，+stream 会把它当新轮 +1——用户实测空闲 5 轮显示 6轮、2 轮 ~115 请求显示 3轮 215步，0.6.36 修复）。新轮由事件流立即 +1、快照 ≤30s 追平，重开旧会话、轮次滚出视口都不丢历史；步数为 0 时该段不显示，避免「1轮0步」。
- **会话累计口径**：输入/输出=各轮 `usage.delta` 累加（API 计费视角，每轮 inputTokens 含历史所以累计值偏大，属预期）；平均命中=累计缓存命中 ÷ 累计输入（`input>0` 即显示，`0.00%` 也显示），**固定两位小数四舍五入**（`fmtPct`，不足补零，如 `84.00%`）；流式中未报 usage 的轮以内容估算兜底。
- **今日总耗口径**：今日 Σ(inputTokens + outputTokens)，只计 `usage.delta` 精确值（不含流式估算），按 `occurredAt` 本地日期分桶；全局口径，含所有会话与侧边栏辅助对话。仅补丁运行期间捕获（ZCode 未运行时/历史消耗不计）；数据存 `localStorage`（键 `ztps-daily-v1`），保留近 30 天，重复事件幂等去重，多窗口经 `storage` 事件同步，清 localStorage 即清零。
- **渐进降级顺序**：溢出时先丢总耗 → 首 token → tok/s → 轮步，输入/输出/命中保留。

```bash
python zcode_patcher.py --tps-footer             # 注入 scripts/zcode-tps.js
python zcode_patcher.py --tps-footer --check     # 查状态
python zcode_patcher.py --tps-footer --revert    # 整体还原
python zcode_patcher.py --tps-footer --tps-src /path/to/zcode-tps.js   # 指定注入源
```

### 行为规则（验收标准）

- **绿点 ● 常驻**：有可展示的轮次就在；流式生成中绿点发亮，空闲静态。不显示时间。
- **分隔符**：组内 `·`、组之间竖线 `│`；标签灰、数值白、tok/s 与平均命中橙、tabular-nums 对齐。
- **同一 turnId 复用（编辑重发/重试）自动清零**：检测到新一轮开始即重置旧统计，杜绝「时间变新、指标是旧的」残留。
- **平均命中常显**：`输入>0` 即显示（含 `0.00%`），不再要求先有命中。
- **动态刷新**：流式中 1 秒节奏刷新——tok/s 为 4s 滑动窗口即时速度；基于回答文本的 token 估算（CJK 1 字≈1 token、其余 4 字符≈1 token）。`usage.delta` 精确值随每次模型请求完成到达即覆盖估算；轮结束后为精确值（精确输出 ÷ 首块→末次 usage 的解码窗口）。
- **静默期保持**：工具执行期间文本停止增长，速度保持最近值不消失；点停止/出错时该次请求不报 usage，输出估算以内容兜底、速度保持最近值——已产生的数据不凭空消失。
- **切换会话立即消失**：渲染只认「DOM 可见轮次（`section[data-turn-id]`）+ `data-session-id` 匹配当前会话」双重条件，不依赖任何会话切换事件；多会话并行时各 tab 互不干扰。
- **历史会话累计缺失**：usage.delta 不回放，重新打开旧会话拿不到当时的 token 统计，属预期。
- **无假时钟**：不显示时间段，绝不拿当前时间冒充轮次时间。
- **空会话常驻**：当前会话无任何轮次（新会话/未对话）时显示仅绿点的空态胶囊，今日有消耗则附带 `总耗 xx`，进入对话后自然切换为完整指标。今日值经 `window.__ztpsDaily.readToday()` / `localStorage["ztps-daily-v1"]` 可查。

### 位置切换（胶囊右键）

统计条右键弹出自绘菜单，可在「输入框下方（默认）/ 输入框工具栏 / 会话顶部 sticky」间切换，`localStorage`（键 `ztps-pos`）记忆，重开保持：

- **输入框下方**：composer 卡片之后的独立行（`insertAdjacentElement` 于卡片后），`alignSelf: stretch` 与输入框同宽；**实测像素间距对齐**（0.6.27）：不再猜父容器 `gap`（Tailwind `space-y-*`／margin 布局读不到，0.6.25 的 `rowGap` 方案会静默失效），挂载后量「胶囊上沿↔卡片下沿」「胶囊下沿↔下一元素」，用 `marginTop/marginBottom` **增量**抵到 `GAP_TARGET=2px`（绝对值反算会在 0 与 -gap 间自激振荡），偏差 <0.5px 即停写；**末位元素另走视觉位移**（0.6.29）：胶囊是父容器最后一个子元素时负 `marginBottom` 只压缩容器总高、不会让胶囊下移，改用 `translateY(min(父边框盒底−胶囊下沿−2, 16))` 沉进 padding；快路径 1s 节流重量，布局/窗口/主题变化自动跟随。
- **输入框工具栏**：行内水平居中。
- **会话顶部**：吸附到消息区滚动容器（从 `section[data-turn-id]` 向上找第一个 `overflow-y: auto/scroll` 且高 >120px 的祖先）第一个子元素，`position: sticky; top: 8px` 悬浮；host 上 `pointer-events: none` 放行下方消息。
- 数据层零改动，仅挂载点不同；挂载点找不到（空态/设置页）时自清理，`window.__ztpsDiag.posMode`/`hiddenReason` 可诊断。右键修复注记：菜单用 pointerdown 捕获关外部点击时必须放行菜单内部按下，否则 click 在已移除节点上落空、选项永远点不中。

### 数据链路原理（无常驻服务）

**实时层**（0 延迟，流式中即有数据）：

1. ZCode 桌面端 preload 把主进程的 MessagePort 经 `window.postMessage("zcode:service-port", "*", [port])` 转交渲染页面；注入脚本监听该事件接管端口（`window.__ztpsHook` 可对存量端口手动补挂，`window.__ztpsPort` 暴露端口供调试旁路监听）。
2. 会话协议帧为二进制（Uint8Array）内嵌 JSON（自首个 `{` 起），两类：
   - **version:1 事件流**（顶层带 sessionId/sourceCommandId/occurredAt）：`usage.delta`（inputTokens/outputTokens/cacheReadTokens/totalTokens/reasoningTokens，**每次模型请求完成时发**——一轮含工具调用会有多条，out 为该次请求输出）、`stream.chunk`（`assistantMessageId` + `chunkLength` + `channel`，流式期间每 50-100ms 一批）
   - **conversation 行事件**（`frame.payload.deltas`/`events`）：`turnHeader`（startedAt/endedAt/state）、`userInput`（createdAt）、`reasoning`/`assistantText`（`text` 全量 + `assistantResponseId`）、`row.delta`（`{rowId, path:"text", append:"文本增量"}`）
3. **轮关联链**（事件里的 id 有两套，务必分清）：轮的 key 是 productTurnId（`msg_xxx`，与 DOM `section[data-turn-id]` 一致）；stream.chunk 的 `assistantMessageId` 是 assistantResponseId（另一个 msg_xxx），需经行事件的 `assistantResponseId → turnId` 映射中转；usage.delta 经 `sourceCommandId` 关联（turnHeader/userInput 行携带）。首批 delta 常早于桥接到达——旧逻辑直接丢弃导致输入恒 0，现暂存 `pendingUsage` 待桥接建成后回放（`__ztpsDiag.pendingUsageSize/appliedFromPending` 可查）。
4. 渲染：扫描 `section[data-turn-id]` + sessionId 双条件取当前会话最新轮 → 算指标 → 更新胶囊。
5. 刷新机制：MutationObserver 回调里 16ms 节流的**同步**刷新（切换会话零残留）＋ 60ms 防抖全量扫 ＋ 1s 估算刷新节奏；渲染带内容签名（stamp/ttft/tps/out/streaming），数据未变零 DOM 写，保证同步刷新不触发 observer 自激。

**结算层**（0.6.26，精确值 + 全历史，秒级延迟）：

6. Python 侧 `tps_snapshot.py` 只读 `~/.zcode/cli/db/db.sqlite`（`mode=ro`），按 `session_id` 聚合 `model_usage`（`status='completed'`）+ 今日全局，写 `~/.zcode/v2/ztps-snapshot.json`；每会话同时带 `turns`（只数含 `main_turn` 行的 turn_id，0.6.37 起，见轮/步口径）与 `requests`（completed 行数=模型请求数），供状态栏 `N轮N步` 使用；0.6.42 起还带最近一条**可见** completed 请求（main_turn/compact，剔除 session_title/subagent 隐藏请求——最后落库行常是标题生成，实测 102 tok @16 tok/s 会显示「标题速度」）的权威 `last_tps = output ÷ (completed_at − first_token_at)`（缺 first_token_at 退化 duration_ms，gen_ms<100 或 0 输出记 0）与 `last_ttft_ms`（老库缺列记 0）。触发点：**main watcher（0.6.42，主力）**——`ztps-snapshot` main 块内 `fs.watch` 库目录（db.sqlite/-wal/-shm）→ 300ms 去抖 → 1500ms 限频 + busy 单飞 → 按指针文件 `zcode-patches-scripts.json` spawn `tps_snapshot.py --quiet` 重算 → 读回快照 → `webContents.send("zcode:tps-push")` 推给渲染层；另监听快照文件本身（钩子写的同样推）；30s stat 心跳兜底 fs.watch 丢事件，挂失 5s 重连，**空闲零进程零轮询**，DB 落库→可见 ≈1-2s。兜底触发点：SessionStart worker、**每轮结束的 `Stop` 钩子**（0.6.27，DB 只有轮末落库，只靠 SessionStart 会把今日总耗冻在会话开始那一刻）、**回合内每次工具调用的 `PostToolUse` 钩子**（0.6.35，带 `--min-age 30` 节流：快照 30s 内刷新过就秒退不碰 DB。修的是「长回合中途总耗冻在回合初值」——用户实测官方用量页 15.9M、状态栏 9m，轮末快照一写才跳到 20m）、看护写补丁前。watcher spawn 仅限安全模式（指针 python + scripts_dir/tps_snapshot.py + --quiet + windowsHide，异步单飞、15s 超时杀），非 electron 环境 import 失败整体 no-op。口径移植自 `xhwxt/zcode-token-usage-statusbar` (MIT)：合计=`computed_total`（=input+output，cache 已含 input 不重复加），命中=`cache_read/input`。钩子调用必须带 `--quiet`，否则 stdout 非 JSON 会被判钩子失败。
7. 渲染层经 `zcode:tps-snapshot` IPC（preload 桥 + main 只读 handler，与 enhance bridge 同锚点模式）拉取，3s TTL 缓存，**轮次结束强制失效**（`_snapCache.at = 0`）；0.6.42 起另有 main watcher 经 `zcode:tps-push` **主动推送**（preload 桥 `onTpsPush(cb)`，`acceptSnapshot` 为拉取/推送共用的缓存写入路径，按 stamp 去重、推送即重置 TTL 窗口；无桥/旧版补丁静默跳过，拉取兜底照旧）；以 `Math.max(事件累计, 快照值)` 回填会话输入/输出/命中、轮数/步数（0.6.36 起纯 `max`，快照 `turns/requests` 不再加流式中轮次补差——见轮/步口径）与今日总耗——事件优先、快照补漏，流式值不会被拉低。结束轮的 tok/s/首token 只在**事件漏采（DB 比事件层最新活动还新 3s+）或事件层算不出**两处用快照权威值（`last_tps/last_ttft_ms`）兜底，事件层有值绝不覆盖，流式轮一律排除（`__ztpsDiag.snapshotTpsApplied` 标记生效原因）。快照缺失/损坏/无桥时静默降级为纯事件流（`__ztpsDiag.snapshotHit/snapshotOk/snapshotErr/snapshotTs/snapshotToday/snapshotAge/aggRounds/aggSteps/snapTurns/snapRequests/lastPushStamp/pushSubscribed` 可查）。
8. **handler 参数陷阱**（0.6.27 修复）：`ipcMain.handle(ch, (event, ...args))` 的第二参数是**渲染层实参**，不是模块。0.6.26 写成 `async(ev,t)=>{...t.join(...)}` 而 preload 不传参 → `t===undefined` → 每次 invoke 抛 TypeError → 永远 `read-failed`，快照整条链路静默失效（表现为输入/命中不显示、今日总耗只吃 localStorage 存量）。路径模块必须用 `import` 进来的 `r`。

**注入状态角标链路**（0.6.38，`--inject-status`）：

9. 状态真相源 = `<base>/.zcode/v2/zcode-patches-status.json`（base 服从 dataBaseDir）：**sync.py `run_sync()` 收尾写**（有分歧 → `pending:true` + items；全一致 → `false`），**看护 `apply_after_exit._write_status` 应用后回写**（成功 → `false`；失败/预检未通过 → 保持 `true` + `last_error`，0.6.41 起还带 `phase` 进度标记）——双写保证任一环失败角标也不说谎。渲染层 `zcode-inject-status.js` 轮询 `zcode:inject-status` IPC（main 只读 handler，缺文件回 `no-status` → 隐藏角标）：**立即首查 + 启动突发重查（1/2/4/8s）+ 10s 稳态 + visibilitychange/focus 补查**（0.6.41——status 文件常在启动后数秒才落，固定 10s 会让角标多等近 10s）；350ms 自愈兼管**首次挂载创建**（旧逻辑只扶正已有角标，首轮 DOM 未就绪要等 10s）。IPC 返回体带 `ver`（0.6.44：插件版本烙进注入内容——`__zinjDiag.ver` 一眼可知客户端跑的是哪版角标代码，且**每次发版生成内容必变 → check_state 必判 stale → 更新即亮角标**）时，pending 时在左上标题条（返回/前进按钮所在行）挂黑底金字「待注入」角标，找不到锚点退化为固定位置兜底（`__zinjDiag.mountMode` 可查实况）。
10. 一键应用链路：点角标 → 原生风格确认弹窗（说明将**完全退出 ZCode**、未发送草稿会中断，Esc/取消/遮罩均可关闭）→ 确认调 `zcode:apply-patches-now`（main handler）→ 复核 pending → `schtasks /Create + /Run ZCodePatchApply`，**`/TR` 直接给「pythonw + apply_after_exit.py」两个带引号路径，不落 .cmd 中间文件**（0.6.39/0.6.40：Task Scheduler 以 UTF-16 存任务，避开「cmd.exe 按 ANSI 解析 .cmd、非 ASCII 安装路径变乱码 → 看护静默夭折」与「整个等待期挂一个可见 cmd 控制台窗口」两个实测坑；**sync 的排期同样直写 /TR**）；`/TR` 不带 `--want` → 看护合并 `_watchdog.want`；/Create//Run 结果**追加进看护日志**（`[apply-now]` 行，静默失败必须有迹可循）→ 200ms 后 `app.quit()`（quit 被应用自身拦截时 5s 后 `app.exit(0)` 强退兜底）→ 看护等退出、写补丁、拉起 ZCode。任何一步失败都原样返回 `{success:!1}` **不退出**，渲染层 toast 提示。
11. **看护脚本定位 = 指针文件唯一真相源 + 生成内容副本无关**（0.6.40）：`<v2>/zcode-patches-scripts.json`（scripts_dir + python，sync 每次同步写）是唯一来源，指针缺失回 `no-pointer` 结构化报错引导重启。★ 生成内容**不得含任何本机路径**——此前把副本 scripts 目录/解释器在注入期烤进 JS，cache/marketplaces/开发仓库三个副本烤入字节不同 → 副本间互判「含旧版组件」→ 应用→判旧→重排死循环（0.6.39 实测两代旧看护赛跑、新版同步永远判 stale）。看护应用成功后还须 `sync.refresh_client_fingerprint()`：重打包改了 asar 尺寸，不刷新的话下次 detect_upgrade 会把「我们自己刚做的重打包」误判成客户端升级，弹假通知。
11. **看护单例跨版本共享锁**（0.6.39）：`<v2>/zcode-watchdog.pid`。插件每个版本副本各有自己的 `_watchdog.pid`，升级前后两个版本的看护可能同时等待——各查各的 pid 会双双放行，退出后并发重打包同一个 asar（一方必 rc!=0）。看护启动时同时查共享锁，活看护在 → 合并需求后退出。看护应用成功后还须 `sync.refresh_client_fingerprint()`：重打包改了 asar 尺寸，不刷新的话下次 detect_upgrade 会把「我们自己刚做的重打包」误判成客户端升级，弹假通知。
12. **退出后进度小卡**（0.6.41）：看护等到 ZCode 退出、有活要干时（等待期数小时不弹窗），用 tkinter 弹右下角置顶黑底金字小卡：TPS 快照 → 各补丁批写入（绿=完成/红=失败）→ 指纹刷新 → 重启 ZCode，每步经 `queue` 由工作线程传主线程刷 UI（子进程最长 600s 期间窗口不「未响应」）。成功 ~1.5s 自动关闭；有失败项 / 预检未通过 / 找不到主程序 / 重启失败 → 常驻 + 「关闭」按钮。无 tkinter 时整条降级为旧行为（仅日志），`phase` 字段兜底诊断。**测试红线**：`TestDoctor.test_auto_fix_enables_plugin` 曾不打桩 sync 侧——mock 的 `zcode_running=True` 走进 `auto_fix` 的「激活看护」分支，真 `start_watchdog`（真 schtasks）全天武装 DEV 树看护（_sync.log 十余条 arm 实证）；凡触 sync/watchdog 的测试必须打桩 `resolve_wanted/start_watchdog/resolve_v2_root/tps.main`，跑完套件后要查无新 pythonw、无新 arm 行。

### 注入原理（asar 重打包级）

状态栏要**新增文件**，必须整体重打包：

1. 注入内容（0.6.26 起 4 组件，走 `_process_ipc_patch` 通用链路）：`out/renderer/index.html` 的 `</body>` 前插 `<script src="./zcode-tps.js"></script>`；zcode-tps.js 作为新条目写入 `out/renderer/`；preload 加 `getUsageSnapshot` 桥（`/*zp:begin:ztps-snapshot*/` 定界）；main 加 `zcode:tps-snapshot` 只读 handler。index.html 无 CSP meta、无 nonce，普通脚本标签即可（在 `type="module"` 的 React bundle 之前同步执行，注册监听早于应用挂载）。0.6.25 及更早的 2 组件旧安装会被 check 报 stale，自动重跑补齐 IPC 块。
2. asar 布局（读/写同一公式）：头 16 字节 = 4 个 uint32 LE `[4, headerSize, pickleLen, jsonLen]`，`pickleLen = 4 + jsonLen + pad4`，`headerSize = 8 + jsonLen + pad4`，数据区起点 = `16 + jsonLen + pad4`（pad4 把 JSON 补齐到 4 字节倍数）；文件条目 `offset` 为相对数据区起点的字符串，全部文件带 integrity（SHA256 全文 + 4MB 分块 hex）。
3. 重打包流程：读全量 → 树上删条目/插占位/标记覆盖 → 全部条目 offset 重排 → 覆盖与新增条目重算 integrity → 写临时文件 → **回读校验**（逐条比对注入条目字节）→ 原子替换。
4. **实现关键坑**（改 `_repack_asar` 前必读）：offset 重排会直接改写条目，此后从旧文件切片必须用**重排前快照的旧位置**，否则「新 offset + 旧数据区起点」错位读取（实测 50 个抽查文件错 11 个，且改动文件恰好走覆盖分支不受影响，极易漏测）；新增条目的树插入必须在重打包函数内部做（外层持有的树引用与函数内部重新读入的不是同一棵）。
5. 备份与记录：首次注入前整包备份 `app.asar.tps.bak`；`app.asar.tps-patch.json` 记录原始 index.html（base64）与 asar 尺寸指纹。
6. 重打包会改变整包尺寸：tps/puller/enhance 三个 sidecar 里记录的 asar_size 指纹由脚本自动同步（`_refresh_repack_sidecars`）。

### 升级 / 回退 / 排障

| 现象 | 处理 |
|---|---|
| 升级后胶囊消失 | app.asar 被覆盖，重跑 `--tps-footer`（注入源默认 skill 自带 zcode-tps.js） |
| 重启后无胶囊 | `--tps-footer --check` 看 state；渲染进程 console 查 `window.__ztps` 是否存在 |
| console 出现 CSP 拦截报错 | 当前版本 index.html 无 CSP；若未来版本加了，需同步放宽 `script-src` 允许同目录脚本 |
| 指标一直只有「●」/「● 总耗」 | usage.delta 未关联到轮（看 `window.__ztpsTurns` 里轮的 outputTokens/inputTokens/lastUsageAt 是否为空）；版本升级导致帧结构变化时，用 `window.__ztpsPort` 旁路监听原始帧比对字段 |
| 输入/平均命中不出现但输出正常 | 先看 `__ztpsDiag.snapshotErr`：`read-failed` = main handler 读到快照但抛错（0.6.26 的 `t.join` 参数误用就是这类，0.6.27 已修）；`no-snapshot` = 快照文件没生成（跑 `python tps_snapshot.py --check` 查库，`--tps-footer --check` 看 4 组件）；undefined + `snapshotOk:false` = IPC 桥缺失。再看 `pendingUsageSize/appliedFromPending`：前者涨后者 0 = 事件桥接断裂 |
| 今日总耗不变化 | ①`snapshotErr` 有值 = 快照链路断（见上一行）；②`snapshotOk:true` 但 `snapshotTs`/`lastPushStamp` 不变 = 快照没刷新：0.6.42 起 main watcher 应在 DB 落库后 ≈2s 内重算推送，若不刷新先查 `pushSubscribed`（false = preload 桥缺失/旧版补丁）、再查 `Stop` / `PostToolUse`（`--min-age 30` 节流）钩子是否在跑（`hooks/hooks.json`）、手动 `python tps_snapshot.py` 后数值应变；③只有 localStorage 在涨=事件流 usage.delta 没到；④回合**进行中** watcher 会随每条请求落库自动刷（钩子 30s 节流只是兜底），轮末 `Stop` 会再精确刷一次 |
| 结束轮 tok/s 与事件层值不一致 | 结束后 ≈2s 内被快照权威值校准属预期（`__ztpsDiag.snapshotTpsApplied`：`db-newer` = 事件漏采被拉平 / `no-event-tps` = 事件层算不出被兜底）；事件层有值且不落后时永不覆盖；流式轮不做校准（DB 无流中数据） |
| 旧会话无累计 | 快照未命中：先看 `__ztpsDiag.domSessionId`——为 null/`draft` 说明会话 id 没取到（0.6.28 已加事件流 sessionId 兜底）；再看 `snapshotAge` 过大或 -1 = IPC 桥缺失/快照过期，手动跑 `python tps_snapshot.py` 刷新后重开会话 |
| tok/s 不出现 | 该轮从未有过文本流（纯工具调用轮）时无速度可算，属预期；有文本流后静默期（工具执行）保持最近值 |
| 想换脚本逻辑 | 改 zcode-tps.js 后重跑 `--tps-footer`（内容变了会自动热更新脚本条目，无需 revert） |

## 二、模型拉取按钮：设置页一键拉取/勾选模型

设置 → 模型供应商页在「添加模型」左侧注入下载图标按钮（悬停提示功能，点击转圈）：点开弹窗自动拉取该供应商 `/models` 接口的模型列表，标注「已添加/新模型」并勾选，保存后经**原生 IPC** 读写 `~/.zcode/v2/config.json` 并自动刷新界面——不用退出 ZCode、不用手改 config。

```bash
python zcode_patcher.py --model-puller             # 注入（默认用本 skill scripts/zcode-model-puller.js）
python zcode_patcher.py --model-puller --check     # 查状态（逐组件：renderer/挂载/preload/main）
python zcode_patcher.py --model-puller --revert    # 整体还原
python zcode_patcher.py --model-puller --puller-src /path/to/zcode-model-puller.js
```

- **来源**：前端脚本为 vendored 的第三方实现（MIT，版权声明见脚本文件头）；原实现的 npx @electron/asar 全量解包/重打包方案未采纳（Node 依赖 + 会把 12 个 unpacked 原生模块打进 asar 内部，Electron 无法从 asar 加载 .node），改用本 skill 自带的纯 Python `_repack_asar`（unpacked 条目原样跳过、原子替换、回读校验），路径走 `discover()` 跨平台探测（原项目仅支持 macOS）
- **注入四件套**：① `out/renderer/zcode-model-puller.js` 新文件；② index.html `</body>` 前挂 `<script type="module">`（与 TPS 同文件共存、互不干扰）；③ preload 在 `contextBridge.exposeInMainWorld("zcode",{` 对象开头插入 3 个 IPC 桥方法；④ main 在 `SaveMcpToUserDirectory` 注册语句前插入 3 个 IPC handler（读 config / 写 config（先落 config.json.puller-bak）/ 代理拉模型列表）
- **锚点跨版本设计**：preload/main 锚点用语义字符串（`exposeInMainWorld("zcode",{`、`SaveMcpToUserDirectory`——后者是 IPC 通道名，非压缩符号），正则捕获周边的压缩别名（electron 导入别名 / ipcMain 包装别名）拼进注入代码——**无需按版本维护符号表**；命中数 ≠1 一律拒绝
- **保存语义（重要）**：整份 config 读出 → 只对不存在的模型 `p.models[mid] = {模板}` → 整份写回。**已有条目原样保留**（手改的 reasoning.variants 安全，比 ZCode 自带设置页保存还会剥 variants 更安全）
- **新供应商一步到位**：保存时按 baseURL（去尾斜杠）匹配供应商，匹配不到再按界面名称兜底，仍匹配不到则**自动创建** provider 条目（UUID id、source:custom、表单里的 baseURL/apiKey），创建后 toast 提示——破解 ZCode 自带流程的死锁（「添加供应商」按钮要求先有 ≥1 个模型，而手填模型 id 正是痛点）。`kind`（API 协议）判定优先读表单「API 格式」下拉的显示文案（3.11.2 实测三选项：`Anthropic Messages (/v1/messages)` → anthropic、`Chat Completions (/chat/completions)` → openai-compatible、`Responses (/responses)` → openai），读不到再按 URL 特征（含 anthropic → anthropic，`/v1` 结尾 → openai-compatible）→ 现有自定义供应商的 kind → openai-compatible。猜错表现为请求协议不对，设置页改 API 格式保存即可
- **新模型模板（元数据感知）**：拉取时读取 `/v1/models` 透出的每模型元数据——`context_length`/`max_input_tokens` → `limit.context`、`max_output_tokens`/`max_completion_tokens` → `limit.output`、`supported_efforts` → `reasoning.variants`（自动前插 off 档）、`default_effort` → `defaultVariant`（workbuddy2api 等网关透出这些字段）；元数据缺失时退回保守模板 `limit 1M/128k + off/high/max`。`zcode.modified: true` 恒有——与 CLI `model_pull.py` 一致
- **还原全外科手术式**：index.html 只摘自己的 tag、preload/main 用正则精确摘除自己注入的字节段（别名通配），**不依赖 sidecar 指纹**——其他补丁重打包改了 asar 大小也能精确还原；TPS 的还原同样已改为外科手术式，两个重打包级补丁任意顺序装/卸互不误伤
- **组件级热更新**：`--check`/注入以「内容比对」判定每个组件是否为现行版本（不能只看 marker——换实现后 marker 不变会漏更新）；不一致的组件自动重注入，一致的原样跳过；注入段形态不符（被手工改过）时拒绝改写并提示
- **备份**：首次注入整包备份 `app.asar.puller.bak` + sidecar `app.asar.puller-patch.json`；与 TPS 的 sidecar 联动同现有机制（重打包后自动同步 sidecar 的 asar_size 指纹）

### 命令行版（不动 asar）

```bash
python scripts/model_pull.py                 # 交互选供应商
python scripts/model_pull.py --all           # 同步全部自定义供应商
python scripts/model_pull.py --provider 关键字 [--dry-run] [--refresh] [--no-reasoning]
python scripts/model_pull.py --test https://api.example.com/v1 [KEY]
```

新模型默认**元数据感知**：网关透出 `context_length/max_output_tokens/supported_efforts/default_effort` 时按模型写实 limit 与思考档位，缺失退回 `1M/128k + off/high/max` 模板（`--no-reasoning` 关闭）。已有条目默认原样保留；**`--refresh` 按服务器元数据刷新已有条目的 limit 与思考档位**（其余键不动，手改过的条目也只动这两处）。注意 CLI 在 ZCode 运行中写 config 有被回写覆盖的竞态，建议退出后跑；注入版无此问题。

### 排障

| 现象 | 处理 |
|---|---|
| 设置页没有按钮 | `--model-puller --check` 看四组件哪个缺；渲染 console 查 `window.__ZCODE_MODEL_PULLER_LOADED_PRO__` |
| 按钮报「通信桥不可用」 | preload 桥缺失（`window.zcode.readConfigFile` 应为函数）；重跑注入会逐组件补齐 |
| 拉取失败 | 供应商 baseURL 不通或鉴权失败；先用 `model_pull.py --test <URL> [KEY]` 单测 |
| 自动创建的供应商协议不对（请求报错/无响应） | kind 猜错（如 OpenAI 兼容端点被判成 anthropic）：设置页打开该供应商，把 API 格式改对保存即可 |
| 想换注入脚本逻辑 | 改 `scripts/zcode-model-puller.js` 或改 preload/main 注入构造器后重跑 `--model-puller` 即可——**四组件（renderer/preload/main/index）均按内容比对**，只更新与现行实现不一致的组件，无需 revert；`--check` 会显示「含旧版组件，重跑可自动更新」 |
| 保存后档位丢失 | 正常不会（整读整写不重建条目）；若用 ZCode 自带设置页保存过该 provider，属其重建路径剥掉 variants，重配 reasoning 即可 |

## 三、增强提示词：「润色」按钮、右键选模型与跨机「Model is unavailable」

输入框工具栏一键润色草稿（图标 3 态：✦ 待机 / ◌ 增强中 / ↺ 可还原 20s）。

```bash
python zcode_patcher.py --enhance-prompt            # 注入（renderer 脚本 + index.html + preload 桥 + main IPC）
python zcode_patcher.py --enhance-prompt --check
python zcode_patcher.py --enhance-prompt --revert
```

**左键**润色；**右键**弹出模型选择菜单（按供应商分组列出所有可用模型，选中即持久化，
之后每次润色都用它，零重启生效）—— 见下文「右键菜单」一节。

链路：渲染层按钮 → preload 桥 `window.zcode.enhancePrompt(text, modelValue, modelLabel, override)`
→ main handler `zcode:enhance-prompt`（`_ENHANCE_HANDLER`）读**供应商配置**解析 → 直接 POST 补全接口。
菜单另走两条桥：`listEnhanceModels()`（复用同一通道的 `{list:true}` 分支取清单）与
`saveEnhanceModel({providerId, modelId})` → main handler `zcode:enhance-model-save`（写配置文件）。

### ★★ 关键前提：客户端发请求用的是 `provider_config.json`，不是 `config.json`（0.5.10 修复）

**两份配置文件并存、语义不同**（同一个数据根下）：

| 文件 | 角色 | 说明 |
|---|---|---|
| `~/.zcode/v2/provider_config.json` | **权威源** | 客户端真正据此构造请求。结构：`providerConfigRules.providerRules[]`（`providerId` / `providerName` / `config.access.apiKey` / `config.api.baseUrl` / `config.api.type` / `config.personalModelIds`）+ `modelConfigRules.providerModelRules[]` |
| `~/.zcode/v2/config.json` | **遗留副本** | 旧格式（`provider.options.baseURL/apiKey/models`）。可能滞后：供应商缺失、apiKey 过期、模型列表旧 |

客户端 bundle 里的硬证据：`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 环境变量、
常量 `MXe="provider_config.json"`、以及
`a=e.personalProviderConfigPath??e.env[tte]?.trim()??join(dirname(credentialStore.filePath),MXe)`。
即**默认就是读 `provider_config.json`**。

> 本机实测两份不一致：`config.json` 里某供应商只有 `['glm-5.2']` 且 apiKey 是旧的，
> `provider_config.json` 里有 8 个模型（含 `glm-5.3`）且 apiKey 不同；
> 另有供应商（如 `openai`、`590ce4cc-…`）**只存在于 `provider_config.json`**。

**0.5.9 的残留缺陷**：0.5.9 修好了「兜底档无视界面选择」，但 handler 仍只读 `config.json`。
于是当界面选中的是只在 `provider_config.json` 里存在的供应商/模型时，
ref 档必然查不到 → 掉进兜底档 → 打到别的供应商 → `HTTP 400 Model is unavailable`。

**修复（0.5.10）**：handler 改为 **`provider_config.json` 优先、`config.json` 仅补缺**，
把两份归一化成统一候选表（去重，保留权威源同名条目），再走档位解析。
这样「界面选中的 provider/model」与「handler 读到的」来自**同一个文件**，从根上对齐。

### ★ 已知坑：请求打到不相干的供应商上（0.5.9 起修复）

**症状**：本机润色正常，别的电脑报
`HTTP 400：Upstream request failed: Model is unavailable.`，或部分机器显示
「已用 glm-5.2 增强」却成功。

**根因（两层）**：
1. **0.5.9 之前**：模型解析的兜底档**无视界面选择**——只要 ref / label 两档没命中，
   就把请求发给「第一个带 baseURL 的自定义供应商的首个模型」，且**不校验该供应商是否可用**
   （`apiKey` 为空、`systemDisabledReason` 存在都照样发）。
   不同机器 `provider` 的**插入顺序不同** → 兜底落到不同供应商 → 有的机器撞对了就能用。
2. **0.5.10 之前**：读错了配置文件（见上一节），界面所选模型在旧副本里根本查不到。

**为什么本机能用纯属巧合**：本机 `provider` 里前面几条是 `builtin:*`（被旧逻辑跳过），
兜底恰好落到一个有效供应商上。

**修复（0.5.9）**：各档解析全部经 `usable(pp)` 判定（`baseURL` + `apiKey` + 无
`systemDisabledReason`）；新增 `ref-label` 档；`label` 档放开 `builtin:` 限制；
兜底只选真正可用的。拿不出可用候选时返回 `code:"no-model"` + 可读原因，不再构造注定失败的请求。
**修复（0.5.10）**：权威源改为 `provider_config.json`；兜底候选排序时把
`builtin:` / `account:` 前缀的供应商**排到最后**（用户自定义供应商优先）。

### 六档解析顺序（0.6.7 起）

| 档 | 来源 | 说明 |
|---|---|---|
| **explicit** | 右键菜单**本次**选中的模型（`override` 参数） | 最高优先级。只校验供应商可用性，不校验模型表 |
| **config** | `<数据根>/enhance_config.json` 的 `providerId`/`modelId` | 右键菜单持久化的选择也写在这里；手改同效。每次点击热读，**零重启** |
| **ref** | 界面 `data-model-current-value` 的 `${providerId}/${modelId}` | 精确命中 |
| **ref-label** | ref 的 provider 段命中，模型改用界面显示名匹配 | |
| **label** | 全部候选里按显示名匹配 | |
| **fallback** | 排序后的第一个可用候选（`builtin:` / `account:` 排最后） | 跨机差异的高发区 |

> **★ 每档都必须带 `!pick` 守卫**：新增更高优先级档时，必须给**后面每一个** `pick=` 赋值
> 补上 `!pick`，否则后面的档会静默覆盖它 —— 语法对、位置对、行为全静默。
> 这个坑踩过两次（PR#1 的 config 档、0.6.7 的 explicit 档），现已由
> `tests/test_enhance_handler.py::TestHotConfigSourceInvariants` 的源码顺序断言钉死。

`how` 会回填到返回值（`window.__zenhanceDiag.lastResult.how`）：
**只有 `explicit` / `config` / `ref` 才代表「用上了你指定的模型」**；`ref-label` / `label` /
`fallback` 都值得怀疑。

### ★ 右键菜单：选择润色使用的模型（0.6.7）

**用法**：在润色按钮上**右键** → 菜单按供应商分组列出所有**可用**模型（`usable()`：有
baseURL + 有 apiKey + 无 `systemDisabledReason`）→ 点选某项即生效。
菜单顶部有「跟随界面选择（默认）」用于清除选择（等价于删掉配置里的 `providerId`/`modelId`）。

**清单口径（0.6.27）**：菜单必须与设置页的**开关状态逐项一致**。客户端把启用状态拆成三层，
缺任何一层都会出现「设置里关了、菜单里还在」或「设置里开着、菜单里没有」：

| 层 | 位置 | 语义 |
|---|---|---|
| ⓐ 供应商 | `providerRules[].enabled === false` | **整组关闭**（火山方舟 Agent Plan 实测）。等价于 `systemDisabledReason="provider_disabled"`，`usable()` 直接排除 |
| ⓑ 模型·用户 | `modelConfigRules.providerModelRules[].config.enabled` | 单模型用户开关。`false` 不得进菜单 |
| ⓒ 模型·模板 | `runtime/provider/<平台>/<版本>/endpoint-*/zcode-builtin.json` 的 `templateRules[].builtinModelIds` + `templateModelRules[].config.enabled` | 模板自带模型与**默认**开关。自定义供应商 `personalModelIds` 为空时（小米 MiMo Token Plan 实测）模型**只在这里**，不读模板就整组消失；用户没动过的模型以模板默认值为准（= 设置页的灰/绿） |

生效顺序：**ⓑ 用户规则 > ⓒ 模板默认 > 视作开启**（自定义供应商自己加的模型）。
模型全集 = `personalModelIds ∪ 用户模型规则 ∪ 模板 builtinModelIds`；`api.baseUrl` / `api.type`
在 rule 里缺失时**回退模板**（`opencode-go-responses` 就是这样，不再需要「借道 Chat 组」的旧绕法）。

**旧格式不再补模型**：`config.json` 同 pid 的 `models` **不再**并入候选表（0.6.25 曾模型级合并）。
实测 chat 侧 config.json 有 30 个模型、设置页只列 19 个（模板内置），把旧的并进来正是
「关了还在列表里」的来源。`config.json` 只用于权威源完全没有该 pid 的兜底。

跨供应商重名模型仍标注供应商后缀（如 `glm-5.3-flash（火山方舟 Agent Plan）`）；
usable 但无模型的供应商**整组隐藏**。

**为什么"选了就生效"**：一次选择同时走两条路，互为兜底 ——

1. `saveEnhanceModel()` → `zcode:enhance-model-save` → 写进 `enhance_config.json`
   （= **config 档**，handler 每次点击热读）→ **零重启、重启后依然沿用**；
2. 本次点击把选择作为 `override` 参数传给 `enhancePrompt()` → **explicit 档**（最高优先级）
   → 即使文件写入失败或被别处改动，这一次点击也一定用它。

**设计要点**：

- 菜单清单走 `listEnhanceModels()`，它在主进程里**复用 enhance-prompt 的同一份候选表**
  （`{list:true}` 分支，不发任何补全请求）。这样「菜单里能选的」与「发请求时能用的」
  **永远同源**，不会出现两套逻辑漂移导致的「菜单里能选、点了报不可用」。
- 菜单是挂在 `document.body` 上的 **fixed 浮层**，**不进 composer 子树** —— 既不会被
  虚拟列表 / 重渲染搬走，也不参与输入框布局（不会再把图标位置搞乱）。
- `zcode:enhance-model-save` **只增删 `providerId`/`modelId` 两个键**，
  `maxTokens` / `temperature` / 思考强度等参数原样保留 —— 选个模型不该抹掉你调好的参数。
- 写失败会**显式报错**（toast），不静默吞掉：否则用户以为选好了，下次点击仍走旧档位。
- **关闭策略**（0.6.8 修「菜单一出现就自动关闭」）：只有 ①点菜单外部 ②按 Esc ③再右键收起
  三种情况会关。**滚动不关闭**，改为节流（80ms）跟随重定位 —— 客户端消息区是虚拟列表、
  输入区 sticky，滚动极频繁，把 `scroll` 当关闭信号等于菜单刚挂上就被关掉；
  点击关闭带 **350ms 保护期**，防止触发「打开」的那串事件（右键 mousedown/mouseup、
  触控板多出来的事件）在监听器注册之后到达而误关；按钮被重渲染摘掉时**不立刻关**
  （4 秒宽限 + 位置缓存），避免 composer 抖动误伤。

**排障**：

```bash
python enhance_doctor.py --override-provider <id> --override-model <model>   # 模拟菜单选择
```

第 2c 节会直接显示 `enhance_config.json` 当前指定的模型（以及它是否在压过界面选择），
第 3 节显示最终命中的档位。DevTools 里 `window.__zenhanceDiag.overrideModel` 是当前会话内
选中的模型，`lastRequest.override` 是实际随请求发出的值；
`menuOpens` / `menuClosedBy` 记录菜单开合次数与**最后一次的关闭原因**
（`outside` 点外部 / `escape` / `toggle` 再右键 / `choose` 选完 / `btn-gone` 按钮长期不在）
—— 菜单「莫名消失」时看它就知道是谁关的。

### 错误归因与重试（0.5.9）

`classify(code, status, msg)` 把失败归成
`model / quota / auth / path / rate / server / timeout / network / bad-request`，
并回传 `tip`，前端展示成「增强失败：…」+「→ 可执行建议」。

| 类别 | 是否重试 |
|---|---|
| `model` / `auth` / `quota` / `bad-request` | **否**，立刻停 |
| `rate` | 退避 1600ms，原地重试 1 次 |
| `server` / `timeout` / `network` | 退避 600ms，原地重试 1 次 |
| `path`(404) | 换候选地址（`/v1` 两种拼法） |

### 排查（只读工具）

```bash
python "<skill目录>/scripts/enhance_doctor.py"                 # 解析链路体检
python enhance_doctor.py --json                                # 机器可读（含 resolve/provider/request/problems）
python enhance_doctor.py --probe                               # 加真实连通性探测（耗极少额度）
python enhance_doctor.py --probe --model-value "builtin:zai-coding-plan/GLM-5.2"
```

**它逐段复刻 handler 的解析逻辑**（同一套「provider_config.json 优先 + 六档」），
所以「脚本判定用哪个供应商」= 「按钮实际会用哪个」。支持
`--model-value`（界面 ref，形如 `providerId/modelId`）/ `--model-label`（界面显示名）
模拟界面选择，`--override-provider` + `--override-model` 模拟右键菜单的 explicit 档；
不给就演示最坏情况。
输出含解析路径（`explicit`/`config`/`ref`/`ref-label`/`label`/`fallback`）、关键字段、
请求 URL / `max_tokens`、**两份配置的差异审计**（`2b` 节）与
**热配置当前值**（`2c` 节，即右键菜单写入的选择）。
退出码 0 = 无阻断，1 = 发现会导致失败的问题。

> **判读要点**：只有 `how=explicit` / `config` / `ref` 才代表「用上了你指定的模型」。
> `fallback` = 打到了别的供应商（正是跨机差异的症状）；
> `config` 但模型不是你想要的 = 菜单/配置文件里残留了旧选择（看 `2c` 节）。

界面侧自诊断：DevTools（`Ctrl+Shift+I`）里看 `window.__zenhanceDiag`——
`lastRequest.modelValue`（空 = ref 通道失效）、`modelCandidates`（>1 = 页面有多个模型节点）、
`lastResult.code`、`hiddenReason`（按钮没挂上时的原因）。

### ★ 已知坑：按钮「跑出输入框」渲染进消息区（0.5.11 修复）

**症状**：多轮对话 / 消息列表增长时，润色按钮出现在会话消息区域里
（有的表现为「输入框旁边的按钮突然不见，消息流中间多出一个图标」）。

**根因**：`zcode-enhance-prompt.js` 的 `findInput()` 在**整个 `document`** 上按
`COMPOSER_INPUT_SELECTORS` 查找 —— 其中 `textarea` / `[contenteditable='true']` /
`form textarea` 是**通用选择器**。而客户端的消息区里也可能出现这类节点，于是：

1. 消息区元素被误认成「交互输入框」（读写正文也跟着错）；
2. 用它反推挂载点（`input.parentElement` / `card.querySelector("div")`）→
   按钮被插进消息流 → 视觉上「按钮跑出输入框」。

放大该问题的是客户端的真实 DOM 结构（`out/renderer/assets/styles-*.js` 实证）：

```
div[data-v4-timeline-scroll]          ← overflow-y-auto，真正的滚动宿主
└─ div                                 ← flex min-h-full flex-col
   ├─ div[data-v4-timeline-message-layer]      ← 消息层
   │  ├─ div[data-v4-timeline-header-slot]
   │  ├─ div[data-v4-timeline-virtual-history] ← 虚拟列表（absolute + translateY）
   │  ├─ div[data-v4-running-live-tail]
   │  └─ div[data-v4-timeline-content-column]
   └─ div[data-v4-composer-dock]        ← ★ 输入框 dock，与消息层**同级兄弟**
      └─ div[data-v4-composer-dock-content]
         └─ div[data-v4-back-to-bottom-anchor="composer-dock"]
            └─ … composer 卡片（含 v4-composer-send 工具栏行）
```

关键点：**dock 和消息层都在滚动容器内部**，dock 仅靠
`` K ? `mt-3 shrink-0` : oe ? `shrink-0` : `sticky bottom-0` `` 贴底。
一旦按钮被插进消息流那一侧，它就**不再受 dock 的 sticky 约束**，
随消息增长被一路推到列表底部 —— 这正是「多轮对话后才明显」的原因。

**修复（0.5.11）**：

1. 新增 `findDock()`：按 `[data-v4-composer-dock='true']` / `[data-v4-composer]`
   定位 composer dock（可见优先 + 最靠下，兼容多会话场景）。
2. `findInput()` 改为**两段式**：
   - ① 严格模式：只在 **dock 内**子查询；
   - ② 兼容模式：dock 不存在才退回全局，且**跳过** `textarea` /
     `[contenteditable='true']` / `form textarea` 这些会误伤消息区的通用选择器。
3. `ensureButton()` 的挂载点收敛到 dock 内：
   发送按钮的父节点 → dock 内的 toolbar/卡片 → 输入框向上爬到 dock 为止；
   最后一道校验 `if (host && dock && !dock.contains(host)) host = dock;`
   —— **越界就回退到 dock 本体，宁可不挂也不渲染进消息区**。
4. 位置自愈：已连接的按钮若 `btn.parentElement !== host` 或已脱离 dock，
   主动 `insertBefore` 搬回，并累加 `diag.reattaches`。
5. 轮询 2000ms → **1000ms**（流式输出时消息持续增长，周期过长会肉眼可见地错位）。

自诊断新增字段：`window.__zenhanceDiag.reattaches`（>0 说明发生过自愈搬迁，
可用于确认线上是否仍在错位）。

### ★ 已知坑：图标跑到输入框**左上角**（1.4 / 0.6.6 修复）

**症状**：润色图标不在工具栏右侧，而是贴在**输入框左上角**。两个可复现的时机：
① 输入框为空时；② 会话进行中（生成过程中）。正常对话（有内容、未生成）时位置是对的。

**根因**：挂载点解析的**兜底链会落到「输入框的祖先」上**，而 `insertBefore(host, host.firstChild)`
正好是那个容器的左上角。旧实现：

```js
// 旧（有 bug）：只认发送按钮；取不到就一路退到卡片/dock 本体
const send = document.querySelector("[data-testid='v4-composer-send']");
if (send && send.parentElement) host = send.parentElement;
if (!host && dock) {
  host = dock.querySelector("[data-testid*='composer-toolbar']")   // ← 选择器恒不命中（实测 0 个）
      || dock.querySelector("[data-testid='v4-composer']")         // ← 卡片 = 输入框所在区域
      || dock.querySelector("[data-v4-composer-dock-content]")
      || dock;                                                     // ← 最坏 = 整个 dock
}
if (host && dock && !dock.contains(host)) host = dock;
```

三个致命点：

1. **`[data-testid*='composer-toolbar']` 是死选择器**——在 3.14.3 的 asar 里命中数为 **0**
   （工具栏行只有 class `group/toolbar flex items-end gap-3`，没有 testid），所以它永远落到下一档；
2. **下一档 `[data-testid='v4-composer']` 就是卡片本身**，它是输入框的**祖先**；
   `insertBefore(btn, card.firstChild)` = 图标钉在输入框左上角；
3. **发送按钮不是恒定锚点**。内核里提交控件是
   `sn = canStop && !hasContent ? 停止按钮 : 发送按钮`
   （`sn = $t && !tn`，`$t = !!e?.control.canStop`，`tn` = 输入框/附件/上下文有无内容）——
   **输入框为空 + 会话进行中**时，`[data-testid='v4-composer-send']` 被
   `[data-testid='v4-stop']` **替换**，`querySelector` 直接返回 null → 触发上面的兜底 → 左上角。

所以「输入框为空」与「会话进行中」其实是**同一个内核条件**的两种描述：生成中清空输入框，
就同时满足两者。（输入框为空但**未**生成时发送按钮只是 `disabled`，仍在 DOM 里，
所以那个瞬间位置是对的——这也解释了为什么它看起来像"偶发"。）

**修复（1.4）**：改成三级解析，任何一级都不退回卡片 / dock 本体：

| 级 | 锚点 | 落位 |
|---|---|---|
| ① | `card.querySelector("[data-composer-trailing-actions]")` —— 工具栏**右侧操作区**，跨状态恒存在 | prepend（图标在模型胶囊/发送按钮左侧 = 既有正确位置） |
| ② | `[data-testid='v4-composer-send']` / `[data-testid='v4-stop']` 的父节点（两者同属一个提交控件容器） | prepend |
| ③ | 工具栏行（class 含 `flex` + `items-end`，与 TPS 状态栏同一套结构判定） | **append**（贴行尾；绝不插行首） |

解析全失败时**保持原位、不搬迁**（旧行为是搬到左上角），并在
`window.__zenhanceDiag.hiddenReason = "未找到工具栏操作区"` 里说明。

真实 DOM 结构（3.14.3 实证，也是这次定位的依据）：

```
div[data-testid='v4-composer']                  ← 卡片 = .chat-composer-region（输入框所在区域）
 └─ div.chat-composer-input-surface
    ├─ div[data-testid='v4-composer-input']     ← 输入框
    └─ div.group/toolbar.flex.items-end.gap-3   ← 工具栏行（无 testid！）
       ├─ div[data-composer-leading-actions]        ← 左侧（+ / 附件）
       └─ div[data-composer-trailing-actions]       ← ★ 右侧操作区（恒存在）
          └─ div.flex.min-w-0.items-center.gap-1    ← 提交控件容器
             ├─ span …                                ← 模型胶囊
             └─ button[data-testid='v4-composer-send']（生成中且无内容时 → 'v4-stop'）
```

自诊断新增字段：`window.__zenhanceDiag.mountWhere`（`prepend` / `append`，看走的是哪一级）。

回归测试：`tests/enhance_mount_smoke.js`（最小 DOM 桩，**真跑** 6 个状态：待机 / 输入框为空 /
**发送按钮被停止按钮替换** / 锚点全缺失 / 连操作区都没有 / 自愈 + 幂等），
Python 侧 `tests/test_patcher.py::TestEnhancePromptScript`
（含源码级不变量：不得出现 `host = dock;`、必须同时认 `v4-composer-send` 与 `v4-stop`）。
负向验证：把脚本回退到修复前，冒烟测试立刻红在「会话进行中 → CARD(top-left!)」。

### 排障速查

| 现象 | 处理 |
|---|---|
| ★ **要「重启两遍」才生效 / 退出重启后仍不生效** | ★ 写入时机在**退出**不在启动（`启动①补丁→退出时写→自动拉起→启动②生效`）。第一次多半**没退干净**：点 × 只是最小化到托盘，且 ZCode 多进程会残留 `ZCode.exe` → `zcode_running()` 恒真 → 看护一直等（最长 24h）**永不写入**。查 `doctor.py` **第 7.5 节**：`看护启动 N 次 / 等到退出 0 次` 即中。**彻底退出**（托盘右键退出 + 任务管理器确认无残留），或完全退出后手动 `--all`。详见「为什么有时要重启两遍」 |
| ★ **更新插件 + 退出重启后仍不生效** | ★ 插件市场「更新」只换插件目录，**不重新注入 app.asar**；而 ≤0.6.0 的同步脚本看到 `--check` 输出里的「已打」就判成 `on` → 永远跳过重跑 → 旧片段永远留在 asar 里，**且不报任何错**。判定：`--enhance-prompt --check` 出现「含旧版组件」即是。**0.6.1+ 已自动识别（新 `stale` 态）**；旧版手动 `--all`。详见「插件更新≠补丁更新」 |
| 报 `Model is unavailable` | ★ 解析没命中界面所选模型。跑 `enhance_doctor.py --model-value "<providerId>/<modelId>"` 看 `how=`；`ref` 之外都要查：① 选中供应商是否只在 `provider_config.json` 里（旧版 handler 读的是 `config.json`，见上文 0.5.10）；② 该供应商是否被 `systemDisabledReason` 禁用 |
| 按钮跑到消息区 / 看不见 | ★ 挂载点跑出了 composer dock。升级到 **0.5.11+**；确认注入也是新版（`--dry-run`）。诊断看 `window.__zenhanceDiag.reattaches`（>0 = 发生过自愈）与 `hiddenReason` |
| ★ **图标跑到输入框左上角**（输入框为空 / 会话进行中时） | ★ 挂载点兜底落到了「输入框的祖先」（卡片 / dock），`insertBefore(firstChild)` 正好是左上角。升级到 **0.6.6+**（脚本 `scriptVersion 1.4`）；确认注入也是新版（`--enhance-prompt --dry-run`）。诊断看 `window.__zenhanceDiag.mountWhere`（应为 `prepend`）与 `scriptVersion` |
| 升级到 0.5.10 后仍报错 | 确认**注入**也升到了新版：`--enhance-prompt --dry-run` 看是否有「将热更新…（X → Y 字节）」。`--check` 只看挂载标记，不比对脚本内容 |
| 报「通信桥不可用」 | preload 桥缺失；重跑 `--enhance-prompt` 注入后**重启** ZCode |
| 按钮不出现 | `window.__zenhanceDiag.hiddenReason`；找不到输入框 / 找不到工具栏行 |
| 报 `no-model` | 没有可用候选（全表缺 key/baseURL 或被禁用），按提示补配置 |
| 报 `no-key` / `no-baseurl` | 命中供应商缺凭据；`enhance_doctor.py` 第 4 节直接列出 |
| 本机能用、别人不能 | 典型兜底档差异：对比两台机器的 `enhance_doctor.py` 输出中的 `how` 与 `providerId` |

> 注意 `Upstream request failed` 是 vercel-ai 网关的错误措辞（对应
> `GatewayModelNotFoundError`），属**模型维度**判定（不在套餐内 / 已下线），
> **与地区限制、代理无关**。地域封锁表现为 403 或连接重置。

### ★★ 插件更新 ≠ 补丁更新：`stale` 态为什么必须独立存在（0.6.1 修复）

**跨机复现的真实故障**：用户在另一台电脑从插件市场「更新」插件 → 按提示退出并重启
→ 润色新修的功能（0.5.11 的按钮定位）**仍然不生效**；跑 `doctor.py` 一路全绿。

链路是一条**全静默**的失效：

1. 插件市场「更新」只替换**插件目录**（`cache/<市场>/<插件名>/<版本>/`），
   **不重新注入 `app.asar`** —— asar 里还是上一版的注入片段；
2. `zcode_patcher.py --check` 会明确给出两种措辞：
   `已打（含旧版组件，重跑可自动更新）` / `已打（四组件均为当前版本）`；
3. 但 ≤0.6.0 的 `sync.check_state()` 只做子串匹配：
   ```python
   if "未打" in out: return "off"
   if "已打" in out: return "on"     # ← 两种措辞都含「已打」，全被判成 on
   ```
4. `run_sync()` 拿到 `want=True, state=on` → `continue`（视为已一致）
   → **永远不会重跑注入**；
5. 结果：心跳正常、日志干净、`doctor` 全绿、`--check` 也显示「已打」，
   唯一表现是「修复没生效」——**没有任何一处会报错**。

**修复（0.6.1）**：`check_state()` 新增第四态 `stale`，把「已打但内容旧」单独分出来。

* **判断顺序是硬性要求**：`if "含旧版组件" in out: return "stale"`
  **必须排在** `if "已打" in out` **之前** —— 前者本身含「已打」，顺序反了
  `stale` 分支永远走不到。已有两条回归测试分别从**语义**（喂字符串）和
  **源码顺序**（`inspect.getsource`）两个角度钉死它。
* `run_sync()` 对 `stale`：重打包级补丁转交看护并报
  「插件已更新，客户端退出时重注入为新版」；非重打包级**当场重跑**；
  若开关是关的直接还原（不必先更新再还原绕一圈）。
* `doctor.py` 第 8 节末尾会点名「有 N 项注入的是**旧版片段**」。

**给用户的一句话**：重打包级功能（TPS 状态栏 / 滑条 / 润色 / 拉取按钮）在插件更新后，
仍要等**下一次完全退出 ZCode** 才由看护重新写入 —— 光重启不够，
因为「重启」期间看护会被先起来的 ZCode 挡住（它等的是**退出**）。

### ★★ 为什么有时要「重启两遍」才生效（0.6.2 新增第 7.5 节）

**用户报的原话**：「重启了两遍后润色功能就可以正常工作了」。
这不是玄学，也不是缓存/服务需要两轮预热 —— **写入时机在退出，不在启动**：

```
启动① → 钩子跑 sync → 有待办 → 挂看护 W（W 在 while zcode_running(): sleep(3) 里等）
退出  → W 醒来 → 写 app.asar → 主动拉起 ZCode
启动② → 新 asar 生效 ✓          ← 真正起作用的是这第二个启动
```

所以「一次重启」在本工具里就等于「退出 + 自动拉起」两个动作；
用户口中的「重启两遍」往往其实是**第二次退出才真的退干净**。

**真正的故障点：第一次退出没退干净。**

* 点窗口 × 是**最小化到托盘**，进程还在；
* ZCode 是**多进程**（主进程 / 渲染 / GPU / 工具进程），主窗口关了常留
  若干 `ZCode.exe` 子进程（本机实测残留过 14 个）。

`zcode_running()` 只判「`tasklist` 里有无 `ZCode.exe`」，有残留即为真 →
看护一直等（`MAX_WAIT_SEC = 24h`）→ **永不写入** → 用户必须再来一轮。

**新增的可观测性（doctor 第 7.5 节）**：`_apply_after_exit.log` 是唯一判据。

| 日志内容 | 含义 |
|---|---|
| `看护启动，等待 ZCode 退出…` | 看护起来了（**仅此不代表写入了**） |
| `ZCode 已退出（等待 Ns），开始处理` | 等到了退出 → 真正开始写 |
| `DONE` | 写完并已（尝试）重启 |
| `检测到 ZCode 已再次运行，跳过重启` | 写入成功，只是被别的原因抢先拉起（无害） |
| `等待超时（24h），放弃` | 等了 24 小时 |

第 7.5 节算 `pending = 启动数 - 等到退出数 - 超时数`；`pending > 0` 就直说
「N 个看护起来了却从未等到退出 = 补丁没写进去 = 必须重启两遍的直接原因」，
并给出托盘退出 + `tasklist` 确认残留的指引。
**没有这条输出时，用户能看到的全部信息就是「我重启了却不生效」**，
排查会跑偏到模型配置 / 缓存 / 网络上。

回归测试 `TestDoctorWatchdogSection`（7 条）钉死：报警文案、正常完成**不**报警、
无日志不算故障、24h 超时**不**重复计入 pending、「跳过重启」要说明无害、
第 7.5 节确实被 `main()` 调用且顺序在心跳之后 / 补丁状态之前、
以及 `apply_after_exit.py` 的五个日志措辞子串（被 doctor 当接口消费，不能随手改）。

**给用户的一句话**：要生效请**彻底退出** —— 托盘右键退出，并在任务管理器确认
没有 `ZCode.exe` 残留；拿不准就完全退出后手动跑一次
`python "<脚本目录>/zcode_patcher.py" --all`，不依赖看护时序。

### ★★ ZCode 退出时看护被 Job 对象连带结束（0.6.33 修复）

3.18.2 实测：用户**完全退出**后看护日志只有「看护启动…」，没有「ZCode 已退出」，
`_watchdog.pid` 里的进程也已消失——看护不是没等到，是被**杀掉了**。

根因：Electron/Chromium 把子进程放进带 `KILL_ON_JOB_CLOSE` 的 Windows Job 对象。
ZCode 退出时 Job 关闭，整棵进程树（包括 `DETACHED_PROCESS` 启动的看护）一起结束；
`CREATE_BREAKAWAY_FROM_JOB` 会被 Job 拒绝（实测 `WinError 5`），脱离不了。

修复：Windows 改用一次性计划任务启动看护（`schtasks /Create → /Run → /Delete`）。
Task Scheduler 启动的进程不在 ZCode 的 Job 里，能活到退出之后；删除任务定义
不会终止已运行实例。创建失败时回退原来的分离进程。日志会写
「已启动退出后看护（计划任务 ZCodePatchApply）」。

判别：如果日志有「看护启动」但没有「ZCode 已退出」，且任务管理器里那个 PID
已经不存在 → 就是被连带结束；0.6.33+ 应能看到计划任务启动记录。



### 连带修复：Windows 瞬时占用写不进补丁

`app.asar` 被杀软/索引器/未释放句柄短暂占用时，裸 `os.replace` 直接
`WinError 5 拒绝访问`。新增 `_replace_with_retry()`：仅对 `WinError 5 / 32`
做 0.25→0.5→1→2s 退避（共 5 次），其他错误立即抛出。
**后续新增任何对 asar / 配置的原子替换都应走它。**

## ★★ asar「布局错位」＝客户端打不开，且毫无日志（0.6.5 修复）

**症状**：注入后 ZCode **双击无反应**（无窗口、无错误弹窗、无崩溃记录）。
`--enable-logging=stderr` 跑它也**什么都不打印**，只是退出码 1。Windows 事件日志、
`CrashDumps`、ZCode 自己的日志目录全都是干净的。

**根因**：`app.asar` 的**数据区排布与 header 声明错位**。典型形态是：

```
header 里 out/main/index.js 声明 size = 760,736（注入后）
数据区实际只按 758,743（注入前）递增 —— 之后每个条目的 offset 都少 1,993
但每个条目自己的 integrity 记录还是【旧内容的哈希】
```

于是 4,138 个条目的 `integrity` 与实际内容不符。**asar 结构本身完全自洽**：
条目数对、offset 连续、零重叠、零越界、最后一个条目的 end 正好等于文件大小。
**所以结构校验全绿，问题被彻底掩盖。**

Electron 加载时按 `integrity` 校验，不匹配就**拒绝加载该模块**；主进程
`out/main/index.js` 的依赖链一断，进程在能够打印任何日志之前就退出了。

**为什么结构校验看不出来**：`offset` 与 `size` 自洽只保证「数据区没有空洞/重叠」，
不保证「offset 指向的是它自己那份内容」。**只有逐条重算哈希才能发现。**

**规矩**：
1. **回读校验必须覆盖「全部条目」，不能只校验本次改动的条目。** 旧实现只比对
   `overwrite` 里的条目 —— 而未改动条目恰恰是最容易静默损坏的那批。
   现在 `_repack_asar` 落盘前会逐条重算 sha256 与 `integrity` 记录比对，
   任一条不符即抛错拒绝落盘，并报出「声明 offset/size + 拒绝落盘」。
2. **同一 asar 的写入必须互斥。** 看护与手动流程并发时会各自读一份 header、
   各自算 offset，交错落盘 → 直接产出上面的错位文件。新增 `_AsarWriteLock`
   （进程内 `threading.Lock` + 跨进程 `msvcrt.locking` 文件锁 `<asar>.zp-lock`）
   覆盖整个「读 header → 排布 → 写数据 → 原子替换」。
3. **怀疑 asar 不干净时，跑全域体检**（不用猜）：
   `python .workbuddy-ai/tmp/find_integrity_mismatch.py` —— 它会报出全部失配条目
   与首个失配项。**首个失配条目往往就紧跟在注入点之后**，一眼看出错位基准。
4. **事故恢复**：直接换回 `app.asar.<补丁名>.bak`（写入前的备份，integrity 自洽），
   换完立刻再跑一次全域体检确认为 0。

> 排查心法：这次绕了很久，是因为「结构校验通过」就排除了 asar，转而去查 Electron
> 自动更新、`NODE_OPTIONS` 污染、崩溃日志…… **当客户端「静默不启动」时，
> 先做一次全域 integrity 体检，再考虑其它方向。**

## ★★ 给 if 链插「最高优先级」分支时，必须给后续分支补守卫（0.6.4）

`_ENHANCE_HANDLER` 的模型解析是一条 `if` 链，靠**顺序**表达优先级：
⓪热配置 → ①ref → ②ref-label → ③label → ④兜底。

外部贡献的 PR 在链首插入 ⓪档（`enhance_config.json` 热配置），但**忘了**给紧随其后的
①档补 `!pick` 守卫 —— ①档写的是 `if(mv){...pick=...}`，于是：

```
⓪ 设 pick=config:model-a
① 只要界面取值 mv 非空就重跑 → pick=ref:model-b   ← 覆盖掉了
```

**最讽刺的一点**：同一个 PR 的 `currentModel()` 修复**正是让界面取值变得可读**的，
所以这个 bug 让新功能「只在它修好的那个前提下失效」。排查时 `tried` 轨迹显示
`config:P-A/model-a` 已被记录，请求却发给了 `P-B/model-b` —— 极具误导性。

**规矩**：
1. 在 if 链**前面**插分支时，检查**后面每一个 `pick=` 赋值**是否都带 `!pick`；
   ②③ 两档本来就有，① 没有 → 补齐后语义统一为「先到先得」。
2. 这类「语法对、位置错」的 bug **行为上完全静默**，只做行为测试可能漏
   （若两档指向同一模型就测不出来）→ 源码级测试用 `assertRegex` 钉住
   `if\(!pick\s*&&\s*mv\)`，并单独测「⓪ 必须压过 ①」这个语义。
3. 顺手修了 `how` 恒为空串（声明后从未赋值）：新文档教用户看 `lastResult.how`
   判断走了哪一档，该字段不生效等于**文档教的排障法失效**。
   **教训：新增「可观测性字段」时要确认它真的被写入了** —— 空值不会报错。

## ★★ 通用教训：别把「输出字符串」当状态接口（0.6.3 修复三处）

0.6.1 / 0.6.2 / 0.6.3 三个版本**反复**踩在同一类根因上，所以单独拎出来当规矩讲。

**病根**：用「子串匹配别人打印的文字」来判断程序状态。它必然会在某天失效，因为
*文案会改*、*同一个词会出现在两种相反的状态里*、*正常的流程也会打印警示语*。
失效时**不报错**：日志干净、心跳正常、退出码 0，只有结论是错的。

### 三个实例（全部已修 + 已钉测试）

| 实例 | 失效方式 | 为什么只有子串匹配会错 |
|---|---|---|
| `check_state()` 判 `stale` | 见[上一节](#插件更新--补丁更新stale-态为什么必须独立存在061-修复) | `已打（含旧版组件…）` 与 `已打（四组件均为当前版本）` **都含「已打」** |
| `run_patcher()` 判失败 | 良性警告被当成失败 | `zcode_patcher.py` 有 **60+ 处** `[!]`，多处在**成功路径**上（如「发现 N 个模型同时存在于两张规则表」——**事先就存在**的问题，脚本只报告不修） |
| `declared_defaults()` 找清单 | 找到**别人**的清单 | 原先无条件向上找 2~6 层 → 仓库布局下会到**盘符根**（`F:\`） |

### 三条硬规矩（新增同类代码时照着做）

1. **优先找结构化信号**：退出码、汇总计数、独立的 marker 行。
   `run_patcher()` 现在解析 `合计 N 项：成功 X，失败 Y` 里的 Y ——
   那是脚本**自己算出来的结论**，比任何特征串都可靠。
2. **特征串必须是「只在该状态出现」的**。判断前先问：这个字眼会不会同时出现在
   正常流程里？（`[!]` 就是反面教材：它同时是「警示」和「失败」两个意思。）
3. **顺序敏感的判断要单独钉测试**。`stale` 之所以必须排在裸 `已打` 之前，
   是因为前者**包含**后者 —— 这种「包含关系导致的顺序依赖」光看代码看不出来，
   要用 `inspect.getsource` 查源码顺序。

### 无人值守路径必须带超时

同一批修复里还有一类：`subprocess.run` 不写 `timeout=` 时可能**永久挂起**，
而用户只看到「卡住不动」。无人在旁边时这类故障最难查。

* `bootstrap.py`：`pip install` / `git clone` 一旦上游半开连接就永久挂起 →
  默认 1200s，超时退 **124**（与 GNU timeout 一致）并带出部分输出。
* `apply_after_exit.py`：看护是**后台无人值守**进程 → `tasklist` 30s、
  补丁 600s。**`tasklist` 超时必须按「仍在运行」处理** ——
  反过来会在 asar 还被锁时动手写，且此时已错过退出时机，补丁永远写不进去，
  现象与[「看护从未等到退出」](#为什么有时要重启两遍才生效062-新增第-75-节)完全一样。

