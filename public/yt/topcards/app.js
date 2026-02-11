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

// --- MAIN RENDER (TOP 3 CARDS LOGIC UNCHANGED) ---
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


/* --- HOLO-STREAM HUD ENGINE (CLEAR ENGLISH + MORE INSIGHTS) --- */
const HUD_CONFIG = {
  interval: 9000,
  timer: null
};

// Icons
const HUD_ICONS = {
  ai: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2a7 7 0 0 0-7 7v3a3 3 0 0 0 2 2.83V17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-2.17A3 3 0 0 0 19 12V9a7 7 0 0 0-7-7Zm5 10a1 1 0 0 1-1 1h-1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4H8a1 1 0 0 1-1-1V9a5 5 0 0 1 10 0v3Z"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" fill="white"><path d="M3 3h7v2H5v5H3V3zm16 0h-7v2h5v5h2V3zM3 21h7v-2H5v-5H3v7zm18 0h-7v-2h5v-5h2v7z"/></svg>`,
  chartUp: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
  chartDown: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="white"><path d="M11 21h-1l1-7H7l6-12h1l-1 7h4l-6 12z"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" fill="white"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  strategy: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>`
};

// More interesting trivia (no fake numbers; still useful)
const TRIVIA_BANK = [
  "Trivia: YouTube tests your video with small groups first. If people click and stay, it shows it to more viewers.",
  "Trivia: The first 5–15 seconds are like a “decision moment”. Many viewers decide to stay or leave there.",
  "Trivia: A thumbnail and the first frame should feel like the same story. If they feel different, people leave fast.",
  "Trivia: A clear promise in the title helps search and suggested. A confusing title reduces clicks.",
  "Trivia: If viewers watch one more video after yours, YouTube may recommend your channel more often.",
  "Trivia: Captions (subtitles) can help YouTube understand your topic and can help non-native viewers stay longer.",
  "Trivia: One strong series often grows a channel faster than many random topics.",
  "Trivia: A pinned comment can work like a “second title”. Use it to guide viewers to your next best video.",
  "Trivia: If your video feels slow, remove small pauses. Fast pacing often improves watch time.",
  "Trivia: A good hook is not only “hello guys”. A good hook shows the value first, then explains.",
  "Trivia: People remember emotions more than details. A thumbnail with clear emotion can be easier to notice.",
  "Trivia: Short videos can bring new viewers, but you still need a path to long videos (playlist or end screen).",
];

// Action tips (simple + direct)
const TIP_BANK = {
  reach: [
    "Tip: Pick one video and improve only the thumbnail and title. Then watch if views increase next week.",
    "Tip: Make your title easy English. Use simple words and one clear benefit.",
    "Tip: In the first 3 seconds, show what the viewer will get. Do not wait too long."
  ],
  retention: [
    "Tip: Start with the final result first. Then show how you did it step by step.",
    "Tip: Cut long intros. Go to the main point quickly.",
    "Tip: Add small changes every 20–30 seconds (zoom, text, cut) to keep attention."
  ],
  conversion: [
    "Tip: Ask for subscribe only after you give value. People subscribe when they trust you.",
    "Tip: Say one clear reason to subscribe, like: “Subscribe for weekly ___ videos.”",
    "Tip: Use end screen with ONE best video, not many options."
  ],
  system: [
    "Tip: Make a playlist for your best topic and link it in description and pinned comment.",
    "Tip: Reply to early comments. It can create a stronger first-hour signal.",
    "Tip: Keep a simple schedule you can follow. Consistency helps viewers remember you."
  ]
};

// Small helpers
function safePct(cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  if (p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 100);
}
function signed(n) { return (Number(n) >= 0 ? "+" : "") + fmt(n); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function pick(arr, seed) { return arr && arr.length ? arr[Math.abs(seed) % arr.length] : ""; }

function seedFromData(data) {
  const ch = data.channel || {};
  const w = data.weekly || {};
  return (
    Number(ch.subscribers || 0) * 5 +
    Number(ch.totalViews || 0) +
    Math.round(Number(w.views || 0) * 2) +
    Math.round(Number(w.netSubs || 0) * 17)
  );
}

function decideFocus(data) {
  // Find weakest area vs median 6 months (simple heuristic)
  const last28 = data.m28?.last28 || {};
  const med = data.m28?.median6m || {};

  const rSubs = (Number(med.netSubs || 0) <= 0) ? 1 : (Number(last28.netSubs || 0) / Number(med.netSubs || 1));
  const rViews = (Number(med.views || 0) <= 0) ? 1 : (Number(last28.views || 0) / Number(med.views || 1));
  const rWatch = (Number(med.watchHours || 0) <= 0) ? 1 : (Number(last28.watchHours || 0) / Number(med.watchHours || 1));

  const min = Math.min(rSubs, rViews, rWatch);
  if (min === rWatch) return "retention";
  if (min === rSubs) return "conversion";
  return "reach";
}

function bestDayBy(arr, key) {
  const a = (arr || []).filter(x => x && x.day);
  if (!a.length) return null;
  let best = a[0];
  for (const d of a) if (Number(d[key] || 0) > Number(best[key] || 0)) best = d;
  return best ? { day: best.day, val: Number(best[key] || 0) } : null;
}

function minMaxBy(arr, key) {
  const a = (arr || []).map(x => Number(x?.[key] || 0)).filter(Number.isFinite);
  if (!a.length) return null;
  return { min: Math.min(...a), max: Math.max(...a) };
}

function etaText(diff, perDay) {
  const d = Number(diff || 0);
  const p = Number(perDay || 0);
  if (d <= 0 || p <= 0) return null;
  const days = Math.ceil(d / p);
  if (days <= 1) return "about 1 day";
  if (days < 7) return `${days} days`;
  const weeks = Math.ceil(days / 7);
  return `${weeks} weeks`;
}

function generateIntel(data) {
  const intel = [];
  const ch = data.channel || {};
  const w = data.weekly || {};
  const last28 = data.m28?.last28 || {};
  const prev28 = data.m28?.prev28 || {};
  const hist = data.history28d || [];
  const daily7d = data.daily7d || [];
  const meta = data.meta || {};

  const seed = seedFromData(data);
  const focus = decideFocus(data);

  const subs = Number(ch.subscribers || 0);
  const views = Number(ch.totalViews || 0);
  const vids = Number(ch.videoCount || 0);

  const weekViews = Number(w.views || 0);
  const weekWatch = Number(w.watchHours || 0);
  const weekNetSubs = Number(w.netSubs || 0);
  const weekG = Number(w.subsGained || 0);
  const weekL = Number(w.subsLost || 0);

  const endDate = meta.analyticsEndDate || w.endDate || "";

  const wowViewsPct = safePct(weekViews, w.prevViews);
  const wowWatchPct = safePct(weekWatch, w.prevWatchHours);
  const wowSubsPct = safePct(weekNetSubs, w.prevNetSubs);

  // Derived ratios
  const minsPerView = weekViews > 0 ? Math.round((weekWatch * 60 / weekViews) * 10) / 10 : 0;
  const subsPer1kViews = weekViews > 0 ? Math.round((weekNetSubs / weekViews) * 1000 * 10) / 10 : 0;

  // Daily insights
  const bestViewsDay = bestDayBy(daily7d, "views");
  const bestSubsDay = bestDayBy(daily7d, "netSubs");
  const rangeViews = minMaxBy(daily7d, "views");

  // 28d comparisons
  const p28Views = safePct(Number(last28.views || 0), Number(prev28.views || 0));
  const p28Subs  = safePct(Number(last28.netSubs || 0), Number(prev28.netSubs || 0));
  const p28Watch = safePct(Number(last28.watchHours || 0), Number(prev28.watchHours || 0));

  // 1) AI CORE STATUS
  intel.push({
    icon: HUD_ICONS.ai, tag: "AI_CORE", type: "blue",
    text: `AI is active. I am reading your channel data up to ${endDate || "the latest closed day"} and building insights from it.`
  });

  // 2) WEEK SUMMARY (clear)
  intel.push({
    icon: HUD_ICONS.scan, tag: "WEEK_SUMMARY", type: "blue",
    text: `In the last 7 days, you got ${fmt(weekViews)} views and ${fmt1(weekWatch)} watch hours. Your net subscribers changed by ${signed(weekNetSubs)} (gained ${fmt(weekG)}, lost ${fmt(weekL)}).`
  });

  // 3) WEEK VS PREV WEEK (clear)
  if (wowViewsPct !== null || wowWatchPct !== null || wowSubsPct !== null) {
    const vTxt = wowViewsPct === null ? "views change: not available" : `views change: ${wowViewsPct > 0 ? "+" : ""}${wowViewsPct}%`;
    const wTxt = wowWatchPct === null ? "watch change: not available" : `watch change: ${wowWatchPct > 0 ? "+" : ""}${wowWatchPct}%`;
    const sTxt = wowSubsPct === null ? "subs change: not available" : `subs change: ${wowSubsPct > 0 ? "+" : ""}${wowSubsPct}%`;

    const type =
      (wowViewsPct !== null && wowViewsPct <= -8) || (wowWatchPct !== null && wowWatchPct <= -8) ? "red" :
      (wowViewsPct !== null && wowViewsPct >= 8) || (wowWatchPct !== null && wowWatchPct >= 8) ? "green" :
      "yellow";

    intel.push({
      icon: type === "green" ? HUD_ICONS.chartUp : (type === "red" ? HUD_ICONS.chartDown : HUD_ICONS.bolt),
      tag: "WEEK_COMPARE", type,
      text: `Compared to the previous 7 days, here is your movement: ${vTxt}, ${wTxt}, and ${sTxt}. This tells you if your channel is speeding up or slowing down.`
    });
  }

  // 4) ENGAGEMENT PER VIEW (easy)
  if (weekViews > 0) {
    const msg =
      minsPerView >= 1
        ? `On average, each view gave about ${fmt1(minsPerView)} minutes of watch time this week. More minutes per view usually means better retention.`
        : `This week, watch time per view is low. That often means the hook or pacing needs improvement.`;
    intel.push({ icon: HUD_ICONS.bolt, tag: "ENGAGEMENT", type: minsPerView >= 1 ? "green" : "yellow", text: msg });
  }

  // 5) SUBS CONVERSION (easy)
  if (weekViews > 0) {
    const convType = subsPer1kViews >= 1 ? "green" : (subsPer1kViews <= 0 ? "red" : "yellow");
    intel.push({
      icon: convType === "green" ? HUD_ICONS.chartUp : (convType === "red" ? HUD_ICONS.chartDown : HUD_ICONS.bolt),
      tag: "SUB_CONVERT", type: convType,
      text: `Subscriber conversion check: for every 1,000 views this week, you gained about ${fmt1(subsPer1kViews)} net subscribers. If this number is low, your content may not be matching the right audience.`
    });
  }

  // 6) BEST DAY (views)
  if (bestViewsDay && bestViewsDay.val > 0) {
    intel.push({
      icon: HUD_ICONS.bolt, tag: "BEST_DAY", type: "blue",
      text: `Your best view day this week was ${bestViewsDay.day}. On that day you got ${fmt(bestViewsDay.val)} views. Try to remember what topic or style you used there.`
    });
  }

  // 7) BEST DAY (subs)
  if (bestSubsDay && bestSubsDay.val !== 0) {
    const t = bestSubsDay.val > 0 ? "green" : "red";
    intel.push({
      icon: bestSubsDay.val > 0 ? HUD_ICONS.chartUp : HUD_ICONS.chartDown,
      tag: "BEST_SUB_DAY", type: t,
      text: `Subscriber signal: your strongest subscriber day was ${bestSubsDay.day}, with ${signed(bestSubsDay.val)} net subscribers. This usually happens when viewers feel the channel is “for them”.`
    });
  }

  // 8) DAILY RANGE (stability)
  if (rangeViews) {
    const spread = rangeViews.max - rangeViews.min;
    const type = spread > 0 ? "blue" : "yellow";
    intel.push({
      icon: HUD_ICONS.scan, tag: "STABILITY", type,
      text: `Daily stability: this week your daily views ranged from ${fmt(rangeViews.min)} to ${fmt(rangeViews.max)}. A big range means you get spikes, which you can repeat by copying the winning topic.`
    });
  }

  // 9) 28D COMPARISON (clear)
  if (p28Views !== null) {
    const up = p28Views >= 6;
    const down = p28Views <= -6;
    intel.push({
      icon: up ? HUD_ICONS.chartUp : (down ? HUD_ICONS.chartDown : HUD_ICONS.bolt),
      tag: "28D_TREND",
      type: up ? "green" : (down ? "red" : "yellow"),
      text: `Last 28 days performance: you got ${fmt(last28.views)} views. Compared to the previous 28 days, your views changed by ${p28Views > 0 ? "+" : ""}${p28Views}%.`
    });
  }
  if (p28Watch !== null) {
    const up = p28Watch >= 6;
    const down = p28Watch <= -6;
    intel.push({
      icon: up ? HUD_ICONS.chartUp : (down ? HUD_ICONS.chartDown : HUD_ICONS.bolt),
      tag: "28D_WATCH",
      type: up ? "green" : (down ? "red" : "yellow"),
      text: `Watch time check (28 days): you got ${fmt1(last28.watchHours)} watch hours. Compared to the previous 28 days, it changed by ${p28Watch > 0 ? "+" : ""}${p28Watch}%.`
    });
  }
  if (p28Subs !== null) {
    const up = p28Subs >= 6;
    const down = p28Subs <= -6;
    intel.push({
      icon: up ? HUD_ICONS.chartUp : (down ? HUD_ICONS.chartDown : HUD_ICONS.bolt),
      tag: "28D_SUBS",
      type: up ? "green" : (down ? "red" : "yellow"),
      text: `Subscriber trend (28 days): your net subscribers were ${signed(last28.netSubs)}. Compared to the previous 28 days, it changed by ${p28Subs > 0 ? "+" : ""}${p28Subs}%.`
    });
  }

  // 10) GOALS + ETA (easy)
  const nextSubGoal = getMilestone(subs, "subs");
  const subDiff = nextSubGoal - subs;
  const subsPerDay = weekNetSubs > 0 ? (weekNetSubs / 7) : 0;
  const subEta = etaText(subDiff, subsPerDay);

  if (subDiff > 0) {
    let msg = `Goal tracker: your next subscriber milestone is ${fmt(nextSubGoal)}. You still need ${fmt(subDiff)} more subscribers to reach it.`;
    if (subEta) msg += ` If you keep the current weekly pace, you may reach it in ${subEta}.`;
    else msg += ` If growth is slow, try improving one strong video first (title, thumbnail, hook).`;
    intel.push({ icon: HUD_ICONS.target, tag: "GOAL_SUBS", type: "blue", text: msg });
  }

  const nextViewGoal = getMilestone(views, "views");
  const viewDiff = nextViewGoal - views;
  const viewsPerDay = weekViews > 0 ? (weekViews / 7) : 0;
  const viewEta = etaText(viewDiff, viewsPerDay);

  if (viewDiff > 0) {
    let msg = `Goal tracker: your next views milestone is ${fmt(nextViewGoal)} total views. You need ${fmt(viewDiff)} more views to reach it.`;
    if (viewEta) msg += ` At your current pace, the estimate is ${viewEta}.`;
    intel.push({ icon: HUD_ICONS.target, tag: "GOAL_VIEWS", type: "blue", text: msg });
  }

  // 11) CHANNEL PROFILE (easy)
  if (vids > 0) {
    const vPerVideo = Math.round(views / vids);
    intel.push({
      icon: HUD_ICONS.scan, tag: "CHANNEL_PROFILE", type: "blue",
      text: `Channel profile: you have ${fmt(vids)} videos uploaded. On average, that is around ${fmt(vPerVideo)} views per video across your channel lifetime.`
    });
  }

  // 12) AI FOCUS (clear explanation)
  const focusLabel =
    focus === "retention" ? "Retention (keep viewers watching)" :
    focus === "conversion" ? "Conversion (turn viewers into subscribers)" :
    "Reach (get more clicks and discovery)";

  const focusMsg =
    focus === "retention"
      ? "AI focus is retention. Your watch time is weaker than your usual baseline, so the biggest win is improving the hook and pacing."
      : (focus === "conversion"
        ? "AI focus is conversion. You are getting views, but the subscriber gain is weaker than expected, so you need clearer audience match and a simple subscribe reason."
        : "AI focus is reach. Your content might be good, but discovery looks weaker, so title and thumbnail upgrades can help first.");

  intel.push({ icon: HUD_ICONS.strategy, tag: "AI_FOCUS", type: "yellow", text: `${focusLabel}: ${focusMsg}` });

  // 13) TIP (matches focus)
  const tip = pick(TIP_BANK[focus] || TIP_BANK.system, seed);
  intel.push({ icon: HUD_ICONS.strategy, tag: "ACTION_STEP", type: "yellow", text: tip });

  // 14) TRIVIA (more fun + interesting)
  const trivia = pick(TRIVIA_BANK, seed + 41);
  intel.push({ icon: HUD_ICONS.bulb, tag: "TRIVIA", type: "purple", text: trivia });

  // Keep it rich but not too long
  return intel.slice(0, 14);
}

let intelQueue = [];
let intelIndex = 0;
let lastIntelHash = "";

function updateHud(data) {
  // Refresh only when data changes (feels more "AI" and less random)
  const h = JSON.stringify({
    a: data?.meta?.analyticsEndDate,
    b: data?.channel?.subscribers,
    c: data?.channel?.totalViews,
    d: data?.weekly?.views,
    e: data?.weekly?.netSubs,
    f: data?.weekly?.watchHours,
    g: data?.m28?.last28?.views
  });

  if (h !== lastIntelHash) {
    intelQueue = generateIntel(data);
    intelIndex = 0;
    lastIntelHash = h;
  }

  if (!HUD_CONFIG.timer) {
    showNextIntel();
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
  }
}

function showNextIntel() {
  if (!intelQueue.length) return;

  const item = intelQueue[intelIndex];
  intelIndex = (intelIndex + 1) % intelQueue.length;

  const msgEl = document.getElementById("hudMessage");
  const tagEl = document.getElementById("hudTag");
  const iconEl = document.getElementById("hudIcon");
  const barEl = document.getElementById("hudTimerFill");
  const boxEl = document.getElementById("hudBox");

  barEl.style.transition = "none";
  barEl.style.width = "0%";

  msgEl.style.opacity = "0.2";

  setTimeout(() => {
    msgEl.textContent = item.text;
    tagEl.textContent = item.tag;
    iconEl.innerHTML = item.icon;

    msgEl.classList.remove("hud-glitch");
    void msgEl.offsetWidth;
    msgEl.classList.add("hud-glitch");
    msgEl.style.opacity = "1";

    const c = COLORS[item.type] || COLORS.white;
    tagEl.style.color = c;
    tagEl.style.textShadow = `0 0 10px ${c}`;
    boxEl.style.borderLeftColor = c;

    barEl.style.background = c;
    barEl.style.boxShadow = `0 0 10px ${c}`;

    requestAnimationFrame(() => {
      barEl.style.transition = `width ${HUD_CONFIG.interval}ms linear`;
      barEl.style.width = "100%";
    });
  }, 180);
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
