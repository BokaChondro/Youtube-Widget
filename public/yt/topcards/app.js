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

// Logic for "Next Goal"
function getMilestone(val, type) {
  const v = Number(val || 0);
  if(v < 0) return 100;

  // Watch Hours (smaller scale)
  if (type === 'watch') {
    if (v < 100) return 100;
    if (v < 1000) return Math.ceil((v + 1) / 100) * 100;
    if (v < 4000) return 4000; // Special YouTube monetization goal
    if (v < 10000) return Math.ceil((v + 1) / 1000) * 1000;
    return Math.ceil((v + 1) / 5000) * 5000;
  }

  // Views & Subs (Powers of 10-ish logic)
  const digits = Math.floor(Math.log10(v));
  const base = Math.pow(10, digits); // e.g., 700 -> 100
  
  // If 740, next is 800. If 950, next is 1000.
  const nextStep = Math.ceil((v + 1) / base) * base;
  
  // If we just hit a round number (e.g. 1000), target is 1100 (or 2000?)
  // Let's do finer steps for smaller channels
  if (v < 10000) return Math.ceil((v + 1) / 1000) * 1000;
  if (v < 100000) return Math.ceil((v + 1) / 10000) * 10000;
  return Math.ceil((v + 1) / 100000) * 100000;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

function setCardTheme(cardId, tier) {
  const card = document.getElementById(cardId);
  card.style.setProperty('--c-tier', COLORS[tier] || COLORS.yellow);
  card.classList.add('fresh');
  setTimeout(() => card.classList.remove('fresh'), 2500);
}

function setChip(dotId, chipTextId, tier, text) {
  document.getElementById(dotId).style.background = COLORS[tier];
  document.getElementById(dotId).style.boxShadow = `0 0 10px ${COLORS[tier]}`;
  document.getElementById(chipTextId).textContent = text;
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
  numEl.className = d > 0 ? "vsNum pos" : (d < 0 ? "vsNum neg" : "vsNum neu");
  arrEl.className = d > 0 ? "vsArrow pos" : (d < 0 ? "vsArrow neg" : "vsArrow neu");
  arrEl.textContent = d > 0 ? "↑" : (d < 0 ? "↓" : "–");
  numEl.textContent = (decimals ? Math.abs(d).toFixed(decimals) : fmt(Math.round(Math.abs(d)))) + suffix;
}

function setSpark(fillId, pathId, values, tier) {
  const vals = (values || []).map(Number);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const w = 120, h = 40, pad = 2;

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

  document.getElementById(pathId).setAttribute("d", d);
  document.getElementById(pathId).style.stroke = COLORS[tier];
  document.getElementById(pathId).style.strokeWidth = "2.5";
  
  document.getElementById(fillId).setAttribute("d", `${d} L ${w} ${h} L 0 ${h} Z`);
}

function renderPacing(elId, cur, prev, suffix="") {
  const c = Number(cur||0), p = Number(prev||1);
  const pct = Math.round(((c - p) / p) * 100);
  let html = `This week: ${fmt(c)}${suffix}`;
  if(pct > 0) html += ` <span style="color:var(--c-green)">(+${pct}%)</span>`;
  else if(pct < 0) html += ` <span style="color:var(--c-red)">(${pct}%)</span>`;
  else html += ` <span style="color:#777">(—)</span>`;
  document.getElementById(elId).innerHTML = html;
}

// --- CASINO ROLL (FILMSTRIP) ---
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

function animateCasinoRoll(el, from, to, opts = {}) {
  const isFirst = !!opts.isFirst;
  const decimals = opts.decimals ?? 0;
  const suffix = opts.suffix ?? "";
  
  ensureRoll(el);
  const col = el._rollCol;
  
  const scale = Math.pow(10, decimals);
  const a = Math.round(Number(from || 0) * scale);
  const b = Math.round(Number(to || 0) * scale);
  
  // Create formatting helper
  const txt = (val) => {
    const n = val / scale;
    return (decimals ? fmt1(n) : fmt(Math.round(n))) + suffix;
  }

  // If identical, just set text (no animation)
  if (a === b) {
    col.innerHTML = `<span class="rollLine">${txt(a)}</span>`;
    col.style.transition = "none";
    col.style.transform = "translateY(0)";
    return;
  }

  // Always generate a strip of numbers to ensure movement is visible
  // Limit strip length to max 10 items for performance. If diff > 10, just show start/end/blur
  const diff = b - a; // can be negative
  const absDiff = Math.abs(diff);
  
  let html = "";
  let finalY = 0;
  
  if (absDiff <= 15) {
    // Generate full strip (e.g. 742, 743, 744 OR 744, 743, 742)
    // We always stack them top-to-bottom in the HTML
    // If going UP (742->744): HTML: 742, 743, 744. Slide 0 -> -2em
    // If going DOWN (744->742): HTML: 744, 743, 742. Slide 0 -> -2em
    
    const steps = [];
    const dir = diff > 0 ? 1 : -1;
    for (let i = 0; i <= absDiff; i++) {
      steps.push(a + (i * dir));
    }
    
    html = steps.map(v => `<span class="rollLine">${txt(v)}</span>`).join("");
    finalY = -1.1 * absDiff; // 1.1em line height
  } else {
    // Big jump: Show Start -> ... -> End
    // We create a fake strip: Start, [Random Middle], End
    html = `
      <span class="rollLine">${txt(a)}</span>
      <span class="rollLine" style="filter:blur(2px)">${txt(a + Math.round(diff/2))}</span>
      <span class="rollLine">${txt(b)}</span>
    `;
    finalY = -1.1 * 2; // Move 2 slots
  }

  col.innerHTML = html;
  col.style.transition = "none";
  col.style.transform = "translateY(0)";

  // Trigger Reflow
  col.offsetHeight; 

  // Animate
  col.style.transition = `transform ${isFirst ? 2000 : 1000}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
  col.style.transform = `translateY(${finalY}em)`;
}

/* Floating Icons */
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
  // Removes itself after animation (5s) defined in CSS
  setTimeout(() => el.remove(), 5500); 
}

// --- MAIN RENDER ---
let state = { subs: 0, views: 0, watch: 0 };

function render(data, isFirst) {
  setLogo(data.channel?.logo);

  const cur = {
    subs: Number(data.channel?.subscribers || 0),
    views: Number(data.channel?.totalViews || 0),
    watch: Number(data.lifetime?.watchHours || 0)
  };
  
  const weekly = data.weekly || {};
  const last28 = data.m28?.last28 || {};
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
  setVsRG("subsVsNum", "subsVsArrow", last28.netSubs - avg6m.netSubs);
  document.getElementById("subsLast28").textContent = (last28.netSubs>0?"+":"")+fmt(last28.netSubs);
  document.getElementById("subsPrev28").textContent = (data.m28.prev28.netSubs>0?"+":"")+fmt(data.m28.prev28.netSubs);

  // Subs Goal
  const gSubs = getMilestone(cur.subs, 'subs');
  const pSubs = Math.min(100, (cur.subs/gSubs)*100).toFixed(1);
  document.getElementById("subsNextGoal").textContent = fmt(gSubs);
  document.getElementById("subsNextPct").textContent = pSubs+"%";
  document.getElementById("subsProgressFill").style.width = pSubs+"%";

  // 2. VIEWS
  const tViews = tierFromBaseline(last28.views, med6m.views, 25000, 0.1);
  setCardTheme("cardViews", tViews);
  setChip("viewsDot", "viewsChipText", tViews, FEEDBACK.views[tViews]);
  setMainArrow("viewsMainArrow", tViews);
  setSpark("viewsSparkFill", "viewsSparkPath", hist.map(x=>x.views), tViews);
  renderPacing("viewsWeek", weekly.views, weekly.prevViews);
  setVsRG("viewsVsNum", "viewsVsArrow", last28.views - avg6m.views);
  document.getElementById("viewsLast28").textContent = fmt(last28.views);
  document.getElementById("viewsPrev28").textContent = fmt(data.m28.prev28.views);

  // Views Goal
  const gViews = getMilestone(cur.views, 'views');
  const pViews = Math.min(100, (cur.views/gViews)*100).toFixed(1);
  document.getElementById("viewsNextGoal").textContent = fmt(gViews);
  document.getElementById("viewsNextPct").textContent = pViews+"%";
  document.getElementById("viewsProgressFill").style.width = pViews+"%";

  // 3. WATCH
  const tWatch = tierFromBaseline(last28.watchHours, med6m.watchHours, 50, 0.1);
  setCardTheme("cardWatch", tWatch);
  setChip("watchDot", "watchChipText", tWatch, FEEDBACK.watch[tWatch]);
  setMainArrow("watchMainArrow", tWatch);
  setSpark("watchSparkFill", "watchSparkPath", hist.map(x=>x.watchHours), tWatch);
  renderPacing("watchWeek", weekly.watchHours, weekly.prevWatchHours, "h");
  setVsRG("watchVsNum", "watchVsArrow", last28.watchHours - avg6m.watchHours, 1, "h");
  document.getElementById("watchLast28").textContent = fmt(last28.watchHours)+"h";
  document.getElementById("watchPrev28").textContent = fmt(data.m28.prev28.watchHours)+"h";

  // Watch Goal
  const gWatch = getMilestone(cur.watch, 'watch');
  const pWatch = Math.min(100, (cur.watch/gWatch)*100).toFixed(1);
  document.getElementById("watchNextGoal").textContent = fmt(gWatch);
  document.getElementById("watchNextPct").textContent = pWatch+"%";
  document.getElementById("watchProgressFill").style.width = pWatch+"%";

  // --- ANIMATIONS ---
  // Only animate if value changed
  animateCasinoRoll(document.getElementById("subsNow"), isFirst ? 0 : state.subs, cur.subs, { isFirst });
  if (!isFirst && cur.subs > state.subs) spawnFloatIcon("cardSubs", "subs");

  animateCasinoRoll(document.getElementById("viewsTotal"), isFirst ? 0 : state.views, cur.views, { isFirst });
  if (!isFirst && cur.views > state.views) spawnFloatIcon("cardViews", "views");

  animateCasinoRoll(document.getElementById("watchNow"), isFirst ? 0 : state.watch, cur.watch, { isFirst, decimals: cur.watch<100?1:0, suffix:"h" });
  if (!isFirst && cur.watch > state.watch) spawnFloatIcon("cardWatch", "watch");

  // Save State
  state = cur;
  document.getElementById("updated").textContent = `SYSTEM ACTIVE • ${nowStamp()}`;
  showToast("SYNC COMPLETE");
}

async function load(isFirst) {
  const data = await fetchJSON("/api/yt-kpis");
  if (data.error) return;
  render(data, isFirst);
}

// 3D Tilt
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('mousemove', (e) => {
    const r = card.getBoundingClientRect();
    const x = ((e.clientY - r.top) / r.height - 0.5) * -10;
    const y = ((e.clientX - r.left) / r.width - 0.5) * 10;
    card.style.transform = `perspective(1000px) rotateX(${x}deg) rotateY(${y}deg) scale(1.02)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale(1)`;
  });
});

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
