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
  subs: { red: "Audience Leak", orange: "Slow Convert", yellow: "Steady Growth", green: "Strong Pull", blue: "Rising Fast", purple: "Exceptional" },
  views: { red: "Reach Down", orange: "Low Reach", yellow: "Stable Reach", green: "Reach Up", blue: "Trending", purple: "Viral" },
  watch: { red: "Poor Engage", orange: "Retention Issue", yellow: "Consistent", green: "Engage Up", blue: "Hooked", purple: "Outstanding" }
};

// --- DOM HELPERS ---
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function safeSetStyle(id, prop, val) { const el = document.getElementById(id); if (el) el.style[prop] = val; }
function safeSetHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

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

// --- UI SETTERS ---
function setCardTheme(cardId, tier) { const card = document.getElementById(cardId); if (card) card.style.setProperty("--c-tier", COLORS[tier] || COLORS.yellow); }
function setChip(dotId, chipTextId, tier, text) {
  const dot = document.getElementById(dotId);
  if (dot) { dot.style.background = COLORS[tier]; dot.style.boxShadow = `0 0 10px ${COLORS[tier]}`; }
  safeSetText(chipTextId, text);
}
function setMainArrow(elId, tier) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = tierArrow(tier); el.style.color = "var(--c-tier)"; el.style.textShadow = "0 0 15px var(--c-tier)"; }
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
function rgbaFromHex(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

function ensureSparkGradient(svgEl, gradId, tierHex) {
  if (!svgEl) return null;
  let defs = svgEl.querySelector("defs");
  if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); svgEl.insertBefore(defs, svgEl.firstChild); }
  let grad = svgEl.querySelector(`#${gradId}`);
  if (!grad) {
    grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    grad.setAttribute("id", gradId); grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
    grad.innerHTML = `<stop offset="0%"/><stop offset="70%"/><stop offset="100%"/>`;
    defs.appendChild(grad);
  }
  const stops = grad.querySelectorAll("stop");
  if (stops[0]) stops[0].setAttribute("stop-color", rgbaFromHex(tierHex, 0.22));
  if (stops[1]) stops[1].setAttribute("stop-color", "rgba(255,255,255,0.10)");
  if (stops[2]) stops[2].setAttribute("stop-color", "rgba(255,255,255,0.02)");
  return `url(#${gradId})`;
}

function setSpark(fillId, pathId, values, tier) {
  const fillEl = document.getElementById(fillId);
  const pathEl = document.getElementById(pathId);
  if (!fillEl || !pathEl) return;
  const vals = (values || []).map(Number);
  if (vals.length < 2) return;
  const w = 120, h = 40;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => ({ x: (i / (vals.length - 1)) * w, y: h - ((v - min) / span) * h }));
  let dLine = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i], cx = ((p.x + c.x) / 2).toFixed(1), cy = ((p.y + c.y) / 2).toFixed(1);
    dLine += ` Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${cx} ${cy}`;
  }
  dLine += ` T ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;
  pathEl.setAttribute("d", dLine); pathEl.style.stroke = COLORS[tier]; pathEl.style.strokeWidth = "2.4";
  fillEl.setAttribute("d", `${dLine} L ${w} ${h} L 0 ${h} Z`);
  const svgEl = fillEl.closest("svg");
  const gradUrl = ensureSparkGradient(svgEl, `grad-${fillId}`, COLORS[tier]);
  if (gradUrl) fillEl.style.fill = gradUrl;
}

function renderPacing(elId, cur, prev, suffix = "") {
  const c = Number(cur || 0), p = Number(prev || 0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);
  let pctHtml = pct > 0 ? `<span style="color:var(--c-green); font-size:0.9em;">(+${pct}%)</span>` : (pct < 0 ? `<span style="color:var(--c-red); font-size:0.9em;">(${pct}%)</span>` : `<span style="color:#666; font-size:0.9em;">(—)</span>`);
  const left = `<div><span style="opacity:0.6; margin-right:4px;">Last 7D:</span><b>${fmt(c)}${suffix}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">Prev:</span><span style="opacity:0.8">${fmt(p)}${suffix}</span></div>`;
  safeSetHTML(elId, left + right);
}

// --- CASINO ROLL ---
function ensureRoll(el) {
  if (!el || (el._rollWrap && el._rollCol)) return;
  el.textContent = "";
  const wrap = document.createElement("span"); wrap.className = "rollWrap";
  const col = document.createElement("span"); col.className = "rollCol";
  wrap.appendChild(col); el.appendChild(wrap);
  el._rollWrap = wrap; el._rollCol = col;
}
function setRollInstant(el, text) {
  if (!el) return; ensureRoll(el);
  const col = el._rollCol; col.style.transition = "none"; col.style.transform = "translateY(0)";
  col.innerHTML = `<span class="rollLine">${text}</span>`;
}
function animateCasinoRoll(el, fromVal, toVal, opts = {}) {
  if (!el) return;
  const decimals = opts.decimals ?? 0, suffix = opts.suffix ?? "", duration = opts.duration ?? 1600;
  const start = Number(fromVal || 0), end = Number(toVal || 0);
  ensureRoll(el); const col = el._rollCol;
  const scale = Math.pow(10, decimals);
  const a = Math.round(start * scale), b = Math.round(end * scale);
  const txt = (val) => (decimals ? fmt1(val / scale) : fmt(Math.round(val / scale))) + suffix;
  if (a === b) { setRollInstant(el, txt(b)); return; }
  const diff = b - a, absDiff = Math.abs(diff);
  let steps = [];
  if (absDiff <= 28) {
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) steps.push(a + (i * dir));
  } else { steps = [a, a + Math.round(diff / 2), b]; }
  col.style.transition = "none"; col.style.transform = "translateY(0)";
  col.innerHTML = steps.map((v, i) => `<span class="rollLine" ${(steps.length === 3 && i === 1) ? 'style="filter:blur(2px)"' : ''}>${txt(v)}</span>`).join("");
  void col.offsetHeight;
  col.style.transition = `transform ${duration}ms cubic-bezier(0.18, 0.9, 0.2, 1)`;
  col.style.transform = `translateY(${-1.1 * (steps.length - 1)}em)`;
}

// --- SPEEDOMETER ---
function animateSpeedometer(el, toVal, opts = {}) {
  if (!el) return;
  const decimals = opts.decimals ?? 0, suffix = opts.suffix ?? "", duration = opts.duration ?? 650;
  const endVal = Number(toVal || 0);
  if (el._spdRaf) cancelAnimationFrame(el._spdRaf);
  const t0 = performance.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const renderText = (v) => (decimals ? fmt1(v) : fmt(Math.round(v))) + suffix;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    el.textContent = renderText(endVal * easeOutCubic(p));
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
  const card = document.getElementById(cardId); if (!card) return;
  const el = document.createElement("div"); el.className = "floatIcon"; el.innerHTML = SVGS[type] || "";
  card.appendChild(el); setTimeout(() => el.remove(), 7000);
}

function triggerGlowOnce(cardId) {
  const card = document.getElementById(cardId); if (!card) return;
  card.classList.remove("glow-once"); void card.offsetWidth; card.classList.add("glow-once");
  setTimeout(() => card.classList.remove("glow-once"), 4000);
}
let glowTimer = null;

let state = { subs: 0, views: 0, watch: 0 };
function render(data, isFirst) {
  const ch = data.channel || {};
  if (ch.logo) { const v = `url("${ch.logo}")`; document.querySelectorAll(".card").forEach(c => c.style.setProperty("--logo-url", v)); }
  const cur = { subs: Number(ch.subscribers || 0), views: Number(ch.totalViews || 0), watch: Number(data.lifetime?.watchHours || 0) };
  if (isFirst) { document.querySelectorAll(".card").forEach((c, i) => { c.style.animationDelay = `${i * 100}ms`; c.classList.add("card-enter"); }); }

  const weekly = data.weekly || {}, last28 = data.m28?.last28 || {}, prev28 = data.m28?.prev28 || {}, med6m = data.m28?.median6m || {}, hist = data.history28d || [];

  // SUBS
  const tSubs = tierFromBaseline(last28.netSubs, med6m.netSubs, 30);
  setCardTheme("cardSubs", tSubs); setChip("subsDot", "subsChipText", tSubs, FEEDBACK.subs[tSubs]); setMainArrow("subsMainArrow", tSubs);
  setSpark("subsSparkFill", "subsSparkPath", hist.map(x => x.netSubs), tSubs);
  renderPacing("subsWeek", weekly.netSubs, weekly.prevNetSubs);
  setVsRG("subsVsNum", "subsVsArrow", (last28.netSubs || 0) - (data.m28?.avg6m?.netSubs || 0));
  safeSetText("subsLast28", (Number(last28.netSubs) >= 0 ? "+" : "") + fmt(last28.netSubs)); safeSetText("subsPrev28", (Number(prev28.netSubs) >= 0 ? "+" : "") + fmt(prev28.netSubs));
  const gSubs = getMilestone(cur.subs, "subs"), pSubs = Math.min(100, (cur.subs / gSubs) * 100).toFixed(1);
  safeSetText("subsNextGoal", fmt(gSubs)); safeSetText("subsNextPct", pSubs + "%"); safeSetStyle("subsProgressFill", "width", pSubs + "%");

  // VIEWS
  const tViews = tierFromBaseline(last28.views, med6m.views, 25000);
  setCardTheme("cardViews", tViews); setChip("viewsDot", "viewsChipText", tViews, FEEDBACK.views[tViews]); setMainArrow("viewsMainArrow", tViews);
  setSpark("viewsSparkFill", "viewsSparkPath", hist.map(x => x.views), tViews);
  renderPacing("viewsWeek", weekly.views, weekly.prevViews);
  setVsRG("viewsVsNum", "viewsVsArrow", (last28.views || 0) - (data.m28?.avg6m?.views || 0));
  safeSetText("viewsLast28", fmt(last28.views)); safeSetText("viewsPrev28", fmt(prev28.views));
  const gViews = getMilestone(cur.views, "views"), pViews = Math.min(100, (cur.views / gViews) * 100).toFixed(1);
  safeSetText("viewsNextGoal", fmt(gViews)); safeSetText("viewsNextPct", pViews + "%"); safeSetStyle("viewsProgressFill", "width", pViews + "%");

  // WATCH
  const tWatch = tierFromBaseline(last28.watchHours, med6m.watchHours, 50);
  setCardTheme("cardWatch", tWatch); setChip("watchDot", "watchChipText", tWatch, FEEDBACK.watch[tWatch]); setMainArrow("watchMainArrow", tWatch);
  setSpark("watchSparkFill", "watchSparkPath", hist.map(x => x.watchHours), tWatch);
  renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, "h");
  setVsRG("watchVsNum", "watchVsArrow", (last28.watchHours || 0) - (data.m28?.avg6m?.watchHours || 0), 1, "h");
  safeSetText("watchLast28", fmt(last28.watchHours) + "h"); safeSetText("watchPrev28", fmt(prev28.watchHours) + "h");
  const gWatch = getMilestone(cur.watch, "watch"), pWatch = Math.min(100, (cur.watch / gWatch) * 100).toFixed(1);
  safeSetText("watchNextGoal", fmt(gWatch)); safeSetText("watchNextPct", pWatch + "%"); safeSetStyle("watchProgressFill", "width", pWatch + "%");

  // ANIMATIONS
  const subsEl = document.getElementById("subsNow"), viewsEl = document.getElementById("viewsTotal"), watchEl = document.getElementById("watchNow");
  if (isFirst) {
    animateSpeedometer(subsEl, cur.subs, { duration: 650 }); animateSpeedometer(viewsEl, cur.views, { duration: 650 }); animateSpeedometer(watchEl, cur.watch, { duration: 650, decimals: cur.watch < 100 ? 1 : 0, suffix: "h" });
  } else {
    if (Math.round(cur.subs) !== Math.round(state.subs)) { animateCasinoRoll(subsEl, state.subs, cur.subs, { duration: 1800 }); if (cur.subs > state.subs) spawnFloatIcon("cardSubs", "subs"); } else setRollInstant(subsEl, fmt(cur.subs));
    if (Math.round(cur.views) !== Math.round(state.views)) { animateCasinoRoll(viewsEl, state.views, cur.views, { duration: 1800 }); if (cur.views > state.views) spawnFloatIcon("cardViews", "views"); } else setRollInstant(viewsEl, fmt(cur.views));
    const wDec = cur.watch < 100 ? 1 : 0, scale = wDec ? 10 : 1;
    if (Math.round(state.watch * scale) !== Math.round(cur.watch * scale)) { animateCasinoRoll(watchEl, state.watch, cur.watch, { decimals: wDec, suffix: "h", duration: 1800 }); if (cur.watch > state.watch) spawnFloatIcon("cardWatch", "watch"); } else setRollInstant(watchEl, (wDec ? fmt1(cur.watch) : fmt(Math.round(cur.watch))) + "h");
  }

  state = cur;
  if (!isFirst) { triggerGlowOnce("cardSubs"); triggerGlowOnce("cardViews"); triggerGlowOnce("cardWatch"); }
  clearTimeout(glowTimer); glowTimer = setTimeout(() => { triggerGlowOnce("cardSubs"); triggerGlowOnce("cardViews"); triggerGlowOnce("cardWatch"); }, 30000);

  updateHud(data);

  document.getElementById("updated").textContent = `SYSTEM ONLINE • ${nowStamp()}`;
  document.getElementById("toast").classList.add("show"); setTimeout(() => document.getElementById("toast").classList.remove("show"), 2000);
}

async function load(isFirst) {
  try { const data = await fetchJSON("/api/yt-kpis"); if (data.error) throw new Error(data.error); render(data, isFirst); }
  catch (e) { document.getElementById("updated").textContent = "FETCH ERROR: " + e.message; }
}

document.querySelectorAll(".card").forEach(card => {
  card.addEventListener("mousemove", (e) => { const r = card.getBoundingClientRect(), x = ((e.clientY - r.top) / r.height - 0.5) * -10, y = ((e.clientX - r.left) / r.width - 0.5) * 10; card.style.transform = `perspective(1000px) rotateX(${x}deg) rotateY(${y}deg) scale(1.02)`; });
  card.addEventListener("mouseleave", () => { card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale(1)`; });
});

/* ===========================
   HUD ENGINE (SCI-FI)
   =========================== */

const HUD_CONFIG = {
  interval: 16000,
  timer: null, started: false, bootAt: Date.now(),
  lastKey: null, recentKeys: [], shownAt: JSON.parse(localStorage.getItem("aihud_shownAt") || "{}"),
  cooldownMs: { freshness: 600000, birthday: 900000, status: 480000, trivia: 60000, tip: 60000, motivation: 90000 }
};
document.documentElement.style.setProperty("--hud-interval", "16s");

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

const KB = {
  facts: [
    "YouTube is the 2nd most visited site in existence.", "The first video 'Me at the zoo' has over 200M views.", "Mobile users visit YouTube twice as often as desktop users.",
    "Comedy, Music, and Entertainment are top genres.", "YouTube supports 80+ languages.", "More than 500 hours of video are uploaded every minute.",
    "Algorithm favors Watch Time over View Count.", "Bright thumbnails tend to have higher CTR.", "60% of people prefer online video to TV.",
    "Videos that keep viewers watching often get recommended more."
  ],
  tips: [
    "Audio is King: Bad video is forgiveable, bad audio is not.", "Hook 'em: The first 5 seconds determine retention.", "Metadata: Keywords in first sentence of description help.",
    "Hearting comments brings viewers back.", "Use End Screens to link best videos.", "Playlists increase Session Time.", "Use Shorts as a funnel.",
    "Rule of Thirds works for thumbnails.", "Cut the silence to keep energy up."
  ],
  motivation: [
    "Creation is a marathon. Pace yourself.", "Your next video could change everything.", "Don't compare your Ch 1 to their Ch 20.",
    "1,000 true fans beats 100,000 ghosts.", "Consistency is the cheat code.", "Focus on the 1 viewer watching."
  ],
  nostalgia: [
    "Remember why you started? Keep that spark.", "Look at your first video. Progress.", "Every big channel started with 0 subs."
  ]
};

function daysBetweenISO(aIso, bIso) { try { return Math.floor((new Date(bIso) - new Date(aIso)) / 86400000); } catch { return null; } }
function secondsToMinSec(s) { const n = Math.floor(Number(s||0)); return `${Math.floor(n/60)}m ${String(n%60).padStart(2,"0")}s`; }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
function uniqPush(arr, s) { if (!arr.includes(s)) arr.push(s); }

function initHudRing() {
  const rect = document.getElementById("hudRingRect"); if (!rect) return;
  rect.style.animation = "none"; rect.setAttribute("pathLength", "100");
  rect.style.strokeDasharray = "100"; rect.style.strokeDashoffset = "100";
}
function animateHudRing(colorHex) {
  const rect = document.getElementById("hudRingRect"); if (!rect) return;
  rect.style.stroke = colorHex; rect.style.transition = "none"; rect.style.strokeDashoffset = "100";
  requestAnimationFrame(() => { rect.style.transition = `stroke-dashoffset ${HUD_CONFIG.interval}ms linear`; rect.style.strokeDashoffset = "0"; });
}

function buildIntel(data) {
  const out = []; const ch = data.channel || {}, w = data.weekly || {}, m28 = data.m28 || {}, hud = data.hud || {}, hist = data.history28d || [];
  const weekViews = Number(w.views || 0), weekG = Number(w.subscribersGained || 0), weekL = Number(w.subscribersLost || 0), weekNet = Number(w.netSubs || 0);
  const churnPct = weekG > 0 ? Math.round((weekL / weekG) * 100) : (weekL > 0 ? 100 : 0);
  const minsPerView = weekViews > 0 ? (Number(w.minutesWatched||0) / weekViews) : 0;
  const subsPer1k = weekViews > 0 ? (weekNet / weekViews) * 1000 : 0;
  
  // REAL SIGNALS
  const uploadDaysAgo = (hud.uploads?.latest?.publishedAt && hud.statsThrough) ? daysBetweenISO(hud.uploads.latest.publishedAt, hud.statsThrough) : null;
  if (uploadDaysAgo !== null && uploadDaysAgo > 14) out.push({ key: "warn_gap", cat: "warning", weight: 3, icon: HUD_ICONS.warn, tag: "Warning", type: "orange", text: `Upload buffer empty. Last upload was ${uploadDaysAgo} days ago.` });
  
  if (weekG > 0 || weekL > 0) out.push({ key: "churn", cat: "subs", weight: 3.2, icon: weekL>weekG?HUD_ICONS.down:HUD_ICONS.up, tag: "Subs", type: weekL>weekG?"red":(weekNet>=0?"green":"orange"), text: `Gained ${fmt(weekG)}, Lost ${fmt(weekL)}. Net: ${weekNet}. Churn: ${churnPct}%.` });

  if (weekViews > 0) out.push({ key: "conv", cat: "conversion", weight: 2.6, icon: HUD_ICONS.target, tag: "Conversion", type: subsPer1k>=2?"green":"yellow", text: `You earned ${subsPer1k.toFixed(2)} net subs per 1k views this week.` });

  // CTR
  const thumb = hud.thumb28;
  if (thumb && thumb.ctr) {
    const ctr = thumb.ctr;
    out.push({ key: "ctr", cat: "packaging", weight: 2.1, icon: ctr<2?HUD_ICONS.warn:HUD_ICONS.bulb, tag: "Packaging", type: ctr<2?"orange":(ctr>8?"green":"yellow"), text: `Avg CTR (28d) is ${ctr.toFixed(1)}%. ${ctr<2?"Try brighter thumbs.":"Healthy."}` });
  }

  // Retention
  const ret = hud.retention28;
  if (ret && ret.avgViewPercentage) {
    const r = ret.avgViewPercentage;
    out.push({ key: "ret", cat: "retention", weight: 2, icon: r<35?HUD_ICONS.warn:HUD_ICONS.up, tag: "Retention", type: r<35?"orange":(r>50?"green":"yellow"), text: `Avg View % is ${r.toFixed(0)}%. ${r<35?"Tighten intros.":"Strong."}` });
  }

  // LATEST VIDEO
  const lv = hud.latestVideo;
  if (lv && lv.title) {
    const vViews = Number(lv.views||0), vLikes = Number(lv.likes||0);
    const likeRate = vViews > 0 ? (vLikes/vViews)*100 : 0;
    out.push({ key: "lv_stat", cat: "video", weight: 2.8, icon: HUD_ICONS.rocket, tag: "Video", type: "purple", text: `Latest: "${lv.title}" has ${fmt(vViews)} views & ${fmt(vLikes)} likes.` });
    if (vViews>0) out.push({ key: "lv_rate", cat: "video", weight: 2, icon: HUD_ICONS.up, tag: "Video", type: likeRate>4?"green":"yellow", text: `Latest video like rate is ${likeRate.toFixed(1)}%.` });
  }

  // GENERIC
  const nextSub = getMilestone(Number(ch.subscribers||0), "subs");
  if (nextSub > Number(ch.subscribers||0)) out.push({ key: "goal", cat: "goal", weight: 1.4, icon: HUD_ICONS.target, tag: "Goal", type: "blue", text: `${fmt(nextSub - Number(ch.subscribers))} subs to reach ${fmt(nextSub)}.` });

  const tip = pick(KB.tips); if (tip) out.push({ key: "tip", cat: "tip", weight: 0.4, icon: HUD_ICONS.bulb, tag: "Tip", type: "yellow", text: tip });
  const fact = pick(KB.facts); if (fact) out.push({ key: "fact", cat: "trivia", weight: 0.3, icon: HUD_ICONS.bulb, tag: "Fact", type: "purple", text: fact });

  return out;
}

function showNextIntel() {
  const item = intelQueue.length ? intelQueue[Math.floor(Math.random() * intelQueue.length)] : null;
  if (!item) return;
  const msg = document.getElementById("hudMessage"), tag = document.getElementById("hudTag"), icon = document.getElementById("hudIcon"), box = document.getElementById("hudBox");
  if (msg) {
    msg.style.opacity = "0.2";
    setTimeout(() => {
      msg.textContent = item.text; tag.textContent = item.tag; icon.innerHTML = item.icon || "⚡";
      const c = COLORS[item.type] || COLORS.white; tag.style.color = c; tag.style.textShadow = `0 0 10px ${c}`;
      if (box) box.style.setProperty("--hud-accent", c);
      msg.classList.remove("hud-glitch"); void msg.offsetWidth; msg.classList.add("hud-glitch"); msg.style.opacity = "1";
      animateHudRing(c);
    }, 220);
  }
}

function updateHud(data) {
  intelQueue = buildIntel(data);
  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true; initHudRing();
    setTimeout(() => { showNextIntel(); HUD_CONFIG.timer = setInterval(showNextIntel, HUD_CONFIG.interval); }, 1200);
  }
}

(async function init() { await load(true); setInterval(() => load(false), 60 * 1000); })();
