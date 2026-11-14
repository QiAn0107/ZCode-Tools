/**
 * ZCode 状态栏：TPS 统计胶囊 —— 双源混合（事件流实时 + DB 快照结算）
 * ==================================================
 * 输入框工具栏常驻胶囊：● 首 token · tok/s │ 输入 · 输出 · 平均命中 │ 总耗(今日)
 *
 * 数据源：
 *   实时层（ServicePort 事件流，经 window.postMessage 转交）：
 *   - version:1 事件流：usage.delta（真实 outputTokens/inputTokens）、stream.chunk
 *   - conversation 行事件：turnHeader / userInput / reasoning / assistantText / row.delta
 *   由此得到 0 延迟的 tok/s（4s 滑动窗口）、首 token 延迟、输出估算。
 *   结算层（DB 快照，经 zcode:tps-snapshot IPC 只读回传）：
 *   - Python 侧 tps_snapshot.py 只读 ~/.zcode/cli/db/db.sqlite 聚合，
 *     口径移植自 xhwxt/zcode-token-usage-statusbar (MIT)：completed 才计、
 *     合计=computed_total、命中=cache_read/input。
 *   两层以 Math.max 合并：事件优先、快照补漏（旧会话/关联失败时回填）。
 *
 * ⚠️ 关键约束：**绝不调用 port.start()**
 *   MessagePort 队列一旦启用，消息只派发给"启用瞬间已注册的监听器"。本脚本是普通
 *   script（早于 type=module 的应用主包执行），若先 start() 就会消费掉服务端的
 *   Initialize 启动握手 → 应用的协议客户端永远收不到握手 → ZCode 3.12.2 卡在启动界面。
 *   因此只 addEventListener，把 start() 留给应用；届时双方都能收到消息。
 *
 *   真实 Chrome 实测（MessageChannel，双方持有同一 port）：
 *     我们先 start()          → 我们 ["Initialize"]，应用 []            ✗ 卡启动
 *     我们不 start、应用 start → 我们 ["Initialize"]，应用 ["Initialize"] ✓ 正常
 *   注意：不能用 Node 验证此语义——Node 的 MessagePort 在 addEventListener 时隐式
 *   start，会让"不 start"也失败，从而得出错误结论。
 *
 * 已知特性：tok/s 在开始生成后约 1~4 秒才出现（需要滑动窗口内 ≥2 个采样点，且首块到达
 *   前的思考阶段无文本增量可算），期间只显示 ● 与时间，属预期。
 *
 * 基于社区分享版本实现，仅删除 port.start() 一行并补充诊断，计算逻辑与原版一致。
 *
 * 安全：只读事件流、只写自己的 host 元素；异常静默；找不到工具栏行时自清理。
 * 位置切换：胶囊右键菜单可在「输入框工具栏(默认) / 会话顶部(sticky)」间切换，
 *   localStorage 记忆（键 ztps-pos）；数据层零改动，仅挂载点不同。
 * 回滚：脚本/补丁异常时用 scripts/restore_clean.py --latest 秒级还原，无需重装。
 */
(() => {
  if (window.__ztps) return;
  window.__ztps = true;
  const dec = new TextDecoder();
  const MARK = "data-ztps";

  // ---------- 位置切换(胶囊右键菜单,localStorage 记忆) ----------
  const POS_KEY = "ztps-pos";
  const POSITIONS = [
    { id: "composer-below", label: "输入框下方" },
    { id: "toolbar", label: "输入框工具栏" },
    { id: "session-top", label: "会话顶部" },
  ];
  const getPos = () => {
    try {
      const v = localStorage.getItem(POS_KEY);
      return POSITIONS.some((p) => p.id === v) ? v : "composer-below";
    } catch (err) { return "composer-below"; }
  };
  const setPos = (id) => { try { localStorage.setItem(POS_KEY, id); } catch (err) { /* 静默 */ } };

  // ---------- 今日统计(按本地日期聚合 usage.delta 精确值,localStorage 持久化) ----------
  // 口径:今日总耗 = Σ(inputTokens + outputTokens),只计 usage.delta 精确值,不含流式估算。
  // 限制:仅补丁运行期间捕获(ZCode 未运行时/历史消耗不计);清 localStorage 即清零。
  const DAILY_KEY = "ztps-daily-v1";
  const DAILY_KEEP = 30;      // 保留近 30 天
  const DAILY_SEEN_CAP = 500; // 去重环上限
  // 本地时区 YYYY-MM-DD(跨午夜按 occurredAt 分桶)
  const dayKeyOf = (ts) => {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const loadDaily = () => {
    try {
      const raw = localStorage.getItem(DAILY_KEY);
      if (!raw) return { days: {}, seen: [] };
      const j = JSON.parse(raw);
      if (!j || typeof j !== "object" || !j.days || typeof j.days !== "object") return { days: {}, seen: [] };
      return { days: j.days, seen: Array.isArray(j.seen) ? j.seen : [] };
    } catch (err) { return { days: {}, seen: [] }; }
  };
  const saveDaily = (st) => {
    try {
      const keys = Object.keys(st.days).sort();
      while (keys.length > DAILY_KEEP) delete st.days[keys.shift()];
      if (st.seen.length > DAILY_SEEN_CAP) st.seen = st.seen.slice(st.seen.length - DAILY_SEEN_CAP);
      localStorage.setItem(DAILY_KEY, JSON.stringify(st));
    } catch (err) { /* 静默:隐私模式等写失败时退回内存兜底 */ }
  };
  // localStorage 不可用时的当次内存兜底 {key, total}
  let memToday = { key: dayKeyOf(Date.now()), total: 0 };
  // 幂等累加一条 usage.delta;返回当日累计值
  const addDaily = (ev) => {
    const i = ev.inputTokens || 0, o = ev.outputTokens || 0;
    if (i <= 0 && o <= 0) return readToday().total;
    const key = dayKeyOf(ev.occurredAt ?? Date.now());
    const id = [ev.sourceCommandId, ev.occurredAt, i, o, ev.modelId].join("|");
    const st = loadDaily();
    if (st.seen.indexOf(id) >= 0) {
      const b = st.days[key];
      const tot = b ? (b.i || 0) + (b.o || 0) : 0;
      return tot > 0 ? tot : memTodayTotal(key);
    }
    st.seen.push(id);
    const b = st.days[key] || (st.days[key] = { i: 0, o: 0, n: 0, u: 0 });
    b.i += i; b.o += o; b.n += 1; b.u = Date.now();
    saveDaily(st);
    if (memToday.key === key) memToday.total = Math.max(memToday.total, b.i + b.o);
    else { memToday.key = key; memToday.total = b.i + b.o; }
    return b.i + b.o;
  };
  const memTodayTotal = (key) => (memToday.key === key ? memToday.total : 0);
  // 读侧缓存:localStorage 字符串不变则零解析
  let _dailyCache = { raw: null, key: null, total: 0 };
  const readToday = () => {
    const key = dayKeyOf(Date.now());
    try {
      const raw = localStorage.getItem(DAILY_KEY);
      if (raw === _dailyCache.raw && _dailyCache.key === key) return { key, total: _dailyCache.total };
      _dailyCache.raw = raw;
      _dailyCache.key = key;
      if (!raw) { _dailyCache.total = memTodayTotal(key); return { key, total: _dailyCache.total }; }
      const j = JSON.parse(raw);
      const b = j && j.days && j.days[key];
      _dailyCache.total = Math.max(b ? (b.i || 0) + (b.o || 0) : 0, memTodayTotal(key));
      return { key, total: _dailyCache.total };
    } catch (err) { return { key, total: memTodayTotal(key) }; }
  };
  // 跨 tab 同步:别的窗口写入后刷新读缓存并重绘
  try {
    window.addEventListener("storage", (e) => {
      if (e && e.key === DAILY_KEY) { _dailyCache.raw = undefined; scheduleScan(); }
    });
  } catch (err) { /* 静默 */ }

  // ---------- DB 快照结算层(渲染侧读缓存) ----------
  // 事件流是"实时层"(首 token/tok/s/输出估算 0 延迟)，DB 快照是"结算层"
  // (会话输入/输出/命中/今日的官方落库精确值，天然全历史)。
  // 口径移植自 xhwxt/zcode-token-usage-statusbar (MIT)：completed 才计、
  // 合计=computed_total、命中=cache_read/input。
  // 快照由 Python 侧(tps_snapshot.py)在 SessionStart / 每轮结束(Stop 钩子) / 看护写入，
  // main 经 zcode:tps-snapshot IPC 只读回传；此处 3s TTL 缓存，轮次结束强制失效，
  // 失败静默降级为纯事件流。
  const SNAP_TTL_MS = 3000;
  let _snapCache = { at: 0, ok: false, err: null, stamp: 0, sessions: null, today: null, pending: false };
  // 快照接收（拉取与推送共用）：校验形状后写缓存并触发重渲染
  function acceptSnapshot(r) {
    if (r && r.success && r.sessions && r.today) {
      _snapCache.ok = true;
      _snapCache.err = null;
      _snapCache.stamp = r.stamp || 0;
      _snapCache.sessions = r.sessions;
      _snapCache.today = r.today;
      scheduleScan();
      return true;
    } else if (r) {
      _snapCache.err = r.code || "bad-response";
    }
    return false;
  }
  // main watcher 主动推送（0.6.42 移植自参考实现）：DB 每条 completed 请求落库、
  // 或快照被钩子重写时直接送达渲染层，免等 3s TTL 轮询。无桥/旧版补丁时本函数
  // 无人订阅，refreshSnapshot 的拉取兜底照旧。
  function onSnapshotPush(d) {
    if (diag) { diag.lastPushAt = Date.now(); diag.lastPushStamp = (d && d.stamp) || 0; }
    if (!d || !d.success || !d.sessions || !d.today) return;
    if (d.stamp && d.stamp === _snapCache.stamp && _snapCache.ok) {
      _snapCache.at = Date.now();   // 同一快照：只重置 TTL 窗口，避免紧随的拉取白跑
      return;
    }
    _snapCache.at = Date.now();     // 推送即新鲜：TTL 窗口从现在起算
    acceptSnapshot(d);
  }
  function refreshSnapshot() {
    const now = Date.now();
    if (_snapCache.pending || now - _snapCache.at < SNAP_TTL_MS) return;
    let api = null;
    try { api = window.zcode && window.zcode.getUsageSnapshot; } catch (err) { api = null; }
    if (typeof api !== "function") return;   // 无桥(旧版补丁/未注入)：纯事件流
    _snapCache.pending = true;
    try {
      const p = api();
      if (p && typeof p.then === "function") {
        p.then((r) => {
          _snapCache.pending = false;
          _snapCache.at = Date.now();
          acceptSnapshot(r);
        }, () => { _snapCache.pending = false; _snapCache.at = Date.now(); _snapCache.err = "rejected"; });
      } else { _snapCache.pending = false; _snapCache.at = now; }
    } catch (err) { _snapCache.pending = false; _snapCache.at = now; _snapCache.err = "throw"; }
  }
  const snapSession = (sid) => {
    if (!_snapCache.ok || !sid || !_snapCache.sessions) return null;
    return _snapCache.sessions[sid] || null;
  };
  const snapTodayTotal = () => {
    if (!_snapCache.ok || !_snapCache.today) return 0;
    return _snapCache.today.total || 0;
  };

  // ---------- 侧边栏/辅助对话与主会话边界判定 ----------
  // 核心诉求：无论何时只挂载在主界面对话框，绝不在侧边栏（辅助对话）来回跳动。
  function isInsideSidePane(el) {
    if (!el || typeof el.closest !== "function") return false;
    try {
      return !!el.closest(
        "[data-workspace-side-frame], " +
        "[data-side-pane-tabs-content], " +
        "[data-side-pane-tab-content], " +
        "[data-side-pane-tabs-viewport], " +
        "[data-workspace-sidebar-panel], " +
        "[data-mobile-side-pane-overlay], " +
        "[data-side-pane-terminal-stash], " +
        "aside, " +
        "[class*='side-pane'], [class*='sidePane'], [class*='sidebar-panel'], [class*='sidebarPanel']"
      );
    } catch (err) { return false; }
  }

  function isInsideMainConversation(el) {
    if (!el || typeof el.closest !== "function") return false;
    try {
      return !!el.closest("[data-workspace-conversation-frame]");
    } catch (err) { return false; }
  }

  // 会话顶部 sticky 的挂载点:当前会话消息区的滚动容器。
  // 从轮次 section 向上找第一个纵向可滚动的祖先(主内容区特征:overflow auto/scroll 且足够高)。
  function findSessionScroller() {
    const mainFrame = document.querySelector("[data-workspace-conversation-frame]");
    const scope = mainFrame || document;
    let secs = Array.from(scope.querySelectorAll("section[data-turn-id]")).filter((s) => !isInsideSidePane(s));
    const sec = secs[0];
    let cur = sec ? sec.parentElement : null;
    while (cur && cur !== document.body) {
      if (isInsideSidePane(cur)) break;
      let oy = "";
      try { oy = getComputedStyle(cur).overflowY; } catch (err) { /* ignore */ }
      if (/(auto|scroll)/.test(oy) && cur.clientHeight > 120) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  let posMenu = null;
  function closePosMenu() {
    if (posMenu) {
      posMenu.remove();
      posMenu = null;
      document.removeEventListener("pointerdown", onDocDownClose, true);
    }
  }
  // 点击菜单项的时序:pointerdown(此监听)→ pointerup → click。若 pointerdown 就关菜单,
  // click 会在已移除的元素上落空、永远选不中——故菜单内部点击不关,交给 click 处理
  function onDocDownClose(e) {
    if (posMenu && posMenu.contains(e.target)) return;
    closePosMenu();
  }
  function openPosMenu(x, y) {
    closePosMenu();
    const m = document.createElement("div");
    m.setAttribute("data-ztps-menu", "1");
    Object.assign(m.style, {
      position: "fixed", left: x + "px", top: y + "px", zIndex: "2147483000",
      background: "var(--color-background, var(--ztps-bg, #ffffff))",
      color: "var(--color-foreground, var(--ztps-fg, #1b1f24))",
      border: "1px solid rgba(127,127,127,0.3)", borderRadius: "10px",
      padding: "4px", display: "flex", flexDirection: "column", gap: "2px",
      fontSize: "12px", lineHeight: "1.4", boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      userSelect: "none",
    });
    const cur = getPos();
    for (const p of POSITIONS) {
      const it = document.createElement("div");
      Object.assign(it.style, { padding: "5px 12px", borderRadius: "6px", cursor: "pointer", whiteSpace: "nowrap" });
      it.textContent = (p.id === cur ? "● " : "○ ") + p.label;
      it.addEventListener("pointerenter", () => { it.style.background = "rgba(127,127,127,0.18)"; });
      it.addEventListener("pointerleave", () => { it.style.background = "transparent"; });
      it.addEventListener("click", (e) => {
        e.stopPropagation();
        closePosMenu();
        if (p.id !== cur) { setPos(p.id); renderBar(); }
      });
      m.appendChild(it);
    }
    document.body.appendChild(m);
    // 视口内收敛,防止贴边溢出
    const r = m.getBoundingClientRect();
    if (r.right > window.innerWidth) m.style.left = Math.max(4, window.innerWidth - r.width - 4) + "px";
    if (r.bottom > window.innerHeight) m.style.top = Math.max(4, window.innerHeight - r.height - 4) + "px";
    posMenu = m;
    // 捕获阶段监听外部按下即关闭;setTimeout 避免右键自身的 pointerdown 立刻触发关闭
    setTimeout(() => document.addEventListener("pointerdown", onDocDownClose, true), 0);
  }
  // 右键入口挂 document 捕获阶段:任何中间层 stopPropagation 都拦不住,且不随 pill 生命周期失效
  document.addEventListener("contextmenu", (e) => {
    const t = e.target;
    if (t && typeof t.closest === "function" && t.closest("[data-ztps-bar]")) {
      e.preventDefault();
      openPosMenu(e.clientX, e.clientY);
    }
  }, true);

  // ---------- 主题兜底 ----------
  // 颜色优先用应用自己的 CSS 变量（--color-foreground 等），一旦某个版本改了变量名，
  // 就退到我们自己的变量上；而我们的变量按「应用主题类（.dark）→ 系统偏好」两级判定，
  // 避免出现「浅色主题 + 深色兜底字色」这种看不清的组合。
  const STYLE_ID = "ztps-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    try {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = [
        "[data-ztps-bar]{--ztps-fg:#1b1f24;--ztps-dim:#5b6470;--ztps-accent:#b45309}",
        ".dark [data-ztps-bar],html.dark [data-ztps-bar],body.dark [data-ztps-bar]",
        "{--ztps-fg:#e8e8e8;--ztps-dim:#9a9a9a;--ztps-accent:#e0983a}",
        "@media (prefers-color-scheme: dark){",
        ":root:not(.light):not([data-theme='light']) [data-ztps-bar]",
        "{--ztps-fg:#e8e8e8;--ztps-dim:#9a9a9a;--ztps-accent:#e0983a}}",
        "[data-ztps-menu]{--ztps-bg:#ffffff;--ztps-fg:#1b1f24}",
        ".dark [data-ztps-menu],html.dark [data-ztps-menu],body.dark [data-ztps-menu]",
        "{--ztps-bg:#1e1e1e;--ztps-fg:#e8e8e8}",
        "@media (prefers-color-scheme: dark){",
        ":root:not(.light):not([data-theme='light']) [data-ztps-menu]",
        "{--ztps-bg:#1e1e1e;--ztps-fg:#e8e8e8}}",
        "/* 状态点呼吸灯(0.6.49):仅 opacity,合成器动画零重排零重绘 */",
        "@keyframes ztpsBreath{0%,100%{opacity:.35}50%{opacity:1}}",
        "/* 模型弹窗扁平列表宽度自适应保障 */",
        "[data-radix-popper-content-wrapper] [role='menu'].w-48,",
        "[data-radix-popper-content-wrapper] [role='listbox'].w-48,",
        "[data-radix-popper-content-wrapper] .w-48.max-h-72{width:20rem!important;min-width:20rem!important}",
      ].join("");
      document.head.appendChild(st);
    } catch (err) { /* 静默 */ }
  }

  const turns = new Map();          // turnId(msg_xxx) -> 轮统计
  const firstChunkByScid = {};
  const rowTurn = new Map();        // rowId -> turnId（row.delta 增量归属）
  const respTurn = new Map();       // assistantResponseId -> turnId（stream.chunk 的 assistantMessageId 归属）
  const scidTurn = new Map();       // sourceCommandId -> turnId（usage.delta 关联兜底）
  // 早到 usage.delta 暂存：scid -> [{ev, at}]。首批带 input 的 delta 常早于 turnHeader/
  // respTurn 桥接到达，旧逻辑直接丢弃导致输入恒 0；此处暂存，桥接建成后回放。
  const pendingUsage = new Map();
  const PENDING_CAP = 50, PENDING_TTL_MS = 5 * 60 * 1000;
  let appliedFromPending = 0;

  const get = (id) => {
    if (!turns.has(id)) turns.set(id, {
      msgId: id, sourceCommandId: null, sessionId: null,
      startedAt: null, endedAt: null, activeMs: null, modelDurationMs: null,
      firstChunkAt: null, rowFirstAt: null, lastUsageAt: null,
      outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0,
      steps: 0, reqIds: null,   // 步数=已完成模型请求数；reqIds 按 requestId 去重
      textTok: 0, win: [], modelId: null, streaming: false,
    });
    return turns.get(id);
  };

  // 轮复用（编辑重发/重试复用同一 turnId）时清空上一轮统计，避免旧值残留到新轮
  function resetTurnStats(t) {
    t.endedAt = null; t.activeMs = null; t.modelDurationMs = null;
    t.firstChunkAt = null; t.rowFirstAt = null; t.lastUsageAt = null;
    t.outputTokens = 0; t.inputTokens = 0; t.cacheReadTokens = 0; t.cacheWriteTokens = 0; t.reasoningTokens = 0; t.totalTokens = 0;
    t.steps = 0; t.reqIds = null;
    t.textTok = 0; t.win = []; t.lastTps = null; t.streaming = true;
    // 旧会话 ID/命令 ID 不清会污染新轮：sessionId 导致 renderBar 会话过滤误杀，
    // sourceCommandId 导致 findByScid 把旧轮当新轮命中（usage 串台）
    t.sessionId = null; t.sourceCommandId = null;
  }

  // token 粗估：CJK 字符 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token
  const estTok = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2e7f ? 1 : 0.25;
    return Math.round(n);
  };

  const pushWin = (t, ts, tok) => {
    t.win.push([ts, tok]);
    const floor = ts - 6000;
    while (t.win.length > 2 && t.win[0][0] < floor) t.win.shift();
  };

  let scanRaf = 0;
  function scheduleScan() {
    if (scanRaf) return;
    scanRaf = requestAnimationFrame(() => {
      scanRaf = 0;
      scan();
    });
  }

  function onRow(row) {
    if (!row) return;
    if (row.op === "row.delta") { onRowDelta(row); return; }
    if (!row.turnId) return;
    const t = get(row.turnId);
    if (row.rowId != null) rowTurn.set(row.rowId, row.turnId);
    if (row.kind === "turnHeader") {
      if ((t.endedAt != null || t.lastUsageAt != null) && row.startedAt && row.startedAt !== t.startedAt) resetTurnStats(t);
      t.startedAt = row.startedAt ?? t.startedAt;
      t.endedAt = row.endedAt ?? t.endedAt;
      t.activeMs = row.activeMs ?? t.activeMs;
      t.modelDurationMs = row.modelDurationMs ?? t.modelDurationMs;
      t.streaming = row.state != null && !/^(completedSuccess|completed|failed|stopped|cancelled)/.test(row.state);
      // 轮次结束=DB 落库完成：立刻让快照缓存过期，下一次扫描取到本轮结算值
      if (!t.streaming) _snapCache.at = 0;
      if (row.sourceCommandId) { t.sourceCommandId = row.sourceCommandId; replayPending(row.sourceCommandId, t); }
      scheduleScan();
    } else if (row.kind === "userInput") {
      if ((t.endedAt != null || t.lastUsageAt != null) && row.createdAt && row.createdAt !== t.startedAt) resetTurnStats(t);
      t.startedAt = row.createdAt ?? t.startedAt;
      t.streaming = true;
      if (row.sourceCommandId) { t.sourceCommandId = row.sourceCommandId; replayPending(row.sourceCommandId, t); }
      scheduleScan();
    } else if (row.kind === "reasoning" || row.kind === "assistantText") {
      if (row.assistantResponseId) respTurn.set(row.assistantResponseId, row.turnId);
      if (row.text && row.text.length) t.textTok = estTok(row.text);   // 全量覆盖，防增量累计漂移
      if (t.firstChunkAt == null && t.rowFirstAt == null && row.createdAt) {
        t.rowFirstAt = row.createdAt;   // 兜底首块（优先 stream.chunk）
      }
    }
  }

  function onRowDelta(row) {
    if (row.path !== "text" || !row.append) return;
    const turnId = rowTurn.get(row.rowId);
    if (!turnId) return;
    const t = turns.get(turnId);
    if (!t) return;
    t.textTok += estTok(row.append);
    pushWin(t, Date.now(), t.textTok);
  }

  // 单条 usage.delta 累加到轮（直达与 pending 回放共用；addDaily 不在此，避免今日重复计）
  function applyUsage(t, ev) {
    // 步数口径：usage.delta 每次模型请求完成发一条（一轮含工具调用会有多条），
    // 按 requestId 去重，防止重复投递/回放把同一步算两次；老事件无 id 时按条计。
    if (ev.requestId != null) {
      if (!t.reqIds) t.reqIds = new Set();
      if (!t.reqIds.has(ev.requestId)) { t.reqIds.add(ev.requestId); t.steps = (t.steps || 0) + 1; }
    } else {
      t.steps = (t.steps || 0) + 1;
    }
    t.outputTokens += ev.outputTokens || 0;
    t.inputTokens += ev.inputTokens || 0;
    t.cacheReadTokens += ev.cacheReadTokens || 0;
    t.cacheWriteTokens += ev.cacheWriteTokens || 0;
    t.reasoningTokens += ev.reasoningTokens || 0;
    t.totalTokens += ev.totalTokens || 0;
    t.modelId = ev.modelId || t.modelId;
    if (t.modelId && typeof window !== "undefined") {
      window.__ztpsCurrentModelId = t.modelId;
    }
    t.sessionId = ev.sessionId || t.sessionId;
    t.lastUsageAt = ev.occurredAt ?? t.lastUsageAt;
  }
  // 桥接建成后回放该 scid 的暂存 delta
  function replayPending(scid, t) {
    if (!scid || !pendingUsage.has(scid)) return;
    const list = pendingUsage.get(scid);
    pendingUsage.delete(scid);
    const now = Date.now();
    for (const item of list) {
      if (now - item.at > PENDING_TTL_MS) continue;
      applyUsage(t, item.ev);
      appliedFromPending++;
    }
    scheduleScan();
  }

  function onEvent(ev) {
    if (!ev || ev.version !== 1) return;
    const scid = ev.sourceCommandId;
    if (ev.kind === "usage.delta") {
      if (!scid) return;
      addDaily(ev);   // 今日总耗:与轮关联无关,每条精确用量都计入(幂等去重)
      const t = findByScid(scid) || turns.get(scidTurn.get(scid));
      if (!t) {
        // 桥接未建成（turnHeader/respTurn 还没到）：暂存待回放，不再丢弃
        if (!pendingUsage.has(scid)) {
          if (pendingUsage.size >= PENDING_CAP) {
            const oldest = pendingUsage.keys().next().value;
            pendingUsage.delete(oldest);
          }
          pendingUsage.set(scid, []);
        }
        pendingUsage.get(scid).push({ ev, at: Date.now() });
        return;
      }
      applyUsage(t, ev);
      if (t.firstChunkAt == null && firstChunkByScid[scid] != null) {
        t.firstChunkAt = firstChunkByScid[scid];
      }
      scheduleScan();
    } else if (ev.kind === "stream.chunk") {
      if (firstChunkByScid[scid] == null) firstChunkByScid[scid] = ev.occurredAt;
      let t = findByScid(scid);
      if (!t && ev.assistantMessageId) {
        const tid = respTurn.get(ev.assistantMessageId);
        if (tid) { t = turns.get(tid); if (t && scid) { scidTurn.set(scid, tid); replayPending(scid, t); } }
      }
      if (!t && scid && scidTurn.has(scid)) t = turns.get(scidTurn.get(scid));
      if (!t) return;
      if (t.firstChunkAt == null) t.firstChunkAt = firstChunkByScid[scid];
      t.sessionId = ev.sessionId || t.sessionId;
      t.streaming = true;   // turnHeader 未到时也标记生成中
      pushWin(t, ev.occurredAt || Date.now(), t.textTok);   // 心跳采样，保证窗口时间轴连续
    }
  }

  const findByScid = (scid) => {
    // 先走映射表（usage.delta 每条都要调，原来是无脑全表扫描）
    if (scidTurn.has(scid)) {
      const t = turns.get(scidTurn.get(scid));
      if (t && t.sourceCommandId === scid) return t;
    }
    for (const t of turns.values()) if (t.sourceCommandId === scid) return t;
    return null;
  };

  function handleFrame(data) {
    try {
      let d = data;
      if (d == null) return;
      if (d instanceof ArrayBuffer) d = new Uint8Array(d);
      if (!ArrayBuffer.isView(d)) return;
      const txt = dec.decode(d);
      const i = txt.indexOf("{");
      if (i < 0) return;
      const j = JSON.parse(txt.slice(i));
      if (j.version === 1) { onEvent(j); return; }
      const payload = j.frame && j.frame.payload;
      if (!payload) return;
      const evs = payload.events || payload.deltas || [];
      for (const e of evs) {
        if (e.row) onRow(e.row);
        else if (e.op === "row.appended" || e.op === "row.upserted" || e.op === "row.delta") onRow(e.row || e);
      }
    } catch (err) { /* 静默 */ }
  }

  // ---------- 格式化 ----------
  const fmtLat = (ms) => {
    const s = Math.max(0, (ms || 0) / 1000);
    return (s < 10 ? String(+s.toFixed(1)) : String(Math.round(s))) + "s";
  };
  const fmtTps = (v) => (v >= 10 ? String(Math.round(v)) : String(+Number(v || 0).toFixed(1)));
  const fmtTok = (v) => {
    if (v < 1e3) return String(v);
    const trim = (n) => String(+n.toFixed(n < 10 ? 1 : 0));
    if (v < 1e6) return trim(v / 1e3) + "k";
    if (v < 1e9) return trim(v / 1e6) + "m";
    return trim(v / 1e9) + "b";
  };
  // 平均命中率：固定两位小数（不足补零），四舍五入。
  // 先放大取整再回缩，规避 toFixed 的二进制表示误差（如 (1.005).toFixed(2) === "1.00"）。
  const fmtPct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0.00";
    return (Math.round(n * 100 + 1e-9) / 100).toFixed(2);
  };
  // ---------- 渐变色（0.6.47/0.6.48 用户口径）----------
  // tok/s:0→红、400→紫,中间线性插值;命中率:0%→橙、100%→绿(命中高=省钱)。
  // 两端钳制;亮/暗主题下 #ef4444/#a855f7/#f97316/#22c55e 均可读。
  const mixHex = (a, b, t) => {
    const k = Math.max(0, Math.min(1, t));
    const rgb = [0, 1, 2].map((i) => {
      const pa = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
      const pb = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
      return Math.round(pa + (pb - pa) * k).toString(16).padStart(2, "0");
    });
    return "#" + rgb.join("");
  };
  const TPS_GRAD_MAX = 400;
  const colorTps = (v) => mixHex("#ef4444", "#a855f7", (v || 0) / TPS_GRAD_MAX);
  const colorHit = (pct) => mixHex("#f97316", "#22c55e", (pct || 0) / 100);
  const fmtStamp = (ms) => {
    if (ms == null) return null;
    const d = new Date(ms), now = new Date();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return d.toDateString() === now.toDateString() ? hm
      : d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  };

  function statsOf(t) {
    const firstAt = t.firstChunkAt ?? t.rowFirstAt ?? null;
    const ttft = firstAt != null && t.startedAt != null ? firstAt - t.startedAt : null;
    let out = t.outputTokens;
    if (out === 0 && t.textTok > 0) out = t.textTok;   // 中止/失败未报 usage：以内容估算兜底
    const reasoning = t.reasoningTokens || 0;
    let tps = null;
    if (t.streaming) {
      out = Math.max(out, t.textTok);   // 流式中 usage 未到，用内容估算补齐（精确值到达后自然切换）
      const now = Date.now();
      const win = t.win.filter((w) => now - w[0] <= 4000);
      if (win.length >= 2) {
        const dt = (win[win.length - 1][0] - win[0][0]) / 1000;
        const dtok = win[win.length - 1][1] - win[0][1];
        if (dt >= 1 && dtok > 0) tps = dtok / dt;
      }
      if (tps == null && t.lastTps != null) tps = t.lastTps;   // 工具执行等静默期：保持最近速度
    } else {
      // 优先使用官方下发的精确 modelDurationMs 校准全轮纯模型生成速率
      if (t.modelDurationMs != null && t.modelDurationMs > 500 && t.outputTokens > 0) {
        tps = t.outputTokens / (t.modelDurationMs / 1000);
      } else {
        const decodeFrom = firstAt ?? t.startedAt;
        const decodeMs = decodeFrom != null && t.lastUsageAt != null ? t.lastUsageAt - decodeFrom : null;
        tps = t.outputTokens > 0 && decodeMs > 500 ? t.outputTokens / (decodeMs / 1000) : null;
      }
      if (tps == null && t.lastTps != null) tps = t.lastTps;
    }
    if (tps != null) t.lastTps = tps;
    return {
      stamp: fmtStamp(t.endedAt || t.startedAt), ttft, tps, out, reasoning,
      streaming: t.streaming,
    };
  }

  const hasActivity = (t) => t.streaming || t.textTok > 0 || t.outputTokens > 0;

  // ---------- 渲染 ①: 输入框工具栏中央（当前会话最近一轮） ----------
  // 工具栏行的定位策略（按稳定性排序，逐级回退；不依赖任何随版本/语言变化的文案）：
  //   a) composer 容器内带 items-end 的 flex 行，且含交互控件（button/select/combobox）
  //   b) composer 容器内最后一个 items-end 的 flex 行
  // 历史：旧实现用 textContent.includes("完全访问") 判定，3.12.2 起该文案改为按 i18n key
  // 动态渲染，DOM 文本不再稳定命中 → 改为结构特征判定。
  // 诊断：window.__ztpsDiag 暴露每一环的探测结果（选择器命中数/候选行数/最终选择），
  // 版本升级后若工具栏消失，先在 console 看该对象定位失败环节。
  const COMPOSER_INPUT_SELECTORS = [
    "[data-testid='v4-composer-input']",
    "[data-testid*='composer-input']",
    "textarea[data-testid]",
    "form textarea",
    "textarea",
  ];

  function findComposerInput() {
    const tried = [];
    for (const sel of COMPOSER_INPUT_SELECTORS) {
      let hit = null;
      try {
        let els = Array.from(document.querySelectorAll(sel));
        if (els.length) {
          // ① 严格剔除侧边栏/辅助对话中的输入框，绝不将状态栏挂入侧边栏
          els = els.filter((e) => !isInsideSidePane(e));
          if (els.length) {
            // ② 优先取处于主会话容器 [data-workspace-conversation-frame] 内的输入框
            const mainEls = els.filter(isInsideMainConversation);
            const pool = mainEls.length ? mainEls : els;
            if (pool.length === 1) {
              hit = pool[0];
            } else {
              const vis = pool.filter((e) => e.offsetParent != null);
              const candidates = vis.length ? vis : pool;
              if (candidates.length === 1) {
                hit = candidates[0];
              } else {
                // ③ 排序准则：以最靠下为主要准则；但当纵向坐标极度接近（<20px，左右并排）时，
                //    绝对优先选择靠左（主工作区，left 较小）的主会话输入框，彻底杜绝跳动
                candidates.sort((a, b) => {
                  const ra = a.getBoundingClientRect();
                  const rb = b.getBoundingClientRect();
                  const dTop = rb.top - ra.top;
                  if (Math.abs(dTop) > 20) return dTop;
                  return ra.left - rb.left;
                });
                hit = candidates[0];
              }
            }
          }
        }
      } catch (err) { /* 选择器不合法，跳过 */ }
      tried.push({ selector: sel, count: hit ? 1 : 0 });
      if (hit) return { el: hit, tried };
    }
    return { el: null, tried };
  }

  // composer 卡片(v4-composer):工具栏行与「输入框下方」条共用的定位基准
  function findComposerCard() {
    const { el: ta, tried } = findComposerInput();
    if (diag) {
      diag.inputTried = tried;
      diag.inputFound = !!ta;
    }
    if (!ta) return null;
    let card = null;
    try { card = ta.closest("[data-testid='v4-composer']"); } catch (err) { /* ignore */ }
    if (!card) card = ta.closest("form") ? ta.closest("form").parentElement : null;
    if (!card) card = ta.parentElement;
    if (card && isInsideSidePane(card)) return null;   // 侧边栏卡片直接拒收
    return card || null;
  }

  function findToolbarRow() {
    const card = findComposerCard();
    if (!card || isInsideSidePane(card)) return null;

    // 从某元素向上找「工具栏行」：class 同时含 flex 与 items-end 的 div，且不得越过 card
    const rowFrom = (el, card) => {
      let cur = el;
      while (cur && cur !== card.parentElement) {
        if (cur.tagName === "DIV") {
          const c = typeof cur.className === "string" ? cur.className : "";
          if (/(^|\s)flex(\s|$)/.test(c) && /items-end/.test(c)) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    };

    // ① 首选：发送/停止按钮向上找工具栏行（生成中发送按钮会被官方切换为停止按钮 v4-stop）。
    let picked = null;
    try {
      const btn = card.querySelector("[data-testid='v4-composer-send'], [data-testid='v4-stop']");
      if (btn) picked = rowFrom(btn, card);
    } catch (err) { /* ignore */ }

    // ② 回退：card 内所有 items-end 行，取含交互控件的那一行（或最后一个）
    if (!picked) {
      const rows = Array.from(card.querySelectorAll("div")).filter((el) => {
        const c = typeof el.className === "string" ? el.className : "";
        return /(^|\s)flex(\s|$)/.test(c) && /items-end/.test(c);
      });
      if (diag) diag.rowCandidates = rows.length;
      if (!rows.length) return null;
      picked = rows.find((el) => el.querySelector("button,select,[role='combobox'],input")) ||
               rows[rows.length - 1];
    } else if (diag) {
      diag.rowCandidates = 1;
      diag.rowVia = "send-button";
    }

    if (diag) {
      diag.pickedRowText = (picked.textContent || "").slice(0, 60);
      diag.pickedRowClass = String(picked.className || "").slice(0, 120);
      diag.cardTag = card.tagName;
    }
    return picked;
  }

  // 诊断对象（console 里直接看 window.__ztpsDiag）
  let diag = null;
  try {
    diag = window.__ztpsDiag = window.__ztpsDiag || {};
    diag.scriptVersion = "3.26-dotbreath";
    diag.loadedAt = new Date().toISOString();
  } catch (err) { /* ignore */ }

  // ---------- 挂载点 ----------
  // 三种模式共用同一个 host(含内层 pill);切换模式时搬移节点并重置样式。
  //   composer-below: composer 卡片之后的独立一行(默认),与输入框同宽,承载会话累计统计
  //   toolbar:        工具栏行内水平居中
  //   session-top:    消息区滚动容器首子元素,sticky 吸顶;负 margin-bottom 抵消文档流占位,
  //                   host 上 pointer-events:none 放行下方消息,胶囊本体恢复 auto
  // composer-below 的纵向间距：不猜布局（gap / space-y / margin 各家不同），
  // 直接量「胶囊上沿到卡片下沿」「胶囊下沿到下一元素」的实际像素，用等量负 margin 抵消，
  // 使视觉间距恒为 GAP_TARGET。布局变更/窗口缩放后再量一次即自适应。
  const GAP_TARGET = 2;   // 目标视觉间距(px)
  const MAX_SINK = 16;    // 末位元素最多下沉多少(px)，防止跑到父容器外压到别的东西
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  function fitGap(host, card) {
    if (!host || !card || !host.isConnected || !card.isConnected) return;
    try {
      // 增量累积修正：测量值本身包含上一次的 margin，必须「当前 margin - 实测偏差」，
      // 不能用绝对值反算（否则会在 0 与 -gap 之间自激振荡）。一次收敛，之后偏差≈0 不再写样式。
      const c = card.getBoundingClientRect();
      let h = host.getBoundingClientRect();
      // 布局原生的上方空白 = 实测 - 我们已加的 margin。它同时是「下方最多能抵消多少」的上限：
      // 我们只撤掉自己插入带来的那一份空白，绝不吞掉应用自己的下边距/元素间距。
      const rawTop = (h.top - c.bottom) - px(host.style.marginTop);
      const cap = Math.max(0, rawTop);
      const topErr = (h.top - c.bottom) - GAP_TARGET;   // 正=还太远 负=贴太近
      if (Math.abs(topErr) > 0.5) {
        host.style.marginTop = (px(host.style.marginTop) - topErr) + "px";
        h = host.getBoundingClientRect();               // 立即回流，取补偿后的真实位置
      }
      const nx = host.nextElementSibling;
      if (nx) {
        // 后面还有元素：负 margin 能真正把后续内容拉上来，量到它上沿即可
        const botErr = nx.getBoundingClientRect().top - h.bottom;
        if (botErr > 0.5) {
          host.style.marginBottom = (px(host.style.marginBottom) - Math.min(botErr, cap)) + "px";
        } else if (botErr < -0.5) {
          host.style.marginBottom = (px(host.style.marginBottom) + Math.min(-botErr, cap)) + "px";
        }
        host.style.transform = "";
        if (diag) { diag.gapSink = 0; diag.gapNext = true; }
      } else {
        // 末位元素：负 margin 只会压缩父容器总高，**不会让胶囊自己下移**（父高 auto 时
        // 容器底同步上移，偏差恒定不变），所以「胶囊↔底部边框」这段只能靠视觉位移沉下去。
        // 沉入量 = 父容器边框盒底 - 胶囊下沿 - 2(留白)，上限 MAX_SINK；只沉进 padding，
        // 不越过父容器，绝不压到其它 UI。
        host.style.marginBottom = "0px";
        const p = host.parentElement;
        const pcs = getComputedStyle(p);
        const bBottom = p.getBoundingClientRect().bottom - px(pcs.borderBottomWidth);
        const room = bBottom - h.bottom - GAP_TARGET;
        const sink = Math.max(0, Math.min(room, MAX_SINK));
        host.style.transform = sink > 0.5 ? "translateY(" + sink + "px)" : "";
        if (diag) { diag.gapSink = sink; diag.gapNext = false; }
      }
    } catch (err) { /* 静默 */ }
  }
  function attach(host, mode) {
    const changed = host.getAttribute("data-ztps-mode") !== mode;
    // 快路径：宿主已在文档树中、模式未变、且处于正确的父/兄弟节点下，无需重新查找 composer，0开销返回
    if (!changed && host.isConnected && host._target && host._target.isConnected) {
      if (mode === "composer-below" && host.previousElementSibling === host._target) {
        // 低频重量：布局(gap 变化/窗口缩放/主题切换)漂移后自动重新对齐，1s 节流
        const now = Date.now();
        if (!host._fitAt || now - host._fitAt > 1000) { fitGap(host, host._target); host._fitAt = now; }
        return true;
      }
      if (mode === "session-top" && host.parentElement === host._target) return true;
      if (mode === "toolbar" && host.parentElement === host._target) return true;
    }
    if (mode === "composer-below") {
      const card = findComposerCard();
      if (!card || !card.parentElement || isInsideSidePane(card)) return false;
      if (changed || host.parentElement !== card.parentElement || host.previousElementSibling !== card) {
        card.insertAdjacentElement("afterend", host);
        host.setAttribute("data-ztps-mode", mode);
        host.style.cssText = "";
        Object.assign(host.style, {
          display: "flex", justifyContent: "center",
          alignItems: "center",
          marginTop: "0", marginBottom: "0", padding: "0",
          alignSelf: "stretch",          // 与 composer 卡片同宽
          pointerEvents: "auto",
        });
        // 插入完成后量一次实际空白并抵消（rAF 保证拿到最终布局）
        try { requestAnimationFrame(() => { fitGap(host, card); host._fitAt = Date.now(); }); } catch (err) { /* 静默 */ }
      }
      host._target = card;
    } else if (mode === "session-top") {
      const sc = findSessionScroller();
      if (!sc || isInsideSidePane(sc)) return false;
      if (changed || host.parentElement !== sc) {
        sc.insertBefore(host, sc.firstChild);
        host.setAttribute("data-ztps-mode", mode);
        host.style.cssText = "";
        Object.assign(host.style, {
          position: "sticky", top: "8px", zIndex: "30",
          width: "100%", height: "22px",
          display: "flex", justifyContent: "center",
          margin: "0 0 -30px", padding: "0",
          pointerEvents: "none",
        });
      }
      host._target = sc;
    } else {
      const row = findToolbarRow();
      if (!row || isInsideSidePane(row)) return false;
      if (changed || host.parentElement !== row) {
        row.insertBefore(host, row.children[1] || null);
        host.setAttribute("data-ztps-mode", mode);
        host.style.cssText = "";
        Object.assign(host.style, {
          display: "inline-flex", flex: "0 1 auto",
          minWidth: "0", maxWidth: "50%",
          marginLeft: "auto", marginRight: "auto",   // 两侧 auto = 工具栏行内水平居中
          alignSelf: "center", height: "22px",
          margin: "0", padding: "0", position: "static",
          pointerEvents: "auto",
        });
        row.style.alignItems = "center";
      }
      host._target = row;
    }
    const pill = host.firstChild;
    if (pill) {
      pill.style.pointerEvents = "auto";
      pill.title = "ZCode TPS · 右键切换位置";
    }
    return true;
  }

  function renderBar() {
    try {
      const mode = getPos();
      // 只认当前主会话 DOM 里可见的轮次——排除侧边栏辅助对话的轮次干扰
      const mainFrame = document.querySelector("[data-workspace-conversation-frame]");
      let domSess = null;
      if (mainFrame) {
        domSess = mainFrame.getAttribute("data-session-id");
        if (!domSess) {
          const innerSess = mainFrame.querySelector("[data-session-id]");
          if (innerSess) domSess = innerSess.getAttribute("data-session-id");
        }
      }
      // 3.17.x 把 data-session-id 挂在 composer 卡片上（无会话时为 "draft"），不在 frame 上；
      // 取不到就不能按会话查快照 → 输入/命中永远回填不了。兜底顺序：
      // ① 事件流里轮次自带的 sessionId（usage.delta/stream.chunk 均下发真实 sess_xxx）
      // ② 主会话 DOM 里任一非 draft 的 data-session-id（排除侧边栏）
      if (!domSess || domSess === "draft") {
        domSess = null;
        let bestAt = -1;
        for (const t of turns.values()) {
          if (!t.sessionId) continue;
          const at = t.lastUsageAt ?? t.startedAt ?? 0;   // 取最近有活动的那个会话，别被旧轮覆盖
          if (at >= bestAt) { bestAt = at; domSess = t.sessionId; }
        }
        if (!domSess) {
          let pool = [];
          try {
            pool = Array.from(document.querySelectorAll("[data-session-id]")).filter((el) => {
              const v = el.getAttribute("data-session-id");
              return v && v !== "draft" && !isInsideSidePane(el);
            });
          } catch (err) { pool = []; }
          if (pool.length) domSess = pool[0].getAttribute("data-session-id");
        }
      }

      const visible = new Set();
      // 只有在内存中有轮次数据时才扫描可见 DOM；若 turns 为空（新启动/仅看历史），直接跳过数百个节点的 DOM 遍历
      if (turns.size > 0) {
        if (mainFrame) {
          mainFrame.querySelectorAll("section[data-turn-id]").forEach((el) => {
            visible.add(el.getAttribute("data-turn-id"));
          });
        } else {
          document.querySelectorAll("section[data-turn-id]").forEach((el) => {
            if (!isInsideSidePane(el)) visible.add(el.getAttribute("data-turn-id"));
          });
        }
      }
      lastVisible = visible;
      // 会话累计:轮数/步数 / 累计输入 / 累计缓存命中 / 累计思考 / 累计输出(仅当前可见会话的轮次)
      const agg = { rounds: 0, steps: 0, input: 0, cache: 0, cacheWrite: 0, reasoning: 0, output: 0 };
      let latest = null;
      for (const t of turns.values()) {
        if (!visible.has(t.msgId)) continue;
        // 轮次归属会话与当前显示会话不符时排除(会话切换的 DOM 中间态残留兜底)
        if (t.sessionId && domSess && t.sessionId !== domSess) continue;
        if (t.startedAt != null || hasActivity(t)) agg.rounds++;
        agg.steps += t.steps || 0;
        agg.input += t.inputTokens || 0;
        agg.cache += t.cacheReadTokens || 0;
        agg.cacheWrite += t.cacheWriteTokens || 0;
        agg.reasoning += t.reasoningTokens || 0;
        // 流式中 usage 未到的轮以内容估算兜底,精确值到达后自然覆盖
        agg.output += Math.max(t.outputTokens || 0, t.streaming ? (t.textTok || 0) : 0);
        if (!latest || (t.startedAt ?? 0) > (latest.startedAt ?? 0)) latest = t;
      }
      let host = document.querySelector("[" + MARK + "-bar]");
      // DB 快照结算层回填：事件优先、快照补漏（Math.max 保证流式值不被拉低）。
      // 触发刷新（3s TTL，搭本次渲染顺带触发，不新增定时器；0.6.42 起新快照由
      // main watcher 经 zcode:tps-push 主动推送，拉取仅作兜底）
      refreshSnapshot();
      const snap = snapSession(domSess);
      if (snap) {
        if ((snap.input || 0) > agg.input) agg.input = snap.input;
        if ((snap.cache_read || 0) > agg.cache) agg.cache = snap.cache_read;
        if ((snap.output || 0) > agg.output) agg.output = snap.output;
        // 轮/步是会话级全历史:快照 turns=distinct turn_id、requests=completed 模型请求数。
        // ⚠️ 不得再把「streaming 轮的轮数/步数」加到快照基线上（0.6.35 及之前这么做）：
        //   * 0.6.35 起 PostToolUse 钩子让快照在回合内也持续刷新，in-flight 轮的首个请求
        //     一落库就进 snap.turns/requests，再 +stream 会把它算两遍；
        //   * 终态 turnHeader 行偶发缺失时，旧轮会永远卡在 streaming——+stream 会把
        //     它当成新轮再 +1（用户实测：空闲 5 轮显示 6；回合中 2 轮 115 请求显示 3轮 215步）。
        // 口径 = max(事件流实时累计, 快照结算值)：新轮由事件流立即 +1，快照 ≤30s 追平；
        // 重开旧会话事件流无历史，由快照兜底全历史。
        const snapRounds = snap.turns || 0;
        const snapSteps = snap.requests || 0;
        if (snapRounds > agg.rounds) agg.rounds = snapRounds;
        if (snapSteps > agg.steps) agg.steps = snapSteps;
      }
      // 今日总耗(全局口径:含所有会话/侧边栏,以 Σ(input+output) 精确值计)
      const today = readToday();
      const snapToday = snapTodayTotal();
      if (snapToday > today.total) today.total = snapToday;
      if (diag) {
        diag.domSessionId = domSess;
        diag.visibleTurns = visible.size;
        diag.turnStats = turns.size;
        diag.latestFound = !!latest;
        diag.posMode = mode;
        diag.todayKey = today.key;
        diag.todayTotal = today.total;
        diag.pendingUsageSize = pendingUsage.size;
        diag.appliedFromPending = appliedFromPending;
        diag.aggRounds = agg.rounds;
        diag.aggSteps = agg.steps;
        diag.snapshotHit = !!snap;
        diag.snapTurns = snap ? (snap.turns || 0) : 0;
        diag.snapRequests = snap ? (snap.requests || 0) : 0;
        diag.snapshotOk = _snapCache.ok;
        diag.snapshotErr = _snapCache.err;
        diag.snapshotTs = _snapCache.stamp || 0;
        diag.snapshotToday = snapToday;
        diag.snapshotAge = _snapCache.ok ? (Date.now() - _snapCache.at) : -1;
        if (latest) {
          diag.latest = {
            msgId: latest.msgId, sessionId: latest.sessionId,
            startedAt: latest.startedAt, endedAt: latest.endedAt,
            streaming: latest.streaming, out: latest.outputTokens, textTok: latest.textTok,
            reasoning: latest.reasoningTokens,
          };
        }
        diag.hostAttached = !!host;
      }
      // 数据态:轮次有时间戳或生成活动;空态:当前会话无任何轮次(新会话/未对话)。
      // 快照有量也算数据态——重开旧会话时事件流没有历史，但 DB 结算值在；
      // 否则只显示「● 总耗」，输入/输出/命中要等新一轮才出现。
      const snapHas = !!(snap && ((snap.input || 0) > 0 || (snap.output || 0) > 0));
      const hasData = (!!latest && (hasActivity(latest) || latest.endedAt != null || latest.startedAt != null))
        || snapHas;
      if (diag) diag.hiddenReason = hasData ? null : "空态(无轮次数据)";
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-ztps-bar", "1");
        host.setAttribute("data-ztps-mode", mode);
        const pill = document.createElement("div");
        Object.assign(pill.style, {
          display: "inline-flex", alignItems: "center", gap: "6px",
          minWidth: "0",
          fontSize: "11px", height: "20px", userSelect: "none",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap", overflow: "hidden",
          borderRadius: "999px",
          background: "rgba(127,127,127,0.08)",
          padding: "0 10px",
        });
        pill.addEventListener("contextmenu", (e) => e.preventDefault());
        host.appendChild(pill);
      }
      // 挂载点失效(找不到工具栏行/会话滚动容器,新建任务空态、设置页等)→ 移除,杜绝旧内容残留
      if (!attach(host, mode)) {
        if (diag) diag.hiddenReason = "挂载点未找到(" + mode + ")";
        closePosMenu();
        host.remove();
        return;
      }
      const pill = host.firstChild;
      if (!hasData) {
        // 空态:仅绿点,今日有消耗则附带总耗;右键切位置等交互照常
        const ekey = "empty|" + today.key + "|" + today.total;
        if (pill._zkey !== ekey) {
          pill._zkey = ekey;
          pill._zsegs = [];
          pill.style.background = "rgba(127,127,127,0.08)";
          pill.style.padding = "0 10px";
          pill.innerHTML = "";
          const dot = document.createElement("span");
          dot.textContent = "●";
          dot.style.color = "#4ade80";
          pill.appendChild(dot);
          if (today.total > 0) {
            const sep = document.createElement("span");
            sep.textContent = "│";
            sep.style.opacity = "0.45";
            pill.appendChild(sep);
            const lab = document.createElement("span");
            lab.textContent = "总耗 ";
            pill.appendChild(lab);
            const val = document.createElement("span");
            val.textContent = fmtTok(today.total);
            val.style.color = "var(--color-foreground, var(--ztps-fg, #1b1f24))";
            pill.appendChild(val);
          }
        }
        return;
      }
      // 只有快照、没有事件流轮次（重开旧会话）时给一份空指标，只渲染累计区
      const s = latest ? statsOf(latest) : { stamp: null, ttft: null, tps: null, out: 0, reasoning: 0, streaming: false };
      // 结算层权威兜底（0.6.42 移植自参考实现）：DB 每条 completed 请求自带官方
      // first_token_at/completed_at，快照会话级携带最近一条可见请求的 tok/s
      // （output÷生成耗时）与首token 毫秒。只在两种情况兜底，事件层有值时绝不覆盖：
      //   ① 事件漏采（DB 可见请求比事件层最新活动还新 3s+，scid 关联失败/长回合漏帧
      //      时 tok/s 冻在旧值）——判据用 last_completed_at（可见请求口径）而非 last_at，
      //      因标题等隐藏请求总在轮末 +1~2s 落库，3s 容差不应被它们吃掉；
      //   ② 事件层算不出（中止/缺 modelDurationMs/重开旧会话无事件流）。
      // 流式轮不受影响——DB 只在请求完成时落行，流中没有权威数据。
      if (snap && (snap.last_tps || 0) > 0 && !(latest && latest.streaming)) {
        const evAt = latest ? (latest.lastUsageAt || latest.endedAt || 0) : 0;
        const dbNewer = (snap.last_completed_at || snap.last_at || 0) > evAt + 3000;
        if (dbNewer || s.tps == null) {
          s.tps = snap.last_tps;
          if (s.ttft == null && (snap.last_ttft_ms || 0) > 0) s.ttft = snap.last_ttft_ms;
          if (diag) diag.snapshotTpsApplied = dbNewer ? "db-newer" : "no-event-tps";
        }
      }
      // 内容签名:未变化时完全跳过 DOM 写入与排版回流，达到零开销
      const key = [s.stamp, s.ttft, s.tps, s.out, s.reasoning, s.streaming,
                   agg.rounds, agg.steps, agg.input, agg.cache, agg.cacheWrite, agg.reasoning, agg.output,
                   today.key, today.total, _snapCache.stamp].join("|");
      let segs = pill._zsegs;
      if (pill._zkey !== key) {
        pill._zkey = key;
        pill.style.background = "rgba(127,127,127,0.08)";
        pill.style.padding = "0 10px";
        pill.style.color = "var(--color-foreground-subtle, var(--ztps-dim, #5b6470))";
        pill.innerHTML = "";
        const VALUE = "var(--color-foreground, var(--ztps-fg, #1b1f24))";
        const span = (txt, cls) => {
          const sp = document.createElement("span");
          sp.textContent = txt;
          if (cls === "VALUE") sp.style.color = VALUE;
          return sp;
        };
        // 状态点常驻（0.6.49 用户口径）：对话运行中=琥珀呼吸灯，空闲=绿色静态。
        // 点节点跨重建复用（pill._zdot）：流式中 tok/s 每次变化都会重建 pill（innerHTML=""），
        // 若每次新建节点，CSS 动画会不断从头播，呼吸感失效——只在 streaming 翻转时改状态。
        let dot = pill._zdot;
        if (!dot) {
          dot = span("●");
          pill._zdot = dot;
        }
        if (dot._zbusy !== !!s.streaming) {
          dot._zbusy = !!s.streaming;
          if (s.streaming) {
            dot.style.color = "#f59e0b";
            dot.style.textShadow = "0 0 6px rgba(245,158,11,.8)";
            dot.style.animation = "ztpsBreath 1.6s ease-in-out infinite";
          } else {
            dot.style.color = "#4ade80";
            dot.style.textShadow = "";
            dot.style.animation = "";
          }
        }
        pill.appendChild(dot);
        // 段布局:即时指标(g0:首 token/tok/s)+ 会话累计(g1:轮数/步数/输入/输出/平均命中)+ 今日总耗(g2:总耗)。
        // 组间用竖线分隔,组内用 · ;不显示时间(用户不需要)
        segs = [];
        if (s.ttft != null && s.ttft >= 0) segs.push({ p: 1, g: 0, nodes: [span("首 token "), span(fmtLat(s.ttft), "VALUE")] });
        if (s.tps != null) {
          // 速度渐变（0.6.48 用户口径）：0 tok/s→红、400→紫，随流式/结算值实时变化
          const sp = span(fmtTps(s.tps) + " tok/s");
          sp.style.color = colorTps(s.tps);
          segs.push({ p: 2, g: 0, nodes: [sp] });
        }
        if (agg.rounds > 0 && agg.steps > 0) {
          // 会话累计轮/步:严格按用户口径渲染成 N轮N步
          segs.push({ p: 3, g: 1, nodes: [span(agg.rounds + "轮", "VALUE"), span(agg.steps + "步", "VALUE")] });
        }
        if (agg.input > 0) segs.push({ p: 5, g: 1, nodes: [span("输入 "), span(fmtTok(agg.input), "VALUE")] });
        if (agg.output > 0) segs.push({ p: 6, g: 1, nodes: [span("输出 "), span(fmtTok(agg.output), "VALUE")] });
        if (agg.input > 0) {
          const pct = (agg.cache / agg.input) * 100;
          // 命中率渐变（语义色）：0%→橙（命中低=贵）、100%→绿（命中高=省钱）
          const sp = span(" 平均命中 " + fmtPct(pct) + "%");
          sp.style.color = colorHit(pct);
          segs.push({ p: 5.6, g: 1, nodes: [sp] });
        }
        if (today.total > 0) segs.push({ p: 7, g: 2, nodes: [span("总耗 "), span(fmtTok(today.total), "VALUE")] });
        segs.forEach((g, i) => {
          if (i > 0) {
            const cross = segs[i - 1].g !== g.g;   // 跨组:竖线分隔,更醒目
            const sep = span(cross ? "│" : "·");
            sep.style.opacity = cross ? "0.45" : "0.55";
            g.nodes.unshift(sep);   // 分隔符跟段一起,降级时同生共死
          }
        });
        segs.forEach((g) => g.nodes.forEach((n) => pill.appendChild(n)));
        pill._zsegs = segs;

        // 仅在文本内容有变动时，才在 rAF 中执行溢出降级检查，杜绝无意义的 scrollWidth 强制回流
        try {
          requestAnimationFrame(() => {
            try {
              for (const drop of [7, 1, 2, 3]) {
                if (pill.scrollWidth <= pill.clientWidth + 1) break;
                const g = segs.find((x) => x.p === drop);
                if (!g) continue;
                g.nodes.forEach((n) => n.remove());
              }
            } catch (err) { /* 静默 */ }
          });
        } catch (err) { /* 静默 */ }
      }
    } catch (err) { /* 静默 */ }
  }

  // ---------- 渲染 ②: 清理历史遗留的逐轮统计行（统计只在工具栏展示） ----------
  // 轮次表回收：turns / rowTurn / respTurn / scidTurn / firstChunkByScid 原来只增不删，
  // 长会话或长时间挂着会一直涨。规则：不在当前可见轮次里、且 30 分钟没有活动的记录删掉。
  const PRUNE_MS = 30 * 60 * 1000;
  let lastVisible = null;
  function prune() {
    const now = Date.now();
    for (const [id, t] of turns) {
      if (lastVisible && lastVisible.has(id)) continue;
      const last = t.lastUsageAt || t.endedAt || t.startedAt || 0;
      if (now - last <= PRUNE_MS) continue;
      turns.delete(id);
      if (t.sourceCommandId) scidTurn.delete(t.sourceCommandId);
      for (const [rid, tid] of rowTurn) if (tid === id) rowTurn.delete(rid);
      for (const [rid, tid] of respTurn) if (tid === id) respTurn.delete(rid);
    }
    for (const k of Object.keys(firstChunkByScid)) {
      if (!scidTurn.has(k) && now - (firstChunkByScid[k] || 0) > PRUNE_MS) delete firstChunkByScid[k];
    }
    // 暂存 delta 过期清理：桥接 5 分钟还没建成的 scid 视为孤儿（轮已被删/会话已切）
    for (const [scid, list] of pendingUsage) {
      const fresh = list.filter((item) => now - item.at <= PENDING_TTL_MS);
      if (fresh.length) pendingUsage.set(scid, fresh);
      else pendingUsage.delete(scid);
    }
  }

  function removeLegacyFooters() {
    try {
      // 任何误落入侧边栏/辅助对话中的 bar 节点，强制摘除
      document.querySelectorAll(`[${MARK}-bar]`).forEach((el) => {
        if (isInsideSidePane(el)) el.remove();
      });
      document.querySelectorAll(`[${MARK}]:not([data-ztps-bar])`).forEach((el) => el.remove());
    } catch (err) { /* 静默 */ }
  }

  function scan() {
    renderBar();
  }

  function start() {
    ensureStyle();
    removeLegacyFooters();
    // 彻底移除 document.body 的 MutationObserver，杜绝长会话挂载时的底层 C++ 监听负荷。
    // 流式生成期间 100% 由 MessagePort 消息帧事件驱动实时刷新（0 延迟）；
    // 会话常驻状态栏通过 500ms 轻量巡检维护（挂载状态下瞬时短路，零开销）。
    setInterval(() => {
      if (document.hidden) return;
      scheduleScan();
    }, 500);
    // 低频维护（5s）：清理过期轮次数据与遗留废弃节点
    setInterval(() => {
      if (document.hidden) return;
      prune();
      removeLegacyFooters();
    }, 5000);
    // main watcher 推送订阅（0.6.42）：快照有新写入直接送达；无桥/旧版补丁静默跳过，
    // refreshSnapshot 的拉取兜底照旧。
    try {
      if (window.zcode && typeof window.zcode.onTpsPush === "function") {
        window.zcode.onTpsPush(onSnapshotPush);
        if (diag) diag.pushSubscribed = true;
      }
    } catch (err) { /* 静默 */ }
    scan();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);

  // ---------- 端口获取 ----------
  function hookPort(port) {
    if (!port || port.__ztps) return;
    port.__ztps = true;
    // 关键：只注册监听，**绝不调用 port.start()**
    // start() 会让消息只派发给"启用瞬间"的监听器，从而吃掉应用的 Initialize 握手。
    // 交给应用 start；届时所有已注册监听器（含我们）同时收到消息。
    port.addEventListener("message", (ev) => handleFrame(ev.data));
    window.__ztpsPort = port;   // 调试用
    if (diag) {
      diag.portHooked = true;
      diag.portStarted = false;   // 恒为 false —— 本版本刻意不 start
      diag.portHookedAt = new Date().toISOString();
    }
  }
  // 端口转交的消息格式跨版本不同，两种都要认：
  //   旧版（≤3.11.x）：window.postMessage("zcode:service-port", "*", [port])   → data 为字符串
  //   新版（3.12.2+）：window.postMessage({type:"zcode:service-port",...}, "*", [port]) → data 为对象
  // 只比较字符串会让新版端口永远不被接管（表现为 turnStats 恒为 0、胶囊不显示）。
  function takePortIfHandoff(d) {
    if (!d) return false;
    if (d === "zcode:service-port") return true;
    if (typeof d === "object" && d.type) {
      return d.type === "zcode:service-port" || d.type === "zcode:scoped-service-port";
    }
    return false;
  }
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (diag) {
      diag.lastMessage = typeof e.data === "string" ? e.data
        : (e.data && e.data.type) || Object.prototype.toString.call(e.data);
      diag.lastMessagePorts = (e.ports || []).length;
    }
    if (takePortIfHandoff(e.data)) {
      if (e.ports && e.ports[0]) hookPort(e.ports[0]);
    }
  }, true);

  window.__ztpsTurns = turns;
  window.__ztpsDaily = { readToday, loadDaily, dayKeyOf };   // 调试用:查今日统计
  window.__ztpsHook = hookPort;   // 调试用：热注入时可对存量端口手动补挂
  // 自检：加载 5s 后若仍未接管端口，把诊断信息打到 console（便于版本升级后排障）
  setTimeout(() => {
    if (diag) {
      diag.portInjectedAt = diag.portInjectedAt || null;
      diag.diagReady = true;
      if (!diag.portHooked) {
        console.warn("[zcode-tps] 未接管到服务端口，统计将不可用。window.__ztpsDiag =", diag);
      } else {
        console.info("[zcode-tps] 已接管端口，window.__ztpsDiag =", diag);
      }
    }
  }, 5000);
})();
