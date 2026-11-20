// TPS 状态栏「输入框上方/下方」挂载回归：用最小 DOM 桩真跑 zcode-tps.js 的
// findComposerInput / findComposerCard / attach / fitGap / fitGapAbove。
//
// 为什么需要它：0.6.52 把状态条默认改到 composer 卡片之前后，出现两个纯布局问题：
//   ① 问题卡/弹窗里的输入框被当成 composer → 状态条插进消息流/问题卡；
//   ② fitGapAbove 的 cap 用实测间距自我封顶，问题卡把卡片推远后写出几百 px
//      负 marginBottom → sticky dock 被拉塌，会话记录整片空白。
// 这两个问题 `node --check` 都看不出来，必须真跑 DOM 路径。
//
// 用法：node tests/tps_layout_smoke.js <zcode-tps.js 路径>
// 退出码 0 = 通过；1 = 断言失败；2 = 用法/读文件错误。
const fs = require("fs");
const vm = require("vm");

const target = process.argv[2];
if (!target) {
  console.error("用法：node tests/tps_layout_smoke.js <zcode-tps.js 的路径>");
  console.error("例如：node tests/tps_layout_smoke.js skills/zcode-tools/scripts/zcode-tps.js");
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
function parseSelector(sel) {
  return String(sel).split(",").map((part) => {
    const c = { tag: null, id: null, attrs: [], classes: [] };
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\[([\w-]+)(?:([*^$]?=)["']?([^"'\]]*)["']?)?\]|\.([\w-]+)/g;
    let m;
    while ((m = re.exec(part))) {
      if (m[1]) c.tag = m[1].toLowerCase();
      else if (m[2]) c.id = m[2];
      else if (m[3]) c.attrs.push({ name: m[3].toLowerCase(), op: m[4] || null, value: m[5] == null ? "" : m[5] });
      else if (m[6]) c.classes.push(m[6]);
    }
    return c;
  });
}

function matchCompound(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) {
    if (!(" " + (el.attrs["class"] || "") + " ").includes(" " + cls + " ")) return false;
  }
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v == null) return false;
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "*=" && !String(v).includes(a.value)) return false;
    if (a.op === "^=" && !String(v).startsWith(a.value)) return false;
    if (a.op === "$=" && !String(v).endsWith(a.value)) return false;
  }
  return true;
}

function matches(el, sel) {
  return parseSelector(sel).some((c) => matchCompound(el, c));
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.attrs = Object.create(null);
    this.children = [];
    this.parentElement = null;
    this.style = { cssText: "" };
    this.dataset = {};
    this.textContent = "";
    this.innerHTML = "";
    this.id = "";
    this.title = "";
    this.type = "";
    this.disabled = false;
    this.__hidden = false;
    this.__rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.__listeners = {};
  }
  get className() { return this.attrs["class"] || ""; }
  set className(v) { this.attrs["class"] = String(v); }
  get offsetParent() {
    if (this.__hidden) return null;
    return this.parentElement || null;
  }
  get isConnected() {
    let n = this;
    while (n) {
      if (n.__isBody) return true;
      n = n.parentElement;
    }
    return false;
  }
  setAttribute(k, v) { this.attrs[String(k).toLowerCase()] = String(v); }
  getAttribute(k) {
    const key = String(k).toLowerCase();
    return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  removeAttribute(k) { delete this.attrs[String(k).toLowerCase()]; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    const i = c.parentElement ? c.parentElement.children.indexOf(c) : -1;
    if (i >= 0) c.parentElement.children.splice(i, 1);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at >= 0) this.children.splice(at, 0, c); else this.children.push(c);
    c.parentElement = this;
    return c;
  }
  insertAdjacentElement(pos, el) {
    if (pos === "beforebegin") {
      if (!this.parentElement) return null;
      return this.parentElement.insertBefore(el, this);
    }
    if (pos === "afterend") {
      if (!this.parentElement) return null;
      return this.parentElement.insertBefore(el, this.nextElementSibling);
    }
    if (pos === "afterbegin") return this.insertBefore(el, this.firstChild);
    return this.appendChild(el);
  }
  remove() {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
  }
  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentElement; }
    return false;
  }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentElement; }
    return null;
  }
  descendants() {
    const out = [];
    const walk = (el) => { for (const c of el.children) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel) { return this.descendants().filter((el) => matches(el, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return Object.assign({}, this.__rect); }
  getClientRects() { return [this.getBoundingClientRect()]; }
  addEventListener(t, fn) { (this.__listeners[t] = this.__listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatchEvent() { return true; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const i = this.parentElement.children.indexOf(this);
    return this.parentElement.children[i + 1] || null;
  }
  get previousElementSibling() {
    if (!this.parentElement) return null;
    const i = this.parentElement.children.indexOf(this);
    return i > 0 ? this.parentElement.children[i - 1] : null;
  }
}

function makeDocument() {
  const doc = {
    hidden: false,
    head: new El("head"),
    body: new El("body"),
    createElement: (t) => new El(t),
    __listeners: Object.create(null),
    addEventListener(t, fn) { (this.__listeners[t] = this.__listeners[t] || []).push(fn); },
    removeEventListener() {},
    getElementById: () => null,
  };
  doc.body.__isBody = true;
  doc.querySelectorAll = (sel) => doc.body.descendants().filter((el) => matches(el, sel));
  doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
  return doc;
}

function mk(doc, tag, attrs) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  doc.body.appendChild(el);
  el.remove();                       // 只建节点，由调用方决定挂到哪
  return el;
}

function rect(top, bottom) {
  return { left: 0, top, right: 500, bottom, width: 500, height: bottom - top };
}

// 真实结构（SKILL.md:746-759 / enhance_mount_smoke.js:189-239）：
// frame > timeline-scroll > flex > [message-layer > turn > question-card, composer-dock > ... > real-card]
function buildTree(doc, opts) {
  const o = opts || {};
  const frame = mk(doc, "div", { "data-workspace-conversation-frame": "true" });
  const timeline = mk(doc, "div", { "data-v4-timeline-scroll": "true" });
  const column = mk(doc, "div", { "class": "flex min-h-full flex-col" });
  const messageLayer = mk(doc, "div", { "data-v4-timeline-message-layer": "true" });
  const turn = mk(doc, "section", { "data-turn-id": "t1" });
  const questionCard = mk(doc, "div", { "data-testid": "v4-composer", "class": "chat-composer-region" });
  const questionInput = mk(doc, "div", { "data-testid": "v4-composer-input", "contenteditable": "true" });
  const questionSend = mk(doc, "button", { "data-testid": "v4-composer-send" });
  const dock = mk(doc, "div", { "data-v4-composer-dock": "true", "class": "sticky bottom-0" });
  const dockContent = mk(doc, "div", { "data-v4-composer-dock-content": "true" });
  const anchor = mk(doc, "div", { "data-v4-back-to-bottom-anchor": "composer-dock" });
  const realCard = mk(doc, "div", { "data-testid": "v4-composer", "class": "chat-composer-region" });
  const realInput = mk(doc, "div", { "data-testid": "v4-composer-input", "contenteditable": "true" });
  const trailing = mk(doc, "div", { "data-composer-trailing-actions": "true" });
  const realSend = mk(doc, "button", { "data-testid": "v4-composer-send" });

  if (o.noFrame) {
    doc.body.appendChild(timeline);     // 兼容旧布局：没有 frame 属性，但 dock 仍在
  } else {
    doc.body.appendChild(frame);
    frame.appendChild(timeline);
  }
  timeline.appendChild(column);
  column.appendChild(messageLayer);
  messageLayer.appendChild(turn);
  turn.appendChild(questionCard);
  questionCard.appendChild(questionInput);
  questionCard.appendChild(questionSend);
  column.appendChild(dock);
  dock.appendChild(dockContent);
  dockContent.appendChild(anchor);
  anchor.appendChild(realCard);
  realCard.appendChild(realInput);
  realCard.appendChild(trailing);
  trailing.appendChild(realSend);

  questionCard.__rect = rect(100, 200);
  questionInput.__rect = rect(120, 160);
  realCard.__rect = rect(o.realTop == null ? 800 : o.realTop, (o.realTop == null ? 800 : o.realTop) + 100);
  realInput.__rect = rect((o.realTop == null ? 800 : o.realTop) + 20, (o.realTop == null ? 800 : o.realTop) + 60);
  anchor.__rect = rect(0, (o.realTop == null ? 800 : o.realTop) + 150);
  if (o.hideReal) {
    realCard.__hidden = true;
    realInput.__hidden = true;
  }
  if (o.hideQuestion) {
    questionCard.__hidden = true;
    questionInput.__hidden = true;
  }
  return { frame, timeline, column, messageLayer, turn, questionCard, questionInput,
           questionSend, dock, dockContent, anchor, realCard, realInput, trailing, realSend };
}

function makeHost(doc, top, bottom) {
  const host = new El("div");
  host.setAttribute("data-ztps-bar", "1");
  host.appendChild(new El("div"));   // pill
  host.__rect = rect(top, bottom);
  return host;
}

function boot(doc) {
  const timers = { interval: null };
  const sandbox = {
    document: doc,
    console,
    Date,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: (fn) => { timers.interval = fn; return 0; },
    clearInterval: () => {},
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ borderBottomWidth: "0px" }),
    TextDecoder,
    localStorage: { getItem: () => null, setItem: () => {} },
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // 先让 body 为空，避免脚本自动 start()（本测试只调用 __ztpsTest 暴露的入口）
  const realBody = doc.body;
  doc.body = null;
  vm.runInNewContext(src, sandbox, { filename: "zcode-tps.js" });
  doc.body = realBody;
  if (!sandbox.__ztpsTest) throw new Error("脚本没有暴露 window.__ztpsTest");
  return { sandbox, api: sandbox.__ztpsTest, timers };
}

const bad = [];
const check = (cond, msg) => { if (!cond) bad.push(msg); };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const MAX = 32;

// ---------------------------------------------------------------- 场景 1：正常上方挂载
{
  const doc = makeDocument();
  const t = buildTree(doc);
  const { api } = boot(doc);
  const host = makeHost(doc, 760, 780);   // 与 realCard(800) 间距 20
  const ok = api.attach(host, "composer-above");
  check(ok === true, "正常结构：attach 应成功");
  check(host.parentElement === t.anchor, "正常结构：host 应挂在 composer dock 内");
  check(host.nextElementSibling === t.realCard, "正常结构：host 必须紧邻真实 composer 卡片之前");
  check(!t.questionCard.contains(host), "正常结构：host 不得进入问题卡");
  const mb = num(host.style.marginBottom);
  check(mb >= -MAX && mb <= MAX, "正常结构：marginBottom 必须在 [-32,32]，实际 " + host.style.marginBottom);
  check(mb < 0, "正常结构：20px 间距应被补偿到接近 2px，实际 " + host.style.marginBottom);
  check(host.style.flexShrink === "0", "host 必须禁止 flex 压缩（flexShrink:0）");
}

// ---------------------------------------------------------------- 场景 2：问题卡与真实 composer 同时可见
{
  const doc = makeDocument();
  const t = buildTree(doc);
  const { api } = boot(doc);
  const host = makeHost(doc, 760, 780);
  check(api.attach(host, "composer-above") === true, "问题卡共存：attach 应成功");
  check(host.nextElementSibling === t.realCard, "问题卡共存：必须选更靠下的真实 composer，而不是问题卡");
  check(!t.questionCard.contains(host), "问题卡共存：host 不得进入问题卡");
}

// ---------------------------------------------------------------- 场景 3：真实 composer 隐藏，只剩问题卡
{
  const doc = makeDocument();
  const t = buildTree(doc, { hideReal: true });
  const { api } = boot(doc);
  const host = makeHost(doc, 760, 780);
  const ok = api.attach(host, "composer-above");
  check(ok === false, "真实 composer 隐藏时：attach 必须拒绝挂载");
  check(!host.isConnected, "真实 composer 隐藏时：host 不得被插入 DOM");
  check(!t.questionCard.contains(host), "真实 composer 隐藏时：host 不得进入问题卡");
  check(api.findComposerCard() === null, "真实 composer 隐藏时：findComposerCard 必须返回 null");
}

// ---------------------------------------------------------------- 场景 4：间距被放大到 500px
{
  const doc = makeDocument();
  const t = buildTree(doc, { realTop: 500 });
  const { api } = boot(doc);
  const host = makeHost(doc, 60, 90);     // card.top=500 → gap=410 > 32
  check(api.attach(host, "composer-above") === true, "超大间距：仍应完成挂载（只是不做补偿）");
  check(host.nextElementSibling === t.realCard, "超大间距：host 仍应紧邻卡片");
  check(num(host.style.marginBottom) === 0,
        "超大间距：必须清零 marginBottom，实际 " + host.style.marginBottom);
  check(host.style.transform === "" || host.style.transform == null,
        "超大间距：不得用 transform 位移");
}

// ---------------------------------------------------------------- 场景 5：host 与卡片之间插入高面板
{
  const doc = makeDocument();
  const t = buildTree(doc);
  const { api } = boot(doc);
  const host = makeHost(doc, 760, 780);
  check(api.attach(host, "composer-above") === true, "相邻守卫：初始 attach 应成功");
  const panel = mk(doc, "div", { "data-testid": "question-panel" });
  t.anchor.insertBefore(panel, t.realCard);   // 变成 host, panel, realCard
  api.fitGapAbove(host, t.realCard);
  check(host.nextElementSibling === panel, "相邻守卫：测试结构应让 panel 夹在中间");
  check(num(host.style.marginBottom) === 0,
        "相邻守卫：非相邻时必须清零 marginBottom，实际 " + host.style.marginBottom);
  check(num(host.style.marginTop) === 0,
        "相邻守卫：非相邻时必须清零 marginTop，实际 " + host.style.marginTop);
}

// ---------------------------------------------------------------- 场景 6：下方模式
{
  const doc = makeDocument();
  const t = buildTree(doc);
  const { api } = boot(doc);
  const host = makeHost(doc, 908, 928);   // realCard.bottom=900 → gap=8
  check(api.attach(host, "composer-below") === true, "下方模式：attach 应成功");
  check(host.previousElementSibling === t.realCard, "下方模式：host 必须紧邻卡片之后");
  const mt = num(host.style.marginTop);
  check(mt >= -MAX && mt <= MAX, "下方模式：marginTop 必须在 [-32,32]，实际 " + host.style.marginTop);
  check(host.style.transform === "translateY(16px)" || num(host.style.transform.replace(/[^\d.-]/g, "")) <= 16,
        "下方模式：translateY 不得超过 MAX_SINK");
}

// ---------------------------------------------------------------- 场景 7：问题卡移除后自愈
{
  const doc = makeDocument();
  const t = buildTree(doc, { hideReal: true });
  const { api } = boot(doc);
  const blocked = makeHost(doc, 760, 780);
  check(api.attach(blocked, "composer-above") === false, "自愈：问题态下应先拒绝挂载");
  // 关闭问题：真实 composer 恢复，问题卡移除
  t.realCard.__hidden = false;
  t.realInput.__hidden = false;
  t.questionCard.remove();
  t.questionInput.remove();
  const host = makeHost(doc, 760, 780);
  check(api.attach(host, "composer-above") === true, "自愈：问题关闭后应重新挂载");
  check(host.nextElementSibling === t.realCard, "自愈：问题关闭后必须挂回真实 composer");
}

// ---------------------------------------------------------------- 场景 8：弹窗里的 composer 不得接管
{
  const doc = makeDocument();
  const real = buildTree(doc, { hideReal: true });
  const dialog = mk(doc, "div", { "role": "dialog", "aria-modal": "true" });
  const dCard = mk(doc, "div", { "data-testid": "v4-composer" });
  const dInput = mk(doc, "div", { "data-testid": "v4-composer-input" });
  const dSend = mk(doc, "button", { "data-testid": "v4-composer-send" });
  real.frame.appendChild(dialog);
  dialog.appendChild(dCard);
  dCard.appendChild(dInput);
  dCard.appendChild(dSend);
  dCard.__rect = rect(300, 400);
  dInput.__rect = rect(320, 360);
  const { api } = boot(doc);
  const host = makeHost(doc, 760, 780);
  check(api.attach(host, "composer-above") === false, "弹窗：真实 composer 隐藏时不得挂到 dialog 里的 composer");
  check(!dialog.contains(host), "弹窗：host 不得进入 dialog");
}

// ---------------------------------------------------------------- 场景 9：无 frame 属性的旧布局，dock 仍可挂载
{
  const doc = makeDocument();
  const t = buildTree(doc, { noFrame: true });
  const { api } = boot(doc);
  const host = makeHost(doc, 760, 780);
  check(api.attach(host, "composer-above") === true,
        "旧布局：没有 frame 属性时，只要在 composer dock 内仍应挂载");
  check(host.nextElementSibling === t.realCard, "旧布局：必须紧邻真实 composer 卡片");
  check(!t.questionCard.contains(host), "旧布局：仍不得进入问题卡");
}

if (bad.length) {
  console.error("tps_layout_smoke: " + bad.length + " 项失败");
  for (const m of bad) console.error("  ✗ " + m);
  process.exit(1);
}
console.log("tps layout smoke OK (9 scenarios)");
