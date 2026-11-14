// 模型拉取按钮「挂载位置」回归测试：用最小 DOM 桩复刻设置页供应商头部结构，
// 把 zcode-model-puller.js 真跑一遍，核对按钮落在「添加模型」**左侧**且纯图标，
// 以及被 React 重排挤偏后能被自愈循环插回原位。
//
// 为什么需要它：0.6.37 修的是**纯布局**（after→before + 去文字）——`node --check`
// 通过、肉眼 review 也看不出问题，因为错的是「插到哪」而不是语法。复刻
// enhance_mount_smoke.js 的教训：挂载类改动必须在 DOM 里做出来才算真验证。
//
// 用法：node tests/puller_mount_smoke.js <zcode-model-puller.js 路径>
// 退出码 0 = 通过；非 0 时逐条打印失败原因。
const fs = require("fs");
const vm = require("vm");

const target = process.argv[2];
if (!target) {
  console.error("用法：node tests/puller_mount_smoke.js skills/zcode-tools/scripts/zcode-model-puller.js");
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
// 只实现被测脚本真正用到的那部分：tag/attr/class 选择器（含逗号与 *=）、
// before/after/remove/appendChild、previousElementSibling/isConnected。
// 够用即止，不引 jsdom。
const roots = []; // isConnected 的判定根（document.body / document.head）

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.parentElement = null;
    this.offsetParent = null; // 测试场景里显式置真值 = 「可见」
    this._innerHTML = "";
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
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return roots.includes(n);
  }
  get previousElementSibling() {
    if (!this.parentElement) return null;
    const sibs = this.parentElement.children.filter((c) => c instanceof FakeElement);
    const i = sibs.indexOf(this);
    return i > 0 ? sibs[i - 1] : null;
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
  after(el) {
    const p = this.parentElement;
    if (!p) return;
    el.remove();
    p.children.splice(p.children.indexOf(this) + 1, 0, el);
    el.parentElement = p;
  }
  before(el) {
    const p = this.parentElement;
    if (!p) return;
    el.remove();
    p.children.splice(p.children.indexOf(this), 0, el);
    el.parentElement = p;
  }
  set innerHTML(v) { this._innerHTML = String(v); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  get textContent() {
    // 只用于「添加模型」文本兜底：剥标签 + 拼子孙文本
    if (this.children.length === 0) return this._innerHTML.replace(/<[^>]*>/g, "");
    return this.children.map((c) => (c.textContent || "")).join("");
  }
}

// 选择器：支持逗号分组；单组支持 tag / .class / [attr="v"] / [attr*="v"]
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

// ---------------------------------------------------------------- 场景
// 供应商页：page(provider 容器) > header(flex 行) > [title「模型列表」, addBtn「添加模型」]
const body = new FakeElement("body");
const head = new FakeElement("head");
roots.push(body, head);

const page = new FakeElement("div");
page.attrs["class"] = "provider-detail-panel";
page.offsetParent = {};
body.appendChild(page);

const header = new FakeElement("div");
page.appendChild(header);

const title = new FakeElement("span");
title.innerHTML = "模型列表";
header.appendChild(title);

const addBtn = new FakeElement("button");
addBtn.attrs["data-testid"] = "model-provider-add-model-button";
addBtn.offsetParent = {};
addBtn.innerHTML = `<span>添加模型</span>`;
header.appendChild(addBtn);

const doc = {
  head,
  body,
  createElement: (tag) => new FakeElement(tag),
  addEventListener: () => {}, // reorder 场景直接手动触发不了 listener，见下
  getElementById: (id) => matchAll(body, "#" === id[0] ? id : `[id="${id}"]`)[0] || null,
  querySelectorAll: (sel) => matchAll(body, sel),
  querySelector: (sel) => matchAll(body, sel)[0] || null,
};

// setTimeout 立即执行：脚本把自愈挂在 document click + setTimeout(50) 上，
// 桩里同步执行等价于「等 50ms 后自愈跑完」。
const listeners = {};
doc.addEventListener = (type, fn) => { listeners[type] = fn; };

const ctx = {
  document: doc,
  window: {},
  console: { log() {}, warn() {}, error() {} },
  setTimeout: (fn) => fn(),
  setInterval: () => 0,
};
vm.createContext(ctx);

// ---------------------------------------------------------------- 断言
const failures = [];
function expect(cond, msg) {
  if (cond) return;
  failures.push(msg);
}

try {
  vm.runInContext(src, ctx, { timeout: 5000 });
} catch (err) {
  console.error("脚本在桩 DOM 里抛异常：" + err.stack);
  process.exit(1);
}

const btn = doc.getElementById("zcode-auto-pull-models-btn");
expect(btn, "脚本跑完后找不到注入按钮 #zcode-auto-pull-models-btn");

if (btn) {
  expect(addBtn.previousElementSibling === btn,
    `按钮应紧贴「添加模型」左侧，实际 previousElementSibling=` +
    `${addBtn.previousElementSibling && addBtn.previousElementSibling.id}`);
  expect(btn.parentElement === header, "按钮应挂在添加模型同一父容器（header 行）");
  expect(btn.innerHTML.includes("zcode-pull-dl-icon"), "idle 标记应使用下载图标 .zcode-pull-dl-icon");
  expect(!btn.innerHTML.includes("<span"), "idle 标记应是纯图标，不得残留文字 span");
  expect(!btn.innerHTML.includes("自动拉取模型"), "idle 标记不得再带「自动拉取模型」文字");
  expect(btn.getAttribute("title") === "根据当前 Base URL 和 API Key 自动拉取所有可用模型",
    "tooltip 应保留功能说明，实际：" + btn.getAttribute("title"));
  expect(btn.getAttribute("aria-label") === "自动拉取模型", "应设置 aria-label（纯图标按钮的唯一文字语义）");
  // 原生行容器是 space-between，DOM 相邻≠视觉相邻：margin-left:auto 让
  // 「图标+添加模型」成对贴右，图标不会摊到行中间
  expect(btn.style.marginLeft === "auto", "应有 margin-left:auto（space-between 容器下贴住添加模型）");
  expect(head.children.some((c) => c.id === "zcode-model-puller-style-pro"),
    "样式表应注入 document.head");
}

// 挤偏自愈：React 重排把一个元素插到按钮与添加模型之间 → 点击事件触发的自愈必须插回原位
if (btn && addBtn.previousElementSibling === btn) {
  const spacer = new FakeElement("div");
  header.children.splice(header.children.indexOf(addBtn), 0, spacer);
  spacer.parentElement = header;
  if (listeners.click) listeners.click({});
  expect(addBtn.previousElementSibling === btn,
    "被挤偏后自愈循环应把按钮重新插回「添加模型」左侧");
}

if (failures.length) {
  console.error("puller_mount_smoke 失败：");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("puller_mount_smoke: 全部通过（左侧挂载 / 纯图标 / 挤偏自愈 / tooltip+aria）");
