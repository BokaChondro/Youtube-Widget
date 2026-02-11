const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleTimeString(); }

// --- THEME & COLORS ---
const COLORS = {
  red: "#ff3344",
  orange: "#ff8800",
  yellow: "#ffd700",
  green: "#00ff99",
  blue: "#00ccff",
  purple: "#bb00ff",
};

const FEEDBACK = {
  subs: {
    red: "Churn warning", orange: "Slow growth", yellow: "Stable flow",
    green: "Climbing", blue: "Surging", purple: "Viral",
  },
  views: {
    red: "Low reach", orange: "Needs push", yellow: "Holding",
    green: "Rising", blue: "Trending", purple: "Explosive",
  },
  watch: {
    red: "Drops", orange: "Weak", yellow: "Consistent",
    green: "Engaging", blue: "Hooked", purple: "Binge-mode",
  },
};

// --- LOGIC HELPERS ---

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

  if (B <= 0) {
    if (L <= 0) return "red";
    if (L < absMin) return "orange";
    if (L < absMin * 4) return "yellow";
    if (L < absMin * 10) return "green";
    if (L < absMin * 25) return "blue";
    return "purple";
  }

  const ratio = L / B;
  const delta = L - B;
  const gate = Math.max(absMin, B * minPct);

  let tier = "yellow";
  if (ratio < 0.7) tier = "red";
  else if (ratio < 0.9) tier = "orange";
  else if (ratio < 1.05) tier = "yellow";
  else if (ratio < 1.25) tier = "green";
  else if (ratio < 1.6) tier = "blue";
  else tier = "purple";

  if ((tier === "blue" || tier === "purple") && delta < gate) tier = "green";
  return tier;
}

function getMilestone(current) {
  // Dynamic stepping for milestones
  if (current < 1000) return Math.ceil((current + 1) / 100) * 100; // Next 100
  if (current < 10000) return Math.ceil((current + 1) / 1000) * 1000; // Next 1k
  if (current < 100000) return Math.ceil((current + 1) / 10000) * 10000; // Next 10k
  return Math.ceil((current + 1) / 100000) * 100000; // Next 100k
}

// --- DOM UPDATERS ---

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

function setCardTheme(cardId, tier) {
  const card = document.getElementById(cardId);
  const color = COLORS[tier] || COLORS.yellow;
  // Set CSS variable locally for this card
  card.style.setProperty('--c-tier', color);
  
  // Flash effect logic
  card.classList.add('fresh');
  setTimeout(() => card.classList.remove('fresh'), 2500);
}

function setChip(dotId, chipTextId, tier, text) {
  const dot = document.getElementById(dotId);
  const chipText = document.getElementById(chipTextId);
  const color = COLORS[tier] || COLORS.yellow;
  
  dot.style.background = color;
  dot.style.boxShadow = `0 0 10px ${color}`;
  chipText.textContent = text;
  chipText.style.color = "#fff";
}

function setMainArrow(elId, tier) {
  const el = document.getElementById(elId);
  el.textContent = tierArrow(tier);
  el.style.color = "var(--c-tier)";
  el.style.textShadow = "0 0 10px var(--c-tier)";
}

function setVsRG(elNumId, elArrowId, delta, decimals = 0, suffix = "") {
  const numEl = document.getElementById(elNumId);
  const arrEl = document.getElementById(elArrowId);
  const d = Number(delta || 0);

  if (d > 0) {
    numEl.className = "vsNum pos";
    arrEl.className = "vsArrow pos";
    arrEl.textContent = "↑";
  } else if (d < 0) {
    numEl.className = "vsNum neg";
    arrEl.className = "vsArrow neg";
    arrEl.textContent = "↓";
  } else {
    numEl.className = "vsNum neu";
    arrEl.className = "vsArrow neu";
    arrEl.textContent = "–";
  }
  const abs = Math.abs(d);
  numEl.textContent = (decimals ? abs.toFixed(decimals) : fmt(Math.round(abs))) + suffix;
}

// Generates both a Line (stroke) and an Area (fill)
function setSpark(fillId, pathId, values, tier) {
  const fillEl = document.getElementById(fillId);
  const pathEl = document.getElementById(pathId);
  const color = COLORS[tier];

  const w = 120, h = 40, pad = 2;
  const vals = (values || []).map(Number);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  // Generate points
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - pad - ((v - min) / span) * (h - pad * 2); 
    return { x, y };
  });

  // Create Smooth Curve (Catmull-Rom or Quad Bezier)
  // Simple Quad Bezier approach
  let dLine = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const cx = ((p.x + c.x) / 2).toFixed(1);
    const cy = ((p.y + c.y) / 2).toFixed(1);
    dLine += ` Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${cx} ${cy}`;
  }
  dLine += ` T ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;

  // Close the loop for the fill
  const dFill = `${dLine} L ${w} ${h} L 0 ${h} Z`;

  // Apply Line
  pathEl.setAttribute("d", dLine);
  pathEl.style.stroke = color;
  pathEl.style.strokeWidth = "2.5";

  // Apply Fill
  fillEl.setAttribute("d", dFill);
  // (Fill color is handled by SVG LinearGradient referencing --c-tier in CSS)
}

function renderPacing(elId, current, previous, suffix="") {
  const cur = Number(current || 0);
  const prev = Number(previous || 1); // protect div0
  if (prev === 0) return; // skip if no history
  
  const pct = Math.round(((cur - prev) / prev) * 100);
  const el = document.getElementById(elId);
  
  let html = `This week: ${fmt(cur)}${suffix}`;
  
  // Velocity Indicator
  if (pct > 0) {
    html += ` <span style="color:var(--c-green); font-size:0.9em; margin-left:4px;">(+${pct}%)</span>`;
  } else if (pct < 0) {
    html += ` <span style="color:var(--c-red); font-size:0.9em; margin-left:4px;">(${pct}%)</span>`;
  } else {
    html += ` <span style="color:#777; font-size:0.9em; margin-left:4px;">(—)</span>`;
  }
  
  el.innerHTML = html;
}

function showToast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 1500);
}

function setLogo(url) {
  if (!url) return;
  const v = `url("${url}")`;
  document.querySelectorAll('.card').forEach(c => c.style.setProperty("--logo-url", v));
}

/* Floating Icons */
const ICON_SVG = {
  subs: `<svg viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z"/></svg>`,
  views:`<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`,
  watch:`<svg viewBox="0 0 24 24"><path d="M15 8H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1.2l4 2.3V7.9l-4 2.3V10c0-1.1-.9-2-2-2Z"/></svg>`,
};

function spawnFloatIcon(cardId, type) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const el = document.createElement("div");
  el.className = "floatIcon";
  el.innerHTML = ICON_SVG[type] || "";
  card.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

/* CASINO ROLL (Standard Numbers) */
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

function formatValue(v, decimals, suffix) {
  const num = Number(v || 0);
  const t = decimals ? fmt1(num) : fmt(Math.round(num));
  return t + (suffix || "");
}

function animateCasinoRoll(el, from, to, opts = {}) {
  const isFirst = !!opts.isFirst;
  const decimals = opts.decimals ?? 0;
  const suffix = opts.suffix ?? "";
  
  ensureRoll(el);
  const col = el._rollCol;
  
  const scale = Math.pow(10, decimals);
  const a = Math.round(Number(from || 0) * scale);
  const b = Math.round(Number(to || 0) * scale);
  const diff = Math.abs(b - a);

  // Instant if no change
  if (diff === 0) {
    col.innerHTML = `<span class="rollLine">${formatValue(b/scale, decimals, suffix)}</span>`;
    col.style.transform = "translateY(0px)";
    return;
  }

  // Determine steps
  const maxSteps = isFirst ? 50 : 80;
  const stepVal = Math.max(1, Math.ceil(diff / maxSteps));
  
  // Animate
  let cur = a;
  const dir = b > a ? 1 : -1;
  
  clearInterval(el._rollTimer);
  col.innerHTML = `<span class="rollLine">${formatValue(cur/scale, decimals, suffix)}</span>`;
  
  el._rollTimer = setInterval(() => {
    if ((dir > 0 && cur >= b) || (dir < 0 && cur <= b)) {
      cur = b;
      clearInterval(el._rollTimer);
    } else {
      cur += dir * stepVal;
    }
    col.innerHTML = `<span class="rollLine">${formatValue(cur/scale, decimals, suffix)}</span>`;
  }, 20);
}

// --- MAIN INIT ---

let state = { subsNow: 0, viewsTotal: 0, watchTotal: 0 };

function render(data, isFirst) {
  setLogo(data.channel?.logo);

  // DATA EXTRACTION
  const weekly = data.weekly || {};
  const last28 = data.m28?.last28 || {};
  const prev28 = data.m28?.prev28 || {};
  const avg6m  = data.m28?.avg6m || {};
  const med6m  = data.m28?.median6m || {};
  const hist   = data.history28d || [];

  const subsNow = Number(data.channel?.subscribers || 0);
  const viewsTotal = Number(data.channel?.totalViews || 0);
  const watchTotal = Number(data.lifetime?.watchHours || 0);

  // --- CARD 1: SUBS ---
  const subsTier = tierFromBaseline(last28.netSubs, med6m.netSubs, 30, 0.10);
  setCardTheme("cardSubs", subsTier);
  setChip("subsDot", "subsChipText", subsTier, FEEDBACK.subs[subsTier]);
  setMainArrow("subsMainArrow", subsTier);
  setSpark("subsSparkFill", "subsSparkPath", hist.map(p => p.netSubs), subsTier);
  
  // Velocity Pacing
  renderPacing("subsWeek", weekly.netSubs, weekly.prevNetSubs);
  
  // Meta
  document.getElementById("subsLast28").textContent = `${Number(last28.netSubs)>=0?"+":""}${fmt(last28.netSubs)}`;
  document.getElementById("subsPrev28").textContent = `${Number(prev28.netSubs)>=0?"+":""}${fmt(prev28.netSubs)}`;
  setVsRG("subsVsNum", "subsVsArrow", Number(last28.netSubs) - Number(avg6m.netSubs), 0, "");
  
  // Gamification: Next Milestone
  const nextGoal = getMilestone(subsNow);
  const subPct = Math.min(100, (subsNow / nextGoal) * 100).toFixed(1);
  document.getElementById("subsNextGoal").textContent = fmt(nextGoal);
  document.getElementById("subsNextPct").textContent = subPct + "%";
  document.getElementById("subsProgressFill").style.width = subPct + "%";
  if(Number(subPct) > 95) document.getElementById("subsProgressFill").classList.add("pulse-bar");
  else document.getElementById("subsProgressFill").classList.remove("pulse-bar");

  // Roll & Float
  if(!isFirst && subsNow > state.subsNow) spawnFloatIcon("cardSubs", "subs");
  animateCasinoRoll(document.getElementById("subsNow"), isFirst ? 0 : state.subsNow, subsNow, { isFirst });


  // --- CARD 2: VIEWS ---
  const viewsTier = tierFromBaseline(last28.views, med6m.views, 25000, 0.10);
  setCardTheme("cardViews", viewsTier);
  setChip("viewsDot", "viewsChipText", viewsTier, FEEDBACK.views[viewsTier]);
  setMainArrow("viewsMainArrow", viewsTier);
  setSpark("viewsSparkFill", "viewsSparkPath", hist.map(p => p.views), viewsTier);
  
  renderPacing("viewsWeek", weekly.views, weekly.prevViews);
  
  document.getElementById("viewsLast28").textContent = fmt(last28.views);
  document.getElementById("viewsPrev28").textContent = fmt(prev28.views);
  setVsRG("viewsVsNum", "viewsVsArrow", Number(last28.views) - Number(avg6m.views), 0, "");

  if(!isFirst && viewsTotal > state.viewsTotal) spawnFloatIcon("cardViews", "views");
  animateCasinoRoll(document.getElementById("viewsTotal"), isFirst ? 0 : state.viewsTotal, viewsTotal, { isFirst });


  // --- CARD 3: WATCH ---
  const watchTier = tierFromBaseline(last28.watchHours, med6m.watchHours, 50, 0.10);
  setCardTheme("cardWatch", watchTier);
  setChip("watchDot", "watchChipText", watchTier, FEEDBACK.watch[watchTier]);
  setMainArrow("watchMainArrow", watchTier);
  setSpark("watchSparkFill", "watchSparkPath", hist.map(p => p.watchHours), watchTier);
  
  renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, "h");

  document.getElementById("watchLast28").textContent = `${fmt(last28.watchHours)}h`;
  document.getElementById("watchPrev28").textContent = `${fmt(prev28.watchHours)}h`;
  setVsRG("watchVsNum", "watchVsArrow", Number(last28.watchHours) - Number(avg6m.watchHours), 1, "h");

  if(!isFirst && watchTotal > state.watchTotal) spawnFloatIcon("cardWatch", "watch");
  animateCasinoRoll(document.getElementById("watchNow"), isFirst ? 0 : state.watchTotal, watchTotal, { isFirst, decimals: watchTotal<100?1:0, suffix:"h" });

  // Update State
  state.subsNow = subsNow;
  state.viewsTotal = viewsTotal;
  state.watchTotal = watchTotal;

  document.getElementById("updated").textContent = `SYSTEM ACTIVE • UPDATED ${nowStamp()} • AUTO-CYCLE 60s`;
  showToast("DATA SYNCED");
}

async function load(isFirst) {
  const data = await fetchJSON("/api/yt-kpis");
  if (data.error) {
    document.getElementById("updated").textContent = "ERR: " + data.error;
    showToast("SYNC FAILED");
    return;
  }
  render(data, isFirst);
}

// 3D Tilt Interaction
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xRot = ((y / rect.height) - 0.5) * -8; 
    const yRot = ((x / rect.width) - 0.5) * 8;
    card.style.transform = `perspective(1000px) rotateX(${xRot}deg) rotateY(${yRot}deg) scale(1.02)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale(1)`;
  });
});

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
