// HUD v3 (2026-02-12) — full ring + 16s + no early "AI active" spam

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
  purple: "#70369d",
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

// --- SPARKLINE GRADIENT ---
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

  let html = "";
  let finalY = 0;

  if (absDiff <= 20) {
    const steps = [];
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) steps.push(a + (i * dir));
    html = steps.map(v => `<span class="rollLine">${txt(v)}</span>`).join("");
    finalY = -1.1 * absDiff;
  } else {
    html = `
      <span class="rollLine">${txt(a)}</span>
      <span class="rollLine" style="filter:blur(2px)">${txt(a + Math.round(diff / 2))}</span>
      <span class="rollLine">${txt(b)}</span>
    `;
    finalY = -1.1 * 2;
  }

  col.style.transition = "none";
  col.style.transform = "translateY(0)";
  col.innerHTML = html;

  void col.offsetHeight;

  col.style.transition = `transform 800ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
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
  setTimeout(() => el.remove(), 5500);
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

    // Counters
    const subsEl = document.getElementById("subsNow");
    if (isFirst) {
      animateSpeedometer(subsEl, cur.subs, { duration: 650 });
    } else if ((cur.subs - state.subs) >= 1) {
      animateCasinoRoll(subsEl, state.subs, cur.subs, { decimals: 0, suffix: "" });
      spawnFloatIcon("cardSubs", "subs");
    } else {
      setRollInstant(subsEl, fmt(cur.subs));
    }

    const viewsEl = document.getElementById("viewsTotal");
    if (isFirst) {
      animateSpeedometer(viewsEl, cur.views, { duration: 650 });
    } else if ((cur.views - state.views) >= 1) {
      animateCasinoRoll(viewsEl, state.views, cur.views, { decimals: 0, suffix: "" });
      spawnFloatIcon("cardViews", "views");
    } else {
      setRollInstant(viewsEl, fmt(cur.views));
    }

    const watchEl = document.getElementById("watchNow");
    const wDec = cur.watch < 100 ? 1 : 0;
    const watchTxt = (n) => (wDec ? fmt1(n) : fmt(Math.round(n))) + "h";

    if (isFirst) {
      animateSpeedometer(watchEl, cur.watch, { duration: 650, decimals: wDec, suffix: "h" });
    } else if ((cur.watch - state.watch) >= 1) {
      animateCasinoRoll(watchEl, state.watch, cur.watch, { decimals: wDec, suffix: "h" });
      spawnFloatIcon("cardWatch", "watch");
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

/* -------------------------
   HUD LOGIC (REAL 16s)
-------------------------- */
const HUD_CONFIG = {
  interval: 16000,
  timer: null,
  // do not show “system status” style lines early
  warmupMessages: 4,
};

const HUD_ICONS = {
  signal: `<svg viewBox="0 0 24 24" fill="white"><path d="M4 17h2v-7H4v7zm14 0h2V7h-2v10zM9 17h2V4H9v13zm5 0h2V10h-2v7z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="white"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  goal: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>`,
  tip: `<svg viewBox="0 0 24 24" fill="white"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  trivia: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>`,
};

const TAG = {
  Week: "This Week",
  Compare: "Compared",
  Signal: "Signal",
  Warning: "Warning",
  Goal: "Goal",
  Tip: "Tip",
  Trivia: "Trivia",
};

const TRIVIA = [
  "Trivia: YouTube often tests a video with small groups first. If people click and watch, it shows it to more viewers.",
  "Trivia: Many viewers decide to stay or leave in the first 5–15 seconds. A strong hook matters a lot.",
  "Trivia: If your thumbnail promise matches the first seconds of the video, people usually watch longer.",
  "Trivia: Playlists can increase session time because viewers keep watching related videos.",
  "Trivia: A pinned comment can work like a second title. Use it to guide people to your next best video.",
];

function pct(cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  if (!p) return null;
  return Math.round(((c - p) / Math.abs(p)) * 100);
}
function signed(n) {
  const x = Number(n || 0);
  return (x >= 0 ? "+" : "") + fmt(x);
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function eta(diff, perDay) {
  const d = Number(diff || 0);
  const p = Number(perDay || 0);
  if (d <= 0 || p <= 0) return null;
  const days = Math.ceil(d / p);
  if (days <= 1) return "about 1 day";
  if (days < 7) return `${days} days`;
  return `${Math.ceil(days / 7)} weeks`;
}

const HUD_STATE = {
  warmupLeft: HUD_CONFIG.warmupMessages,
  lastKey: "",
  queue: [],
  idx: 0,
  lastHash: "",
};

function buildQueue(data) {
  const qSignals = [];
  const qWarnings = [];
  const qGoals = [];
  const qTips = [];
  const qTrivia = [];

  const ch = data.channel || {};
  const w = data.weekly || {};
  const m28 = data.m28 || {};
  const last28 = m28.last28 || {};
  const prev28 = m28.prev28 || {};
  const avg6m = m28.avg6m || {};
  const hist = data.history28d || [];
  const d7 = data.daily7d || [];

  const weekViews = Number(w.views || 0);
  const weekWatch = Number(w.watchHours || 0);
  const weekNetSubs = Number(w.netSubs || 0);
  const weekG = Number(w.subsGained || 0);
  const weekL = Number(w.subsLost || 0);

  // 1) Week summary (always)
  qSignals.push({
    icon: HUD_ICONS.signal,
    tag: TAG.Week,
    type: "blue",
    text: `In the last 7 days, you got ${fmt(weekViews)} views and ${fmt1(weekWatch)} watch hours. Your net subscribers changed by ${signed(weekNetSubs)}.`,
  });

  // 2) gained vs lost + churn %
  const churnTotal = weekG + weekL;
  if (churnTotal > 0) {
    const churnPct = Math.round((weekL / churnTotal) * 100);
    const t = churnPct >= 45 ? "red" : (churnPct >= 30 ? "yellow" : "green");
    const icon = t === "red" ? HUD_ICONS.warn : HUD_ICONS.signal;
    const tag = t === "red" ? TAG.Warning : TAG.Signal;
    (t === "red" ? qWarnings : qSignals).push({
      icon,
      tag,
      type: t,
      text: `Subscriber detail: you gained ${fmt(weekG)} and lost ${fmt(weekL)} this week. That means about ${churnPct}% of subscriber movement was people leaving.`,
    });
  }

  // 3) mins per view (retention proxy)
  if (weekViews > 0) {
    const minsPerView = (weekWatch * 60) / weekViews;
    const t = minsPerView >= 1.0 ? "green" : (minsPerView >= 0.7 ? "yellow" : "red");
    const icon = t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.signal);
    (t === "red" ? qWarnings : qSignals).push({
      icon,
      tag: t === "red" ? TAG.Warning : TAG.Signal,
      type: t,
      text: `Retention signal: each view gave about ${fmt1(minsPerView)} minutes of watch time this week. Higher minutes per view usually means people stay longer.`,
    });
  }

  // 4) subs per 1,000 views (conversion)
  if (weekViews > 0) {
    const subsPer1k = (weekNetSubs / weekViews) * 1000;
    const t = subsPer1k >= 1.2 ? "green" : (subsPer1k >= 0.4 ? "yellow" : "red");
    const icon = t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.warn : HUD_ICONS.signal);
    (t === "red" ? qWarnings : qSignals).push({
      icon,
      tag: t === "red" ? TAG.Warning : TAG.Signal,
      type: t,
      text: `Conversion signal: for every 1,000 views, you gained about ${fmt1(subsPer1k)} net subscribers this week. If this is low, add a clear reason to subscribe.`,
    });
  }

  // 5) week vs previous week (views / watch / subs)
  const wowV = pct(w.views, w.prevViews);
  const wowW = pct(w.watchHours, w.prevWatchHours);
  const wowS = pct(w.netSubs, w.prevNetSubs);
  if (wowV !== null || wowW !== null || wowS !== null) {
    const vTxt = wowV === null ? "views: no compare" : `views: ${wowV > 0 ? "+" : ""}${wowV}%`;
    const wTxt = wowW === null ? "watch: no compare" : `watch: ${wowW > 0 ? "+" : ""}${wowW}%`;
    const sTxt = wowS === null ? "subs: no compare" : `subs: ${wowS > 0 ? "+" : ""}${wowS}%`;

    const bad = (wowV !== null && wowV <= -10) || (wowW !== null && wowW <= -10) || (wowS !== null && wowS <= -10);
    const good = (wowV !== null && wowV >= 10) || (wowW !== null && wowW >= 10) || (wowS !== null && wowS >= 10);

    const t = good ? "green" : (bad ? "red" : "yellow");
    const icon = good ? HUD_ICONS.up : (bad ? HUD_ICONS.down : HUD_ICONS.signal);
    (t === "red" ? qWarnings : qSignals).push({
      icon,
      tag: TAG.Compare,
      type: t,
      text: `Compared to the previous 7 days: ${vTxt}, ${wTxt}, and ${sTxt}. This tells you if your channel is speeding up or slowing down.`,
    });
  }

  // 6) usual week vs this week (based on 6m avg 28d / 4)
  const expViews = Number(avg6m.views || 0) / 4;
  if (expViews > 0) {
    const p = Math.round(((weekViews - expViews) / expViews) * 100);
    const t = p >= 15 ? "green" : (p <= -15 ? "red" : "yellow");
    const icon = t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.signal);
    (t === "red" ? qWarnings : qSignals).push({
      icon,
      tag: TAG.Signal,
      type: t,
      text: `Usual-week check: a normal week for you is about ${fmt(Math.round(expViews))} views. This week you got ${fmt(weekViews)} (${p > 0 ? "+" : ""}${p}%).`,
    });
  }

  // 7) momentum streak (28d windows)
  const last3 = hist.slice(-3).map(x => Number(x.views || 0));
  if (last3.length === 3) {
    const up = last3[2] > last3[1] && last3[1] > last3[0];
    const down = last3[2] < last3[1] && last3[1] < last3[0];
    if (up) {
      qSignals.push({
        icon: HUD_ICONS.up,
        tag: TAG.Signal,
        type: "green",
        text: `Momentum signal: your last three 28-day view windows are going up. This often means YouTube is finding more viewers for your content.`,
      });
    } else if (down) {
      qWarnings.push({
        icon: HUD_ICONS.warn,
        tag: TAG.Warning,
        type: "red",
        text: `Momentum warning: your last three 28-day view windows are going down. Try improving one strong video (title + thumbnail + hook).`,
      });
    }
  }

  // 8) best day / worst day this week (from daily7d)
  if (d7.length >= 4) {
    const best = [...d7].sort((a,b)=>b.views-a.views)[0];
    const worst = [...d7].sort((a,b)=>a.views-b.views)[0];
    qSignals.push({
      icon: HUD_ICONS.signal,
      tag: TAG.Signal,
      type: "blue",
      text: `Daily pattern: your best day this week was ${best.day} with ${fmt(best.views)} views. Your lowest day was ${worst.day} with ${fmt(worst.views)} views.`,
    });
  }

  // 9) Goals + ETA
  const subs = Number(ch.subscribers || 0);
  const nextSub = getMilestone(subs, "subs");
  const subDiff = nextSub - subs;
  const perDaySubs = weekNetSubs > 0 ? weekNetSubs / 7 : 0;
  const subEta = eta(subDiff, perDaySubs);
  if (subDiff > 0) {
    qGoals.push({
      icon: HUD_ICONS.goal,
      tag: TAG.Goal,
      type: "blue",
      text: `Goal: your next subscriber milestone is ${fmt(nextSub)}. You need ${fmt(subDiff)} more. ${subEta ? `If you keep this pace, you may reach it in ${subEta}.` : `If growth is slow, focus on one strong topic and improve it.`}`,
    });
  }

  // 10) Tips based on problems
  const tips = [];
  if (weekNetSubs < 0) tips.push("Tip: If net subscribers is negative, your topic may attract the wrong audience. Try a tighter topic series for the right viewers.");
  if (wowV !== null && wowV <= -10) tips.push("Tip: When views drop, upgrade the thumbnail and title of one good video. Small changes can bring discovery back.");
  tips.push("Tip: Put the main value in the first 10 seconds. Then explain. A slow intro makes many viewers leave early.");
  tips.push("Tip: After you give value, say one clear reason to subscribe, like: “Subscribe for weekly ___ videos.”");
  qTips.push({
    icon: HUD_ICONS.tip,
    tag: TAG.Tip,
    type: "yellow",
    text: pick(tips),
  });

  // 11) Trivia always
  qTrivia.push({
    icon: HUD_ICONS.trivia,
    tag: TAG.Trivia,
    type: "purple",
    text: pick(TRIVIA),
  });

  // --------- BUILD FINAL ORDER (NOT RANDOM SPAM) ----------
  // We will rotate like:
  // Warning (if exists) -> Signal -> Signal -> Goal -> Tip -> Trivia -> repeat
  const final = [];
  let wi = 0, si = 0, gi = 0, ti = 0, ri = 0;

  while (final.length < 18) {
    if (qWarnings.length && final.length < 18) { final.push(qWarnings[wi++ % qWarnings.length]); }
    if (qSignals.length && final.length < 18) { final.push(qSignals[si++ % qSignals.length]); }
    if (qSignals.length && final.length < 18) { final.push(qSignals[si++ % qSignals.length]); }
    if (qGoals.length   && final.length < 18) { final.push(qGoals[gi++ % qGoals.length]); }
    if (qTips.length    && final.length < 18) { final.push(qTips[ti++ % qTips.length]); }
    if (qTrivia.length  && final.length < 18) { final.push(qTrivia[ri++ % qTrivia.length]); }
    if (!qWarnings.length && !qSignals.length && !qGoals.length) break;
  }

  return final.slice(0, 18);
}

function updateHud(data) {
  const hash = JSON.stringify({
    d: data?.meta?.analyticsEndDate,
    s: data?.channel?.subscribers,
    v: data?.channel?.totalViews,
    wv: data?.weekly?.views,
    ws: data?.weekly?.netSubs,
    wh: data?.weekly?.watchHours,
  });

  if (hash !== HUD_STATE.lastHash) {
    HUD_STATE.queue = buildQueue(data);
    HUD_STATE.idx = 0;
    HUD_STATE.lastHash = hash;
    HUD_STATE.warmupLeft = HUD_CONFIG.warmupMessages;
  }

  if (!HUD_CONFIG.timer) {
    showNextIntel(); // first message immediately
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
  }
}

function showNextIntel() {
  const q = HUD_STATE.queue || [];
  if (!q.length) return;

  const item = q[HUD_STATE.idx % q.length];
  HUD_STATE.idx++;

  const msgEl = document.getElementById("hudMessage");
  const tagEl = document.getElementById("hudTag");
  const iconEl = document.getElementById("hudIcon");
  const ringEl = document.getElementById("hudRingProg");

  const c = COLORS[item.type] || COLORS.white;

  // prevent early “system” spam by forcing early messages to NOT be the same style
  // (in this v3 we already removed "AI active" lines; warmup is kept for future)
  if (HUD_STATE.warmupLeft > 0) HUD_STATE.warmupLeft--;

  // Fade out
  msgEl.style.opacity = "0.2";

  // --- reset ring immediately ---
  if (ringEl) {
    ringEl.style.transition = "none";
    ringEl.style.stroke = c;
    ringEl.style.filter = `drop-shadow(0 0 6px ${c})`;
    ringEl.style.strokeDasharray = "100";
    ringEl.style.strokeDashoffset = "100";
    void ringEl.getBoundingClientRect();
  }

  setTimeout(() => {
    msgEl.textContent = item.text;
    tagEl.textContent = item.tag;
    iconEl.innerHTML = item.icon;

    msgEl.classList.remove("hud-glitch");
    void msgEl.offsetWidth;
    msgEl.classList.add("hud-glitch");
    msgEl.style.opacity = "1";

    tagEl.style.color = c;
    tagEl.style.textShadow = `0 0 10px ${c}`;

    // animate ring for full duration (16s)
    if (ringEl) {
      ringEl.style.transition = `stroke-dashoffset ${HUD_CONFIG.interval}ms linear`;
      ringEl.style.strokeDashoffset = "0";
    }
  }, 220);
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
