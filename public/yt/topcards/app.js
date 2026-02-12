/* =========================================================
   public/yt/topcards/app.js
   Sci-Fi Logic v8 (Celebration + Roll Bug Fix)
   ========================================================= */

const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleTimeString(); }

const COLORS = {
  green:  "#00ff66",
  red:    "#ff003c",
  blue:   "#00f0ff",
  yellow: "#fcee0a",
  purple: "#bc13fe",
  pink:   "#ff0099",
  orange: "#ff5f1f",
  white:  "#ffffff"
};

const FEEDBACK = {
  subs: { red: "AUDIENCE LEAK", orange: "SLOW CONVERT", yellow: "STEADY GROWTH", green: "STRONG PULL", blue: "RISING FAST", purple: "EXCEPTIONAL" },
  views: { red: "REACH DOWN", orange: "LOW REACH", yellow: "STABLE REACH", green: "REACH UP", blue: "TRENDING", purple: "VIRAL" },
  watch: { red: "POOR ENGAGE", orange: "RETENTION ISSUE", yellow: "CONSISTENT", green: "ENGAGE UP", blue: "HOOKED", purple: "OUTSTANDING" },
  realtime: { red: "BIG DROP", orange: "DROP ALERT", yellow: "GOING FLAT", green: "GOOD PACE", blue: "UPTREND", purple: "ON FIRE" }
};

// --- DOM HELPERS ---
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function safeSetStyle(id, prop, val) { const el = document.getElementById(id); if (el) el.style[prop] = val; }
function safeSetHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function tierArrow(tier) {
  if (tier === "red") return "▼▼";
  if (tier === "orange") return "▼";
  if (tier === "yellow") return "—";
  if (tier === "green") return "▲";
  if (tier === "blue") return "▲▲";
  return "▲▲▲"; 
}

function tierFromBaseline(last28, median6m, absMin) {
  const L = Number(last28 || 0);
  const B = Number(median6m || 0);
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
  const L = Number(last24 || 0);
  const B = Number(prev6Avg || 0);
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
    if (v < 10000) {
      const step = 1000;
      const min = Math.floor(v / step) * step;
      return { min, max: min + step };
    }
    const step = 5000;
    const min = Math.floor(v / step) * step;
    return { min, max: min + step };
  }
  let step = 100;
  if (v >= 10000000) step = 10000000;
  else if (v >= 1000000) step = 1000000;
  else if (v >= 100000) step = 100000;
  else if (v >= 10000) step = 10000;
  else if (v >= 1000) step = 1000;
  else step = 100;
  const min = Math.floor(v / step) * step;
  return { min, max: min + step };
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
  arrEl.textContent = d > 0 ? "▲" : (d < 0 ? "▼" : "—");
  const absTxt = decimals ? Math.abs(d).toFixed(decimals) : fmt(Math.round(Math.abs(d)));
  numEl.innerHTML = absTxt + suffix; 
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
  if (stops[0]) stops[0].setAttribute("stop-color", rgbaFromHex(tierHex, 0.5));
  if (stops[1]) stops[1].setAttribute("stop-color", rgbaFromHex(tierHex, 0.1));
  if (stops[2]) stops[2].setAttribute("stop-color", "rgba(0,0,0,0)");
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
  pathEl.setAttribute("d", dLine); 
  pathEl.style.stroke = COLORS[tier]; 
  pathEl.style.strokeWidth = "2.4";
  fillEl.setAttribute("d", `${dLine} L ${w} ${h} L 0 ${h} Z`);
  const svgEl = fillEl.closest("svg");
  const gradUrl = ensureSparkGradient(svgEl, `grad-${fillId}`, COLORS[tier]);
  if (gradUrl) fillEl.style.fill = gradUrl;
}

function renderPacing(elId, cur, prev, suffix = "") {
  const c = Number(cur || 0), p = Number(prev || 0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);
  let pctHtml = pct > 0 ? `<span style="color:var(--c-green); font-size:0.9em;">(+${pct}%)</span>` : (pct < 0 ? `<span style="color:var(--c-red); font-size:0.9em;">(${pct}%)</span>` : `<span style="color:#666; font-size:0.9em;">(—)</span>`);
  const left = `<div><span style="opacity:0.6; margin-right:4px;">LAST 7D:</span><b>${fmt(c)}${suffix}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">PREV:</span><span style="opacity:0.8">${fmt(p)}${suffix}</span></div>`;
  safeSetHTML(elId, left + right);
}

function renderHourlyPacing(elId, cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);
  let pctHtml = pct > 0 ? `<span style="color:var(--c-green); font-size:0.9em;">(+${pct}%)</span>` : (pct < 0 ? `<span style="color:var(--c-red); font-size:0.9em;">(${pct}%)</span>` : `<span style="color:#666; font-size:0.9em;">(—)</span>`);
  const left = `<div><span style="opacity:0.6; margin-right:4px;">LAST HOUR:</span><b>${fmt(c)}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">PREV HOUR:</span><span style="opacity:0.8">${fmt(p)}</span></div>`;
  safeSetHTML(elId, left + right);
}

// --- CASINO ROLL (FIXED CONCATENATION BUG) ---
function ensureRoll(el) {
  // STRICT CHECK: If wrapper exists AND el contains it, return.
  if (el._rollWrap && el.contains(el._rollWrap)) return;
  
  // CLEAN SLATE: If wrapper is missing or detached, clear el entirely.
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
  const decimals = opts.decimals ?? 0, suffix = opts.suffix ?? "", duration = opts.duration ?? 1600;
  const start = Number(fromVal || 0), end = Number(toVal || 0);
  
  ensureRoll(el); 
  const col = el._rollCol;
  
  const scale = Math.pow(10, decimals);
  const a = Math.round(start * scale), b = Math.round(end * scale);
  const txt = (val) => (decimals ? fmt1(val / scale) : fmt(Math.round(val / scale))) + suffix;
  
  if (a === b) { setRollInstant(el, txt(b)); return; }
  
  const diff = b - a, absDiff = Math.abs(diff);
  let steps = [];
  
  if (absDiff <= 20) {
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) steps.push(a + (i * dir));
  } else { 
    steps = [a, a + Math.round(diff * 0.2), a + Math.round(diff * 0.5), a + Math.round(diff * 0.8), b]; 
  }
  
  // STRICT INNERHTML REPLACEMENT (Prevents accumulation)
  col.innerHTML = steps.map((v, i) => `<span class="rollLine">${txt(v)}</span>`).join("");
  
  col.style.transition = "none"; 
  col.style.transform = "translateY(0)";
  void col.offsetHeight; // Force Reflow
  
  col.style.transition = `transform ${duration}ms cubic-bezier(0.18, 0.9, 0.2, 1)`;
  col.style.transform = `translateY(${-1.1 * (steps.length - 1)}em)`;
}

// FIX: USE INNERHTML to parse <span>
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
    el.innerHTML = renderText(endVal * easeOutCubic(p)); 
    if (p < 1) el._spdRaf = requestAnimationFrame(tick);
  };
  el._spdRaf = requestAnimationFrame(tick);
}

const SVGS = {
  subs: `<svg viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z"/></svg>`,
  views: `<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`,
  watch: `<svg viewBox="0 0 24 24"><path d="M15 8H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1.2l4 2.3V7.9l-4 2.3V10c0-1.1-.9-2-2-2Z"/></svg>`,
};

// FLOATING ICON CELEBRATION
function triggerCelebration(cardId, type, message) {
  const card = document.getElementById(cardId);
  if (!card) return;

  // 1. Float Icon
  const el = document.createElement("div"); 
  el.className = "float-celebration"; 
  el.innerHTML = SVGS[type] || "";
  card.appendChild(el); 
  setTimeout(() => el.remove(), 16500); // 1.5 + 15

  // 2. Swap Milestone Box Content
  const milestoneBox = document.getElementById(type === "subs" ? "subsMilestoneBox" : (type === "rt" ? "rtMilestoneBox" : (type === "views" ? "viewsMilestoneBox" : "watchMilestoneBox")));
  if (milestoneBox) {
    // Set message
    const msgEl = milestoneBox.querySelector(".milestone-celebrate");
    if(msgEl) msgEl.textContent = message;

    milestoneBox.classList.add("celebrating");
    
    // Cleanup after 15s
    setTimeout(() => {
      milestoneBox.classList.remove("celebrating");
    }, 15000);
  }
}

/* =========================================================
   Glitch & Advanced Animations
   ========================================================= */

const GLITCH_CHARS = "#@&$-+!^%";
function scrambleText(el) {
  if (!el || el.dataset.scrambling) return;
  // If element is a Roll Container (Main Counter), DO NOT scramble text content!
  if (el.classList.contains("roll-target")) return; 

  const original = el.textContent;
  if (!original || original.length < 2) return; 
  el.dataset.scrambling = "true";
  let steps = 0;
  const maxSteps = 12; 
  
  const interval = setInterval(() => {
    const arr = original.split('');
    for(let i=0; i<arr.length; i++) {
      if(Math.random() > 0.5 && arr[i] !== ' ' && arr[i] !== ',') {
        arr[i] = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      }
    }
    el.textContent = arr.join('');
    steps++;
    if(steps >= maxSteps) {
      clearInterval(interval);
      el.textContent = original;
      delete el.dataset.scrambling;
    }
  }, 60);
}

function randomGlitchLoop() {
  const targets = ["subsNow", "rtNow", "viewsTotal", "watchNow", "subsLast28", "subsPrev28", "rtLast24", "rtPrev24", "viewsLast28", "viewsPrev28", "watchLast28", "watchPrev28"];
  const id = targets[Math.floor(Math.random() * targets.length)];
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("glitch-active");
    scrambleText(el);
    setTimeout(() => el.classList.remove("glitch-active"), 800);
  }
  
  const hudMsg = document.getElementById("hudMessage");
  if (hudMsg && Math.random() > 0.8) { 
    hudMsg.classList.add("glitch-active");
    scrambleText(hudMsg);
    setTimeout(() => hudMsg.classList.remove("glitch-active"), 800);
  }
  
  setTimeout(randomGlitchLoop, 6000 + Math.random() * 12000);
}

// ANIMATION STATE
let animState = {
  subs: [], rt: [], views: [], watch: [],
  pSubs: 0, pRt: 0, pViews: 0, pWatch: 0,
  tiers: { subs: "blue", rt: "blue", views: "blue", watch: "blue" }
};

// 30s TRIGGER: SMOOTH MORPH
function triggerAdvancedAnimations() {
  const cards = [
    { id: "subs", spark: "subsSpark", bar: "subsProgressFill" },
    { id: "rt", spark: "rtSpark", bar: "rtProgressFill" },
    { id: "views", spark: "viewsSpark", bar: "viewsProgressFill" },
    { id: "watch", spark: "watchSpark", bar: "watchProgressFill" }
  ];

  const elements = ["subsIconBox", "subsChip", "rtIconBox", "rtChip", "viewsIconBox", "viewsChip", "watchIconBox", "watchChip"];
  elements.forEach(id => { const el = document.getElementById(id); if(el) el.classList.add("aurora-mode"); });

  let start = null;
  const duration = 3000; 

  function step(timestamp) {
    if (!start) start = timestamp;
    const progress = timestamp - start;
    const pct = progress / duration;
    
    // Wave Offset
    const waveOffset = progress / 200; 

    cards.forEach(c => {
      const realData = animState[c.id] || [];
      const len = realData.length || 20; 
      const waveData = Array.from({length: len}, (_, i) => 50 + 15 * Math.sin((i + waveOffset) * 0.5));
      
      let renderData = [];
      let mix = 0; 

      if(pct < 0.15) {
        mix = pct / 0.15; 
      } else if (pct > 0.85) {
        mix = 1 - ((pct - 0.85) / 0.15); 
      } else {
        mix = 1; 
      }

      for(let i=0; i<len; i++) {
        const rVal = realData[i] !== undefined ? realData[i] : 50; 
        renderData.push(rVal * (1 - mix) + waveData[i] * mix); 
      }
      
      const tierColor = animState.tiers[c.id] || "blue";
      setSpark(`${c.spark}Fill`, `${c.spark}Path`, renderData, tierColor);
      
      const bEl = document.getElementById(c.bar);
      if(bEl && progress < 50) { 
         bEl.style.setProperty('--target-width', (c.id === 'subs' ? animState.pSubs : c.id === 'rt' ? animState.pRt : c.id === 'views' ? animState.pViews : animState.pWatch) + "%");
         bEl.classList.remove("bar-surge");
         void bEl.offsetWidth; 
         bEl.classList.add("bar-surge");
      }
    });

    if (progress < duration) {
      requestAnimationFrame(step);
    } else {
      setSpark("subsSparkFill", "subsSparkPath", animState.subs, animState.tiers.subs);
      setSpark("rtSparkFill", "rtSparkPath", animState.rt, animState.tiers.rt);
      setSpark("viewsSparkFill", "viewsSparkPath", animState.views, animState.tiers.views);
      setSpark("watchSparkFill", "watchSparkPath", animState.watch, animState.tiers.watch);

      cards.forEach(c => {
        const bEl = document.getElementById(c.bar);
        if(bEl) setTimeout(() => bEl.classList.remove("bar-surge"), 500);
      });

      setTimeout(() => {
        elements.forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove("aurora-mode"); });
      }, 500); 
    }
  }
  requestAnimationFrame(step);
}

/* =========================================================
   MAIN RENDER
   ========================================================= */
let state = { subs: 0, views: 0, watch: 0, rt: 0 };
const UNIT_H = '<span class="unit-lower">h</span>';

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

  // SAVE DATA
  animState.subs = hist.map(x => x.netSubs);
  animState.rt = rt.sparkline || [];
  animState.views = hist.map(x => x.views);
  animState.watch = hist.map(x => x.watchHours);

  // 1. SUBS
  const tSubs = tierFromBaseline(last28.netSubs, med6m.netSubs, 30);
  animState.tiers.subs = tSubs;
  setCardTheme("cardSubs", tSubs); setChip("subsDot", "subsChipText", tSubs, FEEDBACK.subs[tSubs]); setMainArrow("subsMainArrow", tSubs);
  setSpark("subsSparkFill", "subsSparkPath", animState.subs, tSubs);
  renderPacing("subsWeek", weekly.netSubs, weekly.prevNetSubs);
  setVsRG("subsVsNum", "subsVsArrow", (last28.netSubs || 0) - (data.m28?.avg6m?.netSubs || 0));
  safeSetText("subsLast28", (Number(last28.netSubs) >= 0 ? "+" : "") + fmt(last28.netSubs)); safeSetText("subsPrev28", (Number(prev28.netSubs) >= 0 ? "+" : "") + fmt(prev28.netSubs));
  
  const mSubs = getMilestoneLimits(cur.subs, "subs");
  const pSubs = Math.min(100, Math.max(0, ((cur.subs - mSubs.min) / (mSubs.max - mSubs.min)) * 100)).toFixed(1);
  animState.pSubs = pSubs;
  safeSetText("subsNextGoal", fmt(mSubs.max)); 
  safeSetText("subsNextPct", pSubs + "%"); 
  safeSetStyle("subsProgressFill", "width", pSubs + "%");

  // 2. REALTIME
  const rtLast24 = Number(rt.last24h || 0);
  const rtPrev6Avg = Number(rt.avgPrior6d || 0); 
  const vsDelta = Number(rt.vs7dAvgDelta || 0); 
  const tRt = tierRealtime(rtLast24, rtPrev6Avg, 500); 
  animState.tiers.rt = tRt;
  setCardTheme("cardRealtime", tRt); 
  setChip("rtDot", "rtChipText", tRt, FEEDBACK.realtime[tRt]); 
  setMainArrow("rtMainArrow", tRt);
  setSpark("rtSparkFill", "rtSparkPath", animState.rt, tRt);
  renderHourlyPacing("rtPacing", rt.lastHour, rt.prevHour);
  setVsRG("rtVsNum", "rtVsArrow", vsDelta);
  safeSetText("rtLast24", fmt(rt.last24h)); 
  safeSetText("rtPrev24", fmt(rt.prev24h));
  
  const mRt = getMilestoneLimits(cur.rt, "views");
  const pRt = Math.min(100, Math.max(0, ((cur.rt - mRt.min) / (mRt.max - mRt.min)) * 100)).toFixed(1);
  animState.pRt = pRt;
  safeSetText("rtNextGoal", fmt(mRt.max)); 
  safeSetText("rtNextPct", pRt + "%"); 
  safeSetStyle("rtProgressFill", "width", pRt + "%");

  // 3. VIEWS
  const tViews = tierFromBaseline(last28.views, med6m.views, 25000);
  animState.tiers.views = tViews;
  setCardTheme("cardViews", tViews); setChip("viewsDot", "viewsChipText", tViews, FEEDBACK.views[tViews]); setMainArrow("viewsMainArrow", tViews);
  setSpark("viewsSparkFill", "viewsSparkPath", animState.views, tViews);
  renderPacing("viewsWeek", weekly.views, weekly.prevViews);
  setVsRG("viewsVsNum", "viewsVsArrow", (last28.views || 0) - (data.m28?.avg6m?.views || 0));
  safeSetText("viewsLast28", fmt(last28.views)); safeSetText("viewsPrev28", fmt(prev28.views));
  
  const mViews = getMilestoneLimits(cur.views, "views");
  const pViews = Math.min(100, Math.max(0, ((cur.views - mViews.min) / (mViews.max - mViews.min)) * 100)).toFixed(1);
  animState.pViews = pViews;
  safeSetText("viewsNextGoal", fmt(mViews.max)); 
  safeSetText("viewsNextPct", pViews + "%"); 
  safeSetStyle("viewsProgressFill", "width", pViews + "%");

  // 4. WATCH
  const tWatch = tierFromBaseline(last28.watchHours, med6m.watchHours, 50);
  animState.tiers.watch = tWatch;
  setCardTheme("cardWatch", tWatch); setChip("watchDot", "watchChipText", tWatch, FEEDBACK.watch[tWatch]); setMainArrow("watchMainArrow", tWatch);
  setSpark("watchSparkFill", "watchSparkPath", animState.watch, tWatch);
  renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, UNIT_H);
  setVsRG("watchVsNum", "watchVsArrow", (last28.watchHours || 0) - (data.m28?.avg6m?.watchHours || 0), 1, UNIT_H);
  
  safeSetHTML("watchLast28", fmt(last28.watchHours) + UNIT_H); 
  safeSetHTML("watchPrev28", fmt(prev28.watchHours) + UNIT_H);
  
  const mWatch = getMilestoneLimits(cur.watch, "watch");
  const pWatch = Math.min(100, Math.max(0, ((cur.watch - mWatch.min) / (mWatch.max - mWatch.min)) * 100)).toFixed(1);
  animState.pWatch = pWatch;
  safeSetText("watchNextGoal", fmt(mWatch.max)); 
  safeSetText("watchNextPct", pWatch + "%"); 
  safeSetStyle("watchProgressFill", "width", pWatch + "%");

  // ANIMATIONS
  const subsEl = document.getElementById("subsNow"), rtEl = document.getElementById("rtNow"), viewsEl = document.getElementById("viewsTotal"), watchEl = document.getElementById("watchNow");
  if (isFirst) {
    animateSpeedometer(subsEl, cur.subs, { duration: 650 }); 
    animateSpeedometer(rtEl, cur.rt, { duration: 650 });
    animateSpeedometer(viewsEl, cur.views, { duration: 650 }); 
    animateSpeedometer(watchEl, cur.watch, { duration: 650, decimals: cur.watch < 100 ? 1 : 0, suffix: UNIT_H });
  } else {
    if (Math.round(cur.subs) !== Math.round(state.subs)) { 
      animateCasinoRoll(subsEl, state.subs, cur.subs, { duration: 1800 }); 
      if (cur.subs > state.subs) triggerCelebration("cardSubs", "subs", "WOW! NEW SUBSCRIBER!"); 
    } else setRollInstant(subsEl, fmt(cur.subs));
    
    if (Math.round(cur.rt) !== Math.round(state.rt)) { 
      animateCasinoRoll(rtEl, state.rt, cur.rt, { duration: 1800 }); 
      if (cur.rt > state.rt + 10) triggerCelebration("cardRealtime", "rt", "PEOPLE WATCHING!"); 
    } else setRollInstant(rtEl, fmt(cur.rt));
    
    if (Math.round(cur.views) !== Math.round(state.views)) { 
      animateCasinoRoll(viewsEl, state.views, cur.views, { duration: 1800 }); 
      if (cur.views > state.views + 50) triggerCelebration("cardViews", "views", "MORE VIEWS!");
    } else setRollInstant(viewsEl, fmt(cur.views));
    
    const wDec = cur.watch < 100 ? 1 : 0, scale = wDec ? 10 : 1;
    if (Math.round(state.watch * scale) !== Math.round(cur.watch * scale)) { 
      animateCasinoRoll(watchEl, state.watch, cur.watch, { decimals: wDec, suffix: UNIT_H, duration: 1800 }); 
      if (cur.watch > state.watch + 1) triggerCelebration("cardWatch", "watch", "MORE WATCH TIME!");
    } else setRollInstant(watchEl, (wDec ? fmt1(cur.watch) : fmt(Math.round(cur.watch))) + UNIT_H);
  }

  state = cur;
  triggerAdvancedAnimations();

  updateHud(data);

  document.getElementById("updated").textContent = `SYSTEM ONLINE • ${nowStamp()}`;
  document.getElementById("toast").classList.add("show"); setTimeout(() => document.getElementById("toast").classList.remove("show"), 2000);
}

async function load(isFirst) {
  try { const data = await fetchJSON("/api/yt-kpis"); if (data.error) throw new Error(data.error); render(data, isFirst); }
  catch (e) { document.getElementById("updated").textContent = "FETCH ERROR: " + e.message; }
}

// ... HUD ...
let shownAt = {};
try { shownAt = JSON.parse(localStorage.getItem("aihud_shownAt") || "{}"); } catch(e) { console.warn("HUD Mem Reset"); }

const HUD_CONFIG = {
  interval: 16000,
  timer: null, started: false, bootAt: Date.now(),
  lastKey: null, recentKeys: [], shownAt: shownAt,
  cooldownMs: { freshness: 600000, birthday: 900000, status: 480000, trivia: 60000, tip: 60000, motivation: 90000 }
};

// ... Icons, KB, Helper Funcs (unchanged) ...
const HUD_ICONS={live:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`,target:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm0-14a6 6 0 1 0 6 6 6 6 0 0 0-6-6zm0 10a4 4 0 1 1 4-4 4 4 0 0 1-4 4z"/></svg>`,rocket:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5s-4 4.88-4 10.38c0 3.31 1.34 4.88 1.34 4.88L9 22h6l-.34-4.25s1.34-1.56 1.34-4.88S12 2.5 12 2.5z"/></svg>`,warn:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,up:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,down:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 18l2.29-2.29-4.88-4.88-4 4L2 7.41 3.41 6l6 6 4-4 6.3 6.29L22 12v6z"/></svg>`,bulb:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,globe:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm7.93 9h-3.17a15.7 15.7 0 0 0-1.45-6A8.02 8.02 0 0 1 19.93 11zM12 4c.9 1.3 1.7 3.3 2.1 7H9.9C10.3 7.3 11.1 5.3 12 4zM4.07 13h3.17a15.7 15.7 0 0 0 1.45 6A8.02 8.02 0 0 1 4.07 13zm3.17-2H4.07A8.02 8.02 0 0 1 8.69 5a15.7 15.7 0 0 0-1.45 6zm2.66 2h4.2c-.4 3.7-1.2 5.7-2.1 7-.9-1.3-1.7-3.3-2.1-7zm6.86 6a15.7 15.7 0 0 0 1.45-6h3.17A8.02 8.02 0 0 1 15.31 19z"/></svg>`,chat:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v12H5.17L4 17.17V4zm2 2v7.17L6.83 14H18V6H6z"/></svg>`};
const KB={facts:["YouTube is the 2nd most visited site in existence.","The first video 'Me at the zoo' has over 200M views.","Mobile users visit YouTube twice as often as desktop users.","Comedy, Music, and Entertainment are top genres.","YouTube supports 80+ languages.","More than 500 hours of video are uploaded every minute.","Algorithm favors Watch Time over View Count.","Bright thumbnails tend to have higher CTR.","60% of people prefer online video to TV.","Videos that keep viewers watching often get recommended more."],tips:["Audio is King: Bad video is forgiveable, bad audio is not.","Hook 'em: The first 5 seconds determine retention.","Metadata: Keywords in first sentence of description help.","Hearting comments brings viewers back.","Use End Screens to link best videos.","Playlists increase Session Time.","Use Shorts as a funnel.","Rule of Thirds works for thumbnails.","Cut the silence to keep energy up."],motivation:["Creation is a marathon. Pace yourself.","Your next video could change everything.","Don't compare your Ch 1 to their Ch 20.","1,000 true fans beats 100,000 ghosts.","Consistency is the cheat code.","Focus on the 1 viewer watching."],nostalgia:["Remember why you started? Keep that spark.","Look at your first video. Progress.","Every big channel started with 0 subs."]};
function daysBetweenISO(a,b){try{return Math.floor((new Date(b)-new Date(a))/86400000)}catch{return null}}
function pick(a){return a&&a.length?a[Math.floor(Math.random()*a.length)]:null}
function updateHudPathGeometry(){const a=document.getElementById("hudTracePath"),b=document.getElementById("hudBox");if(!a||!b)return;const c=b.offsetWidth-2,d=b.offsetHeight-2;a.setAttribute("d",`M 1 1 L 1 ${d} L ${c} ${d} L ${c} 1 L 1 1`);const e=a.getTotalLength()||1000;a.style.strokeDasharray=e}
function initHudBorder(){updateHudPathGeometry();const a=document.getElementById("hudTracePath");if(!a)return;const b=a.getTotalLength()||1000;a.style.transition="none",a.style.strokeDasharray=b,a.style.strokeDashoffset=b;window._hudRo||(window._hudRo=new ResizeObserver(()=>{updateHudPathGeometry()}),window._hudRo.observe(document.getElementById("hudBox")))}
function animateHudBorder(a){const b=document.getElementById("hudTracePath");if(!b)return;const c=b.getTotalLength()||1000;b.style.stroke=a,b.style.transition="none",b.style.strokeDashoffset=c,requestAnimationFrame(()=>{requestAnimationFrame(()=>{b.style.transition="stroke-dashoffset 16s linear",b.style.strokeDashoffset="0"})})}
function buildIntel(a){const b=[],c=a.channel||{},d=a.weekly||{},e=a.m28||{},f=a.hud||{},g=a.history28d||[],h=Number(d.views||0),i=Number(d.subscribersGained||0),j=Number(d.subscribersLost||0),k=Number(d.netSubs||0),l=h>0?k/h*1e3:0,m=f.uploads?.latest?.publishedAt&&f.statsThrough?daysBetweenISO(f.uploads.latest.publishedAt,f.statsThrough):null;if(null!==m&&m>14?b.push({key:"warn_gap",cat:"warning",weight:3,icon:HUD_ICONS.warn,tag:"WARNING",type:"red",text:`UPLOAD BUFFER EMPTY. LAST UPLOAD ${m}D AGO.`}):null!==m&&m<=3&&b.push({key:"good_gap",cat:"good",weight:2,icon:HUD_ICONS.up,tag:"RISING",type:"green",text:`CONSISTENCY DETECTED. LAST UPLOAD ${m}D AGO.`}),(i>0||j>0)&&b.push({key:"churn",cat:"subs",weight:3.2,icon:j>i?HUD_ICONS.down:HUD_ICONS.up,tag:j>i?"DROPPING":"GROWTH",type:j>i?"red":"green",text:`NET SUBS: ${k}. GAINED ${i}, LOST ${j}.`}),h>0&&b.push({key:"conv",cat:"conversion",weight:2.6,icon:HUD_ICONS.target,tag:"CONVERSION",type:l>=2?"green":"yellow",text:`CONV RATE: ${l.toFixed(2)} NET SUBS PER 1K VIEWS.`}),f.thumb28&&f.thumb28.ctr){const n=f.thumb28.ctr;b.push({key:"ctr",cat:"packaging",weight:2.1,icon:n<2?HUD_ICONS.warn:HUD_ICONS.bulb,tag:n<2?"WARNING":"PACKAGING",type:n<2?"red":n>8?"green":"yellow",text:`AVG CTR IS ${n.toFixed(1)}%. ${n<2?"OPTIMIZE THUMBS.":"HEALTHY METRIC."}`})}if(f.retention28&&f.retention28.avgViewPercentage){const o=f.retention28.avgViewPercentage;b.push({key:"ret",cat:"retention",weight:2,icon:o<35?HUD_ICONS.warn:HUD_ICONS.up,tag:o<35?"WARNING":"RETENTION",type:o<35?"red":"green",text:`AVG VIEW PCT ${o.toFixed(0)}%. ${o<35?"TIGHTEN INTROS.":"AUDIENCE ENGAGED."}`})}const p=f.latestVideo;if(p&&p.title){const q=Number(p.views||0);b.push({key:"lv_stat",cat:"video",weight:2.8,icon:HUD_ICONS.rocket,tag:"LATEST",type:"purple",text:`LATEST: "${p.title.toUpperCase()}" — ${fmt(q)} VIEWS.`})}const r=getMilestoneLimits(Number(c.subscribers||0),"subs").max;if(r>Number(c.subscribers||0)&&b.push({key:"goal",cat:"goal",weight:1.4,icon:HUD_ICONS.target,tag:"MILESTONE",type:"blue",text:`${fmt(r-Number(c.subscribers))} SUBS TO ${fmt(r)}.`}),pick(KB.tips)&&b.push({key:"tip",cat:"tip",weight:.4,icon:HUD_ICONS.bulb,tag:"TIP",type:"yellow",text:pick(KB.tips).toUpperCase()}),pick(KB.facts)&&b.push({key:"fact",cat:"trivia",weight:.3,icon:HUD_ICONS.bulb,tag:"FACT",type:"pink",text:pick(KB.facts).toUpperCase()}),pick(KB.motivation)){const s=pick(KB.motivation);b.push({key:"mot",cat:"motivation",weight:.2,icon:HUD_ICONS.live,tag:"INSIGHT",type:"purple",text:s.toUpperCase()})}return b}
function showNextIntel(){const a=intelQueue.length?intelQueue[Math.floor(Math.random()*intelQueue.length)]:null;if(!a)return;const b=document.getElementById("hudMessage"),c=document.getElementById("hudTag"),d=document.getElementById("hudIcon"),e=document.getElementById("hudBox");e.classList.remove("glitch-active"),b.style.opacity="0",c.style.opacity="0",d.style.opacity="0",setTimeout(()=>{b.textContent=a.text,c.textContent=a.tag,d.innerHTML=a.icon||"⚡",updateHudPathGeometry();const f=COLORS[a.type]||COLORS.orange;e.style.setProperty("--hud-accent",f),c.style.color=f,c.style.textShadow=`0 0 10px ${f}`,d.style.color=f,animateHudBorder(f),b.style.opacity="1",c.style.opacity="1",d.style.opacity="1",e.classList.add("glitch-active"),setTimeout(()=>e.classList.remove("glitch-active"),300)},200)}
function updateHud(a){intelQueue=buildIntel(a),HUD_CONFIG.started||(HUD_CONFIG.started=!0,setTimeout(()=>{initHudBorder(),showNextIntel(),HUD_CONFIG.timer=setInterval(showNextIntel,16e3),randomGlitchLoop(),setInterval(triggerAdvancedAnimations,3e4)},1200))}
(async function init(){await load(!0),setInterval(()=>load(!1),6e4)})();
