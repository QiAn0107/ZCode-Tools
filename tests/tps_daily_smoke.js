// TPS 状态栏「今日总耗」冒烟测试。
//
// 锁三件事：
//   ① 写侧：usage.delta 分支必须调用 addDaily，且在轮关联之前（关联失败也不漏计）；
//   ② 行为：从源码里抠出 dayKeyOf/loadDaily/saveDaily/addDaily/readToday 真跑一遍，
//      验证跨午夜分桶、重复事件去重、30 天裁剪、损坏 JSON 容错；
//   ③ 读侧：renderBar 必须经 readToday 取今日值，空态也要带总耗。
//
// 用法：node tests/tps_daily_smoke.js skills/zcode-tokenspeed/scripts/zcode-tps.js
// 退出码 0 = 通过；1 = 有断言失败；2 = 用法/读取错误。
const fs = require("fs");

const target = process.argv[2];
if (!target) {
  console.error("用法：node tests/tps_daily_smoke.js <zcode-tps.js 的路径>");
  console.error("例如：node tests/tps_daily_smoke.js skills/zcode-tokenspeed/scripts/zcode-tps.js");
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

const failures = [];
const check = (ok, label, extra) => {
  if (ok) return;
  failures.push(label + (extra ? "  —— " + extra : ""));
};

// ---------- ① 写侧静态断言 ----------
check(src.indexOf("addDaily(ev)") >= 0, "usage.delta 分支没有调用 addDaily，今日统计收不到数据");
{
  const iAdd = src.indexOf("addDaily(ev)");
  const iAssoc = src.indexOf("findByScid(scid)");
  check(iAdd >= 0 && iAssoc >= 0 && iAdd < iAssoc,
        "addDaily 必须在轮关联(findByScid)之前调用，否则关联失败的用量会漏计");
}
check(src.indexOf('ev.occurredAt ?? Date.now()') >= 0,
      "今日分桶没有用 ev.occurredAt，跨午夜的用量会记错日期");

// ---------- ② 从源码里抠出今日模块并真跑 ----------
// 用花括号配对而不是正则：函数体后续若加分支/嵌套，正则抠法会静默截断。
function extractDecl(kind, name) {
  const head = kind + " " + name + " = ";
  const i = src.indexOf(head);
  if (i < 0) return null;
  // 简单常量（一行，以分号结束）直接截到分号
  const semi = src.indexOf(";", i + head.length);
  const braceStart = src.indexOf("{", i + head.length);
  if (semi >= 0 && (braceStart < 0 || semi < braceStart)) {
    return src.slice(i, semi + 1);
  }
  if (braceStart < 0) return null;
  let depth = 0;
  for (let j = braceStart; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

const decls = [
  extractDecl("const", "DAILY_KEY"),
  extractDecl("const", "DAILY_KEEP"),
  extractDecl("const", "DAILY_SEEN_CAP"),
  extractDecl("const", "dayKeyOf"),
  extractDecl("const", "loadDaily"),
  extractDecl("const", "saveDaily"),
  extractDecl("let", "memToday"),
  extractDecl("const", "addDaily"),
  extractDecl("const", "memTodayTotal"),
  extractDecl("let", "_dailyCache"),
  extractDecl("const", "readToday"),
];
check(decls.every(Boolean), "源码里抠不出完整的今日模块（有函数被改名或删除了？）");

if (decls.every(Boolean)) {
  // 沙箱：localStorage stub + 待测源码同作用域求值（函数间互相引用，须一次求值）
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  let api;
  try {
    // eslint-disable-next-line no-eval
    api = eval("(function(localStorage){ " + decls.join("\n") +
      "\nreturn { dayKeyOf, loadDaily, saveDaily, addDaily, readToday, DAILY_KEY, DAILY_KEEP }; })")(localStorage);
  } catch (err) {
    check(false, "今日模块源码无法求值", err.message);
  }

  if (api) {
    const pad = (n) => String(n).padStart(2, "0");
    const keyOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

    // 跨午夜分桶（用本地时间构造，任意时区都成立）
    const beforeMid = new Date(2026, 10, 12, 23, 59, 30).getTime();
    const afterMid = new Date(2026, 10, 13, 0, 0, 30).getTime();
    const k1 = api.dayKeyOf(beforeMid), k2 = api.dayKeyOf(afterMid);
    check(/^\d{4}-\d{2}-\d{2}$/.test(k1), "dayKeyOf 输出不是 YYYY-MM-DD 格式", k1);
    check(k1 !== k2, "跨午夜的两条用量应分到不同日期桶", k1 + " vs " + k2);

    // 累加口径：input + output
    localStorage.removeItem(api.DAILY_KEY);
    const ev1 = { sourceCommandId: "sc1", occurredAt: Date.now(), inputTokens: 100, outputTokens: 25, modelId: "m" };
    const tot1 = api.addDaily(ev1);
    check(tot1 === 125, "addDaily 应返回当日累计 input+output", "实得 " + tot1);
    const ev2 = { sourceCommandId: "sc2", occurredAt: Date.now(), inputTokens: 10, outputTokens: 5, modelId: "m" };
    check(api.addDaily(ev2) === 140, "第二条用量应累加", "实得 " + api.readToday().total);

    // 重复投递去重（同一事件对象/同一 id 重复调用不翻倍）
    check(api.addDaily(ev1) === 140, "重复事件被重复计数了", "实得 " + api.readToday().total);
    check(api.addDaily({ sourceCommandId: "sc1", occurredAt: ev1.occurredAt, inputTokens: 100, outputTokens: 25, modelId: "m" }) === 140,
          "同 id 不同对象也应去重");

    // 零用量事件不污染
    const n0 = JSON.parse(store[api.DAILY_KEY]).days[keyOf(new Date())].n;
    api.addDaily({ sourceCommandId: "sc0", occurredAt: Date.now(), inputTokens: 0, outputTokens: 0, modelId: "m" });
    check(JSON.parse(store[api.DAILY_KEY]).days[keyOf(new Date())].n === n0, "零用量事件不应新增计数");

    // 损坏 JSON 容错
    store[api.DAILY_KEY] = "{broken json";
    const loaded = api.loadDaily();
    check(loaded && typeof loaded.days === "object" && Array.isArray(loaded.seen),
          "损坏的 localStorage 数据应回退为空结构而不是抛错");
    check(api.readToday().total >= 0, "损坏数据下 readToday 应返回可用值");

    // 30 天裁剪 + seen 环上限
    const days = {};
    for (let d = 0; d < 40; d++) days["2026-01-" + pad(d + 1)] = { i: 1, o: 1, n: 1, u: 1 };
    api.saveDaily({ days, seen: new Array(600).fill("x") });
    const pruned = JSON.parse(store[api.DAILY_KEY]);
    check(Object.keys(pruned.days).length === api.DAILY_KEEP,
          "saveDaily 应只保留近 30 天", "实得 " + Object.keys(pruned.days).length + " 天");
    check(!pruned.days["2026-01-01"] && pruned.days["2026-01-40"],
          "裁剪应删最旧、留最新");
    check(pruned.seen.length === 500, "seen 去重环应 cap 在 500", "实得 " + pruned.seen.length);
  }
}

// ---------- ③ 读侧静态断言 ----------
check(/const today = readToday\(\)/.test(src), "renderBar 没有经 readToday 读取今日值");
check(/today\.key, today\.total/.test(src), "内容签名缺今日字段，今日变化/午夜滚动时不会重绘");
check(src.indexOf('"empty|" + today.key + "|" + today.total') >= 0,
      "空态签名没有带今日值，空会话下今日变化不会刷新");
check((src.match(/总耗 /g) || []).length >= 2, "有数据态与空态应都有「总耗」显示");

// ---------- 汇报 ----------
if (failures.length) {
  console.error("FAIL " + failures.length + " 项：");
  failures.forEach((f, i) => console.error("  " + (i + 1) + ". " + f));
  process.exit(1);
}
console.log("OK 今日总耗冒烟通过（写侧接入 + 分桶/去重/裁剪/容错 + 读侧渲染）");
