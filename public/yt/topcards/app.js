/* =========================================================
   public/yt/topcards/app.js — Sci-Fi Cyberpunk Edition
   ========================================================= */

// --- FORMATTERS ---
const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleTimeString(); }

// --- TIER COLORS (High Saturation for Neon) ---
const COLORS = {
  green:  "#00FF9D",
  red:    "#FF003C",
  blue:   "#00E0FF",
  yellow: "#FCEE0A",
  purple: "#D500F9",
  pink:   "#FF007F",
  orange: "#FF9100",
  white:  "#FFFFFF"
};

const FEEDBACK = {
  subs: { red: "CRITICAL", orange: "WARNING", yellow: "STABLE", green: "OPTIMAL", blue: "SURGE", purple: "LEGENDARY" },
  views: { red: "DOWNTREND", orange: "LOW FLUX", yellow: "NOMINAL", green: "RISING", blue: "TRENDING", purple: "VIRAL" },
  watch: { red: "LOW ENGAGE", orange: "ATTN LEAK", yellow: "STEADY", green: "HOOKED", blue: "BINGING", purple: "HYPNOTIC" },
  realtime: { red: "CRASH", orange: "ALERT", yellow: "FLAT", green: "PACE UP", blue: "VELOCITY", purple: "MAX POWER" }
};

// --- DOM HELPERS ---
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function safeSetStyle(id, prop, val) { const el = document.getElementById(id); if (el) el.style[prop] = val; }
function safeSetHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function tierArrow(tier) {
  if (tier === "red") return "▼▼";
  if (tier === "orange") return "▼";
  if (tier === "yellow") return "◼";
  if (tier === "green") return "▲";
  if (tier === "blue") return "▲▲";
  return "⚡";
}

function tierFromBaseline(last28, median6m, absMin) {
  const L = Number(last28 || 0), B = Number(median6m || 0);
  if (B <= 0) return L > absMin ? "green" : "orange";
  const ratio = L / B;
  if (ratio < 0.7) return "red";
  if (ratio < 0.85) return "orange";
  if (ratio < 1.15) return "yellow";
  if (ratio < 1.3) return "green";
  if (ratio < 1.6) return "blue";
  return "purple";
}

function tierRealtime(last24, prev6Avg, absMin = 100) {
  const L = Number(last24 || 0), B = Number(prev6Avg || 0);
  if (B <= 0) return L > absMin ? "green" : "orange";
  const ratio = L / B;
  if (ratio < 0.5) return "red";
  if (ratio < 0.9) return "orange";
  if (ratio < 1.1) return "yellow";
  if (ratio < 1.5) return "green";
  if (ratio < 2.0) return "blue";
  return "purple";
}

function getMilestoneLimits(val, type) {
  const v = Number(val || 0);
  if (v < 0) return { min: 0, max: 100 };
  if (type === "watch") {
    if (v < 100) return { min: 0, max: 100 };
    if (v < 4000) return { min: 100, max: 4000 };
    if (v < 10000) return { min: Math.floor(v/1000)*1000, max: Math.floor(v/1000)*1000 + 1000 };
    return { min: Math.floor(v/5000)*5000, max: Math.floor(v/5000)*5000 + 5000 };
  }
  let step = 100;
  if (v >= 10000000) step = 10000000;
  else if (v >= 1000000) step = 1000000;
  else if (v >= 100000) step = 100000;
  else if (v >= 10000) step = 10000;
  else if (v >= 1000) step = 1000;
  const min = Math.floor(v / step) * step;
  return { min, max: min + step };
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function setCardTheme(cardId, tier) { const card = document.getElementById(cardId); if (card) card.style.setProperty("--c-tier", COLORS[tier] || COLORS.yellow); }
function setChip(dotId, chipTextId, tier, text) {
  const dot = document.getElementById(dotId);
  if (dot) { dot.style.background = COLORS[tier]; dot.style.boxShadow = `0 0 10px ${COLORS[tier]}`; }
  safeSetText(chipTextId, text);
}
function setMainArrow(elId, tier) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = tierArrow(tier); el.style.color = "var(--c-tier)"; el.style.textShadow = "0 0 10px var(--c-tier)"; }
}
function setVsRG(elNumId, elArrowId, delta, decimals = 0, suffix = "") {
  const numEl = document.getElementById(elNumId), arrEl = document.getElementById(elArrowId);
  if (!numEl || !arrEl) return;
  const d = Number(delta || 0);
  numEl.className = d > 0 ? "vsNum pos" : (d < 0 ? "vsNum neg" : "vsNum neu");
  arrEl.className = d > 0 ? "vsArrow pos" : (d < 0 ? "vsArrow neg" : "vsArrow neu");
  arrEl.textContent = d > 0 ? "▲" : (d < 0 ? "▼" : "◼");
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
  if (stops[0]) stops[0].setAttribute("stop-color", rgbaFromHex(tierHex, 0.4)); // Higher opacity for neon
  if (stops[1]) stops[1].setAttribute("stop-color", "rgba(255,255,255,0.1)");
  if (stops[2]) stops[2].setAttribute("stop-color", "rgba(255,255,255,0.0)");
  return `url(#${gradId})`;
}

function setSpark(fillId, pathId, values, tier) {
  const fillEl = document.getElementById(fillId), pathEl = document.getElementById(pathId);
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
  pathEl.setAttribute("d", dLine); pathEl.style.stroke = COLORS[tier]; pathEl.style.strokeWidth = "2"; 
  pathEl.style.filter = `drop-shadow(0 0 4px ${COLORS[tier]})`; // Neon line
  fillEl.setAttribute("d", `${dLine} L ${w} ${h} L 0 ${h} Z`);
  const svgEl = fillEl.closest("svg");
  const gradUrl = ensureSparkGradient(svgEl, `grad-${fillId}`, COLORS[tier]);
  if (gradUrl) fillEl.style.fill = gradUrl;
}

function renderPacing(elId, cur, prev, suffix = "") {
  const c = Number(cur || 0), p = Number(prev || 0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);
  let pctHtml = pct > 0 ? `<span style="color:var(--c-green); font-size:0.9em; text-shadow:0 0 5px var(--c-green)">(+${pct}%)</span>` : (pct < 0 ? `<span style="color:var(--c-red); font-size:0.9em; text-shadow:0 0 5px var(--c-red)">(${pct}%)</span>` : `<span style="color:#666; font-size:0.9em;">(—)</span>`);
  const left = `<div><span style="opacity:0.6; margin-right:4px;">L-7D:</span><b>${fmt(c)}${suffix}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">PREV:</span><span style="opacity:0.8">${fmt(p)}${suffix}</span></div>`;
  safeSetHTML(elId, left + right);
}

function renderHourlyPacing(elId, cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);
  let pctHtml = pct > 0 ? `<span style="color:var(--c-green); font-size:0.9em; text-shadow:0 0 5px var(--c-green)">(+${pct}%)</span>` : (pct < 0 ? `<span style="color:var(--c-red); font-size:0.9em; text-shadow:0 0 5px var(--c-red)">(${pct}%)</span>` : `<span style="color:#666; font-size:0.9em;">(—)</span>`);
  const left = `<div><span style="opacity:0.6; margin-right:4px;">L-1H:</span><b>${fmt(c)}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">P-1H:</span><span style="opacity:0.8">${fmt(p)}</span></div>`;
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
  watch: `<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8 8-8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
};
function spawnFloatIcon(cardId, type) {
  const card = document.getElementById(cardId); if (!card) return;
  const el = document.createElement("div"); el.className = "floatIcon"; el.innerHTML = SVGS[type] || "";
  card.appendChild(el); setTimeout(() => el.remove(), 4000);
}

function triggerGlowOnce(cardId) {
  const card = document.getElementById(cardId); if (!card) return;
  card.classList.remove("glow-once"); void card.offsetWidth; card.classList.add("glow-once");
  setTimeout(() => card.classList.remove("glow-once"), 2000);
}

/* =========================================================
   GLITCH SYSTEM (Sci-Fi Randomness)
   ========================================================= */
const GLITCH_CHARS = "█▓▒░<>/\\!@#$%^&*()_+-=[]{}|;:,.~`";
function glitchText(element) {
  if (!element || element.classList.contains('glitching')) return;
  
  const original = element.textContent;
  if (!original || original.length < 2) return;
  
  element.classList.add('glitching');
  element.classList.add('glitch-skew'); // CSS anim

  let iterations = 0;
  const maxIterations = 5;
  const interval = setInterval(() => {
    element.textContent = original.split("").map((char, i) => {
      if (char === " " || Math.random() > 0.5) return char;
      return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
    }).join("");
    
    iterations++;
    if (iterations >= maxIterations) {
      clearInterval(interval);
      element.textContent = original;
      element.classList.remove('glitch-skew');
      element.classList.remove('glitching');
    }
  }, 50);
}

function triggerRandomGlitch() {
  const targets = document.querySelectorAll('.glitch-target');
  if (targets.length === 0) return;
  // Pick one random target
  const target = targets[Math.floor(Math.random() * targets.length)];
  glitchText(target);
}
// Start random glitch loop (every 3-6 seconds)
setInterval(triggerRandomGlitch, 4000);

// --- RENDER ---
let state = { subs: 0, views: 0, watch: 0, rt: 0 };
let glowTimer = null;

function render(data, isFirst) {
  const ch = data.channel || {};
  if (ch.logo) { const v = `url("${ch.logo}")`; document.querySelectorAll(".card").forEach(c => c.style.setProperty("--logo-url", v)); }
  const rt = data.realtime || {};
  const cur = { 
    subs: Number(ch.subscribers || 0), 
    views: Number(ch.totalViews || 0), 
    watch: Number(data.lifetime?.watchHours || 0),
    rt: Number(rt.views48h || 0)
  };
  
  if (isFirst) { document.querySelectorAll(".card").forEach((c, i) => { c.style.animationDelay = `${i * 100}ms`; c.classList.add("card-enter"); }); }

  const weekly = data.weekly || {}, last28 = data.m28?.last28 || {}, prev28 = data.m28?.prev28 || {}, med6m = data.m28?.median6m || {}, hist = data.history28d || [];

  // 1. SUBS
  const tSubs = tierFromBaseline(last28.netSubs, med6m.netSubs, 30);
  setCardTheme("cardSubs", tSubs); setChip("subsDot", "subsChipText", tSubs, FEEDBACK.subs[tSubs]); setMainArrow("subsMainArrow", tSubs);
  setSpark("subsSparkFill", "subsSparkPath", hist.map(x => x.netSubs), tSubs);
  renderPacing("subsWeek", weekly.netSubs, weekly.prevNetSubs);
  setVsRG("subsVsNum", "subsVsArrow", (last28.netSubs || 0) - (data.m28?.avg6m?.netSubs || 0));
  safeSetText("subsLast28", (Number(last28.netSubs) >= 0 ? "+" : "") + fmt(last28.netSubs)); safeSetText("subsPrev28", (Number(prev28.netSubs) >= 0 ? "+" : "") + fmt(prev28.netSubs));
  const mSubs = getMilestoneLimits(cur.subs, "subs");
  const pSubs = Math.min(100, Math.max(0, ((cur.subs - mSubs.min) / (mSubs.max - mSubs.min)) * 100)).toFixed(1);
  safeSetText("subsNextGoal", fmt(mSubs.max)); safeSetText("subsNextPct", pSubs + "%"); safeSetStyle("subsProgressFill", "width", pSubs + "%");

  // 2. REALTIME
  const rtLast24 = Number(rt.last24h || 0), rtPrev6Avg = Number(rt.avgPrior6d || 0), vsDelta = Number(rt.vs7dAvgDelta || 0); 
  const tRt = tierRealtime(rtLast24, rtPrev6Avg, 500); 
  setCardTheme("cardRealtime", tRt); setChip("rtDot", "rtChipText", tRt, FEEDBACK.realtime[tRt]); setMainArrow("rtMainArrow", tRt);
  setSpark("rtSparkFill", "rtSparkPath", rt.sparkline || [], tRt);
  renderHourlyPacing("rtPacing", rt.lastHour, rt.prevHour);
  setVsRG("rtVsNum", "rtVsArrow", vsDelta);
  safeSetText("rtLast24", fmt(rt.last24h)); safeSetText("rtPrev24", fmt(rt.prev24h));
  const mRt = getMilestoneLimits(cur.rt, "views");
  const pRt = Math.min(100, Math.max(0, ((cur.rt - mRt.min) / (mRt.max - mRt.min)) * 100)).toFixed(1);
  safeSetText("rtNextGoal", fmt(mRt.max)); safeSetText("rtNextPct", pRt + "%"); safeSetStyle("rtProgressFill", "width", pRt + "%");

  // 3. VIEWS
  const tViews = tierFromBaseline(last28.views, med6m.views, 25000);
  setCardTheme("cardViews", tViews); setChip("viewsDot", "viewsChipText", tViews, FEEDBACK.views[tViews]); setMainArrow("viewsMainArrow", tViews);
  setSpark("viewsSparkFill", "viewsSparkPath", hist.map(x => x.views), tViews);
  renderPacing("viewsWeek", weekly.views, weekly.prevViews);
  setVsRG("viewsVsNum", "viewsVsArrow", (last28.views || 0) - (data.m28?.avg6m?.views || 0));
  safeSetText("viewsLast28", fmt(last28.views)); safeSetText("viewsPrev28", fmt(prev28.views));
  const mViews = getMilestoneLimits(cur.views, "views");
  const pViews = Math.min(100, Math.max(0, ((cur.views - mViews.min) / (mViews.max - mViews.min)) * 100)).toFixed(1);
  safeSetText("viewsNextGoal", fmt(mViews.max)); safeSetText("viewsNextPct", pViews + "%"); safeSetStyle("viewsProgressFill", "width", pViews + "%");

  // 4. WATCH HOURS
  const tWatch = tierFromBaseline(last28.watchHours, med6m.watchHours, 50);
  setCardTheme("cardWatch", tWatch); setChip("watchDot", "watchChipText", tWatch, FEEDBACK.watch[tWatch]); setMainArrow("watchMainArrow", tWatch);
  setSpark("watchSparkFill", "watchSparkPath", hist.map(x => x.watchHours), tWatch);
  renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, "h");
  setVsRG("watchVsNum", "watchVsArrow", (last28.watchHours || 0) - (data.m28?.avg6m?.watchHours || 0), 1, "h");
  safeSetText("watchLast28", fmt(last28.watchHours) + "h"); safeSetText("watchPrev28", fmt(prev28.watchHours) + "h");
  const mWatch = getMilestoneLimits(cur.watch, "watch");
  const pWatch = Math.min(100, Math.max(0, ((cur.watch - mWatch.min) / (mWatch.max - mWatch.min)) * 100)).toFixed(1);
  safeSetText("watchNextGoal", fmt(mWatch.max)); safeSetText("watchNextPct", pWatch + "%"); safeSetStyle("watchProgressFill", "width", pWatch + "%");

  // ANIMATIONS
  const subsEl = document.getElementById("subsNow"), rtEl = document.getElementById("rtNow"), viewsEl = document.getElementById("viewsTotal"), watchEl = document.getElementById("watchNow");
  if (isFirst) {
    animateSpeedometer(subsEl, cur.subs, { duration: 650 }); 
    animateSpeedometer(rtEl, cur.rt, { duration: 650 });
    animateSpeedometer(viewsEl, cur.views, { duration: 650 }); 
    animateSpeedometer(watchEl, cur.watch, { duration: 650, decimals: cur.watch < 100 ? 1 : 0, suffix: "h" });
  } else {
    if (Math.round(cur.subs) !== Math.round(state.subs)) { animateCasinoRoll(subsEl, state.subs, cur.subs, { duration: 1800 }); if (cur.subs > state.subs) spawnFloatIcon("cardSubs", "subs"); } else setRollInstant(subsEl, fmt(cur.subs));
    if (Math.round(cur.rt) !== Math.round(state.rt)) { animateCasinoRoll(rtEl, state.rt, cur.rt, { duration: 1800 }); if (cur.rt > state.rt) spawnFloatIcon("cardRealtime", "views"); } else setRollInstant(rtEl, fmt(cur.rt));
    if (Math.round(cur.views) !== Math.round(state.views)) { animateCasinoRoll(viewsEl, state.views, cur.views, { duration: 1800 }); if (cur.views > state.views) spawnFloatIcon("cardViews", "views"); } else setRollInstant(viewsEl, fmt(cur.views));
    const wDec = cur.watch < 100 ? 1 : 0, scale = wDec ? 10 : 1;
    if (Math.round(state.watch * scale) !== Math.round(cur.watch * scale)) { animateCasinoRoll(watchEl, state.watch, cur.watch, { decimals: wDec, suffix: "h", duration: 1800 }); if (cur.watch > state.watch) spawnFloatIcon("cardWatch", "watch"); } else setRollInstant(watchEl, (wDec ? fmt1(cur.watch) : fmt(Math.round(cur.watch))) + "h");
  }

  state = cur;
  if (!isFirst) { triggerGlowOnce("cardSubs"); triggerGlowOnce("cardRealtime"); triggerGlowOnce("cardViews"); triggerGlowOnce("cardWatch"); }
  
  clearTimeout(glowTimer); 
  glowTimer = setTimeout(() => { 
    triggerGlowOnce("cardSubs"); triggerGlowOnce("cardRealtime");
    triggerGlowOnce("cardViews"); triggerGlowOnce("cardWatch"); 
  }, 30000);

  updateHud(data);
  document.getElementById("updated").textContent = `SYSTEM ONLINE // ${nowStamp()}`;
  document.getElementById("toast").classList.add("show"); setTimeout(() => document.getElementById("toast").classList.remove("show"), 2000);
}

async function load(isFirst) {
  try { const data = await fetchJSON("/api/yt-kpis"); if (data.error) throw new Error(data.error); render(data, isFirst); }
  catch (e) { document.getElementById("updated").textContent = "ERR_CONNECTION_LOST: " + e.message; }
}

// --- HUD ENGINE ---
let shownAt = {};
try { shownAt = JSON.parse(localStorage.getItem("aihud_shownAt") || "{}"); } catch(e) { console.warn("HUD MEM CORRUPT"); }
const HUD_CONFIG = {
  interval: 16000,
  timer: null, started: false, bootAt: Date.now(),
  lastKey: null, recentKeys: [], shownAt: shownAt,
  cooldownMs: { freshness: 600000, birthday: 900000, status: 480000, trivia: 60000, tip: 60000, motivation: 90000 }
};

const HUD_ICONS = {
  live: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`,
  target: `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm0-14a6 6 0 1 0 6 6 6 6 0 0 0-6-6zm0 10a4 4 0 1 1 4-4 4 4 0 0 1-4 4z"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24"><path d="M12 2.5s-4 4.88-4 10.38c0 3.31 1.34 4.88 1.34 4.88L9 22h6l-.34-4.25s1.34-1.56 1.34-4.88S12 2.5 12 2.5z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  up: `<svg viewBox="0 0 24 24"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  chat: `<svg viewBox="0 0 24 24"><path d="M4 4h16v12H5.17L4 17.17V4zm2 2v7.17L6.83 14H18V6H6z"/></svg>`,
};

const KB = {
  facts: [ "YouTube is the 2nd most visited site.", "Algorithm favors Watch Time over Views.", "Mobile traffic is 2x Desktop.", "Shorts fund is expanding.", "Bright thumbnails = higher CTR." ],
  tips: [ "Audio is critical.", "Hook in 5 seconds.", "Keywords in description.", "Reply to comments.", "Use end screens." ],
  motivation: [ "Creation is a marathon.", "Pace yourself.", "Consistency is key.", "Focus on the viewer." ]
};

function daysBetweenISO(aIso, bIso) { try { return Math.floor((new Date(bIso) - new Date(aIso)) / 86400000); } catch { return null; } }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

function updateHudPathGeometry() {
  const path = document.getElementById("hudTracePath");
  const box = document.getElementById("hudBox");
  if (!path || !box) return;
  // Account for clip-path corners in SVG trace if desired, or simple rect
  const w = box.offsetWidth - 2, h = box.offsetHeight - 2;
  // Complex path matching the clip-path polygon
  const d = `M 20 1 L ${w} 1 L ${w} ${h-20} L ${w-20} ${h} L 1 ${h} L 1 20 L 20 1`;
  path.setAttribute("d", d);
  const len = path.getTotalLength() || 1000;
  path.style.strokeDasharray = len;
}

function initHudBorder() {
  updateHudPathGeometry();
  const path = document.getElementById("hudTracePath");
  if (!path) return;
  const len = path.getTotalLength() || 1000;
  path.style.transition = "none";
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
  if (!window._hudRo) {
      const box = document.getElementById("hudBox");
      if (box) {
          window._hudRo = new ResizeObserver(() => { updateHudPathGeometry(); });
          window._hudRo.observe(box);
      }
  }
}

function animateHudBorder(color) {
  const path = document.getElementById("hudTracePath");
  if (!path) return;
  const len = path.getTotalLength() || 1000;
  path.style.stroke = color;
  path.style.transition = "none";
  path.style.strokeDashoffset = len;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      path.style.transition = "stroke-dashoffset 16s linear";
      path.style.strokeDashoffset = "0";
    });
  });
}

let intelQueue = [];
function buildIntel(data) {
  const out = []; const ch = data.channel || {}, w = data.weekly || {}, hud = data.hud || {};
  const weekViews = Number(w.views || 0), weekG = Number(w.subscribersGained || 0), weekL = Number(w.subscribersLost || 0), weekNet = Number(w.netSubs || 0);
  const subsPer1k = weekViews > 0 ? (weekNet / weekViews) * 1000 : 0;
  
  const uploadDaysAgo = (hud.uploads?.latest?.publishedAt && hud.statsThrough) ? daysBetweenISO(hud.uploads.latest.publishedAt, hud.statsThrough) : null;
  if (uploadDaysAgo !== null && uploadDaysAgo > 14) out.push({ key: "warn_gap", cat: "warning", icon: HUD_ICONS.warn, tag: "ALERT", type: "red", text: `UPLOAD GAP DETECTED. LAST: ${uploadDaysAgo} DAYS.` });
  else if (uploadDaysAgo !== null && uploadDaysAgo <= 3) out.push({ key: "good_gap", cat: "good", icon: HUD_ICONS.up, tag: "ACTIVE", type: "green", text: `CHANNEL ACTIVE. UPLOADED ${uploadDaysAgo} DAYS AGO.` });

  if (weekG > 0 || weekL > 0) out.push({ key: "churn", cat: "subs", icon: weekL>weekG?HUD_ICONS.down:HUD_ICONS.up, tag: weekL>weekG?"LOSS":"GAIN", type: weekL>weekG?"red":"green", text: `NET SUBS: ${weekNet}. +${weekG} / -${weekL}.` });
  if (weekViews > 0) out.push({ key: "conv", cat: "conversion", icon: HUD_ICONS.target, tag: "CONV", type: subsPer1k>=2?"green":"yellow", text: `CONVERSION: ${subsPer1k.toFixed(2)} SUBS/1K VIEWS.` });

  const thumb = hud.thumb28;
  if (thumb && thumb.ctr) {
    const ctr = thumb.ctr;
    out.push({ key: "ctr", cat: "packaging", icon: ctr<2?HUD_ICONS.warn:HUD_ICONS.bulb, tag: ctr<2?"LOW CTR":"CTR", type: ctr<2?"red":(ctr>8?"green":"yellow"), text: `AVG CTR: ${ctr.toFixed(1)}%. ${ctr<2?"IMPROVE THUMBS.":"GOOD."}` });
  }

  const lv = hud.latestVideo;
  if (lv && lv.title) {
    out.push({ key: "lv_stat", cat: "video", icon: HUD_ICONS.rocket, tag: "LATEST", type: "purple", text: `UPLOAD: "${lv.title.substring(0,25)}..."` });
  }

  const tip = pick(KB.tips); if (tip) out.push({ key: "tip", cat: "tip", icon: HUD_ICONS.bulb, tag: "TIP", type: "yellow", text: tip.toUpperCase() });
  const mot = pick(KB.motivation); if (mot) out.push({ key: "mot", cat: "motivation", icon: HUD_ICONS.live, tag: "INSIGHT", type: "purple", text: mot.toUpperCase() });

  return out;
}

function showNextIntel() {
  const item = intelQueue.length ? intelQueue[Math.floor(Math.random() * intelQueue.length)] : null;
  if (!item) return;
  const msg = document.getElementById("hudMessage"), tag = document.getElementById("hudTag"), icon = document.getElementById("hudIcon"), box = document.getElementById("hudBox");
  
  box.classList.remove("glitch-active");
  msg.style.opacity = "0"; tag.style.opacity = "0"; icon.style.opacity = "0";

  setTimeout(() => {
    msg.textContent = item.text;
    tag.textContent = item.tag;
    icon.innerHTML = item.icon || "⚡";
    updateHudPathGeometry();
    const c = COLORS[item.type] || COLORS.orange;
    box.style.setProperty("--hud-accent", c);
    tag.style.color = c; tag.style.textShadow = `0 0 10px ${c}`; icon.style.color = c;
    animateHudBorder(c);
    msg.style.opacity = "1"; tag.style.opacity = "1"; icon.style.opacity = "1";
    box.classList.add("glitch-active");
    // Trigger a glitch effect on the new message
    glitchText(msg);
  }, 200);
}

function updateHud(data) {
  intelQueue = buildIntel(data);
  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true;
    setTimeout(() => { initHudBorder(); showNextIntel(); HUD_CONFIG.timer = setInterval(showNextIntel, 16000); }, 1200);
  }
}

(async function init() { await load(true); setInterval(() => load(false), 60 * 1000); })();
