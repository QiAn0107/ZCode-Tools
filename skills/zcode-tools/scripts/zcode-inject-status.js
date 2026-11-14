/**
 * ZCode-Tools 注入状态角标（0.6.38，由 zcode_patcher.py --inject-status 注入到
 * out/renderer/；配套 preload 桥（getInjectStatus/applyPatchesNow）与 main IPC
 * handler 在 patcher 内置，块名 zcode-inject-status）。
 *
 * 职责：
 *   1. 轮询补丁状态文件（sync.py SessionStart 与看护双写，main 只读 IPC），
 *      pending=true 时在主窗口左上角标题条显示黑底金字「待注入」角标；
 *   2. 点击角标 → 原生风格确认弹窗（说明将完全退出 ZCode 并注入）；
 *   3. 确认 → applyPatchesNow IPC → main 用 schtasks 启动看护并退出 ZCode；
 *      看护等退出后写入补丁并自动重启，角标随 pending:false 消失。
 *
 * 兜底原则：桥缺失/状态文件缺失/IPC 失败 → 角标隐藏或 toast 提示，绝不打扰、
 * 绝不抛错；挂载找不到标题条锚点 → 退化为固定位置角标（__zinjDiag.mountMode 可查）。
 */
(() => {
  if (window.__ZCODE_INJECT_STATUS_LOADED__) return;
  window.__ZCODE_INJECT_STATUS_LOADED__ = true;

  console.log("[ZCode-Inject-Status] 已装载");

  const BTN_ID = "zcode-inject-status-btn";
  const STYLE_ID = "zcode-inject-status-style";
  // 开关键 → 中文名（弹窗「待写入项」列表用；与 plugin.json userConfig 一致）
  const LABELS = {
    tps_footer: "TPS 状态栏",
    enhance_prompt: "增强提示词",
    model_puller: "模型拉取按钮",
    inject_status: "注入状态角标",
  };
  // 应用失败的 code → 用户可读文案
  const FAIL_TEXT = {
    "not-pending": "当前没有待写入的补丁",
    "no-pointer": "看护脚本指针缺失，请重启 ZCode 后重试",
    "schedule-failed": "启动看护失败（计划任务创建失败），已取消退出",
    "run-failed": "启动看护失败（计划任务启动失败），已取消退出",
  };

  const diag = { bridge: false, pending: false, mountMode: null,
                 lastPollAt: 0, lastError: null, noStatus: null, dialogOpen: false };
  window.__zinjDiag = diag;
  let lastStatus = null;

  // ------------------------------------------------------------ 样式
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --zinj-bg: #ffffff;
      --zinj-fg: #18181b;
      --zinj-muted: #71717a;
      --zinj-border: #e4e4e7;
      --zinj-header-bg: #fafafa;
      --zinj-footer-bg: #fafafa;
      --zinj-shadow: 0 20px 40px rgba(0, 0, 0, 0.12);
      --zinj-cancel-bg: #f4f4f5;
      --zinj-cancel-border: #e4e4e7;
      --zinj-cancel-fg: #27272a;
      --zinj-cancel-hover: #e4e4e7;
      /* 黑底金字（角标与主按钮同款） */
      --zinj-gold-bg: #141414;
      --zinj-gold-fg: #e8b339;
      --zinj-gold-border: rgba(232, 179, 57, 0.55);
      --zinj-gold-border-hover: rgba(232, 179, 57, 0.9);
    }
    .dark, html.dark, body.dark {
      --zinj-bg: #1c1c1e;
      --zinj-fg: #f0f0f0;
      --zinj-muted: #a1a1aa;
      --zinj-border: rgba(255, 255, 255, 0.14);
      --zinj-header-bg: #19191b;
      --zinj-footer-bg: #19191b;
      --zinj-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
      --zinj-cancel-bg: rgba(255, 255, 255, 0.08);
      --zinj-cancel-border: rgba(255, 255, 255, 0.1);
      --zinj-cancel-fg: #eee;
      --zinj-cancel-hover: rgba(255, 255, 255, 0.14);
    }

    /* 角标：黑底金字 pill；标题条是拖拽区，必须 no-drag 才点得动 */
    #${BTN_ID} {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 10px;
      border-radius: 6px;
      background: var(--zinj-gold-bg);
      color: var(--zinj-gold-fg);
      border: 1px solid var(--zinj-gold-border);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      user-select: none;
      -webkit-app-region: no-drag;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
      transition: border-color 0.15s, transform 0.15s;
    }
    #${BTN_ID}:hover {
      border-color: var(--zinj-gold-border-hover);
      transform: translateY(-1px);
    }
    #${BTN_ID} svg { width: 13px; height: 13px; display: block; }
    #${BTN_ID}.zinj-fixed {
      position: fixed;
      top: 16px;
      left: 180px;
      z-index: 2147482900;
    }

    /* 确认弹窗：结构沿用拉取按钮弹窗（overlay + header/body/footer）的原生质感 */
    .zinj-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(5px);
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-app-region: no-drag;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: zinjFadeIn 0.15s ease-out;
    }
    .zinj-modal {
      width: 460px;
      max-width: 92vw;
      background: var(--zinj-bg);
      color: var(--zinj-fg);
      border: 1px solid var(--zinj-border);
      border-radius: 14px;
      box-shadow: var(--zinj-shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: zinjScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .zinj-header {
      padding: 14px 20px;
      background: var(--zinj-header-bg);
      border-bottom: 1px solid var(--zinj-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .zinj-title { font-size: 14px; font-weight: 600; }
    .zinj-close {
      background: transparent;
      border: none;
      color: var(--zinj-muted);
      cursor: pointer;
      font-size: 16px;
      padding: 4px 6px;
      border-radius: 6px;
    }
    .zinj-close:hover { background: var(--zinj-cancel-hover); color: var(--zinj-fg); }
    .zinj-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
    .zinj-text { margin: 0; font-size: 13px; line-height: 1.7; color: var(--zinj-fg); }
    .zinj-items-label { font-size: 12px; color: var(--zinj-muted); }
    .zinj-items {
      margin: 0;
      padding: 8px 12px;
      list-style: none;
      border: 1px solid var(--zinj-border);
      border-radius: 8px;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--zinj-header-bg);
    }
    .zinj-footer {
      padding: 14px 20px;
      background: var(--zinj-footer-bg);
      border-top: 1px solid var(--zinj-border);
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
    }
    .zinj-btn-cancel {
      padding: 7px 16px;
      border-radius: 8px;
      font-size: 13px;
      background: var(--zinj-cancel-bg);
      border: 1px solid var(--zinj-cancel-border);
      color: var(--zinj-cancel-fg);
      cursor: pointer;
    }
    .zinj-btn-cancel:hover { background: var(--zinj-cancel-hover); }
    .zinj-btn-primary {
      padding: 7px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      background: var(--zinj-gold-bg);
      color: var(--zinj-gold-fg);
      border: 1px solid var(--zinj-gold-border);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .zinj-btn-primary:hover { border-color: var(--zinj-gold-border-hover); }
    .zinj-btn-primary:disabled { opacity: 0.7; cursor: wait; }
    .zinj-spin { width: 13px; height: 13px; animation: zinjSpin 1s linear infinite; }

    @keyframes zinjFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes zinjScaleIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes zinjSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* toast：与增强提示词同款底部居中样式，纯 textContent（消息含错误详情） */
    .zinj-toast {
      position: fixed;
      left: 50%;
      bottom: 96px;
      transform: translateX(-50%);
      z-index: 2147483001;
      background: var(--zinj-bg);
      color: var(--zinj-fg);
      border: 1px solid var(--zinj-border);
      border-radius: 10px;
      padding: 8px 14px;
      font-size: 12px;
      box-shadow: var(--zinj-shadow);
      max-width: 72vw;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(style);

  // ------------------------------------------------------------ 工具
  function showToast(message, ms = 5000) {
    const existing = document.querySelector(".zinj-toast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.className = "zinj-toast";
    t.textContent = message;   // 纯文本：消息含错误详情，不能当 HTML 解析
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // 标签来自我们自己的 LABELS 兜底，但键来自状态文件——统一转义
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  const GLYPH_HTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>`;

  const SPINNER_HTML = `
    <svg class="zinj-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
    </svg>`;

  // ------------------------------------------------------------ 挂载（分层兜底）
  // ① 结构挂载：左上标题条里「返回/前进」导航按钮所在行，角标排在该行末尾；
  // ② 找不到锚点 → 固定位置角标（top:16px left:180px，即标题条内箭头之后的空位）。
  //    两种模式都带 no-drag；350ms 自愈只在 pending 期间跑，React 重排挤掉即插回。
  function findTitlebarRow() {
    const cands = document.querySelectorAll("button[aria-label],button[title]");
    for (const b of cands) {
      const t = (b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "");
      if (!t || !/返回|后退|back|go back|previous/i.test(t)) continue;
      const row = b.parentElement;
      if (!row || row === document.body) continue;
      const rc = row.getBoundingClientRect();
      // 标题条特征：贴顶、矮条、靠左（排除正文区的同名按钮）
      if (rc.top <= 80 && rc.height > 0 && rc.height <= 64 && rc.left < 320) return row;
    }
    return null;
  }

  function buildIcon(isFixed) {
    const el = document.createElement("button");
    el.id = BTN_ID;
    el.type = "button";
    if (isFixed) el.className = "zinj-fixed";
    el.setAttribute("title", "增强补丁待写入，点击立即应用");
    el.setAttribute("aria-label", "应用增强补丁");
    el.innerHTML = `${GLYPH_HTML}<span>待注入</span>`;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openConfirmDialog();
    });
    return el;
  }

  function ensureIcon() {
    const row = findTitlebarRow();
    let el = document.getElementById(BTN_ID);
    if (row) {
      if (el && el.parentElement !== row) {
        el.remove();
        el = null;
      }
      if (!el) {
        el = buildIcon(false);
        row.appendChild(el);
      }
      diag.mountMode = "titlebar";
    } else {
      if (el && el.parentElement !== document.body) {
        el.remove();
        el = null;
      }
      if (!el) {
        el = buildIcon(true);
        document.body.appendChild(el);
      }
      diag.mountMode = "fixed";
    }
  }

  function removeIcon() {
    const el = document.getElementById(BTN_ID);
    if (el) el.remove();
    diag.mountMode = null;
  }

  // 350ms 自愈（仅在角标存在期间有效，无角标时此轮询零开销短路）
  setInterval(() => {
    if (document.hidden) return;
    if (document.getElementById(BTN_ID)) ensureIcon();
  }, 350);

  // ------------------------------------------------------------ 确认弹窗
  function closeDialog(overlay, onKey) {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    diag.dialogOpen = false;
  }

  function openConfirmDialog() {
    if (diag.dialogOpen) return;
    const api = window.zcode;
    // 无桥时弹窗只会把用户引进死胡同：toast 引导手动路径
    if (!api || typeof api.applyPatchesNow !== "function") {
      showToast("⚠️ 注入桥不可用（补丁未完整注入）。请完全退出 ZCode 后由看护自动写入，或运行 doctor.py 自检");
      return;
    }

    const items = (lastStatus && lastStatus.items) || {};
    const rows = Object.keys(items).length
      ? `<div class="zinj-items-label">待写入项</div>
         <ul class="zinj-items">${Object.entries(items).map(([k, v]) =>
           `<li>${esc(LABELS[k] || k)} → ${v ? "开" : "关"}</li>`).join("")}</ul>`
      : "";

    const overlay = document.createElement("div");
    overlay.className = "zinj-overlay";
    overlay.innerHTML = `
      <div class="zinj-modal" role="dialog" aria-modal="true" aria-label="应用增强补丁">
        <div class="zinj-header">
          <div class="zinj-title">应用增强补丁</div>
          <button class="zinj-close" type="button" title="关闭" aria-label="关闭">✕</button>
        </div>
        <div class="zinj-body">
          <p class="zinj-text">检测到增强补丁有待写入（客户端升级或开关变更）。确认后将<strong>完全退出 ZCode</strong>，由后台看护写入补丁并自动重新拉起；未发送的草稿与进行中的任务会中断。</p>
          ${rows}
        </div>
        <div class="zinj-footer">
          <button class="zinj-btn-cancel" id="zinj-cancel-btn" type="button">取消</button>
          <button class="zinj-btn-primary" id="zinj-confirm-btn" type="button"><span>退出并应用</span></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    diag.dialogOpen = true;

    const onKey = (e) => {
      if (e.key === "Escape") closeDialog(overlay, onKey);
    };
    document.addEventListener("keydown", onKey, true);
    overlay.querySelector(".zinj-close").onclick = () => closeDialog(overlay, onKey);
    overlay.querySelector("#zinj-cancel-btn").onclick = () => closeDialog(overlay, onKey);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeDialog(overlay, onKey);   // 点遮罩关闭
    });

    const confirmBtn = overlay.querySelector("#zinj-confirm-btn");
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `${SPINNER_HTML}<span>正在退出…</span>`;
      try {
        const r = await api.applyPatchesNow();
        if (r && r.success) {
          showToast("正在退出 ZCode 并应用补丁，完成后自动重启…", 8000);
          // 主进程 200ms 后 quit：弹窗留着原样，不做多余动作
        } else {
          const code = (r && r.code) || "error";
          const msg = FAIL_TEXT[code] || (r && r.error) || "应用失败";
          showToast(`❌ ${msg}`, 6000);
          closeDialog(overlay, onKey);
          poll();
        }
      } catch (err) {
        showToast(`❌ 请求异常: ${err && err.message || err}`, 6000);
        closeDialog(overlay, onKey);
        poll();
      }
    };
  }

  // ------------------------------------------------------------ 状态轮询
  async function poll() {
    const api = window.zcode;
    if (!api || typeof api.getInjectStatus !== "function") {
      diag.bridge = false;
      diag.pending = false;
      removeIcon();
      return;
    }
    diag.bridge = true;
    try {
      const r = await api.getInjectStatus();
      diag.lastPollAt = Date.now();
      diag.lastError = null;
      if (r && r.success) {
        lastStatus = r;
        diag.pending = r.pending === true;
        diag.noStatus = null;
        if (r.lastError) diag.lastError = r.lastError;
      } else {
        lastStatus = null;
        diag.pending = false;
        diag.noStatus = (r && r.code) || "unknown";
      }
    } catch (e) {
      diag.lastError = String(e && e.message || e);
    }
    if (diag.pending) ensureIcon();
    else removeIcon();
  }

  setInterval(poll, 10000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });
  poll();
})();
