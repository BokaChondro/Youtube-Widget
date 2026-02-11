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

// --- GLOW ONCE (timing controlled by CSS duration = 4s) ---
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

    // glow once on refresh + every 30s (duration handled in CSS/keyframes but class removed after 4s)
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

    // --- INTEGRATION: TRIGGER HUD UPDATE ---
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


/* --- HOLO-STREAM HUD ENGINE (AI MODE) --- */
const HUD_CONFIG = {
  interval: 8500,
  timer: null
};

// White SVG Icons for HUD (fill="white")
const HUD_ICONS = {
  ai: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2a7 7 0 0 0-7 7v3a3 3 0 0 0 2 2.83V17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-2.17A3 3 0 0 0 19 12V9a7 7 0 0 0-7-7Zm5 10a1 1 0 0 1-1 1h-1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4H8a1 1 0 0 1-1-1V9a5 5 0 0 1 10 0v3Z"/></svg>`,
  live: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2.5s-4 4.88-4 10.38c0 3.31 1.34 4.88 1.34 4.88L9 22h6l-.34-4.25s1.34-1.56 1.34-4.88S12 2.5 12 2.5zM7.5 13c0-3.32 2.68-7.5 4.5-7.5s4.5 4.18 4.5 7.5c0 2.5-1.5 4.38-1.5 4.38H9s-1.5-1.88-1.5-4.38z"/></svg>`,
  chartUp: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
  chartDown: `<svg viewBox="0 0 24 24" fill="white"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="white"><path d="M11 21h-1l1-7H7l6-12h1l-1 7h4l-6 12z"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" fill="white"><path d="M3 3h7v2H5v5H3V3zm16 0h-7v2h5v5h2V3zM3 21h7v-2H5v-5H3v7zm18 0h-7v-2h5v-5h2v7z"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" fill="white"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  strategy: `<svg viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>`
};

// Topic-based facts (short + safe)
const YT_TRIVIA = {
  reach: [
    "Small title + thumbnail changes can lift clicks.",
    "Search traffic grows when your title matches real words people type.",
    "A clear promise in the first line helps the viewer stay."
  ],
  retention: [
    "The first 15 seconds should show the main value fast.",
    "Cut dead time. Faster pacing usually improves watch time.",
    "Chapters help viewers find the part they want."
  ],
  conversion: [
    "Ask people to subscribe right after you deliver value.",
    "Pin a comment that links to your next best video.",
    "End screens can send viewers to one more video."
  ],
  system: [
    "Watch time + satisfaction matters more than views alone.",
    "One strong video can push the whole channel up.",
    "Playlists help viewers keep watching."
  ]
};

// Focus tips (actionable + simple)
const YT_TIPS = {
  reach: [
    "Try 2 new thumbnails for the same idea. Keep the best one.",
    "Use 3-6 simple words in the title. Make the benefit clear.",
    "Make the first frame match the thumbnail."
  ],
  retention: [
    "Start with the result first, then explain how you got it.",
    "Remove long intros. Go straight to the point.",
    "Add pattern breaks every 20-30 seconds (zoom, text, cut)."
  ],
  conversion: [
    "Say one clear CTA: 'Subscribe for ___'. Not many asks.",
    "Tell viewers what they get next if they subscribe.",
    "Use end screen: 1 best video + 1 subscribe button."
  ],
  system: [
    "Post on a steady rhythm. Even 1 video per week is good.",
    "Reply to comments in the first hour to boost signals.",
    "Make a playlist for your best series and link it often."
  ]
};

// Helpers (AI-style)
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function safePct(cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  if (p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 100);
}
function signed(n) { return (Number(n) >= 0 ? "+" : "") + fmt(n); }
function pick(arr, seed) { return arr && arr.length ? arr[Math.abs(seed) % arr.length] : ""; }

function seedFromData(data) {
  const ch = data.channel || {};
  const w = data.weekly || {};
  const m = data.m28?.last28 || {};
  const a = Number(ch.subscribers || 0) * 7;
  const b = Number(ch.totalViews || 0);
  const c = Math.round(Number(w.views || 0) * 3);
  const d = Math.round(Number(m.netSubs || 0) * 11);
  return a + b + c + d;
}

function decideFocus(data) {
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

function bestDaySummary(daily7d) {
  const arr = (daily7d || []).slice().filter(x => x && x.day);
  if (arr.length < 2) return null;
  let best = arr[0];
  for (const d of arr) if (Number(d.views || 0) > Number(best.views || 0)) best = d;
  return best ? { day: best.day, views: Number(best.views || 0) } : null;
}

function rank28(lastVal, historyVals) {
  const arr = (historyVals || []).map(Number).filter(Number.isFinite);
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a,b)=>b-a);
  const idx = sorted.findIndex(v => v === Number(lastVal));
  return idx >= 0 ? (idx + 1) : null;
}

function etaText(diff, perDay) {
  const d = Number(diff || 0);
  const p = Number(perDay || 0);
  if (d <= 0) return null;
  if (p <= 0) return null;
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

  const wowViewsPct = safePct(weekViews, w.prevViews);
  const wowWatchPct = safePct(weekWatch, w.prevWatchHours);
  const wowSubsPct = safePct(weekNetSubs, w.prevNetSubs);

  const endDate = meta.analyticsEndDate || w.endDate || "";

  // 1) STATUS (always first)
  intel.push({
    icon: HUD_ICONS.ai, tag: "AI_CORE", type: "blue",
    text: `AI online. Reading ${ch.title || "channel"} • Stats thru ${endDate || "latest"}.`
  });

  // 2) WEEK SUMMARY
  const weekLine = `Last 7D: ${signed(weekNetSubs)} subs • ${fmt(weekViews)} views • ${fmt1(weekWatch)}h watch.`;
  intel.push({ icon: HUD_ICONS.scan, tag: "WEEK_SCAN", type: "blue", text: weekLine });

  // 3) MOMENTUM (views)
  if (wowViewsPct !== null) {
    if (wowViewsPct >= 8) {
      intel.push({
        icon: HUD_ICONS.chartUp, tag: "MOMENTUM", type: "green",
        text: `Views speed up: +${wowViewsPct}% vs last week. Keep the winning topic.`
      });
    } else if (wowViewsPct <= -8) {
      intel.push({
        icon: HUD_ICONS.chartDown, tag: "WARNING", type: "red",
        text: `Views slow down: ${wowViewsPct}% vs last week. Check title + thumbnail.`
      });
    } else {
      intel.push({
        icon: HUD_ICONS.bolt, tag: "STABLE", type: "yellow",
        text: `Views steady: ${wowViewsPct > 0 ? "+" : ""}${wowViewsPct}% vs last week.`
      });
    }
  }

  // 4) WATCH SIGNAL
  if (wowWatchPct !== null) {
    if (wowWatchPct >= 8) {
      intel.push({
        icon: HUD_ICONS.chartUp, tag: "RETENTION", type: "green",
        text: `Watch time up: +${wowWatchPct}% vs last week. Strong viewer pull.`
      });
    } else if (wowWatchPct <= -8) {
      intel.push({
        icon: HUD_ICONS.chartDown, tag: "RETENTION", type: "red",
        text: `Watch time down: ${wowWatchPct}% vs last week. Improve the first 15s.`
      });
    }
  }

  // 5) SUBS QUALITY (gained vs lost)
  if (weekG + weekL > 0) {
    const churnShare = Math.round((weekL / Math.max(1, weekG + weekL)) * 100);
    if (weekNetSubs < 0) {
      intel.push({
        icon: HUD_ICONS.chartDown, tag: "CHURN", type: "red",
        text: `Churn alert: lost ${fmt(weekL)} subs vs gained ${fmt(weekG)}.`
      });
    } else if (churnShare >= 35) {
      intel.push({
        icon: HUD_ICONS.bolt, tag: "QUALITY", type: "yellow",
        text: `Subs mixed: lost ${fmt(weekL)} (about ${churnShare}%). Fix audience match.`
      });
    } else {
      intel.push({
        icon: HUD_ICONS.rocket, tag: "GROWTH", type: "green",
        text: `Subs healthy: gained ${fmt(weekG)} with low churn (${churnShare}%).`
      });
    }
  }

  // 6) 28D CONTEXT (AI ranking + delta)
  const p28Views = safePct(Number(last28.views || 0), Number(prev28.views || 0));
  if (p28Views !== null) {
    const up = p28Views >= 6;
    const down = p28Views <= -6;
    intel.push({
      icon: up ? HUD_ICONS.chartUp : (down ? HUD_ICONS.chartDown : HUD_ICONS.bolt),
      tag: "28D_CONTEXT",
      type: up ? "green" : (down ? "red" : "yellow"),
      text: `Last 28D views: ${fmt(last28.views)} (${p28Views > 0 ? "+" : ""}${p28Views}% vs prev 28D).`
    });
  }

  // Rank this 28D in your last 7 windows
  const rankViews = rank28(Number(last28.views || 0), hist.map(x => x.views));
  if (rankViews) {
    const type = rankViews === 1 ? "purple" : (rankViews <= 2 ? "green" : "blue");
    intel.push({
      icon: HUD_ICONS.scan, tag: "RANK", type,
      text: `AI rank: This 28D is #${rankViews} out of your last 7 periods (views).`
    });
  }

  // 7) BEST DAY THIS WEEK
  const best = bestDaySummary(daily7d);
  if (best && best.views > 0) {
    intel.push({
      icon: HUD_ICONS.bolt, tag: "BEST_DAY", type: "blue",
      text: `Best day this week: ${best.day} with ${fmt(best.views)} views.`
    });
  }

  // 8) MILESTONE ETA (subs + views)
  const nextSubGoal = getMilestone(subs, "subs");
  const subDiff = nextSubGoal - subs;
  const subsPerDay = weekNetSubs > 0 ? (weekNetSubs / 7) : 0;
  const subEta = etaText(subDiff, subsPerDay);

  if (subDiff > 0) {
    let msg = `Next subs goal: ${fmt(nextSubGoal)} (need ${fmt(subDiff)}).`;
    if (subEta) msg += ` At this pace: ${subEta}.`;
    intel.push({ icon: HUD_ICONS.target, tag: "TARGET", type: "blue", text: msg });
  }

  const nextViewGoal = getMilestone(views, "views");
  const viewDiff = nextViewGoal - views;
  const viewsPerDay = weekViews > 0 ? (weekViews / 7) : 0;
  const viewEta = etaText(viewDiff, viewsPerDay);
  if (viewDiff > 0 && viewEta) {
    intel.push({
      icon: HUD_ICONS.target, tag: "GOAL_ETA", type: "blue",
      text: `Next views goal: ${fmt(nextViewGoal)} (need ${fmt(viewDiff)}). ETA: ${viewEta}.`
    });
  }

  // 9) CHANNEL SHAPE (views per video / lifetime pace)
  if (vids > 0) {
    const vPerVideo = Math.round(views / vids);
    intel.push({
      icon: HUD_ICONS.scan, tag: "PROFILE", type: "blue",
      text: `Channel size: ${fmt(vids)} videos • Avg ${fmt(vPerVideo)} views per video.`
    });
  }

  // 10) FOCUS + TIP (AI picks a focus area)
  const focusLabel =
    focus === "retention" ? "Retention Focus" :
    focus === "conversion" ? "Conversion Focus" :
    "Reach Focus";

  const focusText =
    focus === "retention"
      ? "Main leak looks like retention. Make the first 15s stronger."
      : (focus === "conversion"
        ? "Main leak looks like conversion. Turn viewers into subs."
        : "Main leak looks like reach. Improve clicks and discovery.");

  intel.push({
    icon: HUD_ICONS.strategy, tag: "AI_FOCUS", type: "yellow",
    text: `${focusLabel}: ${focusText}`
  });

  const tip = pick(YT_TIPS[focus] || YT_TIPS.system, seed);
  intel.push({ icon: HUD_ICONS.strategy, tag: "TIP", type: "yellow", text: `Tip: ${tip}` });

  // 11) TRIVIA (topic-based, deterministic)
  const trivia = pick(YT_TRIVIA[focus] || YT_TRIVIA.system, seed + 33);
  intel.push({ icon: HUD_ICONS.bulb, tag: "TRIVIA", type: "purple", text: `Trivia: ${trivia}` });

  // Limit length so it feels curated (AI, not spam)
  return intel.slice(0, 10);
}

let intelQueue = [];
let intelIndex = 0;
let lastIntelHash = "";

function updateHud(data) {
  // Rebuild intel only if data changed (reduces random feeling)
  const h = JSON.stringify({
    a: data?.meta?.analyticsEndDate,
    b: data?.channel?.subscribers,
    c: data?.channel?.totalViews,
    d: data?.weekly?.views,
    e: data?.weekly?.netSubs,
    f: data?.m28?.last28?.views
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

  // Reset Bar
  barEl.style.transition = "none";
  barEl.style.width = "0%";

  // Fade out quickly
  msgEl.style.opacity = "0.2";

  setTimeout(() => {
    // Update content
    msgEl.textContent = item.text;
    tagEl.textContent = item.tag;
    iconEl.innerHTML = item.icon;

    // Glitch in
    msgEl.classList.remove("hud-glitch");
    void msgEl.offsetWidth;
    msgEl.classList.add("hud-glitch");
    msgEl.style.opacity = "1";

    // Color logic
    const c = COLORS[item.type] || COLORS.white;
    tagEl.style.color = c;
    tagEl.style.textShadow = `0 0 10px ${c}`;

    boxEl.style.borderLeftColor = c;

    barEl.style.background = c;
    barEl.style.boxShadow = `0 0 10px ${c}`;

    // Start timer bar
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
