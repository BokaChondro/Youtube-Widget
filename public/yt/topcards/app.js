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

// --- CASINO ROLL (SLOWER + WORKS FOR UP OR DOWN) ---
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
  const duration = opts.duration ?? 1600; // slower by default

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

  // build step list, but cap it to keep UI smooth
  const MAX_STEPS = 28;
  let steps = [];

  if (absDiff <= MAX_STEPS) {
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) steps.push(a + (i * dir));
  } else {
    // for big jumps, use “blur middle” trick
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
    glowTimer = setTimeout(() => {
      triggerGlowOnce("cardSubs");
      triggerGlowOnce("cardViews");
      triggerGlowOnce("cardWatch");
    }, 30000);

    // HUD update
    updateHud(data);

    document.getElementById("updated").textContent = `SYSTEM ONLINE • ${nowStamp()}`;
    document.getElementById("toast").classList.add("show");
    setTimeout(() => document.getElementById("toast").classList.remove("show"), 2000);

  } catch (err) {
    console.error(err);
    document.getElementById("updated").textContent = "ERR: " + err.message;
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

// 3D Tilt
document.querySelectorAll(".card").forEach(card => {
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    const x = ((e.clientY - r.top) / r.height - 0.5) * -10;
    const y = ((e.clientX - r.left) / r.width - 0.5) * 10;
    card.style.transform = `perspective(1000px) rotateX(${x}deg) rotateY(${y}deg) scale(1.02)`;
  });
  card.addEventListener("mouseleave", () => {
    card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale(1)`;
  });
});

/* ===========================
   HUD ENGINE (AI STYLE)
   =========================== */

const HUD_CONFIG = {
  interval: 16000, // MUST be 16s
  timer: null,
  started: false,
  bootAt: Date.now(),
  lastKey: null,
  recentKeys: [],
  shownAt: Object.create(null),
  // cooldowns to stop “status” spamming
  cooldownMs: {
    freshness: 10 * 60 * 1000,   // 10 min
    birthday: 15 * 60 * 1000,    // 15 min
    status: 8 * 60 * 1000,       // 8 min
    trivia: 60 * 1000,           // 1 min (still ok)
    tip: 60 * 1000,              // 1 min
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

// REQUIRED
[
  "YouTube is the 2nd most visited site in existence.",
  "The first video 'Me at the zoo' has over 200M views.",
  "Mobile users visit YouTube twice as often as desktop users.",
  "Comedy, Music, and Entertainment/Pop Culture are the top 3 genres.",
  "YouTube supports over 80 different languages.",
  "The average mobile viewing session lasts more than 40 minutes.",
  "More than 500 hours of video are uploaded every minute.",
  "YouTube's algorithm favors 'Watch Time' over 'View Count'.",
  "Thumbnails with bright backgrounds tend to have higher CTR.",
  "60% of people prefer online video platforms to live TV.",
  "The most searched term on YouTube is usually 'Song' or 'Movie'.",
  "YouTubers who post weekly see 30% more growth on average.",
  "Collaborations can boost channel growth by up to 50%."
].forEach(x => uniqPush(KB.facts, x));

[
  "Audio is King: Bad video is forgiveable, bad audio is not.",
  "Hook 'em: The first 5 seconds determine retention.",
  "Metadata: Put your target keyword in the first sentence of your description.",
  "Community: Hearting comments brings viewers back.",
  "End Screens: Always link to a 'Best for Viewer' video.",
  "Lighting: A cheap ring light beats a $2000 camera in the dark.",
  "Playlists: Grouping videos increases 'Session Time'.",
  "Shorts: Use them as a funnel to your long-form content.",
  "Pacing: Cut out the silence. Keep the energy moving.",
  "CTA: Ask for the sub AFTER you've provided value, not before.",
  "Thumbnails: Use the 'Rule of Thirds' for composition.",
  "Storytelling: Every video needs a Beginning, Middle, and End."
].forEach(x => uniqPush(KB.tips, x));

[
  "Creation is a marathon, not a sprint. Pace yourself.",
  "Your next video could be the one that changes everything.",
  "Don't compare your Chapter 1 to someone else's Chapter 20.",
  "The algorithm can't ignore quality forever.",
  "1,000 true fans are better than 100,000 ghosts.",
  "Grind in silence, let your analytics make the noise.",
  "Every 'No' from a viewer brings you closer to a 'Yes'.",
  "Consistency is the cheat code.",
  "You are building a legacy, one upload at a time.",
  "Focus on the 1 viewer watching, not the 1M who aren't."
].forEach(x => uniqPush(KB.motivation, x));

[
  "Remember why you started? Keep that spark alive.",
  "Look at your first video. Look at you now. Progress.",
  "Every big channel started with 0 subscribers.",
  "Think back to your first comment. That feeling matters."
].forEach(x => uniqPush(KB.nostalgia, x));

// Extra (safe + simple)
[
  "Changing only the thumbnail and title can sometimes revive an older video.",
  "Videos that keep viewers watching longer often get recommended more.",
  "A clear thumbnail and clear title usually beats a complicated design.",
].forEach(x => uniqPush(KB.facts, x));

[
  "Pick ONE thing to improve next video: intro, pacing, title, or thumbnail.",
  "Use a pinned comment to guide viewers to the next best video.",
  "Add chapters on longer videos so viewers can jump to the good parts.",
].forEach(x => uniqPush(KB.tips, x));

[
  "Small progress every week beats one big burst and then stopping.",
  "One strong idea, executed well, can beat ten random uploads.",
].forEach(x => uniqPush(KB.motivation, x));

function pick(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ====== HUD RING (FULL RECT, ALWAYS) ======
function initHudRing() {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;

  // disable any CSS animation that might be present (prevents “bottom only” bug)
  rect.style.animation = "none";

  // normalized length => full border fill always works
  rect.setAttribute("pathLength", "100");
  rect.style.strokeDasharray = "100";
  rect.style.strokeDashoffset = "100";
  rect.style.strokeLinejoin = "round";
  rect.style.strokeLinecap = "round";
}

function animateHudRing(colorHex) {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;

  rect.style.stroke = colorHex;

  // reset to empty
  rect.style.transition = "none";
  rect.style.strokeDashoffset = "100";

  // animate to full
  requestAnimationFrame(() => {
    rect.style.transition = `stroke-dashoffset ${HUD_CONFIG.interval}ms linear`;
    rect.style.strokeDashoffset = "0";
  });
}

// ====== HUD MEMORY (stops spam across refreshes) ======
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

// ====== BUILD INTEL (clear English, not short/cryptic) ======
function buildIntel(data) {
  const out = [];
  const ch = data.channel || {};
  const w = data.weekly || {};
  const m28 = data.m28 || {};
  const hist = data.history28d || [];
  const hud = data.hud || {};

  const title = ch.title || "your channel";

  const weekViews = Number(w.views || 0);
  const weekMin = Number(w.minutesWatched || 0);
  const weekG = Number(w.subscribersGained || 0);
  const weekL = Number(w.subscribersLost || 0);
  const weekNet = Number(w.netSubs || 0);

  const last28Views = Number(m28.last28?.views || 0);
  const prev28Views = Number(m28.prev28?.views || 0);
  const last28Subs = Number(m28.last28?.netSubs || 0);
  const prev28Subs = Number(m28.prev28?.netSubs || 0);
  const last28Watch = Number(m28.last28?.watchHours || 0);
  const prev28Watch = Number(m28.prev28?.watchHours || 0);

  const avg6mViews = Number(m28.avg6m?.views || 0);
  const avg6mSubs = Number(m28.avg6m?.netSubs || 0);

  // requested derived signals
  const churnPct = weekG > 0 ? Math.round((weekL / weekG) * 100) : (weekL > 0 ? 100 : 0);
  const minsPerView = weekViews > 0 ? (weekMin / weekViews) : 0;
  const subsPer1k = weekViews > 0 ? (weekNet / weekViews) * 1000 : 0;

  const usualWeekViews = avg6mViews > 0 ? (avg6mViews / 4) : 0;
  const usualWeekSubs = avg6mSubs > 0 ? (avg6mSubs / 4) : 0;
  const weekVsUsualViewsPct = usualWeekViews > 0 ? Math.round(((weekViews - usualWeekViews) / usualWeekViews) * 100) : 0;

  // momentum streaks (last 3 windows)
  const winViews = hist.slice(0, 3).map(x => Number(x.views || 0));
  const viewsUpStreak = (winViews.length === 3 && winViews[0] > winViews[1] && winViews[1] > winViews[2]);
  const viewsDownStreak = (winViews.length === 3 && winViews[0] < winViews[1] && winViews[1] < winViews[2]);

  // volatility (previous 6 windows)
  const prev6Views = hist.slice(1, 7).map(x => Number(x.views || 0)).filter(Number.isFinite);
  const vMax = prev6Views.length ? Math.max(...prev6Views) : 0;
  const vMin = prev6Views.length ? Math.min(...prev6Views) : 0;
  const volatility = (vMin > 0) ? (vMax / vMin) : 0;

  // upload gap (based on statsThrough)
  const statsThrough = hud.statsThrough || w.endDate || "";
  const latestUpload = hud.uploads?.latest || null;
  const recentUploads = hud.uploads?.recent || [];
  let uploadDaysAgo = null;
  if (latestUpload?.publishedAt && statsThrough) {
    uploadDaysAgo = daysBetweenISO(latestUpload.publishedAt, statsThrough);
  }

  // CTR/Retention (optional)
  const thumb = hud.thumb28 || null;
  const ret = hud.retention28 || null;
  const trafficLast = hud.traffic?.last28 || null;
  const trafficPrev = hud.traffic?.prev28 || null;
  const subStatus = hud.subscribedStatus || null;
  const countries = hud.countries || null;

  // Videos (available from your API output)
  const latestVideo = hud.latestVideo || null;
  const top7 = hud.topVideo7d || null;

  // helper: push intel
  function add(item) {
    if (!item || !item.text) return;
    out.push(item);
  }

  // --- Priority: REAL channel signals first (so you actually SEE them) ---

  // Upload cadence
  if (uploadDaysAgo !== null && uploadDaysAgo > 14) {
    add({
      key: "warn_upload_gap",
      cat: "warning",
      weight: 3.0,
      cooldownMs: 10 * 60 * 1000,
      icon: HUD_ICONS.warn,
      tag: "Warning",
      type: "orange",
      text: `Upload buffer looks empty. Your last upload was about ${uploadDaysAgo} days ago. A fresh video can help wake up both your viewers and the algorithm.`,
      subline: latestUpload?.title ? `Last upload: "${latestUpload.title}"` : "",
    });
  } else if (uploadDaysAgo !== null && uploadDaysAgo <= 3) {
    add({
      key: "good_upload_recent",
      cat: "good",
      weight: 2.2,
      cooldownMs: 5 * 60 * 1000,
      icon: HUD_ICONS.up,
      tag: "Good",
      type: "green",
      text: `Nice pacing. You uploaded about ${uploadDaysAgo} days ago. Consistency helps your audience remember you and return more often.`,
      subline: latestUpload?.title ? `Latest upload: "${latestUpload.title}"` : "",
    });
  }

  // Weekly churn / gained vs lost
  if (weekG > 0 || weekL > 0) {
    const tone = (weekL > weekG) ? "red" : (weekNet >= 0 ? "green" : "orange");
    const icon = (weekL > weekG) ? HUD_ICONS.down : HUD_ICONS.up;
    const netWord = weekNet >= 0 ? `net +${fmt(weekNet)}` : `net -${fmt(Math.abs(weekNet))}`;
    add({
      key: "subs_churn",
      cat: "subs",
      weight: 3.2,
      cooldownMs: 2 * 60 * 1000,
      icon,
      tag: "Subs",
      type: tone,
      text: `This week you gained ${fmt(weekG)} subscribers and lost ${fmt(weekL)}. That means ${netWord}. Churn is about ${churnPct}% (lower is better).`,
      subline: `Gained ${fmt(weekG)} • Lost ${fmt(weekL)} • Net ${weekNet >= 0 ? "+" : "-"}${fmt(Math.abs(weekNet))}`,
    });
  }

  // Minutes per view
  if (weekViews > 0 && weekMin > 0) {
    const tone = minsPerView >= 1.2 ? "green" : (minsPerView >= 0.6 ? "yellow" : "orange");
    add({
      key: "mins_per_view",
      cat: "retention",
      weight: 2.7,
      cooldownMs: 2 * 60 * 1000,
      icon: HUD_ICONS.live,
      tag: "Retention",
      type: tone,
      text: `Viewer time quality: you are getting about ${minsPerView.toFixed(2)} minutes watched per view this week. Improving the first 10 seconds can push this higher.`,
      subline: `Minutes watched: ${fmt(Math.round(weekMin))} • Views: ${fmt(weekViews)}`,
    });
  }

  // Subs per 1k views
  if (weekViews > 0) {
    const tone = subsPer1k >= 2 ? "green" : (subsPer1k >= 0.8 ? "yellow" : "orange");
    const sTxt = subsPer1k >= 0 ? subsPer1k.toFixed(2) : `-${Math.abs(subsPer1k).toFixed(2)}`;
    add({
      key: "subs_per_1k",
      cat: "conversion",
      weight: 2.6,
      cooldownMs: 2 * 60 * 1000,
      icon: HUD_ICONS.target,
      tag: "Conversion",
      type: tone,
      text: `Subscriber conversion: you earned about ${sTxt} net subscribers per 1,000 views this week. A clear “subscribe if this helped” right after the best moment can lift it.`,
      subline: `Net subs: ${weekNet >= 0 ? "+" : "-"}${fmt(Math.abs(weekNet))} • Views: ${fmt(weekViews)}`,
    });
  }

  // Usual week vs this week
  if (usualWeekViews > 0 && weekViews > 0) {
    const tone = weekVsUsualViewsPct >= 10 ? "green" : (weekVsUsualViewsPct <= -10 ? "orange" : "yellow");
    const sign = weekVsUsualViewsPct >= 0 ? "+" : "";
    add({
      key: "usual_vs_week",
      cat: "baseline",
      weight: 2.4,
      cooldownMs: 3 * 60 * 1000,
      icon: weekVsUsualViewsPct >= 0 ? HUD_ICONS.up : HUD_ICONS.down,
      tag: "Baseline",
      type: tone,
      text: `Compared to your usual week, your views are ${sign}${weekVsUsualViewsPct}% right now. Your usual week is about ${fmt(Math.round(usualWeekViews))} views.`,
      subline: `This week: ${fmt(weekViews)} • Usual: ${fmt(Math.round(usualWeekViews))}`,
    });
  }

  // Momentum streaks
  if (viewsUpStreak) {
    add({
      key: "views_up_streak",
      cat: "momentum",
      weight: 2.2,
      cooldownMs: 5 * 60 * 1000,
      icon: HUD_ICONS.up,
      tag: "Momentum",
      type: "blue",
      text: `Momentum is building. Your last 3 blocks of 28 days show views increasing each time. This is a great moment to repeat what is working.`,
    });
  } else if (viewsDownStreak) {
    add({
      key: "views_down_streak",
      cat: "momentum",
      weight: 2.2,
      cooldownMs: 5 * 60 * 1000,
      icon: HUD_ICONS.down,
      tag: "Momentum",
      type: "orange",
      text: `Views are slowly drifting down across the last 3 blocks of 28 days. A new series idea or stronger thumbnails could reverse it.`,
    });
  }

  // Stability / volatility
  if (volatility >= 2.0) {
    add({
      key: "volatility_high",
      cat: "stability",
      weight: 2.0,
      cooldownMs: 6 * 60 * 1000,
      icon: HUD_ICONS.warn,
      tag: "Stability",
      type: "orange",
      text: `Your views are swingy lately. Your strongest 28-day block is about ${volatility.toFixed(1)}× larger than the weakest. A repeatable format can stabilize growth.`,
    });
  } else if (volatility > 0 && volatility <= 1.4) {
    add({
      key: "volatility_low",
      cat: "stability",
      weight: 1.8,
      cooldownMs: 6 * 60 * 1000,
      icon: HUD_ICONS.up,
      tag: "Stability",
      type: "green",
      text: `Your views look stable across recent 28-day blocks. That is good for planning and long-term growth.`,
    });
  }

  // CTR & impressions
  if (thumb && Number.isFinite(thumb.ctr)) {
    const ctr = Number(thumb.ctr || 0);
    const tone = ctr < 2 ? "orange" : (ctr >= 8 ? "green" : "yellow");
    const icon = ctr < 2 ? HUD_ICONS.warn : HUD_ICONS.bulb;
    const extra = ctr < 2
      ? "That is low. Try brighter thumbnails, fewer words, and a clearer promise in the title."
      : (ctr >= 8 ? "That is excellent. Your packaging is working." : "This is healthy. Keep improving little by little.");

    add({
      key: "ctr",
      cat: "packaging",
      weight: 2.1,
      cooldownMs: 8 * 60 * 1000,
      icon,
      tag: "Packaging",
      type: tone,
      text: `Thumbnail CTR signal: in the last 28 days your average CTR is about ${ctr.toFixed(1)}%. ${extra}`,
    });

    if (thumb.impressions) {
      add({
        key: "impressions",
        cat: "reach",
        weight: 1.6,
        cooldownMs: 8 * 60 * 1000,
        icon: HUD_ICONS.live,
        tag: "Reach",
        type: "blue",
        text: `In the last 28 days, your thumbnails were shown about ${fmt(thumb.impressions)} times. A higher CTR turns more of those impressions into views.`,
      });
    }
  }

  // Retention (avg view % + duration)
  if (ret && Number.isFinite(ret.avgViewPercentage)) {
    const r = Number(ret.avgViewPercentage || 0);
    const tone = r < 35 ? "orange" : (r >= 50 ? "green" : "yellow");
    const tip = r < 35
      ? "People may leave early. Tighten your intro and remove slow parts."
      : (r >= 50 ? "That is strong retention. The algorithm usually likes this." : "This is decent. Small edits can push it higher.");

    add({
      key: "retention",
      cat: "retention",
      weight: 2.0,
      cooldownMs: 8 * 60 * 1000,
      icon: r < 35 ? HUD_ICONS.warn : HUD_ICONS.up,
      tag: "Retention",
      type: tone,
      text: `Retention signal: your average view percentage is about ${r.toFixed(0)}%. ${tip}`,
    });

    if (Number.isFinite(ret.avgViewDurationSec)) {
      add({
        key: "avd",
        cat: "retention",
        weight: 1.5,
        cooldownMs: 8 * 60 * 1000,
        icon: HUD_ICONS.live,
        tag: "Watch Time",
        type: "blue",
        text: `Average view duration is about ${secondsToMinSec(ret.avgViewDurationSec)}. If you can lift this over time, your channel usually grows faster.`,
      });
    }
  }

  // Discovery sources
  if (Array.isArray(trafficLast) && trafficLast.length) {
    const total = trafficLast.reduce((a, x) => a + Number(x.value || 0), 0) || 1;
    const top = trafficLast[0];
    const topShare = Math.round((Number(top.value || 0) / total) * 100);

    add({
      key: "top_source",
      cat: "discovery",
      weight: 1.7,
      cooldownMs: 10 * 60 * 1000,
      icon: HUD_ICONS.bulb,
      tag: "Discovery",
      type: "blue",
      text: `Your biggest discovery source in the last 28 days is ${trafficLabel(top.key)} (about ${topShare}% of tracked views). Make more content that fits this path.`,
    });

    const findVal = (arr, k) => Number((arr || []).find(x => x.key === k)?.value || 0);
    const sNow = findVal(trafficLast, "YT_SEARCH");
    const sPrev = findVal(trafficPrev, "YT_SEARCH");
    if (sPrev > 0) {
      const p = Math.round(((sNow - sPrev) / sPrev) * 100);
      if (p >= 15) {
        add({
          key: "seo_up",
          cat: "discovery",
          weight: 1.6,
          cooldownMs: 10 * 60 * 1000,
          icon: HUD_ICONS.up,
          tag: "Search",
          type: "green",
          text: `SEO win: search views are up about +${p}% compared to the previous 28 days. Keep using clear keywords and searchable titles.`,
        });
      } else if (p <= -15) {
        add({
          key: "seo_down",
          cat: "discovery",
          weight: 1.6,
          cooldownMs: 10 * 60 * 1000,
          icon: HUD_ICONS.down,
          tag: "Search",
          type: "orange",
          text: `Search traffic is down about ${p}% compared to the previous 28 days. Try improving titles, descriptions, and making more searchable topics.`,
        });
      }
    }
  }

  // Subscribed vs non-subscribed
  if (Array.isArray(subStatus) && subStatus.length) {
    const total = subStatus.reduce((a, x) => a + Number(x.value || 0), 0) || 1;
    const nonSub = subStatus.find(x => x.key === "UNSUBSCRIBED") || subStatus.find(x => x.key === "NOT_SUBSCRIBED");
    const sub = subStatus.find(x => x.key === "SUBSCRIBED");

    const nonPct = nonSub ? Math.round((Number(nonSub.value || 0) / total) * 100) : null;
    if (nonPct !== null) {
      add({
        key: "non_sub_share",
        cat: "audience",
        weight: 1.6,
        cooldownMs: 10 * 60 * 1000,
        icon: HUD_ICONS.target,
        tag: "Audience",
        type: nonPct >= 80 ? "yellow" : "blue",
        text: `${nonPct}% of your views are from people who are not subscribed (last 28 days). A short reminder after you deliver value can help convert more viewers.`,
      });
    }

    if (sub && sub.value > 0) {
      add({
        key: "sub_view_share",
        cat: "audience",
        weight: 1.2,
        cooldownMs: 10 * 60 * 1000,
        icon: HUD_ICONS.live,
        tag: "Audience",
        type: "blue",
        text: `Subscribed viewers still matter. They gave you about ${fmt(sub.value)} views in the last 28 days. Keep them happy with a consistent theme.`,
      });
    }
  }

  // Top country
  if (Array.isArray(countries) && countries.length) {
    const top = countries[0];
    const nm = countryName(top.key);
    add({
      key: "top_country",
      cat: "global",
      weight: 1.2,
      cooldownMs: 15 * 60 * 1000,
      icon: HUD_ICONS.globe,
      tag: "Global",
      type: "purple",
      text: `Global reach: your #1 country in the last 28 days is ${nm}. Clear visuals and simple language helps international viewers stay longer.`,
    });
  }

  // ====== VIDEO-SPECIFIC INSIGHTS (many, detailed, based on available API fields) ======
  const pickVideoTitle = (t) => (t || "").replace(/\s+/g, " ").trim();

  if (latestVideo && latestVideo.title) {
    const vTitle = pickVideoTitle(latestVideo.title);
    const vViews = Number(latestVideo.views || 0);
    const vLikes = Number(latestVideo.likes || 0);
    const vCom = Number(latestVideo.comments || 0);

    const upDay = latestVideo.publishedAt ? new Date(latestVideo.publishedAt) : null;
    const ageDays = (upDay && statsThrough) ? daysBetweenISO(latestVideo.publishedAt, statsThrough) : null;
    const viewsPerDay = (ageDays && ageDays > 0) ? (vViews / ageDays) : null;

    const likeRate = vViews > 0 ? (vLikes / vViews) * 100 : 0;
    const comPer1k = vViews > 0 ? (vCom / vViews) * 1000 : 0;

    // (1) Latest video basic
    add({
      key: "vid_latest_basic",
      cat: "video",
      weight: 2.8,
      cooldownMs: 3 * 60 * 1000,
      icon: HUD_ICONS.rocket,
      tag: "Video",
      type: "purple",
      text: `Latest upload check: "${vTitle}". It currently has ${fmt(vViews)} views, ${fmt(vLikes)} likes, and ${fmt(vCom)} comments.`,
      subline: ageDays !== null ? `Uploaded ~${ageDays} day(s) before ${statsThrough}` : "",
    });

    // (2) Latest: velocity
    if (viewsPerDay !== null) {
      const baselinePerDay = (weekViews > 0) ? (weekViews / 7) : 0;
      const ratio = baselinePerDay > 0 ? (viewsPerDay / baselinePerDay) : 0;

      add({
        key: "vid_latest_velocity",
        cat: "video",
        weight: 2.4,
        cooldownMs: 4 * 60 * 1000,
        icon: ratio >= 1 ? HUD_ICONS.up : HUD_ICONS.down,
        tag: "Video",
        type: ratio >= 1.3 ? "blue" : (ratio >= 0.8 ? "yellow" : "orange"),
        text: `Latest video speed: it is averaging about ${fmt(Math.round(viewsPerDay))} views per day. Compared to your weekly baseline, that is about ${ratio.toFixed(1)}×.`,
        subline: `Baseline ≈ ${fmt(Math.round(baselinePerDay))} views/day`,
      });
    }

    // (3) Latest: like rate
    if (vViews > 0 && vLikes > 0) {
      add({
        key: "vid_latest_likerate",
        cat: "video",
        weight: 2.0,
        cooldownMs: 6 * 60 * 1000,
        icon: HUD_ICONS.up,
        tag: "Video",
        type: likeRate >= 5 ? "green" : (likeRate >= 2 ? "yellow" : "orange"),
        text: `Viewer satisfaction clue: your latest video has a like rate of about ${likeRate.toFixed(2)}%. Higher like rate often means people enjoyed the content.`,
        subline: `Likes ${fmt(vLikes)} / Views ${fmt(vViews)}`,
      });
    }

    // (4) Latest: comment density
    if (vViews > 0 && vCom >= 0) {
      add({
        key: "vid_latest_comments",
        cat: "video",
        weight: 1.9,
        cooldownMs: 6 * 60 * 1000,
        icon: HUD_ICONS.chat,
        tag: "Video",
        type: comPer1k >= 8 ? "green" : (comPer1k >= 3 ? "yellow" : "orange"),
        text: `Conversation density: your latest video gets about ${comPer1k.toFixed(2)} comments per 1,000 views. More comments usually means stronger community energy.`,
      });
    }

    // (5) Title structure hints
    const words = vTitle.split(" ").filter(Boolean);
    const hasNumber = /\d/.test(vTitle);
    const isLong = vTitle.length >= 60;
    add({
      key: "vid_latest_title_hint",
      cat: "video",
      weight: 1.4,
      cooldownMs: 8 * 60 * 1000,
      icon: HUD_ICONS.bulb,
      tag: "Video",
      type: "yellow",
      text: `Title scan: your latest title has ${words.length} words${hasNumber ? " and includes a number (numbers can help CTR)" : ""}${isLong ? ". It is long — shortening it can sometimes improve clicks." : "."}`,
    });

    // (6) Upload timing
    if (upDay) {
      const dow = upDay.toLocaleDateString(undefined, { weekday: "long" });
      const hr = upDay.getHours();
      add({
        key: "vid_latest_timing",
        cat: "video",
        weight: 1.3,
        cooldownMs: 10 * 60 * 1000,
        icon: HUD_ICONS.live,
        tag: "Video",
        type: "blue",
        text: `Upload timing note: your latest video was published on ${dow} around ${String(hr).padStart(2, "0")}:00 (local time). If you upload consistently, viewers learn when to return.`,
      });
    }

    // (7) If many uploads recently, call it out
    const recentCount = Array.isArray(recentUploads) ? recentUploads.filter(x => x && x.videoId).length : 0;
    if (recentCount >= 3) {
      add({
        key: "vid_recent_cadence",
        cat: "video",
        weight: 1.2,
        cooldownMs: 8 * 60 * 1000,
        icon: HUD_ICONS.up,
        tag: "Video",
        type: "green",
        text: `Upload cadence looks active. You have ${recentCount} recent uploads visible in the system. A steady cadence makes growth more predictable.`,
      });
    }
  }

  // Top performer last 7 days
  if (top7 && top7.title) {
    add({
      key: "top_video_week",
      cat: "video",
      weight: 2.2,
      cooldownMs: 5 * 60 * 1000,
      icon: HUD_ICONS.rocket,
      tag: "Video",
      type: "purple",
      text: `Top performer this week: "${top7.title}" with ${fmt(top7.views)} views. Study why it worked, then repeat the pattern in your next upload.`,
    });
  }

  // Viral-ish check from views48h
  const v48 = Number(hud.views48h || 0);
  if (v48 > 0 && last28Views > 0) {
    const normal48 = (last28Views / 28) * 2;
    const ratio = normal48 > 0 ? (v48 / normal48) : 0;
    if (ratio >= 3) {
      add({
        key: "viral_alert",
        cat: "momentum",
        weight: 2.4,
        cooldownMs: 10 * 60 * 1000,
        icon: HUD_ICONS.rocket,
        tag: "Momentum",
        type: "blue",
        text: `Viral potential: your last ~48 hours views are about ${ratio.toFixed(1)}× higher than normal. If you have a follow-up idea, this is a good time to publish it.`,
      });
    }
  }

  // Goals (simple)
  const nextSubGoal = getMilestone(Number(ch.subscribers || 0), "subs");
  const subDiff = nextSubGoal - Number(ch.subscribers || 0);
  if (subDiff > 0) {
    add({
      key: "goal_subs",
      cat: "goal",
      weight: 1.4,
      cooldownMs: 6 * 60 * 1000,
      icon: HUD_ICONS.target,
      tag: "Goal",
      type: "blue",
      text: `Subscriber goal: you are ${fmt(subDiff)} subs away from ${fmt(nextSubGoal)}. One strong video plus one Short per week can close this gap faster.`,
    });
  }

  // Channel birthday (rare + cooldown)
  if (ch.publishedAt) {
    try {
      const created = new Date(ch.publishedAt);
      const now = new Date();
      const days = Math.max(0, Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));
      const years = Math.floor(days / 365);
      const months = Math.floor((days % 365) / 30);
      const remDays = (days % 365) % 30;

      add({
        key: "birthday",
        cat: "status",
        weight: 0.25,
        cooldownMs: HUD_CONFIG.cooldownMs.birthday,
        icon: HUD_ICONS.bulb,
        tag: "Nostalgia",
        type: "purple",
        text: `You created this channel on ${created.toISOString().slice(0, 10)}. That was about ${years} years, ${months} months, and ${remDays} days ago. Think why you started — it is already a real journey.`,
      });
    } catch {}
  }

  // Tips / trivia / motivation (lower weight, so they don’t drown real signals)
  const tip = pick(KB.tips);
  if (tip) add({ key: "tip", cat: "tip", weight: 0.35, cooldownMs: HUD_CONFIG.cooldownMs.tip, icon: HUD_ICONS.bulb, tag: "Tip", type: "yellow", text: tip });

  const fact = pick(KB.facts);
  if (fact) add({ key: "trivia", cat: "trivia", weight: 0.30, cooldownMs: HUD_CONFIG.cooldownMs.trivia, icon: HUD_ICONS.bulb, tag: "Trivia", type: "purple", text: fact });

  if (Math.random() < 0.30) {
    const mot = pick(KB.motivation);
    if (mot) add({ key: "motivation", cat: "motivation", weight: 0.22, cooldownMs: HUD_CONFIG.cooldownMs.motivation, icon: HUD_ICONS.live, tag: "Motivation", type: "white", text: mot });
  }

  if (Math.random() < 0.20) {
    const nos = pick(KB.nostalgia);
    if (nos) add({ key: "nostalgia", cat: "status", weight: 0.18, cooldownMs: 8 * 60 * 1000, icon: HUD_ICONS.live, tag: "Nostalgia", type: "purple", text: nos });
  }

  // Data freshness (rare, never right after load)
  if (statsThrough) {
    add({
      key: "freshness",
      cat: "status",
      weight: 0.10,
      cooldownMs: HUD_CONFIG.cooldownMs.freshness,
      icon: HUD_ICONS.live,
      tag: "Status",
      type: "blue",
      text: `HUD uses stable analytics up to ${statsThrough}. Subscriber count and total views update live.`,
    });
  }

  return out.filter(x => x && x.text);
}

let intelQueue = [];

function eligible(item) {
  if (!item) return false;

  // avoid showing “status style” right after page load
  const sinceBoot = Date.now() - HUD_CONFIG.bootAt;
  if (sinceBoot < 9000 && (item.cat === "status" || item.key === "freshness" || item.key === "birthday")) return false;

  // cooldown per-key
  const last = Number(HUD_CONFIG.shownAt[item.key] || 0);
  const cd = Number(item.cooldownMs || 0);
  if (cd > 0 && (Date.now() - last) < cd) return false;

  // avoid repeating recent keys
  if (HUD_CONFIG.recentKeys.includes(item.key)) return false;

  // avoid immediate repeat
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

  // try strict eligibility first
  let candidates = intelQueue.filter(eligible);
  if (candidates.length) return weightedPick(candidates);

  // relax: allow repeat but still keep cooldown
  candidates = intelQueue.filter(it => {
    const last = Number(HUD_CONFIG.shownAt[it.key] || 0);
    const cd = Number(it.cooldownMs || 0);
    return !(cd > 0 && (Date.now() - last) < cd);
  });
  if (candidates.length) return weightedPick(candidates);

  // last resort
  return intelQueue[0];
}

function showNextIntel() {
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

function updateHud(data) {
  // Always rebuild queue (so refresh updates intelligence),
  // but DO NOT reset messages or restart timer.
  intelQueue = buildIntel(data);

  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true;

    if (HUD_CONFIG.timer) clearInterval(HUD_CONFIG.timer);

    initHudRing();

    // show first message after a delay (prevents instant “status spam” feeling)
    setTimeout(() => {
      showNextIntel();
      HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
    }, 1200);
  }
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
