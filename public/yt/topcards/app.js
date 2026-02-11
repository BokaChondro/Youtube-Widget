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

    // HUD update (no spam reset)
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
  lastKey: null,
  ringLen: 0,
  bootTime: Date.now(),
};

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

// --- Your required lists + extra (no duplicates) ---
function uniqPush(arr, s) {
  if (!s) return;
  if (!arr.includes(s)) arr.push(s);
}

const KB = {
  facts: [],
  tips: [],
  motivation: [],
  nostalgia: [],
};

// REQUIRED (from your message)
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

// Extra (safe, simple)
[
  "You can change a title and thumbnail any time. Small edits can revive old videos.",
  "Videos that keep viewers watching longer often get more suggestions.",
  "A clear thumbnail + clear title usually beats a complicated design.",
].forEach(x => uniqPush(KB.facts, x));

[
  "Try one simple goal: improve only ONE thing in your next video (title, intro, or pacing).",
  "Use a pinned comment to guide viewers to your next best video.",
  "If your video is long, add chapters so people can jump to the good parts.",
].forEach(x => uniqPush(KB.tips, x));

[
  "Small progress every week beats one big burst and then stopping.",
  "One good idea, executed well, can beat ten random uploads.",
].forEach(x => uniqPush(KB.motivation, x));

function pick(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pct(a, b) {
  const A = Number(a || 0), B = Number(b || 0);
  if (B === 0) return 0;
  return Math.round(((A - B) / B) * 100);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function secondsToMinSec(s) {
  const n = Math.max(0, Math.floor(Number(s || 0)));
  const m = Math.floor(n / 60);
  const r = n % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
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

function buildIntel(data) {
  const intel = [];
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

  const prevWeekViews = Number(w.prevViews || 0);
  const prevWeekNet = Number(w.prevNetSubs || 0);

  const last28Views = Number(m28.last28?.views || 0);
  const prev28Views = Number(m28.prev28?.views || 0);
  const last28Subs = Number(m28.last28?.netSubs || 0);
  const prev28Subs = Number(m28.prev28?.netSubs || 0);
  const last28Watch = Number(m28.last28?.watchHours || 0);
  const prev28Watch = Number(m28.prev28?.watchHours || 0);

  const avg6mViews = Number(m28.avg6m?.views || 0);
  const avg6mSubs = Number(m28.avg6m?.netSubs || 0);
  const avg6mWatch = Number(m28.avg6m?.watchHours || 0);

  // Derived signals (requested)
  const churnPct = weekG > 0 ? Math.round((weekL / weekG) * 100) : (weekL > 0 ? 100 : 0);
  const minsPerView = weekViews > 0 ? (weekMin / weekViews) : 0;
  const subsPer1k = weekViews > 0 ? (weekNet / weekViews) * 1000 : 0;

  const usualWeekViews = avg6mViews > 0 ? (avg6mViews / 4) : 0;
  const usualWeekSubs = avg6mSubs > 0 ? (avg6mSubs / 4) : 0;
  const weekVsUsualViewsPct = usualWeekViews > 0 ? Math.round(((weekViews - usualWeekViews) / usualWeekViews) * 100) : 0;

  // Momentum streak (last 3 windows increasing?)
  const winViews = hist.slice(0, 3).map(x => Number(x.views || 0));
  const winSubs = hist.slice(0, 3).map(x => Number(x.netSubs || 0));
  const viewsUpStreak = (winViews.length === 3 && winViews[0] > winViews[1] && winViews[1] > winViews[2]);
  const viewsDownStreak = (winViews.length === 3 && winViews[0] < winViews[1] && winViews[1] < winViews[2]);

  // Volatility (previous 6 windows)
  const prev6Views = hist.slice(1, 7).map(x => Number(x.views || 0)).filter(Number.isFinite);
  const vMax = prev6Views.length ? Math.max(...prev6Views) : 0;
  const vMin = prev6Views.length ? Math.min(...prev6Views) : 0;
  const volatility = (vMin > 0) ? (vMax / vMin) : 0; // 1.0 = stable, 2.0 = very swingy

  // Upload gap
  const latestUpload = hud.uploads?.latest || null;
  const statsThrough = hud.statsThrough || w.endDate || "";
  let uploadDaysAgo = null;
  if (latestUpload?.publishedAt && statsThrough) {
    try {
      uploadDaysAgo = Math.floor((new Date(statsThrough).getTime() - new Date(latestUpload.publishedAt).getTime()) / (1000 * 60 * 60 * 24));
      if (!Number.isFinite(uploadDaysAgo)) uploadDaysAgo = null;
    } catch { uploadDaysAgo = null; }
  }

  // Goals (subs + views + watch)
  const nextSubGoal = getMilestone(Number(ch.subscribers || 0), "subs");
  const subDiff = nextSubGoal - Number(ch.subscribers || 0);

  const nextViewsGoal = getMilestone(Number(ch.totalViews || 0), "views");
  const viewsDiff = nextViewsGoal - Number(ch.totalViews || 0);

  const nextWatchGoal = getMilestone(Number(data.lifetime?.watchHours || 0), "watch");
  const watchDiff = nextWatchGoal - Number(data.lifetime?.watchHours || 0);

  // Thumb + retention (optional)
  const thumb = hud.thumb28 || null;
  const ret = hud.retention28 || null;

  // Traffic sources (optional)
  const trafficLast = hud.traffic?.last28 || null;
  const trafficPrev = hud.traffic?.prev28 || null;

  // Subscribed status (optional)
  const subStatus = hud.subscribedStatus || null;

  // Countries (optional)
  const countries = hud.countries || null;

  // Top video (optional)
  const top7 = hud.topVideo7d || null;

  // Birthday / nostalgia
  let birthdayLine = null;
  if (ch.publishedAt) {
    try {
      const created = new Date(ch.publishedAt);
      const now = new Date();
      const ms = now.getTime() - created.getTime();
      const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
      const years = Math.floor(days / 365);
      const months = Math.floor((days % 365) / 30);
      const remDays = (days % 365) % 30;

      birthdayLine =
        `You created this channel on ${created.toISOString().slice(0, 10)}. That was about ${years} years, ${months} months, and ${remDays} days ago. Remember why you started — you have already come far.`;
    } catch {}
  }

  // -------- AI-LIKE intel blocks (clear English) --------

  // 1) Upload buffer warning
  if (uploadDaysAgo !== null && uploadDaysAgo > 14) {
    intel.push({
      key: "warn_upload_gap",
      icon: HUD_ICONS.warn,
      tag: "Warning",
      type: "orange",
      text: `Upload buffer looks empty. Your last upload was about ${uploadDaysAgo} days ago. A fresh video can help bring viewers back.`,
    });
  } else if (uploadDaysAgo !== null && uploadDaysAgo <= 3) {
    intel.push({
      key: "good_upload_recent",
      icon: HUD_ICONS.up,
      tag: "Good News",
      type: "green",
      text: `Nice pacing. You uploaded about ${uploadDaysAgo} days ago. Keeping a steady rhythm helps your audience remember you.`,
    });
  }

  // 2) Weekly gained vs lost + churn%
  if (weekG > 0 || weekL > 0) {
    const tone = (weekL > weekG) ? "red" : (weekNet >= 0 ? "green" : "orange");
    const icon = (weekL > weekG) ? HUD_ICONS.down : HUD_ICONS.up;
    const netWord = weekNet >= 0 ? `net +${fmt(weekNet)}` : `net -${fmt(Math.abs(weekNet))}`;
    intel.push({
      key: "subs_churn",
      icon,
      tag: "This Week",
      type: tone,
      text: `This week you gained ${fmt(weekG)} subscribers and lost ${fmt(weekL)}. That is ${netWord}. Your churn rate is about ${churnPct}% (lower is better).`,
    });
  }

  // 3) Minutes per view
  if (weekViews > 0 && weekMin > 0) {
    const tone = minsPerView >= 1.2 ? "green" : (minsPerView >= 0.6 ? "yellow" : "orange");
    intel.push({
      key: "mins_per_view",
      icon: HUD_ICONS.live,
      tag: "Retention",
      type: tone,
      text: `Viewer time quality: you are getting about ${minsPerView.toFixed(2)} minutes watched per view this week. Try to push this up with a stronger intro and faster pacing.`,
    });
  }

  // 4) Subs per 1k views
  if (weekViews > 0) {
    const tone = subsPer1k >= 2 ? "green" : (subsPer1k >= 0.8 ? "yellow" : "orange");
    const sTxt = subsPer1k >= 0 ? subsPer1k.toFixed(2) : `-${Math.abs(subsPer1k).toFixed(2)}`;
    intel.push({
      key: "subs_per_1k",
      icon: HUD_ICONS.rocket,
      tag: "Conversion",
      type: tone,
      text: `Subscriber conversion: you are getting about ${sTxt} net subscribers per 1,000 views this week. A clear call-to-action near the best moment can improve this.`,
    });
  }

  // 5) Usual-week vs this-week
  if (usualWeekViews > 0 && weekViews > 0) {
    const tone = weekVsUsualViewsPct >= 10 ? "green" : (weekVsUsualViewsPct <= -10 ? "orange" : "yellow");
    const sign = weekVsUsualViewsPct >= 0 ? "+" : "";
    intel.push({
      key: "usual_vs_week",
      icon: weekVsUsualViewsPct >= 0 ? HUD_ICONS.up : HUD_ICONS.down,
      tag: "Baseline",
      type: tone,
      text: `Compared to your usual week, your views are ${sign}${weekVsUsualViewsPct}% this week. Usual week is around ${fmt(Math.round(usualWeekViews))} views.`,
    });
  }

  // 6) Momentum streaks
  if (viewsUpStreak) {
    intel.push({
      key: "views_up_streak",
      icon: HUD_ICONS.up,
      tag: "Momentum",
      type: "blue",
      text: `Momentum is building. Your last 3 blocks of 28 days show rising views each time. Keep the same topic style and packaging.`,
    });
  } else if (viewsDownStreak) {
    intel.push({
      key: "views_down_streak",
      icon: HUD_ICONS.down,
      tag: "Momentum",
      type: "orange",
      text: `Views are drifting down across the last 3 blocks of 28 days. A new series idea or stronger thumbnails could help.`,
    });
  }

  // 7) Stability / volatility
  if (volatility >= 2.0) {
    intel.push({
      key: "volatility_high",
      icon: HUD_ICONS.warn,
      tag: "Stability",
      type: "orange",
      text: `Your views are very swingy lately. Your best 28-day block is about ${volatility.toFixed(1)}x bigger than your weakest. Try a repeatable format to stabilize growth.`,
    });
  } else if (volatility > 0 && volatility <= 1.4) {
    intel.push({
      key: "volatility_low",
      icon: HUD_ICONS.up,
      tag: "Stability",
      type: "green",
      text: `Your views look stable across recent 28-day blocks. This is good for long-term growth and planning.`,
    });
  }

  // 8) CTR warning / praise (if available)
  if (thumb && Number.isFinite(thumb.ctr)) {
    const ctr = Number(thumb.ctr || 0);
    const tone = ctr < 2 ? "orange" : (ctr >= 8 ? "green" : "yellow");
    const icon = ctr < 2 ? HUD_ICONS.warn : HUD_ICONS.bulb;

    let extra = "";
    if (ctr < 2) extra = "That is low. Try brighter thumbnails, fewer words, and a clearer promise in the title.";
    else if (ctr >= 8) extra = "That is excellent. Your packaging is working well.";

    intel.push({
      key: "ctr",
      icon,
      tag: "Packaging",
      type: tone,
      text: `Thumbnail CTR signal: in the last 28 days your average CTR is about ${ctr.toFixed(1)}%. ${extra}`,
    });

    if (thumb.impressions) {
      intel.push({
        key: "impressions",
        icon: HUD_ICONS.live,
        tag: "Reach",
        type: "blue",
        text: `In the last 28 days, your thumbnails were shown about ${fmt(thumb.impressions)} times. Better CTR turns these impressions into more views.`,
      });
    }
  }

  // 9) Retention (if available)
  if (ret && Number.isFinite(ret.avgViewPercentage)) {
    const r = Number(ret.avgViewPercentage || 0);
    const tone = r < 35 ? "orange" : (r >= 50 ? "green" : "yellow");
    const icon = r < 35 ? HUD_ICONS.warn : HUD_ICONS.up;

    let tip = "";
    if (r < 35) tip = "People may leave early. Tighten your first 10 seconds and remove slow parts.";
    else if (r >= 50) tip = "That is strong. The algorithm usually likes this kind of retention.";

    intel.push({
      key: "retention",
      icon,
      tag: "Retention",
      type: tone,
      text: `Retention signal: your average view percentage is about ${r.toFixed(0)}%. ${tip}`,
    });

    if (Number.isFinite(ret.avgViewDurationSec)) {
      intel.push({
        key: "avd",
        icon: HUD_ICONS.live,
        tag: "Watch Time",
        type: "blue",
        text: `Average view duration is about ${secondsToMinSec(ret.avgViewDurationSec)}. Try to lift it a little each month.`,
      });
    }
  }

  // 10) Search / suggested traffic insight (if available)
  if (Array.isArray(trafficLast) && trafficLast.length) {
    const total = trafficLast.reduce((a, x) => a + Number(x.value || 0), 0) || 1;
    const top = trafficLast[0];
    const topShare = Math.round((Number(top.value || 0) / total) * 100);

    intel.push({
      key: "top_source",
      icon: HUD_ICONS.bulb,
      tag: "Discovery",
      type: "blue",
      text: `Your biggest traffic source in the last 28 days is ${trafficLabel(top.key)} (${topShare}% of tracked views). Double down on what brings that traffic.`,
    });

    const findVal = (arr, k) => Number((arr || []).find(x => x.key === k)?.value || 0);
    const sNow = findVal(trafficLast, "YT_SEARCH");
    const sPrev = findVal(trafficPrev, "YT_SEARCH");
    if (sPrev > 0) {
      const p = Math.round(((sNow - sPrev) / sPrev) * 100);
      if (p >= 15) {
        intel.push({
          key: "seo_up",
          icon: HUD_ICONS.up,
          tag: "Search",
          type: "green",
          text: `SEO win: search views are up about +${p}% compared to the previous 28 days. Keep using clear keywords and searchable titles.`,
        });
      } else if (p <= -15) {
        intel.push({
          key: "seo_down",
          icon: HUD_ICONS.down,
          tag: "Search",
          type: "orange",
          text: `Search traffic is down about ${p}% compared to the previous 28 days. Try improving titles, descriptions, and making more searchable topics.`,
        });
      }
    }
  }

  // 11) Subscribed vs non-subscribed views (if available)
  if (Array.isArray(subStatus) && subStatus.length) {
    const total = subStatus.reduce((a, x) => a + Number(x.value || 0), 0) || 1;
    const nonSub = subStatus.find(x => x.key === "UNSUBSCRIBED") || subStatus.find(x => x.key === "NOT_SUBSCRIBED");
    const sub = subStatus.find(x => x.key === "SUBSCRIBED");

    const nonPct = nonSub ? Math.round((Number(nonSub.value || 0) / total) * 100) : null;
    if (nonPct !== null) {
      const tone = nonPct >= 80 ? "yellow" : "blue";
      intel.push({
        key: "non_sub_share",
        icon: HUD_ICONS.target,
        tag: "Audience",
        type: tone,
        text: `${nonPct}% of your views are from people who are not subscribed (last 28 days). A simple reminder after you deliver value can help.`,
      });
    }

    if (sub && sub.value > 0) {
      intel.push({
        key: "sub_view_share",
        icon: HUD_ICONS.live,
        tag: "Audience",
        type: "blue",
        text: `Subscribed viewers still matter. They gave you about ${fmt(sub.value)} views in the last 28 days. Keep them happy with a consistent theme.`,
      });
    }
  }

  // 12) Top country (if available)
  if (Array.isArray(countries) && countries.length) {
    const top = countries[0];
    const nm = countryName(top.key);
    intel.push({
      key: "top_country",
      icon: HUD_ICONS.globe,
      tag: "Global",
      type: "purple",
      text: `Global reach: your top country in the last 28 days is ${nm}. Consider using simple language and clear visuals for worldwide viewers.`,
    });
  }

  // 13) Top video this week (if available)
  if (top7 && top7.title) {
    intel.push({
      key: "top_video_week",
      icon: HUD_ICONS.rocket,
      tag: "Top Video",
      type: "purple",
      text: `Top performer this week: "${top7.title}" with ${fmt(top7.views)} views. Study why it worked and repeat the pattern.`,
    });
  }

  // 14) Viral check (48h approx)
  const v48 = Number(hud.views48h || 0);
  if (v48 > 0 && last28Views > 0) {
    const normal48 = (last28Views / 28) * 2; // expected 2 days
    const ratio = normal48 > 0 ? (v48 / normal48) : 0;
    if (ratio >= 3) {
      intel.push({
        key: "viral_alert",
        icon: HUD_ICONS.rocket,
        tag: "Viral",
        type: "blue",
        text: `Viral potential: your last ~48 hours views look about ${ratio.toFixed(1)}x higher than normal. Consider posting a follow-up while attention is hot.`,
      });
    }
  }

  // 15) Channel birthday / nostalgia (NOT spammy)
  if (birthdayLine && (Math.random() < 0.18)) {
    intel.push({
      key: "birthday",
      icon: HUD_ICONS.bulb,
      tag: "Nostalgia",
      type: "purple",
      text: birthdayLine,
    });
  }

  // 16) Goals (always useful)
  if (subDiff > 0) {
    intel.push({
      key: "goal_subs",
      icon: HUD_ICONS.target,
      tag: "Goal",
      type: "blue",
      text: `Subscriber goal: you are only ${fmt(subDiff)} subscribers away from ${fmt(nextSubGoal)}. Keep one strong upload and one strong Short each week.`,
    });
  }
  if (viewsDiff > 0) {
    intel.push({
      key: "goal_views",
      icon: HUD_ICONS.target,
      tag: "Goal",
      type: "blue",
      text: `Views goal: you are ${fmt(viewsDiff)} views away from ${fmt(nextViewsGoal)} total views. Improve CTR a little and you will reach it faster.`,
    });
  }
  if (watchDiff > 0) {
    intel.push({
      key: "goal_watch",
      icon: HUD_ICONS.target,
      tag: "Goal",
      type: "blue",
      text: `Watch goal: you need about ${fmt1(watchDiff)} more watch hours to reach ${fmt(nextWatchGoal)}h. Longer videos + better retention helps a lot.`,
    });
  }

  // 17) Add one random “smart” tip + one fact + sometimes motivation/nostalgia
  const tip = pick(KB.tips);
  if (tip) intel.push({ key: "tip", icon: HUD_ICONS.bulb, tag: "Tip", type: "yellow", text: tip });

  const fact = pick(KB.facts);
  if (fact) intel.push({ key: "fact", icon: HUD_ICONS.bulb, tag: "Trivia", type: "purple", text: fact });

  if (Math.random() < 0.35) {
    const mot = pick(KB.motivation);
    if (mot) intel.push({ key: "mot", icon: HUD_ICONS.live, tag: "Motivation", type: "white", text: mot });
  }
  if (Math.random() < 0.20) {
    const nos = pick(KB.nostalgia);
    if (nos) intel.push({ key: "nos", icon: HUD_ICONS.live, tag: "Nostalgia", type: "purple", text: nos });
  }

  // 18) Sometimes show data freshness (NOT every refresh)
  if (statsThrough && Math.random() < 0.12) {
    intel.push({
      key: "freshness",
      icon: HUD_ICONS.live,
      tag: "Status",
      type: "blue",
      text: `Stats in this HUD are calculated using analytics up to ${statsThrough}. Subscriber count and total views update live.`,
    });
  }

  // Remove empties, then shuffle lightly (but keep variety)
  const out = intel.filter(x => x && x.text);
  // small shuffle
  out.sort(() => Math.random() - 0.5);
  return out;
}

let intelQueue = [];
function updateHud(data) {
  // Build fresh queue, but DO NOT force a reset message on refresh.
  intelQueue = buildIntel(data);

  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true;

    // ring init
    initHudRing();

    // show first message after a short delay (avoids instant “boot spam” feeling)
    setTimeout(() => {
      showNextIntel();
      HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
    }, 900);
  }
}

function initHudRing() {
  const rect = document.getElementById("hudRingRect");
  if (!rect) return;
  try {
    const len = rect.getTotalLength();
    HUD_CONFIG.ringLen = len;
    rect.style.strokeDasharray = `${len}`;
    rect.style.strokeDashoffset = `${len}`;
  } catch {
    HUD_CONFIG.ringLen = 0;
  }
}

function animateHudRing(colorHex) {
  const rect = document.getElementById("hudRingRect");
  if (!rect || !HUD_CONFIG.ringLen) return;

  rect.style.stroke = colorHex;

  // reset
  rect.style.transition = "none";
  rect.style.strokeDashoffset = `${HUD_CONFIG.ringLen}`;

  // animate to full
  requestAnimationFrame(() => {
    rect.style.transition = `stroke-dashoffset ${HUD_CONFIG.interval}ms linear`;
    rect.style.strokeDashoffset = "0";
  });
}

function pickNextItem() {
  if (!intelQueue.length) return null;

  // avoid repeating the same key back-to-back
  for (let i = 0; i < 6; i++) {
    const item = intelQueue[Math.floor(Math.random() * intelQueue.length)];
    if (!item) continue;
    if (item.key && item.key === HUD_CONFIG.lastKey) continue;
    return item;
  }
  return intelQueue[0];
}

function showNextIntel() {
  const item = pickNextItem();
  if (!item) return;

  HUD_CONFIG.lastKey = item.key || null;

  const msgEl = document.getElementById("hudMessage");
  const tagEl = document.getElementById("hudTag");
  const iconEl = document.getElementById("hudIcon");

  if (!msgEl || !tagEl || !iconEl) return;

  // Fade out a bit
  msgEl.style.opacity = "0.2";

  setTimeout(() => {
    msgEl.textContent = item.text;
    tagEl.textContent = item.tag;

    iconEl.innerHTML = item.icon || "⚡";

    // Glitch in
    msgEl.classList.remove("hud-glitch");
    void msgEl.offsetWidth;
    msgEl.classList.add("hud-glitch");
    msgEl.style.opacity = "1";

    const c = COLORS[item.type] || COLORS.white;
    tagEl.style.color = c;
    tagEl.style.textShadow = `0 0 10px ${c}`;

    // FULL border ring progress
    animateHudRing(c);
  }, 220);
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
