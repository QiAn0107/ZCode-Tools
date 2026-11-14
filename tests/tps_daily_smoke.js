// TPS 状态栏「今日总耗」冒烟测试。
//
// 锁四件事：
//   ① 写侧：usage.delta 分支必须调用 addDaily，且在轮关联之前（关联失败也不漏计）；
//   ② 行为：从源码里抠出 dayKeyOf/loadDaily/saveDaily/addDaily/readToday 真跑一遍，
//      验证跨午夜分桶、重复事件去重、30 天裁剪、损坏 JSON 容错；
//   ③ 读侧：renderBar 必须经 readToday 取今日值，空态也要带总耗。
//   ④ 会话累计：步数按 requestId 去重累计，快照 turns/requests 合并，渲染 N轮N步。
//   ⑨ main watcher 推送订阅 + 结算权威 tok/s 兜底（0.6.42，事件有值不覆盖）。
//
// 用法：node tests/tps_daily_smoke.js skills/zcode-tools/scripts/zcode-tps.js
// 退出码 0 = 通过；1 = 有断言失败；2 = 用法/读取错误。
const fs = require("fs");

const target = process.argv[2];
if (!target) {
  console.error("用法：node tests/tps_daily_smoke.js <zcode-tps.js 的路径>");
  console.error("例如：node tests/tps_daily_smoke.js skills/zcode-tools/scripts/zcode-tps.js");
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

// ---------- ④ composer-below 自适应间距补偿 ----------
// 不猜布局（gap / space-y / margin 各版本不同），直接量像素：上沿↔卡片下沿、
// 下沿↔下一元素，用负 margin 抵消到 GAP_TARGET。锁四件事：
// 有测量 helper、有目标值、上下两侧都补偿、有节流重量。
check(/const GAP_TARGET = \d+/.test(src), "缺 GAP_TARGET，视觉间距没有目标值");
check(/function fitGap\(host, card\)/.test(src), "缺 fitGap helper，无法按实测像素补偿间距");
check(/px\(host\.style\.marginTop\) - topErr/.test(src),
      "上侧必须按「当前 margin - 实测偏差」增量修正，绝对值反算会自激振荡");
check(/px\(host\.style\.marginBottom\) - Math\.min\(botErr, cap\)/.test(src),
      "下侧补偿必须按「实测偏差」增量修正且以 cap 封顶");
check(/const cap = Math\.max\(0, rawTop\)/.test(src),
      "缺 cap 上限，会吞掉应用自己的下边距把其它元素往上拽");
check(/Math\.abs\(topErr\) > 0\.5/.test(src) && /botErr > 0\.5/.test(src),
      "缺收敛阈值，稳定后仍会每秒写样式");
// 末位元素：负 margin 不会让胶囊自己下移（父高 auto 时容器底同步上移），
// 「胶囊↔底部边框」只能靠视觉位移沉进父容器 padding。
check(/const MAX_SINK = \d+/.test(src), "缺 MAX_SINK 上限，下沉可能压到父容器外");
check(/host\.style\.transform = sink > 0\.5 \? "translateY\(" \+ sink \+ "px\)" : ""/.test(src),
      "末位元素没有 translateY 下沉，下方到边框的留白收不掉");
check(/const room = bBottom - h\.bottom - GAP_TARGET/.test(src),
      "下沉量必须按父容器边框盒底反算，否则会越过父容器");
check(/now - host\._fitAt > 1000/.test(src),
      "缺重量节流，布局/窗口变化后补偿不会刷新");
check(!/parentRowGap/.test(src), "旧的 parentRowGap 猜测式补偿应已移除");
check(/scriptVersion = "3\.23-settle"/.test(src), "脚本版本号未同步到 3.23-settle");

// ---------- ⑤ 早到 delta pending 回放 ----------
// 首批带 input 的 delta 常早于 turnHeader/respTurn 桥接到达：必须暂存待回放，
// 不得再直接丢弃（`if (!t) return` 是输入恒 0 的根因）。
check(/const pendingUsage = new Map\(\)/.test(src), "缺 pendingUsage 暂存表，早到 delta 会被丢弃");
check(/function applyUsage\(t, ev\)/.test(src), "缺 applyUsage（直达与回放共用的累加函数）");
check(/function replayPending\(scid, t\)/.test(src), "缺 replayPending，暂存的 delta 永远回放不了");
check(/replayPending\(row\.sourceCommandId, t\)/.test(src), "onRow 建桥后没有回放 pending");
check(/replayPending\(scid, t\)/.test(src), "stream.chunk 建桥后没有回放 pending");
check(!/const t = findByScid\(scid\) \|\| turns\.get\(scidTurn\.get\(scid\)\);\s*if \(!t\) return;/.test(src),
      "usage.delta 仍在关联失败时直接 return（应暂存待回放）");

// ---------- ⑥ DB 快照结算层回填 ----------
// 事件流是实时层，DB 快照是结算层：以 Math.max 合并，事件优先、快照补漏。
check(/getUsageSnapshot/.test(src), "没有经 zcode:tps-snapshot IPC 取快照");
check(/snapSession\(domSess\)/.test(src), "没有按当前会话取快照回填");
check(/snapToday > today\.total/.test(src),
      "今日侧没有取 max(localStorage, 快照today)");
check(/_snapCache\.stamp\]\.join/.test(src), "内容签名缺快照 stamp，快照到达不会重绘");
check(/snapshotHit/.test(src), "diag 缺 snapshotHit，快照是否命中无法定位");
check(/snapshotErr/.test(src), "diag 缺 snapshotErr，快照失败原因无法定位");
// 轮次结束=DB 落库完成，必须立刻让缓存过期，否则结算值要等 3s TTL 才可见
check(/if \(!t\.streaming\) _snapCache\.at = 0/.test(src),
      "轮次结束没有失效快照缓存，本轮结算值要等 TTL 才显示");

// ---------- ⑦ 会话 id 兜底（快照按会话回填的前提） ----------
// 3.17.x 的 data-session-id 挂在 composer 卡片上（无会话时是 "draft"），frame 上取不到；
// 取不到就等于快照查找键为 null → 输入/命中永远回填不了。必须有事件流 sessionId 兜底。
check(/domSess === "draft"/.test(src), '缺 "draft" 判据：新会话的占位 id 会被当成真实会话');
check(/const at = t\.lastUsageAt \?\? t\.startedAt \?\? 0/.test(src),
      "缺轮次 sessionId 兜底（取最近活动轮），快照查找键可能为 null");
check(/v !== "draft" && !isInsideSidePane\(el\)/.test(src),
      "DOM 兜底必须排除 draft 与侧边栏，否则会拿错会话");
// 重开旧会话：事件流没有历史，只有快照；数据态必须认快照，且 statsOf 要能接受 null
check(/const snapHas = !!\(snap &&/.test(src),
      "数据态没认快照：重开旧会话只显示绿点，输入/输出/命中不出现");
check(/const s = latest \? statsOf\(latest\)/.test(src),
      "无轮次但快照有量时会崩：statsOf(null)");

// ---------- ⑧ 会话累计「N轮N步」 ----------
// 轮=本会话完成轮数，步=完成模型请求数。锁四件事：轮记录有步数字段、轮复用会清、
// 快照 turns/requests 能并入、渲染确实是 N轮N步；再把 applyUsage 抠出来真跑去重。
check(/steps: 0, reqIds: null/.test(src), "轮记录缺 steps/reqIds，步数无法累计");
check(/t\.steps = 0; t\.reqIds = null/.test(src), "resetTurnStats 没清步数，编辑重发会带旧值");
check(/agg\.steps \+= t\.steps \|\| 0/.test(src), "会话累计没有汇总步数");
check(/const snapRounds = snap\.turns \|\| 0/.test(src) &&
      /const snapSteps = snap\.requests \|\| 0/.test(src) &&
      /snapRounds > agg\.rounds/.test(src) && /snapSteps > agg\.steps/.test(src),
      "快照 turns/requests 没有并入轮/步累计（0.6.36 起是 pure-max，不得再 +stream）");
check(/span\(agg\.rounds \+ "轮"/.test(src) && /span\(agg\.steps \+ "步"/.test(src),
      "状态栏没有渲染 N轮N步");
check(/for \(const drop of \[7, 1, 2, 3\]\)/.test(src),
      "降级顺序应把轮步排在最后(总耗→首token→tok/s→轮步)");

// ---------- ⑨ main watcher 推送 + 结算权威兜底（0.6.42 移植自参考实现） ----------
// 快照有新写入（DB 落库重算/钩子重写）由 main 主动推送，免等 3s TTL 拉取；
// 结束轮的 tok/s 只在事件漏采或事件层缺值时用快照权威值兜底，事件层有值绝不覆盖，
// 流式轮一律排除（DB 只在请求完成时落行，流中没有权威数据）。
check(/window\.zcode\.onTpsPush/.test(src), "没有订阅 main watcher 的 zcode:tps-push 推送");
check(/function onSnapshotPush\(/.test(src), "缺推送接收函数");
check(/function acceptSnapshot\(/.test(src), "拉取与推送没有共用同一份缓存写入路径");
check(/d\.stamp === _snapCache\.stamp/.test(src), "推送缺 stamp 去重，重复推送会反复重渲染");
check(/snap\.last_tps \|\| 0\) > 0/.test(src),
      "缺快照权威 tok/s 兜底（事件漏采/缺值时 tok/s 会冻在旧值）");
check(/!\(latest && latest\.streaming\)/.test(src), "权威兜底必须排除流式轮（DB 无流中数据）");
check(/dbNewer \|\| s\.tps == null/.test(src), "兜底条件必须保守：事件层有值时绝不覆盖");
check(/latest\.lastUsageAt \|\| latest\.endedAt \|\| 0/.test(src) && /evAt \+ 3000/.test(src),
      "漏采判据缺「DB 比事件层新 3s+」容差");
check(/snapshotTpsApplied/.test(src), "diag 缺 snapshotTpsApplied，兜底是否生效无法定位");
check(/lastPushStamp/.test(src), "diag 缺 lastPushStamp，推送是否到达无法定位");
check(/pushSubscribed/.test(src), "diag 缺 pushSubscribed，订阅是否成功无法定位");

function extractFn(name) {
  const head = "function " + name + "(";
  const i = src.indexOf(head);
  if (i < 0) return null;
  const braceStart = src.indexOf("{", i);
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

const fnSrc = extractFn("applyUsage");
check(!!fnSrc, "源码里抠不出 applyUsage（函数被改名或删除了？）");
if (fnSrc) {
  let applyUsage = null;
  try {
    // eslint-disable-next-line no-eval
    applyUsage = eval("(function(window){" + fnSrc + "; return applyUsage;})")({});
  } catch (err) {
    check(false, "applyUsage 源码无法求值", err.message);
  }
  if (typeof applyUsage === "function") {
    const t = {
      outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      reasoningTokens: 0, totalTokens: 0, steps: 0, reqIds: null,
      modelId: null, sessionId: null, lastUsageAt: null,
    };
    applyUsage(t, { requestId: "r1", outputTokens: 1 });
    applyUsage(t, { requestId: "r1", outputTokens: 1 });   // 重复投递/回放
    check(t.steps === 1, "同一 requestId 被重复计数", "实得 " + t.steps);
    check(t.outputTokens === 2, "去重不应吞掉用量累加", "实得 " + t.outputTokens);
    applyUsage(t, { requestId: "r2", outputTokens: 1 });
    check(t.steps === 2, "不同 requestId 应各计一步", "实得 " + t.steps);
    applyUsage(t, { outputTokens: 1 });   // 老事件无 requestId
    check(t.steps === 3, "无 requestId 的事件应按条计步", "实得 " + t.steps);
    // 轮复用清空后，同一个 requestId 应能重新计数
    t.steps = 0; t.reqIds = null;
    applyUsage(t, { requestId: "r1", outputTokens: 1 });
    check(t.steps === 1, "重置后同 requestId 应能重新计数", "实得 " + t.steps);
  }
}

// ---------- 汇报 ----------
if (failures.length) {
  console.error("FAIL " + failures.length + " 项：");
  failures.forEach((f, i) => console.error("  " + (i + 1) + ". " + f));
  process.exit(1);
}
console.log("OK 今日总耗冒烟通过（写侧接入 + 分桶/去重/裁剪/容错 + 读侧渲染）");
