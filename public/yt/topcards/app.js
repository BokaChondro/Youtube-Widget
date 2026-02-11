const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleTimeString(); }

const COLORS = {
  red: "#ff3344", orange: "#ff8800", yellow: "#ffd700",
  green: "#00ff99", blue: "#00ccff", purple: "#bb00ff",
};

const FEEDBACK = {
  subs: { red: "Churn", orange: "Slow", yellow: "Stable", green: "Climbing", blue: "Surging", purple: "Viral" },
  views: { red: "Low Reach", orange: "Needs Push", yellow: "Steady", green: "Rising", blue: "Trending", purple: "Explosive" },
  watch: { red: "Dropping", orange: "Weak", yellow: "Consistent", green: "Engaging", blue: "Hooked", purple: "Binge" },
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
  if (tier === "red" || tier === "orange") return "↓";
  if (tier === "yellow") return "–";
  if (tier === "green") return "↑";
  if (tier === "blue") return "⟰";
  return "⟰⟰";
}

function tierFromBaseline(last28, median6m, absMin, minPct) {
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
  if(v < 0) return 100;
  if (type === 'watch') {
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

// Sets color theme and triggers the "Pulse" animation
function setCardTheme(cardId, tier) {
  const card = document.getElementById(cardId);
  if(!card) return;
  card.style.setProperty('--c-tier', COLORS[tier] || COLORS.yellow);
}

function triggerBreathing(cardId) {
  const card = document.getElementById(cardId);
  if(!card) return;
  // Remove reflow add to restart animation
  card.classList.remove('pulse-active');
  void card.offsetWidth; // force reflow
  card.classList.add('pulse-active');
  
  // Stop breathing after 4 seconds (one full cycle is ~2s)
  setTimeout(() => card.classList.remove('pulse-active'), 4000);
}

function setChip(dotId, chipTextId, tier, text) {
  const dot = document.getElementById(dotId);
  if(dot) {
    dot.style.background = COLORS[tier];
    dot.style.boxShadow = `0 0 10px ${COLORS[tier]}`;
  }
  safeSetText(chipTextId, text);
}

function setMainArrow(elId, tier) {
  const el = document.getElementById(elId);
  if(!el) return;
  el.textContent = tierArrow(tier);
  el.style.color = "var(--c-tier)";
  el.style.textShadow = "0 0 15px var(--c-tier)";
}

function setVsRG(elNumId, elArrowId, delta, decimals = 0, suffix = "") {
  const numEl = document.getElementById(elNumId);
  const arrEl = document.getElementById(elArrowId);
  if(!numEl || !arrEl) return;
  const d = Number(delta || 0);
  numEl.className = d > 0 ? "vsNum pos" : (d < 0 ? "vsNum neg" : "vsNum neu");
  arrEl.className = d > 0 ? "vsArrow pos" : (d < 0 ? "vsArrow neg" : "vsArrow neu");
  arrEl.textContent = d > 0 ? "↑" : (d < 0 ? "↓" : "–");
  numEl.textContent = (decimals ? Math.abs(d).toFixed(decimals) : fmt(Math.round(Math.abs(d)))) + suffix;
}

function setSpark(fillId, pathId, values, tier) {
  const fillEl = document.getElementById(fillId);
  const pathEl = document.getElementById(pathId);
  if(!fillEl || !pathEl) return;
  const vals = (values || []).map(Number);
  if (vals.length < 2) return; 

  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const w = 120, h = 40, pad = 3;

  const pts = vals.map((v, i) => ({
    x: (i / (vals.length - 1)) * w,
    y: h - pad - ((v - min) / span) * (h - pad * 2)
  }));

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = ((pts[i-1].x + pts[i].x) / 2).toFixed(1);
    const cy = ((pts[i-1].y + pts[i].y) / 2).toFixed(1);
    d += ` Q ${pts[i-1].x.toFixed(1)} ${pts[i-1].y.toFixed(1)} ${cx} ${cy}`;
  }
  d += ` T ${pts[pts.length-1].x.toFixed(1)} ${pts[pts.length-1].y.toFixed(1)}`;

  pathEl.setAttribute("d", d);
  pathEl.style.stroke = COLORS[tier];
  fillEl.setAttribute("d", `${d} L ${w} ${h} L 0 ${h} Z`);
}

function renderPacing(elId, cur, prev, suffix="") {
  const c = Number(cur||0), p = Number(prev||0);
  const pct = p === 0 ? 0 : Math.round(((c - p) / p) * 100);
  
  let pctHtml = "";
  if(pct > 0) pctHtml = `<span style="color:var(--c-green); font-size:0.9em;">(+${pct}%)</span>`;
  else if(pct < 0) pctHtml = `<span style="color:var(--c-red); font-size:0.9em;">(${pct}%)</span>`;
  else pctHtml = `<span style="color:#666; font-size:0.9em;">(—)</span>`;

  const left = `<div><span style="opacity:0.6; margin-right:4px;">Last 7D:</span><b>${fmt(c)}${suffix}</b> ${pctHtml}</div>`;
  const right = `<div><span style="opacity:0.4; margin-right:4px;">Prev:</span><span style="opacity:0.8">${fmt(p)}${suffix}</span></div>`;

  safeSetHTML(elId, left + right);
}

// --- CASINO ROLL (FAST START) ---
function ensureRoll(el) {
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

function animateCasinoRoll(el, fromVal, toVal, opts = {}) {
  if(!el) return;
  const isFirst = !!opts.isFirst;
  const decimals = opts.decimals ?? 0;
  const suffix = opts.suffix ?? "";
  
  // IF FIRST LOAD: Force start from 0
  const start = isFirst ? 0 : Number(fromVal || 0);
  const end = Number(toVal || 0);

  ensureRoll(el);
  const col = el._rollCol;
  
  const scale = Math.pow(10, decimals);
  const a = Math.round(start * scale);
  const b = Math.round(end * scale);
  
  const txt = (val) => (decimals ? fmt1(val/scale) : fmt(Math.round(val/scale))) + suffix;

  // No animation if unchanged (and not first load)
  if (!isFirst && a === b) {
    col.style.transition = "none";
    col.style.transform = "translateY(0)";
    col.innerHTML = `<span class="rollLine">${txt(a)}</span>`;
    return;
  }

  const diff = b - a; 
  const absDiff = Math.abs(diff);
  let html = "";
  let finalY = 0;
  
  // On First Load with big numbers (0 -> 700k), we don't want 700k DOM elements.
  // We want a simulated fast spin.
  if (isFirst || absDiff > 50) {
    // Simulated Strip: 0 ... [Randoms] ... Target
    const mid1 = Math.round(a + diff * 0.33);
    const mid2 = Math.round(a + diff * 0.66);
    html = `
      <span class="rollLine">${txt(a)}</span>
      <span class="rollLine" style="filter:blur(3px)">${txt(mid1)}</span>
      <span class="rollLine" style="filter:blur(3px)">${txt(mid2)}</span>
      <span class="rollLine">${txt(b)}</span>
    `;
    finalY = -1.1 * 3; // Move 3 slots down
  } else {
    // Small changes (Refresh): Show full strip
    const steps = [];
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) {
      steps.push(a + (i * dir));
    }
    html = steps.map(v => `<span class="rollLine">${txt(v)}</span>`).join("");
    finalY = -1.1 * absDiff;
  }

  col.style.transition = "none";
  col.style.transform = "translateY(0)";
  col.innerHTML = html;

  // Force Paint
  void col.offsetHeight; 

  // Animate: Fast (800ms) on first load, Standard (1500ms) on refresh
  const dur = isFirst ? 800 : 1500;
  col.style.transition = `transform ${dur}ms cubic-bezier(0.15, 0.85, 0.35, 1)`;
  col.style.transform = `translateY(${finalY}em)`;
}

// --- FLOAT ICON ---
const SVGS = {
  subs: `<svg viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z"/></svg>`,
  views:`<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`,
  watch:`<svg viewBox="0 0 24 24"><path d="M15 8H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1.2l4 2.3V7.9l-4 2.3V10c0-1.1-.9-2-2-2Z"/></svg>`,
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

// --- MAIN RENDER ---
let state = { subs: 0, views: 0, watch: 0 };
let halfTimeTimer = null;

function render(data, isFirst) {
  try {
    const ch = data.channel || {};
    if (ch.logo) {
      const v = `url("${ch.logo}")`;
      document.querySelectorAll('.card').forEach(c => c.style.setProperty("--logo-url", v));
    }

    const cur = {
      subs: Number(ch.subscribers || 0),
      views: Number(ch.totalViews || 0),
      watch: Number(data.lifetime?.watchHours || 0)
    };
    
    // Entrance Anim
    if (isFirst) {
      document.querySelectorAll('.card').forEach((c, i) => {
        c.style.animationDelay = `${i * 100}ms`;
        c.classList.add('card-enter');
      });
    }

    const weekly = data.weekly || {};
    const last28 = data.m28?.last28 || {};
    const prev28 = data.m28?.prev28 || {};
    const med6m = data.m28?.median6m || {};
    const avg6m = data.m28?.avg6m || {};
    const hist = data.history28d || [];

    // 1. SUBS
    const tSubs = tierFromBaseline(last28.netSubs, med6m.netSubs, 30, 0.1);
    setCardTheme("cardSubs", tSubs);
    setChip("subsDot", "subsChipText", tSubs, FEEDBACK.subs[tSubs]);
    setMainArrow("subsMainArrow", tSubs);
    setSpark("subsSparkFill", "subsSparkPath", hist.map(x=>x.netSubs), tSubs);
    renderPacing("subsWeek", weekly.netSubs, weekly.prevNetSubs);
    setVsRG("subsVsNum", "subsVsArrow", (last28.netSubs||0) - (avg6m.netSubs||0));
    safeSetText("subsLast28", (Number(last28.netSubs)>=0?"+":"")+fmt(last28.netSubs));
    safeSetText("subsPrev28", (Number(prev28.netSubs)>=0?"+":"")+fmt(prev28.netSubs));

    const gSubs = getMilestone(cur.subs, 'subs');
    const pSubs = Math.min(100, (cur.subs/gSubs)*100).toFixed(1);
    safeSetText("subsNextGoal", fmt(gSubs));
    safeSetText("subsNextPct", pSubs+"%");
    safeSetStyle("subsProgressFill", "width", pSubs+"%");
    
    // Trigger Breathe on Load
    triggerBreathing("cardSubs");

    // 2. VIEWS
    const tViews = tierFromBaseline(last28.views, med6m.views, 25000, 0.1);
    setCardTheme("cardViews", tViews);
    setChip("viewsDot", "viewsChipText", tViews, FEEDBACK.views[tViews]);
    setMainArrow("viewsMainArrow", tViews);
    setSpark("viewsSparkFill", "viewsSparkPath", hist.map(x=>x.views), tViews);
    renderPacing("viewsWeek", weekly.views, weekly.prevViews);
    setVsRG("viewsVsNum", "viewsVsArrow", (last28.views||0) - (avg6m.views||0));
    safeSetText("viewsLast28", fmt(last28.views));
    safeSetText("viewsPrev28", fmt(prev28.views));

    const gViews = getMilestone(cur.views, 'views');
    const pViews = Math.min(100, (cur.views/gViews)*100).toFixed(1);
    safeSetText("viewsNextGoal", fmt(gViews));
    safeSetText("viewsNextPct", pViews+"%");
    safeSetStyle("viewsProgressFill", "width", pViews+"%");

    triggerBreathing("cardViews");

    // 3. WATCH
    const tWatch = tierFromBaseline(last28.watchHours, med6m.watchHours, 50, 0.1);
    setCardTheme("cardWatch", tWatch);
    setChip("watchDot", "watchChipText", tWatch, FEEDBACK.watch[tWatch]);
    setMainArrow("watchMainArrow", tWatch);
    setSpark("watchSparkFill", "watchSparkPath", hist.map(x=>x.watchHours), tWatch);
    renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, "h");
    setVsRG("watchVsNum", "watchVsArrow", (last28.watchHours||0) - (avg6m.watchHours||0), 1, "h");
    safeSetText("watchLast28", fmt(last28.watchHours)+"h");
    safeSetText("watchPrev28", fmt(prev28.watchHours)+"h");

    const gWatch = getMilestone(cur.watch, 'watch');
    const pWatch = Math.min(100, (cur.watch/gWatch)*100).toFixed(1);
    safeSetText("watchNextGoal", fmt(gWatch));
    safeSetText("watchNextPct", pWatch+"%");
    safeSetStyle("watchProgressFill", "width", pWatch+"%");

    triggerBreathing("cardWatch");

    // --- ANIMATIONS ---
    animateCasinoRoll(document.getElementById("subsNow"), isFirst ?
