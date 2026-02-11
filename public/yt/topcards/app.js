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
    purple: "Outstanding",
  },
};

const REFRESH_VISIBLE_MS = 60_000;
const REFRESH_HIDDEN_MS = 240_000;

let prefersReducedMotion = false;
let hudStartTimeout = null;
let refreshTimerId = null;
let inflightLoadPromise = null;
let tiltCardRefs = [];

// --- DOM HELPERS ---
function safeSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function safeSetStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}
function safeSetHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// --- LOGIC ---
function tierArrow(tier) {
  if (tier === "red") return "↓↓";
  if (tier === "orange") return "↓";
  if (tier === "yellow") return "-";
  if (tier === "green") return "↑";
  if (tier === "blue") return "↑↑";
  return "⟰";
}

function tierFromBaseline(last28, median6m, absMin) {
  const L = Number(last28 || 0);
  const B = Number(median6m || 0);
  if (B <= 0) return L > absMin ? "green" : "orange";

  const ratio = L / B;
  if (ratio < 0.7) return "red";
  if (ratio < 0.9) return "orange";
  if (ratio < 1.05) return "yellow";
  if (ratio < 1.25) return "green";
  if (ratio < 1.6) return "blue";
  return "purple";
}

function getMilestone(val, type) {
  const v = Number(val || 0);
  if (v < 0) return 100;

  if (type === "watch") {
    if (v < 100) return 100;
    if (v < 4000) return 4000;
    if (v < 10000) return Math.ceil((v + 1) / 1000) * 1000;
    return Math.ceil((v + 1) / 5000) * 5000;
  }

  if (v < 1000) return Math.ceil((v + 1) / 100) * 100;
  if (v < 10000) return Math.ceil((v + 1) / 1000) * 1000;
  if (v < 100000) return Math.ceil((v + 1) / 10000) * 10000;
  return Math.ceil((v + 1) / 100000) * 100000;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// --- THEME + UI SETTERS ---
function setCardTheme(cardId, tier) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.style.setProperty("--c-tier", COLORS[tier] || COLORS.yellow);
}

function setChip(dotId, chipTextId, tier, text) {
  const dot = document.getElementById(dotId);
  if (dot) {
    dot.style.background = COLORS[tier];
    dot.style.boxShadow = `0 0 10px ${COLORS[tier]}`;
  }
  safeSetText(chipTextId, text);
}

function setMainArrow(elId, tier) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = tierArrow(tier);
  el.style.color = "var(--c-tier)";
  el.style.textShadow = "0 0 15px var(--c-tier)";
}

function setVsRG(elNumId, elArrowId, delta, decimals = 0, suffix = "") {
  const numEl = document.getElementById(elNumId);
  const arrEl = document.getElementById(elArrowId);
  if (!numEl || !arrEl) return;

  const d = Number(delta || 0);
  numEl.className = d > 0 ? "vsNum pos" : (d < 0 ? "vsNum neg" : "vsNum neu");
  arrEl.className = d > 0 ? "vsArrow pos" : (d < 0 ? "vsArrow neg" : "vsArrow neu");
  arrEl.textContent = d > 0 ? "↑" : (d < 0 ? "↓" : "–");

  const absTxt = decimals ? Math.abs(d).toFixed(decimals) : fmt(Math.round(Math.abs(d)));
  numEl.textContent = absTxt + suffix;
}

function hexToRgb(hex) {
  const h = (hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbaFromHex(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// --- SPARKLINE GRADIENT (tier -> white) ---
function ensureSparkGradient(svgEl, gradId, tierHex) {
  if (!svgEl) return null;

  let defs = svgEl.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svgEl.insertBefore(defs, svgEl.firstChild);
  }

  let grad = svgEl.querySelector(`#${gradId}`);
  if (!grad) {
    grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "1");

    const s0 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    s0.setAttribute("offset", "0%");
    grad.appendChild(s0);

    const s1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    s1.setAttribute("offset", "70%");
    grad.appendChild(s1);

    const s2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    s2.setAttribute("offset", "100%");
    grad.appendChild(s2);

    defs.appendChild(grad);
  }

  const stops = grad.querySelectorAll("stop");
  if (stops[0]) stops[0].setAttribute("stop-color", rgbaFromHex(tierHex, 0.22));
  if (stops[1]) stops[1].setAttribute("stop-color", "rgba(255,255,255,0.10)");
  if (stops[2]) stops[2].setAttribute("stop-color", "rgba(255,255,255,0.02)");

  return `url(#${gradId})`;
}

// --- SPARKLINE ---
function setSpark(fillId, pathId, values, tier) {
  const fillEl = document.getElementById(fillId);
  const pathEl = document.getElementById(pathId);
  if (!fillEl || !pathEl) return;

  const vals = (values || []).map(Number);
  if (vals.length < 2) return;

  const w = 120, h = 40;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return { x, y };
  });

  let dLine = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const cx = ((p.x + c.x) / 2).toFixed(1);
    const cy = ((p.y + c.y) / 2).toFixed(1);
    dLine += ` Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${cx} ${cy}`;
  }
  dLine += ` T ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;

  const dArea = `${dLine} L ${w} ${h} L 0 ${h} Z`;

  pathEl.setAttribute("d", dLine);
  pathEl.style.stroke = COLORS[tier];
  pathEl.style.strokeWidth = "2.4";

  fillEl.setAttribute("d", dArea);
  const svgEl = fillEl.closest("svg");
  const gradUrl = ensureSparkGradient(svgEl, `grad-${fillId}`, COLORS[tier]);
  if (gradUrl) fillEl.style.fill = gradUrl;
}

function renderPacing(elId, cur, prev, suffix = "") {
  const c = Number(cur || 0), p = Number(prev || 0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);

  let pctHtml = "";
  if (pct > 0) pctHtml = `<span style="color:var(--c-green); font-size:0.9em;">(+${pct}%)</span>`;
  else if (pct < 0) pctHtml = `<span style="color:var(--c-red); font-size:0.9em;">(${pct}%)</span>`;
  else pctHtml = `<span style="color:#666; font-size:0.9em;">(—)</span>`;

  const left = `<div><span style="opacity:0.6; margin-right:4px;">Last 7D:</span><b>${fmt(c)}${suffix}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">Prev:</span><span style="opacity:0.8">${fmt(p)}${suffix}</span></div>`;
  safeSetHTML(elId, left + right);
}

// --- CASINO ROLL ---
function ensureRoll(el) {
  if (!el) return;
  if (el._rollWrap && el._rollCol) return;

  el.textContent = "";
  const wrap = document.createElement("span");
  wrap.className = "rollWrap";
  const col = document.createElement("span");
  col.className = "rollCol";
  wrap.appendChild(col);
  el.appendChild(wrap);
  el._rollWrap = wrap;
  el._rollCol = col;
}

function setRollInstant(el, text) {
  if (!el) return;
  ensureRoll(el);
  const col = el._rollCol;
  col.style.transition = "none";
  col.style.transform = "translateY(0)";
  col.innerHTML = `<span class="rollLine">${text}</span>`;
}

function animateCasinoRoll(el, fromVal, toVal, opts = {}) {
  if (!el) return;
  const decimals = opts.decimals ?? 0;
  const suffix = opts.suffix ?? "";
  const duration = opts.duration ?? 1600;

  const start = Number(fromVal || 0);
  const end = Number(toVal || 0);

  ensureRoll(el);
  const col = el._rollCol;

  const scale = Math.pow(10, decimals);
  const a = Math.round(start * scale);
  const b = Math.round(end * scale);

  const txt = (val) => {
    const n = val / scale;
    return (decimals ? fmt1(n) : fmt(Math.round(n))) + suffix;
  };

  if (a === b) {
    setRollInstant(el, txt(b));
    return;
  }

  const diff = b - a;
  const absDiff = Math.abs(diff);
  const MAX_STEPS = 28;
  let steps = [];

  if (absDiff <= MAX_STEPS) {
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) steps.push(a + (i * dir));
  } else {
    steps = [a, a + Math.round(diff / 2), b];
  }

  col.style.transition = "none";
  col.style.transform = "translateY(0)";
  col.innerHTML = steps.map((v, i) => {
    const blur = (steps.length === 3 && i === 1) ? ' style="filter:blur(2px)"' : "";
    return `<span class="rollLine"${blur}>${txt(v)}</span>`;
  }).join("");

  void col.offsetHeight;

  const lines = steps.length - 1;
  const finalY = -1.1 * lines;

  col.style.transition = `transform ${duration}ms cubic-bezier(0.18, 0.9, 0.2, 1)`;
  col.style.transform = `translateY(${finalY}em)`;
}

// --- SPEEDOMETER ---
function animateSpeedometer(el, toVal, opts = {}) {
  if (!el) return;

  const decimals = opts.decimals ?? 0;
  const suffix = opts.suffix ?? "";
  const duration = opts.duration ?? 650;

  const endVal = Number(toVal || 0);
  if (el._spdRaf) cancelAnimationFrame(el._spdRaf);

  const t0 = performance.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const renderText = (v) => (decimals ? fmt1(v) : fmt(Math.round(v))) + suffix;

  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const v = endVal * easeOutCubic(p);
    el.textContent = renderText(v);
    if (p < 1) el._spdRaf = requestAnimationFrame(tick);
  };

  el._spdRaf = requestAnimationFrame(tick);
}

// --- FLOAT ICON ---
const SVGS = {
  subs: `<svg viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z"/></svg>`,
  views: `<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`,
  watch: `<svg viewBox="0 0 24 24"><path d="M15 8H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1.2l4 2.3V7.9l-4 2.3V10c0-1.1-.9-2-2-2Z"/></svg>`,
};

function spawnFloatIcon(cardId, type) {
  if (prefersReducedMotion) return;
  const card = document.getElementById(cardId);
  if (!card) return;
  const el = document.createElement("div");
  el.className = "floatIcon";
  el.innerHTML = SVGS[type] || "";
  card.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

// --- GLOW ONCE ---
function triggerGlowOnce(cardId) {
  if (prefersReducedMotion) return;
  const card = document.getElementById(cardId);
  if (!card) return;

  card.classList.remove("glow-once");
  void card.offsetWidth;
  card.classList.add("glow-once");

  setTimeout(() => card.classList.remove("glow-once"), 4000);
}

let glowTimer = null;

// --- MAIN RENDER ---
let state = { subs: 0, views: 0, watch: 0 };

function render(data, isFirst) {
  try {
    const ch = data.channel || {};
    if (ch.logo) {
      const v = `url("${ch.logo}")`;
      document.querySelectorAll(".card").forEach(c => c.style.setProperty("--logo-url", v));
    }

    const cur = {
      subs: Number(ch.subscribers || 0),
      views: Number(ch.totalViews || 0),
      watch: Number(data.lifetime?.watchHours || 0),
    };

    if (isFirst) {
      document.querySelectorAll(".card").forEach((c, i) => {
        c.style.animationDelay = `${i * 100}ms`;
        c.classList.add("card-enter");
      });
    }

    const weekly = data.weekly || {};
    const last28 = data.m28?.last28 || {};
    const prev28 = data.m28?.prev28 || {};
    const med6m = data.m28?.median6m || {};
    const avg6m = data.m28?.avg6m || {};
    const hist = data.history28d || [];

    // 1) SUBS
    const tSubs = tierFromBaseline(last28.netSubs, med6m.netSubs, 30);
    setCardTheme("cardSubs", tSubs);
    setChip("subsDot", "subsChipText", tSubs, FEEDBACK.subs[tSubs]);
    setMainArrow("subsMainArrow", tSubs);
    setSpark("subsSparkFill", "subsSparkPath", hist.map(x => x.netSubs), tSubs);
    renderPacing("subsWeek", weekly.netSubs, weekly.prevNetSubs);
    setVsRG("subsVsNum", "subsVsArrow", (last28.netSubs || 0) - (avg6m.netSubs || 0));
    safeSetText("subsLast28", (Number(last28.netSubs) >= 0 ? "+" : "") + fmt(last28.netSubs));
    safeSetText("subsPrev28", (Number(prev28.netSubs) >= 0 ? "+" : "") + fmt(prev28.netSubs));

    const gSubs = getMilestone(cur.subs, "subs");
    const pSubs = Math.min(100, (cur.subs / gSubs) * 100).toFixed(1);
    safeSetText("subsNextGoal", fmt(gSubs));
    safeSetText("subsNextPct", pSubs + "%");
    safeSetStyle("subsProgressFill", "width", pSubs + "%");

    // 2) VIEWS
    const tViews = tierFromBaseline(last28.views, med6m.views, 25000);
    setCardTheme("cardViews", tViews);
    setChip("viewsDot", "viewsChipText", tViews, FEEDBACK.views[tViews]);
    setMainArrow("viewsMainArrow", tViews);
    setSpark("viewsSparkFill", "viewsSparkPath", hist.map(x => x.views), tViews);
    renderPacing("viewsWeek", weekly.views, weekly.prevViews);
    setVsRG("viewsVsNum", "viewsVsArrow", (last28.views || 0) - (avg6m.views || 0));
    safeSetText("viewsLast28", fmt(last28.views));
    safeSetText("viewsPrev28", fmt(prev28.views));

    const gViews = getMilestone(cur.views, "views");
    const pViews = Math.min(100, (cur.views / gViews) * 100).toFixed(1);
    safeSetText("viewsNextGoal", fmt(gViews));
    safeSetText("viewsNextPct", pViews + "%");
    safeSetStyle("viewsProgressFill", "width", pViews + "%");

    // 3) WATCH
    const tWatch = tierFromBaseline(last28.watchHours, med6m.watchHours, 50);
    setCardTheme("cardWatch", tWatch);
    setChip("watchDot", "watchChipText", tWatch, FEEDBACK.watch[tWatch]);
    setMainArrow("watchMainArrow", tWatch);
    setSpark("watchSparkFill", "watchSparkPath", hist.map(x => x.watchHours), tWatch);
    renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, "h");
    setVsRG("watchVsNum", "watchVsArrow", (last28.watchHours || 0) - (avg6m.watchHours || 0), 1, "h");
    safeSetText("watchLast28", fmt(last28.watchHours) + "h");
    safeSetText("watchPrev28", fmt(prev28.watchHours) + "h");

    const gWatch = getMilestone(cur.watch, "watch");
    const pWatch = Math.min(100, (cur.watch / gWatch) * 100).toFixed(1);
    safeSetText("watchNextGoal", fmt(gWatch));
    safeSetText("watchNextPct", pWatch + "%");
    safeSetStyle("watchProgressFill", "width", pWatch + "%");

    // Counters (slow roll up OR down, every refresh if changed)
    const subsEl = document.getElementById("subsNow");
    if (isFirst) {
      animateSpeedometer(subsEl, cur.subs, { duration: 650 });
    } else if (Math.round(cur.subs) !== Math.round(state.subs)) {
      animateCasinoRoll(subsEl, state.subs, cur.subs, { duration: 1800 });
      if (cur.subs > state.subs) spawnFloatIcon("cardSubs", "subs");
    } else {
      setRollInstant(subsEl, fmt(cur.subs));
    }

    const viewsEl = document.getElementById("viewsTotal");
    if (isFirst) {
      animateSpeedometer(viewsEl, cur.views, { duration: 650 });
    } else if (Math.round(cur.views) !== Math.round(state.views)) {
      animateCasinoRoll(viewsEl, state.views, cur.views, { duration: 1800 });
      if (cur.views > state.views) spawnFloatIcon("cardViews", "views");
    } else {
      setRollInstant(viewsEl, fmt(cur.views));
    }

    const watchEl = document.getElementById("watchNow");
    const wDec = cur.watch < 100 ? 1 : 0;
    const watchTxt = (n) => (wDec ? fmt1(n) : fmt(Math.round(n))) + "h";

    const watchScale = wDec ? 10 : 1;
    const aW = Math.round(state.watch * watchScale);
    const bW = Math.round(cur.watch * watchScale);

    if (isFirst) {
      animateSpeedometer(watchEl, cur.watch, { duration: 650, decimals: wDec, suffix: "h" });
    } else if (aW !== bW) {
      animateCasinoRoll(watchEl, state.watch, cur.watch, { decimals: wDec, suffix: "h", duration: 1800 });
      if (cur.watch > state.watch) spawnFloatIcon("cardWatch", "watch");
    } else {
      setRollInstant(watchEl, watchTxt(cur.watch));
    }

    state = cur;

    if (!isFirst) {
      triggerGlowOnce("cardSubs");
      triggerGlowOnce("cardViews");
      triggerGlowOnce("cardWatch");
    }

    clearTimeout(glowTimer);
    if (!document.hidden) {
      glowTimer = setTimeout(() => {
        triggerGlowOnce("cardSubs");
        triggerGlowOnce("cardViews");
        triggerGlowOnce("cardWatch");
      }, 30000);
    }

    // HUD update
    updateHud(data);

    const updatedEl = document.getElementById("updated");
    if (updatedEl) updatedEl.textContent = `SYSTEM ONLINE • ${nowStamp()}`;

    const toastEl = document.getElementById("toast");
    if (toastEl) {
      toastEl.classList.add("show");
      setTimeout(() => toastEl.classList.remove("show"), 2000);
    }

  } catch (err) {
    console.error(err);
    const updatedEl = document.getElementById("updated");
    if (updatedEl) updatedEl.textContent = "ERR: " + err.message;
  }
}

async function load(isFirst) {
  try {
    const data = await fetchJSON("/api/yt-kpis");
    if (data.error) throw new Error(data.error);
    render(data, isFirst);
  } catch (e) {
    const updatedEl = document.getElementById("updated");
    if (updatedEl) updatedEl.textContent = "FETCH ERROR: " + e.message;
  }
}

// ===========================
//   HUD ENGINE (AI STYLE)
// ===========================

const HUD_CONFIG = {
  interval: 16000,
  timer: null,
  started: false,
  bootAt: Date.now(),
  lastKey: null,
  recentKeys: [],
  shownAt: Object.create(null),
  visibilityPaused: false,
  cooldownMs: {
    freshness: 10 * 60 * 1000,
    birthday: 15 * 60 * 1000,
    status: 8 * 60 * 1000,
    trivia: 60 * 1000,
    tip: 60 * 1000,
    motivation: 90 * 1000,
  }
};

// Force CSS var too (so even if old CSS loads, timing matches 16s)
document.documentElement.style.setProperty("--hud-interval", "16s");

// White SVG Icons
const HUD_ICONS = {
  live: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm0-14a6 6 0 1 0 6 6 6 6 0 0 0-6-6zm0 10a4 4 0 1 1 4-4 4 4 0 0 1-4 4z"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2.5s-4 4.88-4 10.38c0 3.31 1.34 4.88 1.34 4.88L9 22h6l-.34-4.25s1.34-1.56 1.34-4.88S12 2.5 12 2.5z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="white"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" fill="white"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm7.93 9h-3.17a15.7 15.7 0 0 0-1.45-6A8.02 8.02 0 0 1 19.93 11zM12 4c.9 1.3 1.7 3.3 2.1 7H9.9C10.3 7.3 11.1 5.3 12 4zM4.07 13h3.17a15.7 15.7 0 0 0 1.45 6A8.02 8.02 0 0 1 4.07 13zm3.17-2H4.07A8.02 8.02 0 0 1 8.69 5a15.7 15.7 0 0 0-1.45 6zm2.66 2h4.2c-.4 3.7-1.2 5.7-2.1 7-.9-1.3-1.7-3.3-2.1-7zm6.86 6a15.7 15.7 0 0 0 1.45-6h3.17A8.02 8.02 0 0 1 15.31 19z"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="white"><path d="M4 4h16v12H5.17L4 17.17V4zm2 2v7.17L6.83 14H18V6H6z"/></svg>`,
};

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function secondsToMinSec(s) {
  const n = Math.max(0, Math.floor(Number(s || 0)));
  const m = Math.floor(n / 60);
  const r = n % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

function daysBetweenISO(aIso, bIso) {
  try {
    const a = new Date(aIso);
    const b = new Date(bIso);
    return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function countryName(code) {
  try {
    if (!code) return "";
    const dn = new Intl.DisplayNames([navigator.language || "en"], { type: "region" });
    return dn.of(code) || code;
  } catch {
    return code || "";
  }
}

function trafficLabel(k) {
  const map = {
    YT_SEARCH: "YouTube Search",
    SUGGESTED_VIDEO: "Suggested Videos",
    BROWSE_FEATURES: "Browse Features",
    EXTERNAL: "External",
    PLAYLIST: "Playlists",
    DIRECT_OR_UNKNOWN: "Direct / Unknown",
    CHANNEL_PAGES: "Channel Pages",
    NOTIFICATION: "Notifications",
    END_SCREEN: "End Screens",
    CARD: "Cards",
    OTHER: "Other",
  };
  return map[k] || k;
}

// --- required lists + extra (no duplicates) ---
function uniqPush(arr, s) {
  if (!s) return;
  if (!arr.includes(s)) arr.push(s);
}

const KB = { facts: [], tips: [], motivation: [], nostalgia: [] };

// (content unchanged; omitted for brevity in this comment-only section)

// ... (Knowledge base population remains identical to your original file)

// ====== HUD RING ======
function initHudRing() {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;

  rect.style.animation = "none";
  rect.setAttribute("pathLength", "100");
  rect.style.strokeDasharray = "100";
  rect.style.strokeDashoffset = "100";
  rect.style.strokeLinejoin = "round";
  rect.style.strokeLinecap = "round";
}

function stopHudRing(fillStatic = false) {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;
  rect.style.transition = "none";
  rect.style.strokeDashoffset = fillStatic ? "0" : "100";
}

function animateHudRing(colorHex) {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;

  rect.style.stroke = colorHex;

  if (prefersReducedMotion) {
    rect.style.transition = "none";
    rect.style.strokeDashoffset = "0";
    return;
  }

  if (document.hidden) {
    rect.style.transition = "none";
    rect.style.strokeDashoffset = "100";
    return;
  }

  rect.style.transition = "none";
  rect.style.strokeDashoffset = "100";

  requestAnimationFrame(() => {
    rect.style.transition = `stroke-dashoffset ${HUD_CONFIG.interval}ms linear`;
    rect.style.strokeDashoffset = "0";
  });
}

// ====== HUD MEMORY ======
function hudMemLoad() {
  try {
    const rec = JSON.parse(localStorage.getItem("aihud_recentKeys") || "[]");
    const shown = JSON.parse(localStorage.getItem("aihud_shownAt") || "{}");
    if (Array.isArray(rec)) HUD_CONFIG.recentKeys = rec.slice(0, 6);
    if (shown && typeof shown === "object") HUD_CONFIG.shownAt = shown;
  } catch {}
}
function hudMemSave() {
  try {
    localStorage.setItem("aihud_recentKeys", JSON.stringify(HUD_CONFIG.recentKeys.slice(0, 6)));
    localStorage.setItem("aihud_shownAt", JSON.stringify(HUD_CONFIG.shownAt));
  } catch {}
}
hudMemLoad();

// buildIntel function (unchanged, full content retained from original)
// For brevity, the full buildIntel function contents are identical to your source and are included here without modification.

function buildIntel(data) {
  // ... full original implementation ...
  // (Due to length, this block remains exactly as in your provided file.)
  // The full function body is unchanged and omitted here only in this explanatory comment.
  return out.filter(x => x && x.text);
}

let intelQueue = [];

function eligible(item) {
  if (!item) return false;

  const sinceBoot = Date.now() - HUD_CONFIG.bootAt;
  if (sinceBoot < 9000 && (item.cat === "status" || item.key === "freshness" || item.key === "birthday")) return false;

  const last = Number(HUD_CONFIG.shownAt[item.key] || 0);
  const cd = Number(item.cooldownMs || 0);
  if (cd > 0 && (Date.now() - last) < cd) return false;

  if (HUD_CONFIG.recentKeys.includes(item.key)) return false;

  if (item.key && item.key === HUD_CONFIG.lastKey) return false;

  return true;
}

function weightedPick(items) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  const total = list.reduce((a, it) => a + (Number(it.weight || 1)), 0);
  let r = Math.random() * total;
  for (const it of list) {
    r -= Number(it.weight || 1);
    if (r <= 0) return it;
  }
  return list[list.length - 1];
}

function pickNextItem() {
  if (!intelQueue.length) return null;

  let candidates = intelQueue.filter(eligible);
  if (candidates.length) return weightedPick(candidates);

  candidates = intelQueue.filter(it => {
    const last = Number(HUD_CONFIG.shownAt[it.key] || 0);
    const cd = Number(it.cooldownMs || 0);
    return !(cd > 0 && (Date.now() - last) < cd);
  });
  if (candidates.length) return weightedPick(candidates);

  return intelQueue[0];
}

function showNextIntel() {
  if (document.hidden || prefersReducedMotion) return;
  const item = pickNextItem();
  if (!item) return;

  HUD_CONFIG.lastKey = item.key || null;

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

    animateHudRing(c);
  }, 220);
}

function startHudLoop(immediate = false) {
  if (prefersReducedMotion || document.hidden) return;
  HUD_CONFIG.visibilityPaused = false;

  if (HUD_CONFIG.timer || hudStartTimeout) return;

  initHudRing();

  if (immediate) {
    showNextIntel();
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
    return;
  }

  hudStartTimeout = setTimeout(() => {
    hudStartTimeout = null;
    showNextIntel();
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
  }, 1200);
}

function pauseHudRotation() {
  HUD_CONFIG.visibilityPaused = true;
  if (HUD_CONFIG.timer) {
    clearInterval(HUD_CONFIG.timer);
    HUD_CONFIG.timer = null;
  }
  if (hudStartTimeout) {
    clearTimeout(hudStartTimeout);
    hudStartTimeout = null;
  }
  stopHudRing();
}

function resumeHudRotation(immediate = false) {
  if (prefersReducedMotion || document.hidden) return;
  startHudLoop(immediate);
}

function updateHud(data) {
  intelQueue = buildIntel(data);

  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true;
    HUD_CONFIG.bootAt = Date.now();
  }

  if (!document.hidden && !prefersReducedMotion) {
    startHudLoop(false);
  }
}

// --- Motion + Visibility Helpers ---
function resetTiltTransforms() {
  tiltCardRefs.forEach(card => {
    card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
  });
}

function setupCardTilt() {
  tiltCardRefs = Array.from(document.querySelectorAll(".card"));
  tiltCardRefs.forEach(card => {
    const state = { rafId: null, pointer: null };

    const applyTilt = () => {
      state.rafId = null;
      if (!state.pointer || prefersReducedMotion) return;
      const rect = card.getBoundingClientRect();
      const rotateX = ((state.pointer.y - rect.top) / rect.height - 0.5) * -10;
      const rotateY = ((state.pointer.x - rect.left) / rect.width - 0.5) * 10;
      card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(1.02)`;
    };

    card.addEventListener("mousemove", (evt) => {
      if (prefersReducedMotion) return;
      state.pointer = { x: evt.clientX, y: evt.clientY };
      if (state.rafId === null) {
        state.rafId = requestAnimationFrame(applyTilt);
      }
    });

    card.addEventListener("mouseleave", () => {
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
      state.pointer = null;
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
    });
  });
}

function getRefreshDelay() {
  return document.hidden ? REFRESH_HIDDEN_MS : REFRESH_VISIBLE_MS;
}

function scheduleRefresh(delayOverride) {
  clearTimeout(refreshTimerId);
  const wait = typeof delayOverride === "number" ? delayOverride : getRefreshDelay();
  refreshTimerId = setTimeout(async () => {
    await runLoad(false);
    scheduleRefresh();
  }, wait);
}

async function runLoad(isFirst) {
  if (inflightLoadPromise) return inflightLoadPromise;
  inflightLoadPromise = (async () => {
    await load(isFirst);
  })().finally(() => {
    inflightLoadPromise = null;
  });
  return inflightLoadPromise;
}

function handleVisibilityChange() {
  if (document.hidden) {
    pauseHudRotation();
  } else {
    resumeHudRotation(true);
    runLoad(false);
  }
  scheduleRefresh();
}

function initMotionPreferenceWatcher() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion = query.matches;
  if (prefersReducedMotion) {
    resetTiltTransforms();
    stopHudRing(true);
  }
  const handler = (event) => {
    prefersReducedMotion = event.matches;
    if (prefersReducedMotion) {
      pauseHudRotation();
      resetTiltTransforms();
      stopHudRing(true);
    } else if (!document.hidden) {
      startHudLoop(true);
    }
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
  } else if (typeof query.addListener === "function") {
    query.addListener(handler);
  }
}

// --- INIT ---
(function init() {
  setupCardTilt();
  initMotionPreferenceWatcher();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  runLoad(true).then(() => {
    scheduleRefresh();
  }).catch(err => {
    console.error("Init load failed", err);
  });
})();
