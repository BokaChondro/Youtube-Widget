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


/* --- HOLO-STREAM HUD ENGINE (AI FEEL + NO REPETITION) --- */
const HUD_CONFIG = {
  interval: 16000,                 // doubled from 8000
  timer: null,
  statusCooldownMs: 16000 * 6,     // Status appears rarely (cooldown)
};

// White SVG Icons for HUD (fill="white")
const HUD_ICONS = {
  status: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2a7 7 0 0 0-7 7v3a3 3 0 0 0 2 2.83V17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-2.17A3 3 0 0 0 19 12V9a7 7 0 0 0-7-7Zm5 10a1 1 0 0 1-1 1h-1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4H8a1 1 0 0 1-1-1V9a5 5 0 0 1 10 0v3Z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="white"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>`,
  tip: `<svg viewBox="0 0 24 24" fill="white"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  trivia: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>`,
};

// simple tags
const TAG = {
  Status: "Status",
  Week: "This Week",
  Compared: "Compared",
  Signal: "Signal",
  Goal: "Goal",
  Tip: "Tip",
  Trivia: "Trivia",
  Warning: "Warning",
};

const TRIVIA = [
  "Trivia: YouTube tests your video with small groups first. If people click and watch, it will show it to more viewers.",
  "Trivia: Many viewers decide to stay or leave in the first 5 to 15 seconds. A clear hook helps a lot.",
  "Trivia: If your thumbnail promises one thing, your first seconds should match it. When it matches, people stay longer.",
  "Trivia: A video series often grows a channel faster than random topics, because viewers know what to expect.",
  "Trivia: A pinned comment can work like a second title. Use it to guide viewers to your next best video.",
  "Trivia: If viewers watch another video after yours, YouTube can recommend your channel more often.",
  "Trivia: Simple titles often win. If the title is confusing, many people will not click.",
  "Trivia: Cutting small pauses can improve pacing and keep attention longer, even if the video topic is good.",
];

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function pct(cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  if (!p) return null;
  return Math.round(((c - p) / Math.abs(p)) * 100);
}
function signed(n) {
  const x = Number(n || 0);
  return (x >= 0 ? "+" : "") + fmt(x);
}
function pick(arr) {
  if (!arr || !arr.length) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
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
  recentKeys: [],
  warmupLeft: 3,        // blocks Status right after load/refresh
  lastStatusAt: 0,
  lastDataHash: "",
};

// Build a smarter queue (many new positive/negative signals)
function buildIntelQueue(data) {
  const q = [];
  const ch = data.channel || {};
  const w = data.weekly || {};
  const m28 = data.m28 || {};
  const last28 = m28.last28 || {};
  const prev28 = m28.prev28 || {};
  const avg6m = m28.avg6m || {};
  const hist = data.history28d || [];
  const meta = data.meta || {};

  const title = ch.title || "your channel";
  const endDate = meta.analyticsEndDate || w.endDate || "the latest closed day";

  const weekViews = Number(w.views || 0);
  const weekWatch = Number(w.watchHours || 0);
  const weekNetSubs = Number(w.netSubs || 0);
  const weekG = Number(w.subsGained || 0);
  const weekL = Number(w.subsLost || 0);

  const wowV = pct(weekViews, w.prevViews);
  const wowW = pct(weekWatch, w.prevWatchHours);
  const wowS = pct(weekNetSubs, w.prevNetSubs);

  // extra metrics
  const minsPerView = weekViews > 0 ? roundTo1((weekWatch * 60) / weekViews) : 0;
  const subsPer1k = weekViews > 0 ? roundTo1((weekNetSubs / weekViews) * 1000) : 0;

  const churnTotal = weekG + weekL;
  const churnPct = churnTotal > 0 ? Math.round((weekL / churnTotal) * 100) : 0;

  // expected week (from 6m avg 28d -> /4)
  const expViews = Number(avg6m.views || 0) / 4;
  const expSubs = Number(avg6m.netSubs || 0) / 4;
  const expWatch = Number(avg6m.watchHours || 0) / 4;

  // 28d compare
  const p28V = pct(last28.views, prev28.views);
  const p28S = pct(last28.netSubs, prev28.netSubs);
  const p28W = pct(last28.watchHours, prev28.watchHours);

  // trend streak (last 3 28d windows)
  const last3 = hist.slice(-3);
  const last3Views = last3.map(x => Number(x.views || 0));
  const streakUp = last3Views.length === 3 && last3Views[2] > last3Views[1] && last3Views[1] > last3Views[0];
  const streakDown = last3Views.length === 3 && last3Views[2] < last3Views[1] && last3Views[1] < last3Views[0];

  // volatility (last 6 windows views)
  const last6 = hist.slice(-6).map(x => Number(x.views || 0)).filter(Number.isFinite);
  const vol = last6.length ? (Math.max(...last6) - Math.min(...last6)) : 0;

  // --- Status message is RARE and NOT early ---
  // (we will insert it with random chance below)
  const statusItem = {
    icon: HUD_ICONS.status,
    tag: TAG.Status,
    type: "blue",
    text: `System is online for ${title}. Data is updated up to ${endDate}. I will show signals and tips based on this data.`,
  };

  // --- Week summary (clear) ---
  q.push({
    icon: HUD_ICONS.status,
    tag: TAG.Week,
    type: "blue",
    text: `In the last 7 days you got ${fmt(weekViews)} views and ${fmt1(weekWatch)} watch hours. Your net subscribers changed by ${signed(weekNetSubs)}.`,
  });

  // --- Gained vs lost (new signal not in cards) ---
  if (churnTotal > 0) {
    const t = churnPct >= 45 ? "red" : (churnPct >= 30 ? "yellow" : "green");
    q.push({
      icon: t === "red" ? HUD_ICONS.warn : HUD_ICONS.status,
      tag: t === "red" ? TAG.Warning : TAG.Signal,
      type: t,
      text: `Subscriber movement detail: you gained ${fmt(weekG)} subscribers but you also lost ${fmt(weekL)}. That means about ${churnPct}% of subscriber movement this week was people leaving.`,
    });
  }

  // --- Week compare ---
  if (wowV !== null || wowW !== null || wowS !== null) {
    const vTxt = wowV === null ? "views: not enough data" : `views: ${wowV > 0 ? "+" : ""}${wowV}%`;
    const wTxt = wowW === null ? "watch: not enough data" : `watch: ${wowW > 0 ? "+" : ""}${wowW}%`;
    const sTxt = wowS === null ? "subs: not enough data" : `subs: ${wowS > 0 ? "+" : ""}${wowS}%`;

    const bad = (wowV !== null && wowV <= -8) || (wowW !== null && wowW <= -8) || (wowS !== null && wowS <= -8);
    const good = (wowV !== null && wowV >= 8) || (wowW !== null && wowW >= 8) || (wowS !== null && wowS >= 8);

    q.push({
      icon: good ? HUD_ICONS.up : (bad ? HUD_ICONS.down : HUD_ICONS.status),
      tag: TAG.Compared,
      type: good ? "green" : (bad ? "red" : "yellow"),
      text: `Compared to the previous 7 days, your change is: ${vTxt}, ${wTxt}, and ${sTxt}. This helps you see if your channel is speeding up or slowing down.`,
    });
  }

  // --- Watch per view (retention proxy) ---
  if (weekViews > 0) {
    const t = minsPerView >= 1.0 ? "green" : (minsPerView >= 0.7 ? "yellow" : "red");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.status),
      tag: TAG.Signal,
      type: t,
      text: `Retention signal: this week each view gave about ${fmt1(minsPerView)} minutes of watch time. Higher minutes per view usually means people are staying longer.`,
    });
  }

  // --- Subs per 1000 views (conversion proxy) ---
  if (weekViews > 0) {
    const t = subsPer1k >= 1.2 ? "green" : (subsPer1k >= 0.4 ? "yellow" : "red");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.warn : HUD_ICONS.status),
      tag: t === "red" ? TAG.Warning : TAG.Signal,
      type: t,
      text: `Conversion signal: for every 1,000 views this week, you gained about ${fmt1(subsPer1k)} net subscribers. If this is low, viewers may enjoy the video but not feel the channel is for them.`,
    });
  }

  // --- Expected week vs your usual (new) ---
  if (expViews > 0) {
    const diff = weekViews - expViews;
    const p = Math.round((diff / expViews) * 100);
    const t = p >= 15 ? "green" : (p <= -15 ? "red" : "yellow");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.status),
      tag: TAG.Signal,
      type: t,
      text: `Usual-week check: based on your 6-month average, a normal week is about ${fmt(Math.round(expViews))} views. This week you got ${fmt(weekViews)}, which is ${p > 0 ? "+" : ""}${p}% vs normal.`,
    });
  }

  if (expSubs !== 0) {
    const diff = weekNetSubs - expSubs;
    const t = diff >= Math.abs(expSubs) * 0.25 ? "green" : (diff <= -Math.abs(expSubs) * 0.25 ? "red" : "yellow");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.status),
      tag: TAG.Signal,
      type: t,
      text: `Usual-subs check: a normal week for your channel is around ${fmt(Math.round(expSubs))} net subscribers. This week is ${signed(Math.round(weekNetSubs - expSubs))} vs that usual pace.`,
    });
  }

  // --- 28d trend message (already in cards but now explained) ---
  if (p28V !== null) {
    const t = p28V >= 10 ? "green" : (p28V <= -10 ? "red" : "yellow");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.status),
      tag: TAG.Compared,
      type: t,
      text: `Last 28 days views: you got ${fmt(last28.views)}. Compared to the previous 28 days, it changed by ${p28V > 0 ? "+" : ""}${p28V}%.`,
    });
  }

  if (p28W !== null) {
    const t = p28W >= 10 ? "green" : (p28W <= -10 ? "red" : "yellow");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.down : HUD_ICONS.status),
      tag: TAG.Compared,
      type: t,
      text: `Last 28 days watch time: you got ${fmt1(last28.watchHours)} hours. Compared to the previous 28 days, it changed by ${p28W > 0 ? "+" : ""}${p28W}%.`,
    });
  }

  if (p28S !== null) {
    const t = p28S >= 10 ? "green" : (p28S <= -10 ? "red" : "yellow");
    q.push({
      icon: t === "green" ? HUD_ICONS.up : (t === "red" ? HUD_ICONS.warn : HUD_ICONS.status),
      tag: t === "red" ? TAG.Warning : TAG.Compared,
      type: t,
      text: `Last 28 days subscribers: your net subscribers were ${signed(last28.netSubs)}. Compared to the previous 28 days, it changed by ${p28S > 0 ? "+" : ""}${p28S}%.`,
    });
  }

  // --- Trend streak ---
  if (streakUp) {
    q.push({
      icon: HUD_ICONS.up,
      tag: TAG.Signal,
      type: "green",
      text: `Momentum signal: your last three 28-day view windows are increasing. This usually means YouTube is finding more people for your content.`,
    });
  } else if (streakDown) {
    q.push({
      icon: HUD_ICONS.warn,
      tag: TAG.Warning,
      type: "red",
      text: `Momentum warning: your last three 28-day view windows are going down. This is a good time to improve one strong video (thumbnail + title + hook) instead of uploading random topics.`,
    });
  }

  // --- Volatility ---
  if (vol > 0) {
    const t = vol > (last6.reduce((a,b)=>a+b,0) / Math.max(1,last6.length)) ? "yellow" : "blue";
    q.push({
      icon: HUD_ICONS.status,
      tag: TAG.Signal,
      type: t === "yellow" ? "yellow" : "blue",
      text: `Stability signal: your 28-day views swing by about ${fmt(vol)} between your lowest and highest recent windows. If you want stable growth, repeat the topic style that made the high window.`,
    });
  }

  // --- Goals + ETA ---
  const subs = Number(ch.subscribers || 0);
  const views = Number(ch.totalViews || 0);
  const watch = Number(data.lifetime?.watchHours || 0);

  const nextSub = getMilestone(subs, "subs");
  const subDiff = nextSub - subs;
  const subPerDay = weekNetSubs > 0 ? weekNetSubs / 7 : 0;
  const subEta = eta(subDiff, subPerDay);

  if (subDiff > 0) {
    let msg = `Goal: your next subscriber milestone is ${fmt(nextSub)}. You need ${fmt(subDiff)} more.`;
    msg += subEta ? ` If you keep this pace, the estimate is ${subEta}.` : ` If growth is slow, focus on one strong topic and improve it.`;
    q.push({ icon: HUD_ICONS.target, tag: TAG.Goal, type: "blue", text: msg });
  }

  const nextV = getMilestone(views, "views");
  const vDiff = nextV - views;
  const vPerDay = weekViews > 0 ? weekViews / 7 : 0;
  const vEta = eta(vDiff, vPerDay);
  if (vDiff > 0) {
    q.push({
      icon: HUD_ICONS.target,
      tag: TAG.Goal,
      type: "blue",
      text: `Goal: your next views milestone is ${fmt(nextV)} total views. You need ${fmt(vDiff)} more. ${vEta ? `At your current pace, the estimate is ${vEta}.` : ""}`,
    });
  }

  const nextW = getMilestone(watch, "watch");
  const wDiff = nextW - watch;
  if (wDiff > 0) {
    q.push({
      icon: HUD_ICONS.target,
      tag: TAG.Goal,
      type: "blue",
      text: `Goal: your next watch milestone is ${fmt(nextW)} hours. You need about ${fmt1(wDiff)} more hours to reach it.`,
    });
  }

  // --- Tips (more positive/negative and not shown in cards) ---
  const tips = [];
  if (minsPerView > 0 && minsPerView < 0.8) tips.push("Tip: Improve the first 10 seconds. Show the value first, then explain. Many viewers leave early when the intro is slow.");
  if (subsPer1k >= 0 && subsPer1k < 0.5) tips.push("Tip: Give one clear reason to subscribe, like: “Subscribe for weekly ___ videos.” Say it after you give value, not at the start.");
  if (wowV !== null && wowV <= -10) tips.push("Tip: When views drop, upgrade the thumbnail and title of one good video. Small changes can bring discovery back.");
  if (weekNetSubs < 0) tips.push("Tip: If net subs is negative, your video topic may be pulling the wrong audience. Try a tighter topic series for the right people.");
  if (!tips.length) tips.push("Tip: Pick one winning topic and make a small series. A series makes people come back because they know what you post.");

  q.push({
    icon: HUD_ICONS.tip,
    tag: TAG.Tip,
    type: "yellow",
    text: pick(tips),
  });

  // --- Trivia (always) ---
  q.push({
    icon: HUD_ICONS.trivia,
    tag: TAG.Trivia,
    type: "purple",
    text: pick(TRIVIA),
  });

  // Random chance to include Status (rare)
  if (Math.random() < 0.22) q.push(statusItem);

  // Shuffle so it feels random (not repeating same order)
  shuffleInPlace(q);

  // Keep queue size healthy
  return q.slice(0, 16);
}

function roundTo1(n) { return Math.round(Number(n || 0) * 10) / 10; }

let intelQueue = [];
let intelIndex = 0;

function updateHud(data) {
  // Data hash so queue refresh feels "AI", not random spam
  const h = JSON.stringify({
    d: data?.meta?.analyticsEndDate,
    s: data?.channel?.subscribers,
    v: data?.channel?.totalViews,
    wv: data?.weekly?.views,
    ws: data?.weekly?.netSubs,
    wh: data?.weekly?.watchHours,
  });

  // Rebuild queue only when data changes
  if (h !== HUD_STATE.lastDataHash) {
    intelQueue = buildIntelQueue(data);
    intelIndex = Math.floor(Math.random() * Math.max(1, intelQueue.length));
    HUD_STATE.warmupLeft = 3; // block Status right after refresh
    HUD_STATE.lastDataHash = h;
  }

  if (!HUD_CONFIG.timer) {
    showNextIntel();
    HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval);
  }
}

function pickNextIntel() {
  if (!intelQueue.length) return null;

  const now = Date.now();
  for (let tries = 0; tries < intelQueue.length; tries++) {
    const item = intelQueue[intelIndex];
    intelIndex = (intelIndex + 1) % intelQueue.length;

    // make Status rare and never early
    if (item.tag === TAG.Status) {
      if (HUD_STATE.warmupLeft > 0) continue;
      if ((now - HUD_STATE.lastStatusAt) < HUD_CONFIG.statusCooldownMs) continue;
    }

    const key = `${item.tag}|${item.text.slice(0, 50)}`;
    if (HUD_STATE.recentKeys.includes(key)) continue;

    // accept
    HUD_STATE.recentKeys.push(key);
    if (HUD_STATE.recentKeys.length > 5) HUD_STATE.recentKeys.shift();

    if (item.tag === TAG.Status) HUD_STATE.lastStatusAt = now;
    if (HUD_STATE.warmupLeft > 0) HUD_STATE.warmupLeft--;

    return item;
  }

  // fallback
  return intelQueue[0];
}

function showNextIntel() {
  const item = pickNextIntel();
  if (!item) return;

  // reshuffle at loop boundary for more randomness
  if (intelIndex === 0 && intelQueue.length > 3) shuffleInPlace(intelQueue);

  const msgEl = document.getElementById("hudMessage");
  const tagEl = document.getElementById("hudTag");
  const iconEl = document.getElementById("hudIcon");
  const barEl = document.getElementById("hudTimerFill");
  const boxEl = document.getElementById("hudBox");

  // pick color
  const c = COLORS[item.type] || COLORS.white;

  // 1) Reset ring progress cleanly
  boxEl.classList.add("hud-no-trans");
  boxEl.style.setProperty("--hud-color", c);
  boxEl.style.setProperty("--hud-dur", `${HUD_CONFIG.interval}ms`);
  boxEl.style.setProperty("--hud-p", "0");
  void boxEl.offsetWidth;
  boxEl.classList.remove("hud-no-trans");

  // 2) Reset bar
  barEl.style.transition = "none";
  barEl.style.width = "0%";

  // 3) Fade out
  msgEl.style.opacity = "0.2";

  setTimeout(() => {
    // 4) Update content
    msgEl.textContent = item.text;
    tagEl.textContent = item.tag;
    iconEl.innerHTML = item.icon;

    // 5) Glitch in
    msgEl.classList.remove("hud-glitch");
    void msgEl.offsetWidth;
    msgEl.classList.add("hud-glitch");
    msgEl.style.opacity = "1";

    // Tag glow
    tagEl.style.color = c;
    tagEl.style.textShadow = `0 0 10px ${c}`;

    // 6) Start ring + bar timer
    requestAnimationFrame(() => {
      boxEl.style.setProperty("--hud-p", "1");

      barEl.style.background = c;
      barEl.style.boxShadow = `0 0 10px ${c}`;
      barEl.style.transition = `width ${HUD_CONFIG.interval}ms linear`;
      barEl.style.width = "100%";
    });
  }, 220);
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
