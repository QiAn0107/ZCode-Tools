// 注入状态角标「挂载与交互」回归测试：用最小 DOM 桩把 zcode-inject-status.js
// 真跑一遍，逐场景核对角标出现位置、弹窗开关与「退出并应用」的调用链。
//
// 为什么需要它：角标的挂载是**状态相关 + 多级兜底**的（标题条锚点 → 固定位置），
// node --check 通过、肉眼 review 也看不出「角标该出现时没出现 / 弹窗关不掉」这类
// 问题。复刻 enhance_mount_smoke.js / puller_mount_smoke.js 的教训：挂载与交互类
// 改动必须在 DOM 里做出来才算真验证。
//
// 用法：node tests/inject_status_mount_smoke.js <zcode-inject-status.js 路径>
// 退出码 0 = 通过；非 0 时逐条打印失败原因。
const fs = require("fs");
const vm = require("vm");

const target = process.argv[2];
if (!target) {
  console.error("用法：node tests/inject_status_mount_smoke.js skills/zcode-tools/scripts/zcode-inject-status.js");
  process.exit(2);
}
let src;
try {
  src = fs.readFileSync(target, "utf8");
} catch (err) {
  console.error("读不到被测脚本：" + target);
  console.error("  " + err.message);
  process.exit(2);
}

// ---------------------------------------------------------------- 最小 DOM
const roots = []; // isConnected 判定根（document.body / document.head）

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.parentElement = null;
    this._listeners = {};
    this._innerHTML = "";
    this._q = null; // querySelector 的按需假元素缓存
    const self = this;
    this.classList = {
      _set: new Set(),
      add(c) { self.classList._set.add(c); },
      remove(c) { self.classList._set.delete(c); },
      contains(c) { return self.classList._set.has(c); },
    };
  }
  get id() { return this.attrs.id || ""; }
  set id(v) { this.attrs.id = String(v); }
  set className(v) { this.attrs["class"] = String(v); }
  get className() { return this.attrs["class"] || ""; }
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return roots.includes(n);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
  appendChild(ch) {
    if (ch.parentElement) ch.remove();
    ch.parentElement = this;
    this.children.push(ch);
    return ch;
  }
  remove() {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  fire(type, ev) {
    for (const fn of (this._listeners[type] || []).slice()) fn(ev);
  }
  set innerHTML(v) { this._innerHTML = String(v); this.children = []; this._q = null; }
  get innerHTML() { return this._innerHTML; }
  set textContent(v) { this._innerHTML = String(v); }
  get textContent() { return this._innerHTML; }
  // 弹窗子元素由 innerHTML 字符串构建，桩里不解析 HTML：按选择器返回一个
  // 缓存的假元素（onclick 等赋值会被记录），足够核对交互行为
  querySelector(sel) {
    this._q = this._q || {};
    if (!this._q[sel]) {
      const el = new FakeElement("button");
      el.parentElement = this;
      this._q[sel] = el;
    }
    return this._q[sel];
  }
}

function parseGroup(sel) {
  return String(sel).split(",").map((part) => {
    const c = { tag: null, classes: [], attrs: [] };
    const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)["']?([^"'\]]*)["']?)?\]/g;
    let m;
    while ((m = re.exec(part))) {
      if (m[1]) c.tag = m[1].toLowerCase();
      else if (m[2]) c.classes.push(m[2]);
      else if (m[3]) c.attrs.push({ name: m[3].toLowerCase(), op: m[4] || null, value: m[5] == null ? "" : m[5] });
    }
    return c;
  });
}

function matchCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  for (const cls of c.classes) {
    const have = " " + (el.attrs["class"] || "") + " ";
    if (!have.includes(" " + cls + " ")) return false;
  }
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v == null) return false;
    if (a.op === "*=") { if (!String(v).includes(a.value)) return false; }
    else if (a.op && v !== a.value) return false;
  }
  return true;
}

function walk(el, out) {
  if (!(el instanceof FakeElement)) return out;
  out.push(el);
  for (const c of el.children) walk(c, out);
  return out;
}

function matchAll(rootEl, sel) {
  const groups = parseGroup(sel);
  const all = walk(rootEl, []).concat(roots);
  return all.filter((el) => groups.some((g) => matchCompound(el, g)));
}

// ---------------------------------------------------------------- 场景工厂
function buildEnv({ pending = true, withBridge = true, navRow = true }) {
  const body = new FakeElement("body");
  const head = new FakeElement("head");
  roots.length = 0;
  roots.push(body, head);

  let row = null;
  if (navRow) {
    const side = new FakeElement("aside");
    body.appendChild(side);
    row = new FakeElement("div");
    side.appendChild(row);
    const navBtn = new FakeElement("button");
    navBtn.attrs["aria-label"] = "返回";
    row.appendChild(navBtn);
    // 标题条特征：贴顶、矮条、靠左
    row.getBoundingClientRect = () => ({ top: 10, left: 0, height: 48, width: 260, right: 260, bottom: 58 });
  }

  const docListeners = {};
  const doc = {
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => {
      const l = docListeners[type] || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    getElementById: (id) => matchAll(body, `[id="${id}"]`)[0] || null,
    querySelectorAll: (sel) => matchAll(body, sel),
    querySelector: (sel) => matchAll(body, sel)[0] || null,
  };

  let applyCalls = 0;
  const bridge = {
    getInjectStatus: async () => ({ success: !0, pending, items: pending ? { tps_footer: true, model_puller: false } : {}, stamp: 1 }),
    applyPatchesNow: async () => { applyCalls++; return { success: !0 }; },
  };

  const win = withBridge ? { zcode: bridge } : {};
  win.addEventListener = () => {};        // 0.6.41: focus 补查监听（桩不真跑）
  win.removeEventListener = () => {};
  const ctx = {
    document: doc,
    window: win,
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => 0,          // 轮询不真跑，靠 flush() 手动驱动
    setTimeout: () => 0,           // toast 的移除定时器不真跑，DOM 里就能断言到
  };
  vm.createContext(ctx);
  const diag = () => ctx.window.__zinjDiag;

  return {
    ctx, body, head, doc, diag, row,
    applyCallsNow: () => applyCalls,
    fireKey: (ev) => { for (const fn of (docListeners.keydown || []).slice()) fn(ev); },
    // 等微任务排空：脚本 load 时的 poll() 与 confirm 的 await 都在微任务里收尾
    flush: async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); },
    icon: () => doc.getElementById("zcode-inject-status-btn"),
    overlays: () => body.children.filter((c) => c.attrs["class"] === "zinj-overlay"),
    toasts: () => body.children.filter((c) => c.attrs["class"] === "zinj-toast"),
  };
}

async function runScript(env) {
  vm.runInContext(src, env.ctx, { timeout: 5000 });
  await env.flush();
}

// ---------------------------------------------------------------- 断言
const failures = [];
function expect(cond, msg) {
  if (cond) return;
  failures.push(msg);
}

const CLICK_EV = { preventDefault() {}, stopPropagation() {} };

async function main() {
// ---- 场景 A：pending=true + 有标题条锚点 → 角标结构挂载到导航行，点击弹确认弹窗
{
  const env = buildEnv({ pending: true, navRow: true });
  await runScript(env);
  const btn = env.icon();
  expect(!!btn, "A: pending=true 时角标应出现");
  expect(env.diag().bridge === true, "A: diag.bridge 应为 true");
  expect(env.diag().pending === true, "A: diag.pending 应为 true");
  expect(env.diag().mountMode === "titlebar", "A: 应结构挂载到标题条，实际 " + env.diag().mountMode);
  expect(!!btn && btn.parentElement === env.row, "A: 角标应挂在导航按钮所在行内");

  // 点击 → 弹窗出现，文案说明「完全退出 ZCode」
  btn.fire("click", CLICK_EV);
  expect(env.diag().dialogOpen === true, "A: 点击角标后应弹出确认弹窗");
  const ov = env.overlays()[0];
  expect(!!ov, "A: 遮罩应挂到 DOM");
  expect(!!ov && ov._innerHTML.includes("完全退出 ZCode"), "A: 弹窗文案必须说明将完全退出 ZCode");
  expect(!!ov && ov._innerHTML.includes("待写入项"), "A: 弹窗应列出待写入项");
  expect(!!ov && ov._innerHTML.includes("TPS 状态栏"), "A: 待写入项应显示中文功能名");

  // Esc 关闭
  env.fireKey({ key: "Escape" });
  expect(env.diag().dialogOpen === false, "A: Esc 应关闭弹窗");
  expect(env.overlays().length === 0, "A: Esc 后遮罩应从 DOM 移除");

  // 再开 → 取消按钮关闭
  btn.fire("click", CLICK_EV);
  const ov2 = env.overlays()[0];
  expect(!!ov2, "A: 再次点击应重新弹窗");
  ov2.querySelector("#zinj-cancel-btn").onclick();
  expect(env.diag().dialogOpen === false, "A: 取消按钮应关闭弹窗");
}

// ---- 场景 B：确认 → applyPatchesNow 被调用 + toast 反馈（成功路径保留弹窗）
{
  const env = buildEnv({ pending: true, navRow: true });
  await runScript(env);
  env.icon().fire("click", CLICK_EV);
  const ov = env.overlays()[0];
  expect(!!ov, "B: 弹窗应出现");
  const confirmBtn = ov.querySelector("#zinj-confirm-btn");
  await confirmBtn.onclick();          // onclick 是 async 函数
  await env.flush();
  expect(env.applyCallsNow() === 1, "B: 确认后应调用一次 applyPatchesNow");
  expect(env.toasts().length === 1, "B: 成功后应有 toast 反馈");
  expect(!!env.toasts()[0] && env.toasts()[0]._innerHTML.includes("退出"), "B: toast 文案应说明正在退出");
  expect(env.diag().dialogOpen === true, "B: 成功路径弹窗保留（随后主进程退出）");
}

// ---- 场景 C：确认失败（run-failed）→ 弹 toast + 关弹窗 + 角标恢复
{
  const env = buildEnv({ pending: true, navRow: true });
  // 替换桥方法（原计数器在默认实现闭包里，替换后需自带计数）
  let called = 0;
  env.ctx.window.zcode.applyPatchesNow = async () => {
    called++;
    return { success: !1, code: "run-failed", error: "boom" };
  };
  await runScript(env);
  env.icon().fire("click", CLICK_EV);
  const ov = env.overlays()[0];
  await ov.querySelector("#zinj-confirm-btn").onclick();
  await env.flush();
  expect(called === 1, "C: 失败路径同样应已调用过桥");
  expect(env.toasts().length === 1, "C: 失败应有 toast 提示");
  expect(!!env.toasts()[0] && env.toasts()[0]._innerHTML.includes("已取消退出"),
         "C: 失败 toast 必须说明已取消退出（绝不假成功）");
  expect(env.diag().dialogOpen === false, "C: 失败后弹窗应关闭");
}

// ---- 场景 D：pending=true 但找不到标题条锚点 → 固定位置兜底（no-drag）
{
  const env = buildEnv({ pending: true, navRow: false });
  await runScript(env);
  const btn = env.icon();
  expect(!!btn, "D: 找不到锚点时角标仍应出现（固定兜底）");
  expect(env.diag().mountMode === "fixed", "D: diag.mountMode 应为 fixed");
  expect(!!btn && btn.parentElement === env.body, "D: 兜底角标应挂在 body 上");
  expect(!!btn && (btn.attrs["class"] || "").includes("zinj-fixed"), "D: 兜底角标应带 zinj-fixed 定位类");
  expect(!!btn && btn.attrs["class"].includes("zinj-fixed") &&
         src.includes("-webkit-app-region: no-drag"), "D: 角标样式必须 no-drag（标题条是拖拽区）");
}

// ---- 场景 E：pending=false → 不出现角标
{
  const env = buildEnv({ pending: false, navRow: true });
  await runScript(env);
  expect(!env.icon(), "E: pending=false 时不应出现角标");
  expect(env.diag().pending === false, "E: diag.pending 应为 false");
}

// ---- 场景 F：无桥（补丁未完整注入）→ 不出角标、不弹窗，静默降级
{
  const env = buildEnv({ pending: true, withBridge: false, navRow: true });
  await runScript(env);
  expect(!env.icon(), "F: 无桥时不应出现角标");
  expect(env.diag().bridge === false, "F: diag.bridge 应为 false");
}

// ---- 场景 G：角标及时性（0.6.41）——启动突发重查 + focus 补查 + 自愈覆盖首次挂载
// sync 的 status 文件常在启动后数秒才写，固定 10s 轮询会让角标多等近 10s；
// 首次挂载若撞上 DOM 未就绪，旧逻辑要等下一个 10s 轮询才重试。
{
  expect(src.includes("for (const d of [1000, 2000, 4000, 8000]) setTimeout(poll, d)"),
         "G: 必须保留启动突发重查（1/2/4/8s）");
  expect(src.includes('window.addEventListener("focus"'),
         "G: 必须监听 focus 事件补查");
  expect(src.includes("diag.pending || document.getElementById(BTN_ID)"),
         "G: 350ms 自愈必须覆盖「待注入但未挂载」的首次创建");
  expect(src.includes('setInterval(poll, 10000)'),
         "G: 10s 稳态轮询必须保留");
}
}

main().then(() => {
  if (failures.length) {
    console.error("inject_status_mount_smoke 失败：");
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("inject_status_mount_smoke: 全部通过（标题条挂载/固定兜底/弹窗开关/确认调用链/失败兜底/无桥降级）");
}).catch((err) => {
  console.error("inject_status_mount_smoke 异常：" + (err && err.stack || err));
  process.exit(1);
});
