// public/yt/topcards/app.js

const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleTimeString(); }

const COLORS = {
  red: "#e81416",
  orange: "#ffa500",
  yellow: "#faeb36",
  green: "#79c314",
  blue: "#487de7",
  purple: "#bb00ff",
  white: "#ffffff"
};

const FEEDBACK = {
  subs: {
    red: "Audience Leak",
    orange: "Slow Convert",
    yellow: "Steady Growth",
    green: "Strong Pull",
    blue: "Rising Fast",
    purple: "Exceptional",
  },
  views: {
    red: "Reach Down",
    orange: "Low Reach",
    yellow: "Stable Reach",
    green: "Reach Up",
    blue: "Trending",
    purple: "Viral",
  },
  watch: {
    red: "Poor Engage",
    orange: "Retention Issue",
    yellow: "Consistent",
    green: "Engage Up",
    blue: "Hooked",
    purple: "Ultra Retained",
  }
};

const GOALS = {
  subs: [500, 1000, 2000, 3000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000],
  views: [10000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000],
  watch: [100, 500, 1000, 2000, 4000, 8000, 10000, 20000, 50000, 100000, 200000, 400000]
};

function pickNextGoal(curr, arr) {
  for (const g of arr) if (g > curr) return g;
  const last = arr[arr.length - 1] || 0;
  return Math.ceil(curr / last) * last;
}

function pctToGoal(curr, goal) {
  if (!goal || goal <= 0) return 0;
  return Math.max(0, Math.min(100, (curr / goal) * 100));
}

function fmtDelta(n) {
  const v = Number(n || 0);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return sign + fmt(Math.abs(v));
}

function classDelta(n) {
  const v = Number(n || 0);
  if (v > 0) return "pos";
  if (v < 0) return "neg";
  return "neu";
}

function arrowForDelta(n) {
  const v = Number(n || 0);
  if (v > 0) return "▲";
  if (v < 0) return "▼";
  return "•";
}

function toHours(minutes) {
  return Number(minutes || 0) / 60;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n, a, b) {
  n = Number(n);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixHex(a, b, t) {
  // a,b = "#rrggbb"
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const rr = Math.round(lerp(ar, br, t));
  const rg = Math.round(lerp(ag, bg, t));
  const rb = Math.round(lerp(ab, bb, t));
  return "#" + ((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1);
}

/* ===========================
   Casino-style digit rolling
   =========================== */

// Slow roll (casino) when numbers change; works both up + down
function setRollingNumber(el, prev, next, opts = {}) {
  if (!el) return;
  prev = String(prev ?? "0");
  next = String(next ?? "0");

  const duration = clamp(opts.durationMs ?? 1100, 450, 2600);
  const stagger = clamp(opts.staggerMs ?? 45, 0, 120);
  const loops = clamp(opts.loops ?? 1, 0, 4);
  const ease = opts.ease ?? "cubic-bezier(0.22, 1, 0.36, 1)";

  // Keep digits aligned (monospace-ish via tabular nums)
  const maxLen = Math.max(prev.length, next.length);
  prev = prev.padStart(maxLen, " ");
  next = next.padStart(maxLen, " ");

  // Build columns
  const wrap = document.createElement("span");
  wrap.className = "rollWrap";

  for (let i = 0; i < maxLen; i++) {
    const a = prev[i];
    const b = next[i];

    const col = document.createElement("span");
    col.className = "rollCol";

    // If not a digit, just show final char without rolling
    if (!/\d/.test(a) || !/\d/.test(b)) {
      const line = document.createElement("span");
      line.className = "rollLine";
      line.textContent = b === " " ? "\u00A0" : b;
      col.appendChild(line);
      wrap.appendChild(col);
      continue;
    }

    const from = Number(a);
    const to = Number(b);

    // Build a sequence to roll through (supports down-roll too)
    // We do: [from ... (loops cycles) ... to]
    const seq = [];
    seq.push(from);

    if (loops > 0) {
      for (let l = 0; l < loops; l++) {
        for (let d = 0; d <= 9; d++) seq.push(d);
      }
    }

    // Ensure direction makes sense (up or down) by stepping
    const step = to >= from ? 1 : -1;
    let cur = from;
    while (cur !== to) {
      cur = (cur + step + 10) % 10;
      seq.push(cur);
    }

    // Populate lines
    for (const d of seq) {
      const line = document.createElement("span");
      line.className = "rollLine";
      line.textContent = String(d);
      col.appendChild(line);
    }

    // Animate by translating the column
    const lineH = 1.1; // em (matches CSS)
    const totalLines = seq.length;
    const translateEm = (totalLines - 1) * lineH;

    // Stagger each digit slightly
    col.style.transition = `transform ${duration}ms ${ease}`;
    col.style.transitionDelay = `${i * stagger}ms`;

    // Initial position
    col.style.transform = "translateY(0em)";
    // Force layout
    void col.offsetHeight;
    // Animate to final
    requestAnimationFrame(() => {
      col.style.transform = `translateY(-${translateEm}em)`;
    });

    wrap.appendChild(col);
  }

  // Replace content
  el.innerHTML = "";
  el.appendChild(wrap);
}

/* ===========================
   Sparklines
   =========================== */

function buildSparkPath(values, width = 120, height = 40, pad = 3) {
  values = (values || []).map(safeNum);
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1 || 1);

  let d = "";
  for (let i = 0; i < values.length; i++) {
    const x = pad + i * step;
    const y = pad + (1 - (values[i] - min) / span) * (height - pad * 2);
    d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
  }
  return d.trim();
}

function buildSparkFill(pathD, width = 120, height = 40) {
  if (!pathD) return "";
  return `${pathD} L ${width} ${height} L 0 ${height} Z`;
}

/* ===========================
   Tier + color selection
   =========================== */

function tierColor(type, weekly, prev, avg6m, median6m) {
  // Uses vs median + trend
  const now = safeNum(weekly);
  const before = safeNum(prev);
  const base = safeNum(median6m || avg6m);

  const delta = now - base;
  const trend = now - before;

  const rel = base ? delta / base : 0;
  const tr = before ? trend / before : 0;

  // Heuristics for tier
  if (rel >= 0.6 && tr >= 0.2) return { tier: "purple", color: COLORS.purple };
  if (rel >= 0.35 && tr >= 0.12) return { tier: "blue", color: COLORS.blue };
  if (rel >= 0.12) return { tier: "green", color: COLORS.green };
  if (rel >= -0.05) return { tier: "yellow", color: COLORS.yellow };
  if (rel >= -0.2) return { tier: "orange", color: COLORS.orange };
  return { tier: "red", color: COLORS.red };
}

/* ===========================
   DOM helpers
   =========================== */

function setDot(el, color) {
  if (!el) return;
  el.style.background = color;
  el.style.color = color;
}

function setCardTier(cardId, color) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.style.setProperty("--c-tier", color);
}

function triggerGlowOnce(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.remove("glow-once");
  void card.offsetWidth;
  card.classList.add("glow-once");
}

function showToast() {
  const t = document.getElementById("toast");
  if (!t) return;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ===========================
   Floating +1 icons (SVG)
   =========================== */

const FLOAT_SVGS = {
  subs: `<svg viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z"/></svg>`,
  views: `<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`,
  watch: `<svg viewBox="0 0 24 24"><path d="M15 8H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1.2l4 2.3V7.9l-4 2.3V10c0-1.1-.9-2-2-2Z"/></svg>`
};

function spawnFloatIcon(cardId, type) {
  const card = document.getElementById(cardId);
  if (!card) return;

  const icon = document.createElement("div");
  icon.className = "floatIcon";
  icon.innerHTML = FLOAT_SVGS[type] || "";
  card.appendChild(icon);

  setTimeout(() => {
    icon.remove();
  }, 5200);
}

/* ===========================
   Fetch
   =========================== */

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

/* ===========================
   State
   =========================== */

const STATE = {
  subsNow: 0,
  viewsTotal: 0,
  watchHours: 0
};

/* ===========================
   Render
   =========================== */

function renderCard({
  type, // "subs" | "views" | "watch"
  cardId,
  nowElId,
  arrowElId,
  dotId,
  chipTextId,
  sparkPathId,
  sparkFillId,
  weekElId,
  last28ElId,
  prev28ElId,
  vsNumId,
  vsArrowId,
  nextGoalId,
  nextPctId,
  progressFillId,

  nowValue,
  weeklyValue,
  prevWeeklyValue,
  last28Value,
  prev28Value,
  median6m,
  avg6m,

  sparkValues,
  unitSuffix = ""
}) {
  const nowEl = document.getElementById(nowElId);
  const arrowEl = document.getElementById(arrowElId);
  const dot = document.getElementById(dotId);
  const chipText = document.getElementById(chipTextId);

  const weekEl = document.getElementById(weekElId);
  const last28El = document.getElementById(last28ElId);
  const prev28El = document.getElementById(prev28ElId);
  const vsNum = document.getElementById(vsNumId);
  const vsArrow = document.getElementById(vsArrowId);

  const nextGoalEl = document.getElementById(nextGoalId);
  const nextPctEl = document.getElementById(nextPctId);
  const progressFill = document.getElementById(progressFillId);

  const { tier, color } = tierColor(type, weeklyValue, prevWeeklyValue, avg6m, median6m);

  // Set global tier color for card effects
  setCardTier(cardId, color);

  // Chip + dot
  setDot(dot, color);
  chipText.textContent = FEEDBACK[type][tier] || "—";

  // Main numbers: roll if changed
  const prevNow = STATE[type + "Now"] ?? nowValue;
  const changed = Number(prevNow) !== Number(nowValue);

  if (changed) {
    // slow casino roll
    setRollingNumber(nowEl, fmt(prevNow), fmt(nowValue), {
      durationMs: 1350,
      staggerMs: 55,
      loops: 1
    });

    // float icon when rising
    if (Number(nowValue) > Number(prevNow)) {
      spawnFloatIcon(cardId, type);
    }

    // glow breath
    triggerGlowOnce(cardId);
  } else {
    // normal set
    nowEl.textContent = fmt(nowValue) + unitSuffix;
  }

  // Arrow on main value (based on weekly trend vs prev week)
  const trend = safeNum(weeklyValue) - safeNum(prevWeeklyValue);
  arrowEl.textContent = arrowForDelta(trend);

  // Week line
  weekEl.textContent = `Last 7D: ${fmtDelta(weeklyValue)}${unitSuffix}`;

  // 28D + prev
  last28El.textContent = fmtDelta(last28Value) + unitSuffix;
  prev28El.textContent = fmtDelta(prev28Value) + unitSuffix;

  // vs 6M avg
  const vs = safeNum(last28Value) - safeNum(avg6m);
  vsNum.textContent = fmtDelta(vs) + unitSuffix;
  vsNum.className = "vsNum " + classDelta(vs);
  vsArrow.textContent = vs >= 0 ? " ↗" : " ↘";
  vsArrow.className = "vsArrow " + classDelta(vs);

  // Next goal + progress
  const goal = pickNextGoal(nowValue, GOALS[type]);
  nextGoalEl.textContent = fmt(goal) + unitSuffix;
  const p = pctToGoal(nowValue, goal);
  nextPctEl.textContent = fmt1(p) + "%";
  progressFill.style.width = p.toFixed(1) + "%";

  // Sparkline
  const pathD = buildSparkPath(sparkValues);
  const fillD = buildSparkFill(pathD);
  const pEl = document.getElementById(sparkPathId);
  const fEl = document.getElementById(sparkFillId);
  if (pEl) {
    pEl.setAttribute("d", pathD);
    pEl.setAttribute("stroke", color);
    pEl.setAttribute("stroke-width", "2");
  }
  if (fEl) fEl.setAttribute("d", fillD);

  // Store
  STATE[type + "Now"] = nowValue;
}

function render(data, isFirst) {
  // Update footer
  document.getElementById("updated").textContent = `Updated: ${nowStamp()}`;
  showToast();

  const weekly = data.weekly || {};
  const m28 = data.m28 || {};
  const hist = data.history28d || [];

  // History values for sparks
  // use most recent -> oldest for nicer spark (reverse)
  const sparkSubs = hist.map(h => safeNum(h.netSubs)).reverse().slice(-28);
  const sparkViews = hist.map(h => safeNum(h.views)).reverse().slice(-28);
  const sparkWatch = hist.map(h => safeNum(h.watchHours)).reverse().slice(-28);

  const subsNow = safeNum(data.channel?.subs);
  const viewsTotal = safeNum(data.channel?.views);
  const watchHoursLife = safeNum(data.lifetime?.watchHours);

  // Render subs card
  renderCard({
    type: "subs",
    cardId: "cardSubs",
    nowElId: "subsNow",
    arrowElId: "subsMainArrow",
    dotId: "subsDot",
    chipTextId: "subsChipText",
    sparkPathId: "subsSparkPath",
    sparkFillId: "subsSparkFill",
    weekElId: "subsWeek",
    last28ElId: "subsLast28",
    prev28ElId: "subsPrev28",
    vsNumId: "subsVsNum",
    vsArrowId: "subsVsArrow",
    nextGoalId: "subsNextGoal",
    nextPctId: "subsNextPct",
    progressFillId: "subsProgressFill",
    nowValue: subsNow,
    weeklyValue: safeNum(weekly.netSubs),
    prevWeeklyValue: safeNum(weekly.prevNetSubs),
    last28Value: safeNum(m28.last28?.netSubs),
    prev28Value: safeNum(m28.prev28?.netSubs),
    median6m: safeNum(m28.median6m?.netSubs),
    avg6m: safeNum(m28.avg6m?.netSubs),
    sparkValues: sparkSubs,
    unitSuffix: ""
  });

  // Views card
  renderCard({
    type: "views",
    cardId: "cardViews",
    nowElId: "viewsTotal",
    arrowElId: "viewsMainArrow",
    dotId: "viewsDot",
    chipTextId: "viewsChipText",
    sparkPathId: "viewsSparkPath",
    sparkFillId: "viewsSparkFill",
    weekElId: "viewsWeek",
    last28ElId: "viewsLast28",
    prev28ElId: "viewsPrev28",
    vsNumId: "viewsVsNum",
    vsArrowId: "viewsVsArrow",
    nextGoalId: "viewsNextGoal",
    nextPctId: "viewsNextPct",
    progressFillId: "viewsProgressFill",
    nowValue: viewsTotal,
    weeklyValue: safeNum(weekly.views),
    prevWeeklyValue: safeNum(weekly.prevViews),
    last28Value: safeNum(m28.last28?.views),
    prev28Value: safeNum(m28.prev28?.views),
    median6m: safeNum(m28.median6m?.views),
    avg6m: safeNum(m28.avg6m?.views),
    sparkValues: sparkViews,
    unitSuffix: ""
  });

  // Watch hours card
  renderCard({
    type: "watch",
    cardId: "cardWatch",
    nowElId: "watchNow",
    arrowElId: "watchMainArrow",
    dotId: "watchDot",
    chipTextId: "watchChipText",
    sparkPathId: "watchSparkPath",
    sparkFillId: "watchSparkFill",
    weekElId: "watchWeek",
    last28ElId: "watchLast28",
    prev28ElId: "watchPrev28",
    vsNumId: "watchVsNum",
    vsArrowId: "watchVsArrow",
    nextGoalId: "watchNextGoal",
    nextPctId: "watchNextPct",
    progressFillId: "watchProgressFill",
    nowValue: watchHoursLife,
    weeklyValue: safeNum(weekly.watchHours),
    prevWeeklyValue: safeNum(weekly.prevWatchHours),
    last28Value: safeNum(m28.last28?.watchHours),
    prev28Value: safeNum(m28.prev28?.watchHours),
    median6m: safeNum(m28.median6m?.watchHours),
    avg6m: safeNum(m28.avg6m?.watchHours),
    sparkValues: sparkWatch,
    unitSuffix: ""
  });

  // Logo watermarks (SVG, white)
  // You can swap these with your own PNG via CSS --logo-url.
  const subsLogo = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='white' d='M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z'/%3E%3C/svg%3E")`;
  const viewsLogo = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='white' d='M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'/%3E%3C/svg%3E")`;
  const watchLogo = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='white' d='M15 8H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1.2l4 2.3V7.9l-4 2.3V10c0-1.1-.9-2-2-2Z'/%3E%3C/svg%3E")`;

  document.getElementById("cardSubs")?.style.setProperty("--logo-url", subsLogo);
  document.getElementById("cardViews")?.style.setProperty("--logo-url", viewsLogo);
  document.getElementById("cardWatch")?.style.setProperty("--logo-url", watchLogo);

  // Enter animation only on first render
  if (isFirst) {
    ["cardSubs", "cardViews", "cardWatch"].forEach((id, i) => {
      const c = document.getElementById(id);
      if (!c) return;
      c.classList.remove("card-enter");
      void c.offsetWidth;
      setTimeout(() => c.classList.add("card-enter"), i * 120);
    });
  }

  // HUD
  updateHud(data);

  // Occasionally glow the cards (subtle life)
  clearTimeout(render._glowTimer);
  render._glowTimer = setTimeout(() => {
    if (!document.hidden) {
      triggerGlowOnce("cardSubs");
      triggerGlowOnce("cardViews");
      triggerGlowOnce("cardWatch");
    }

    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => {
      triggerGlowOnce("cardSubs");
      triggerGlowOnce("cardViews");
      triggerGlowOnce("cardWatch");
    }, 30000);
  }, 2000);

  // Save last state (optional)
}

/* ===========================
   HUD ENGINE (AI-style)
   =========================== */

const HUD_MEM_KEY = "yt_hud_mem_v2";
function hudMemLoad() {
  try {
    const raw = localStorage.getItem(HUD_MEM_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch { return null; }
}
function hudMemSave() {
  try {
    const out = {
      lastKey: HUD_CONFIG.lastKey,
      recentKeys: HUD_CONFIG.recentKeys,
      shownAt: HUD_CONFIG.shownAt
    };
    localStorage.setItem(HUD_MEM_KEY, JSON.stringify(out));
  } catch {}
}

function clampInt(n, a, b) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uniq(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    if (!x) continue;
    if (s.has(x)) continue;
    s.add(x);
    out.push(x);
  }
  return out;
}

function sinceDays(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatHms(sec) {
  sec = Math.max(0, Math.floor(Number(sec || 0)));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function sumTop(list, n = 5) {
  if (!Array.isArray(list) || !list.length) return 0;
  return list.slice(0, n).reduce((a, x) => a + safeNum(x.value), 0);
}

const HUD_CONFIG = {
  interval: 16000, // MUST be 16s
  timer: null,
  bootTimeout: null,
  pendingStart: false,
  started: false,
  bootAt: Date.now(),
  lastKey: null,
  recentKeys: [],
  shownAt: Object.create(null),
  // cooldowns to stop “status” spamming
  cooldownMs: {
    freshness: 10 * 60 * 1000,   // 10 min
    birthday: 15 * 60 * 1000,    // 15 min
    uploads: 12 * 60 * 1000,
    retention: 12 * 60 * 1000,
    traffic: 12 * 60 * 1000,
    countries: 20 * 60 * 1000,
  }
};

// Restore memory
(() => {
  const mem = hudMemLoad();
  if (!mem) return;
  HUD_CONFIG.lastKey = mem.lastKey || null;
  HUD_CONFIG.recentKeys = Array.isArray(mem.recentKeys) ? mem.recentKeys.slice(0, 6) : [];
  HUD_CONFIG.shownAt = mem.shownAt && typeof mem.shownAt === "object" ? mem.shownAt : Object.create(null);
})();

// Weighted random pick
function weightedPick(items) {
  const total = items.reduce((a, it) => a + (it.w || 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= (it.w || 1);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Builds a list of intel cards (tag+message+icon), per refresh
let intelQueue = [];

function buildIntel(data) {
  const q = [];
  const hud = data.hud || {};
  const weekly = data.weekly || {};
  const m28 = data.m28 || {};
  const channel = data.channel || {};

  const weekSubs = safeNum(weekly.netSubs);
  const prevWeekSubs = safeNum(weekly.prevNetSubs);
  const weekViews = safeNum(weekly.views);
  const prevWeekViews = safeNum(weekly.prevViews);
  const weekWatch = safeNum(weekly.watchHours);
  const prevWeekWatch = safeNum(weekly.prevWatchHours);

  const v48 = safeNum(hud.views48h);

  // ===== Core “systems” signals =====
  q.push({
    key: "weekly_subs",
    type: "subs",
    tag: "GROWTH",
    icon: "🧬",
    w: 1.1,
    text: weekSubs >= 0
      ? `Net +${fmt(weekSubs)} subs in the last 7 days. Keep the conversion loop tight.`
      : `Net −${fmt(Math.abs(weekSubs))} subs in the last 7 days. Patch the leaks (hook/retention).`,
    subline: `Prev 7D: ${fmtDelta(prevWeekSubs)}`
  });

  q.push({
    key: "weekly_views",
    type: "views",
    tag: "REACH",
    icon: "📡",
    w: 1.1,
    text: `Your last 7 days pulled ${fmt(weekViews)} views.`,
    subline: `Prev 7D: ${fmt(prevWeekViews)}`
  });

  q.push({
    key: "weekly_watch",
    type: "watch",
    tag: "RETENTION",
    icon: "🧲",
    w: 1.1,
    text: `Last 7 days watch time: ${fmt1(weekWatch)} hours.`,
    subline: `Prev 7D: ${fmt1(prevWeekWatch)} hours`
  });

  // ===== Velocity =====
  q.push({
    key: "velocity_48h",
    type: "views",
    tag: "VELOCITY",
    icon: "⚡",
    w: 1.0,
    text: `In the last ~48 hours you got ${fmt(v48)} views.`,
    subline: `Use this to detect “lift” early.`
  });

  // ===== Freshness / uploads =====
  if (hud.uploads?.latest?.publishedAt) {
    const days = sinceDays(hud.uploads.latest.publishedAt);
    const t = hud.uploads.latest.title || "Latest upload";
    q.push({
      key: "freshness",
      type: "views",
      tag: "FRESHNESS",
      icon: "🕒",
      w: 1.0,
      cooldownMs: HUD_CONFIG.cooldownMs.freshness,
      text: days != null
        ? `Latest upload was ${days} day(s) ago: “${t}”.`
        : `Latest upload: “${t}”.`,
      subline: `Published: ${formatDateShort(hud.uploads.latest.publishedAt)}`
    });
  }

  // ===== Thumb / CTR =====
  if (hud.thumb28?.impressions != null && hud.thumb28?.ctr != null) {
    const imp = safeNum(hud.thumb28.impressions);
    const ctr = safeNum(hud.thumb28.ctr);
    q.push({
      key: "thumbs",
      type: "views",
      tag: "THUMB CTR",
      icon: "👁️",
      w: 0.95,
      cooldownMs: HUD_CONFIG.cooldownMs.traffic,
      text: `Last 28D: ${fmt(imp)} impressions, CTR ${fmt1(ctr)}%.`,
      subline: `Aim: CTR up without killing retention.`
    });
  }

  // ===== Retention =====
  if (hud.retention28?.avgViewDurationSec != null && hud.retention28?.avgViewPercentage != null) {
    const avd = safeNum(hud.retention28.avgViewDurationSec);
    const avp = safeNum(hud.retention28.avgViewPercentage);
    q.push({
      key: "retention",
      type: "watch",
      tag: "AVG RET",
      icon: "⏱️",
      w: 0.95,
      cooldownMs: HUD_CONFIG.cooldownMs.retention,
      text: `Last 28D average view duration: ${formatHms(avd)} (${fmt1(avp)}%).`,
      subline: `If AVD drops, fix pacing + hook.`
    });
  }

  // ===== Unique viewers =====
  if (hud.uniqueViewers28 != null) {
    q.push({
      key: "uniq",
      type: "views",
      tag: "UNIQUE",
      icon: "🧑‍🤝‍🧑",
      w: 0.9,
      text: `Estimated unique viewers (28D): ${fmt(hud.uniqueViewers28)}.`,
      subline: `More uniques = bigger top funnel.`
    });
  }

  // ===== Traffic sources =====
  const traffic = hud.traffic?.last28;
  if (Array.isArray(traffic) && traffic.length) {
    const top = traffic[0];
    q.push({
      key: "traffic",
      type: "views",
      tag: "TRAFFIC",
      icon: "🧭",
      w: 0.9,
      cooldownMs: HUD_CONFIG.cooldownMs.traffic,
      text: `Top traffic source (28D): ${top.name} — ${fmt(top.value)} views.`,
      subline: `Diversify sources to stabilize growth.`
    });
  }

  // ===== Countries =====
  const countries = hud.countries;
  if (Array.isArray(countries) && countries.length) {
    const top = countries[0];
    q.push({
      key: "countries",
      type: "views",
      tag: "COUNTRY",
      icon: "🌍",
      w: 0.85,
      cooldownMs: HUD_CONFIG.cooldownMs.countries,
      text: `Top country (28D): ${top.name} — ${fmt(top.value)} views.`,
      subline: `Use timezones + titles to match region.`
    });
  }

  // ===== Video intel (NEW: 7D analytics per recent video) =====
  const vi = hud.videoIntel?.videos;
  if (Array.isArray(vi) && vi.length) {
    // Pick a random high-signal item, but avoid repeating the same video too often
    const sorted = [...vi].sort((a, b) => safeNum(b.views7d) - safeNum(a.views7d));
    const top5 = sorted.slice(0, 5);
    const pickV = pick(top5.length ? top5 : sorted);

    const title = pickV.title || "Recent video";
    const v7 = safeNum(pickV.views7d);
    const wh = safeNum(pickV.watchHours7d);
    const ns = safeNum(pickV.netSubs7d);

    q.push({
      key: "video_intel_" + (pickV.videoId || ""),
      type: "views",
      tag: "VIDEO INTEL",
      icon: "🎯",
      w: 1.05,
      text: `7D intel: “${title}” — ${fmt(v7)} views, ${fmt1(wh)}h watch, net ${fmtDelta(ns)} subs.`,
      subline: `Published: ${formatDateShort(pickV.publishedAt)}`
    });
  }

  // ===== Birthday / channel age =====
  if (channel.publishedAt) {
    const days = sinceDays(channel.publishedAt);
    if (days != null) {
      const years = Math.floor(days / 365);
      const rem = days % 365;
      q.push({
        key: "birthday",
        type: "subs",
        tag: "CHANNEL AGE",
        icon: "🎂",
        w: 0.75,
        cooldownMs: HUD_CONFIG.cooldownMs.birthday,
        text: `Channel age: ~${years}y ${rem}d (since ${formatDateShort(channel.publishedAt)}).`,
        subline: `Consistency compounds.`
      });
    }
  }

  // Fallback
  q.push({
    key: "fallback",
    type: "views",
    tag: "SYSTEM",
    icon: "🧠",
    w: 0.2,
    text: "Analyzing signal… keep shipping. One upload can flip the curve.",
    subline: ""
  });

  // Avoid repeating recent keys too aggressively
  const recent = new Set(HUD_CONFIG.recentKeys || []);
  return q.filter(it => !recent.has(it.key));
}

function initHudRing() {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;
  rect.style.strokeDasharray = "100";
  rect.style.strokeDashoffset = "100";
  rect.style.animation = "none"; // we drive via JS to match exact 16s
}

function animateHudRing(color) {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;

  rect.style.stroke = color;
  rect.style.filter = `drop-shadow(0 0 10px ${color})`;

  rect.style.transition = "none";
  rect.style.strokeDashoffset = "100";
  void rect.getBoundingClientRect();

  // Animate to full in exactly 16 seconds
  rect.style.transition = `stroke-dashoffset ${HUD_CONFIG.interval}ms linear`;
  requestAnimationFrame(() => {
    rect.style.strokeDashoffset = "0";
  });
}

function pickNextItem() {
  if (!intelQueue.length) return null;

  // Prefer items with different keys, and respect cooldowns
  let candidates = intelQueue.filter(it => it.key !== HUD_CONFIG.lastKey);

  // avoid spamming the same type too
  if (!candidates.length) candidates = intelQueue;

  // apply cooldown
  candidates = candidates.filter(it => {
    const last = Number(HUD_CONFIG.shownAt[it.key] || 0);
    const cd = Number(it.cooldownMs || 0);
    return !(cd > 0 && (Date.now() - last) < cd);
  });
  if (candidates.length) return weightedPick(candidates);

  // last resort
  return intelQueue[0];
}

function showNextIntel() {
  if (document.hidden) return;
  const item = pickNextItem();
  if (!item) return;

  HUD_CONFIG.lastKey = item.key || null;

  // remember history (prevents spam across refreshes)
  HUD_CONFIG.recentKeys.unshift(item.key);
  HUD_CONFIG.recentKeys = HUD_CONFIG.recentKeys.filter(Boolean).slice(0, 6);
  HUD_CONFIG.shownAt[item.key] = Date.now();
  hudMemSave();

  const msgEl = document.getElementById("hudMessage");
  const tagEl = document.getElementById("hudTag");
  const iconEl = document.getElementById("hudIcon");
  const subEl = document.getElementById("hudSubline");
  const boxEl = document.getElementById("hudBox");

  if (!msgEl || !tagEl || !iconEl) return;

  msgEl.style.opacity = "0.2";

  setTimeout(() => {
    if (document.hidden) return;
    msgEl.textContent = item.text;
    tagEl.textContent = item.tag;
    iconEl.innerHTML = item.icon || "⚡";

    if (subEl) subEl.textContent = item.subline || "";

    msgEl.classList.remove("hud-glitch");
    void msgEl.offsetWidth;
    msgEl.classList.add("hud-glitch");
    msgEl.style.opacity = "1";

    const c = COLORS[item.type] || COLORS.white;
    tagEl.style.color = c;
    tagEl.style.textShadow = `0 0 10px ${c}`;

    if (boxEl) boxEl.style.setProperty("--hud-accent", c);

    // FULL border ring progress (16s)
    animateHudRing(c);
  }, 220);
}

function pauseHudRotation() {
  if (HUD_CONFIG.timer) { clearInterval(HUD_CONFIG.timer); HUD_CONFIG.timer = null; }
  if (HUD_CONFIG.bootTimeout) { clearTimeout(HUD_CONFIG.bootTimeout); HUD_CONFIG.bootTimeout = null; }
}

function startHudRotation() {
  pauseHudRotation();
  HUD_CONFIG.pendingStart = false;

  // show first message after a delay (prevents instant “status spam” feeling)
  HUD_CONFIG.bootTimeout = setTimeout(() => {
    if (document.hidden) { HUD_CONFIG.pendingStart = true; return; }
    showNextIntel();
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
  }, 1200);
}

function resumeHudRotation() {
  if (!HUD_CONFIG.started) return;
  if (HUD_CONFIG.timer || HUD_CONFIG.bootTimeout) return;

  if (HUD_CONFIG.pendingStart) {
    startHudRotation();
    return;
  }

  // quick resume
  HUD_CONFIG.bootTimeout = setTimeout(() => {
    if (document.hidden) return;
    showNextIntel();
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
  }, 250);
}

function updateHud(data) {
  // Always rebuild queue (so refresh updates intelligence),
  // but DO NOT reset messages or restart timer.
  intelQueue = buildIntel(data);

  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true;
    initHudRing();

    if (!document.hidden) startHudRotation();
    else HUD_CONFIG.pendingStart = true;
  }
}

async function load(isFirst) {
  try {
    const data = await fetchJSON("/api/yt-kpis");
    if (data.error) throw new Error(data.error);
    render(data, isFirst);
  } catch (e) {
    document.getElementById("updated").textContent = "FETCH ERROR: " + e.message;
  }
}

// 3D Tilt (throttled to ~60fps via requestAnimationFrame)
const PREFERS_REDUCED_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

function attachTilt(card) {
  let raf = 0;
  let lastX = 0, lastY = 0;
  let hovering = false;

  function apply() {
    raf = 0;
    if (!hovering || document.hidden) return;
    card.style.transform = `perspective(1000px) rotateX(${lastX}deg) rotateY(${lastY}deg) scale(1.02)`;
  }

  card.addEventListener("mousemove", (e) => {
    if (PREFERS_REDUCED_MOTION || document.hidden) return;
    hovering = true;
    const r = card.getBoundingClientRect();
    lastX = ((e.clientY - r.top) / r.height - 0.5) * -10;
    lastY = ((e.clientX - r.left) / r.width - 0.5) * 10;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });

  card.addEventListener("mouseleave", () => {
    hovering = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale(1)`;
  });
}

if (!PREFERS_REDUCED_MOTION) {
  document.querySelectorAll(".card").forEach(attachTilt);
}

/* ===========================
   VISIBILITY + AUTO REFRESH
   =========================== */
const REFRESH_VISIBLE_MS = 60 * 1000;
const REFRESH_HIDDEN_MS = 4 * 60 * 1000; // 3–5 minutes while hidden

let refreshTimer = null;

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleNextRefresh(delayMs) {
  clearRefreshTimer();
  const ms = Number(delayMs) || (document.hidden ? REFRESH_HIDDEN_MS : REFRESH_VISIBLE_MS);

  refreshTimer = setTimeout(async () => {
    // While hidden we still refresh, but much slower.
    await load(false);
    scheduleNextRefresh();
  }, ms);
}

function handleVisibilityChange() {
  const hidden = document.hidden;

  // CSS cheap-mode (pauses continuous animations / heavy effects)
  document.documentElement.classList.toggle("is-hidden", hidden);

  if (hidden) {
    pauseHudRotation();
    scheduleNextRefresh(REFRESH_HIDDEN_MS);
  } else {
    // Catch up immediately when you come back
    load(false);
    resumeHudRotation();
    scheduleNextRefresh(REFRESH_VISIBLE_MS);
  }
}

document.addEventListener("visibilitychange", handleVisibilityChange);
document.documentElement.classList.toggle("is-hidden", document.hidden);

(async function init() {
  await load(true);
  scheduleNextRefresh();
})();
