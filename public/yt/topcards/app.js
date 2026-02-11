function fmt(n) {
  return Intl.NumberFormat().format(Number(n || 0));
}
function fmtAbs(n, decimals = 0) {
  const v = Math.abs(Number(n || 0));
  if (decimals) return v.toFixed(decimals);
  return fmt(Math.round(v));
}

function nowStamp() {
  return new Date().toLocaleString();
}

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

const COLORS = {
  red: getCss("--c-red"),
  orange: getCss("--c-orange"),
  yellow: getCss("--c-yellow"),
  green: getCss("--c-green"),
  blue: getCss("--c-blue"),
  purple: getCss("--c-purple"),
};

const FEEDBACK = {
  subs: {
    red: "Churn warning",
    orange: "Slow growth",
    yellow: "Stable momentum",
    green: "Healthy climb",
    blue: "Strong surge",
    purple: "Viral growth",
  },
  views: {
    red: "Reach dropped",
    orange: "Need a push",
    yellow: "Holding steady",
    green: "Discovery rising",
    blue: "Algorithm loves this",
    purple: "Breakout reach",
  },
  watch: {
    red: "Watch time slipping",
    orange: "Retention weak",
    yellow: "Consistent hours",
    green: "Better engagement",
    blue: "High retention",
    purple: "Binge-worthy",
  },
};

// Main arrow mapping by tier (buff-like)
function tierArrow(tier) {
  if (tier === "red" || tier === "orange") return "↓";
  if (tier === "yellow") return "–";
  if (tier === "green") return "↑";
  if (tier === "blue") return "⟰";
  return "⟰⟰"; // purple
}

function animateNumber(el, fromValue, toValue, options = {}) {
  const duration = options.duration ?? 850;
  const decimals = options.decimals ?? 0;
  const suffix = options.suffix ?? "";

  const start = performance.now();

  function tick(t) {
    const p = Math.min((t - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = fromValue + (toValue - fromValue) * eased;

    el.textContent =
      (decimals ? val.toFixed(decimals) : fmt(Math.round(val))) + suffix;

    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

// Tier: compare thisWeek vs 6M avg (with a delta gate so tiny bumps don't become blue/purple)
function tierFromAvg(thisWeek, avg6m, absMin, minPct) {
  const L = Number(thisWeek || 0);
  const B = Number(avg6m || 0);

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

  if ((tier === "blue" || tier === "purple") && delta < gate) {
    tier = "green";
  }

  return tier;
}

function setChip(dotId, chipTextId, tier, text) {
  const dot = document.getElementById(dotId);
  const chipText = document.getElementById(chipTextId);

  const color = COLORS[tier] || COLORS.yellow;
  dot.style.background = color;
  dot.style.boxShadow = `0 0 14px ${color}55`;
  chipText.textContent = text;
}

function setMainArrow(elId, tier) {
  const el = document.getElementById(elId);
  const color = COLORS[tier] || COLORS.yellow;
  el.textContent = tierArrow(tier);
  el.style.color = color;
  el.style.textShadow = `0 0 14px ${color}55`;
}

function setVs(elNumId, elArrowId, delta, neutralBand, decimals = 0, suffix = "") {
  const numEl = document.getElementById(elNumId);
  const arrEl = document.getElementById(elArrowId);

  const d = Number(delta || 0);

  let cls = "neu";
  let arrow = "–";
  if (d > neutralBand) {
    cls = "pos";
    arrow = "↑";
  } else if (d < -neutralBand) {
    cls = "neg";
    arrow = "↓";
  }

  numEl.className = `vsNum ${cls}`;
  arrEl.className = `vsArrow ${cls}`;

  numEl.textContent = fmtAbs(d, decimals) + suffix;
  arrEl.textContent = arrow;
}

function setSpark(pathEl, values, strokeColor) {
  const w = 120, h = 36, pad = 3;
  const vals = (values || []).map(Number);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x, y };
  });

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const cx = ((prev.x + cur.x) / 2).toFixed(2);
    const cy = ((prev.y + cur.y) / 2).toFixed(2);
    d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${cx} ${cy}`;
  }
  d += ` T ${pts[pts.length - 1].x.toFixed(2)} ${pts[pts.length - 1].y.toFixed(2)}`;

  pathEl.setAttribute("d", d);
  pathEl.style.stroke = strokeColor;

  const length = pathEl.getTotalLength();
  pathEl.style.strokeDasharray = String(length);
  pathEl.style.strokeDashoffset = String(length);
  pathEl.getBoundingClientRect();
  pathEl.style.transition = "stroke-dashoffset 900ms ease";
  pathEl.style.strokeDashoffset = "0";
}

function showToast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 1300);
}

function setLogo(url) {
  if (!url) return;
  const v = `url("${url}")`;
  document.getElementById("cardSubs").style.setProperty("--logo-url", v);
  document.getElementById("cardViews").style.setProperty("--logo-url", v);
  document.getElementById("cardWatch").style.setProperty("--logo-url", v);
}

let state = { subsNow: 0, viewsTotal: 0, watchTotal: 0 };

function calc28dFromWeekly(weeks) {
  // weeks: [thisWeek, prevWeek, prev2, prev3, ...] where week is 7-day sums
  // last28 = sum of weeks[0..3], prev28 = sum of weeks[4..7] (needs 8 weeks)
  const w = weeks.slice().reverse(); // spark is oldest->newest; we want newest-first
  // easier: just rebuild from spark (oldest->newest) -> newest-first
  const newestFirst = [...weeks].reverse();

  const sum = (arr, key) => arr.reduce((a, b) => a + Number(b[key] || 0), 0);

  // if we don't have 8, fallback gracefully
  const last4 = newestFirst.slice(0, 4);
  const prev4 = newestFirst.slice(4, 8);

  return {
    last28: {
      netSubs: sum(last4, "netSubs"),
      views: sum(last4, "views"),
      watchHours: Math.round(sum(last4, "watchHours") * 10) / 10,
    },
    prev28: {
      netSubs: sum(prev4, "netSubs"),
      views: sum(prev4, "views"),
      watchHours: Math.round(sum(prev4, "watchHours") * 10) / 10,
    },
  };
}

function render(data, isFirst) {
  setLogo(data.channel?.logo);

  // spark points: oldest->newest (8 points)
  const spark = data.spark || [];
  const sparkSubs = spark.map((p) => p.netSubs);
  const sparkViews = spark.map((p) => p.views);
  const sparkWatch = spark.map((p) => p.watchHours);

  // derive 28D blocks from 4 weeks + previous 4 weeks
  const blocks = calc28dFromWeekly(spark);
  const last28 = blocks.last28;
  const prev28 = blocks.prev28;

  // --- SUBS ---
  const subsNow = Number(data.subs.current || 0);
  const subsWeek = Number(data.subs.thisWeekNet || 0);
  const subsAvg = Number(data.subs.avg6mNet || 0);

  const subsTier = tierFromAvg(subsWeek, subsAvg, 8, 0.12);
  setChip("subsDot", "subsChipText", subsTier, FEEDBACK.subs[subsTier]);
  setMainArrow("subsMainArrow", subsTier);

  document.getElementById("subsWeek").textContent = `This week: ${subsWeek >= 0 ? "+" : ""}${fmt(subsWeek)}`;
  document.getElementById("subsLast28").textContent = `${last28.netSubs >= 0 ? "+" : ""}${fmt(last28.netSubs)}`;
  document.getElementById("subsPrev28").textContent = `${prev28.netSubs >= 0 ? "+" : ""}${fmt(prev28.netSubs)}`;

  setVs("subsVsNum", "subsVsArrow", subsWeek - subsAvg, 1, 0, "");

  animateNumber(document.getElementById("subsNow"), isFirst ? 0 : state.subsNow, subsNow, { duration: isFirst ? 950 : 650 });
  setSpark(document.getElementById("subsSparkPath"), sparkSubs, COLORS[subsTier]);
  state.subsNow = subsNow;

  // --- VIEWS ---
  const viewsTotal = Number(data.views.total || 0);
  const viewsWeek = Number(data.views.thisWeek || 0);
  const viewsAvg = Number(data.views.avg6m || 0);

  const viewsTier = tierFromAvg(viewsWeek, viewsAvg, 1200, 0.12);
  setChip("viewsDot", "viewsChipText", viewsTier, FEEDBACK.views[viewsTier]);
  setMainArrow("viewsMainArrow", viewsTier);

  document.getElementById("viewsWeek").textContent = `This week: ${fmt(viewsWeek)}`;
  document.getElementById("viewsLast28").textContent = fmt(last28.views);
  document.getElementById("viewsPrev28").textContent = fmt(prev28.views);

  setVs("viewsVsNum", "viewsVsArrow", viewsWeek - viewsAvg, 50, 0, "");

  animateNumber(document.getElementById("viewsTotal"), isFirst ? 0 : state.viewsTotal, viewsTotal, { duration: isFirst ? 1000 : 650 });
  setSpark(document.getElementById("viewsSparkPath"), sparkViews, COLORS[viewsTier]);
  state.viewsTotal = viewsTotal;

  // --- WATCH (lifetime big) ---
  const watchTotal = Number(data.watch.totalHours || 0);
  const watchWeek = Number(data.watch.thisWeekHours || 0);
  const watchAvg = Number(data.watch.avg6mHours || 0);

  const watchTier = tierFromAvg(watchWeek, watchAvg, 3, 0.12);
  setChip("watchDot", "watchChipText", watchTier, FEEDBACK.watch[watchTier]);
  setMainArrow("watchMainArrow", watchTier);

  document.getElementById("watchWeek").textContent = `This week: ${fmt(watchWeek)}h`;
  document.getElementById("watchLast28").textContent = `${fmt(last28.watchHours)}h`;
  document.getElementById("watchPrev28").textContent = `${fmt(prev28.watchHours)}h`;

  setVs("watchVsNum", "watchVsArrow", watchWeek - watchAvg, 0.2, 1, "h");

  animateNumber(
    document.getElementById("watchNow"),
    isFirst ? 0 : state.watchTotal,
    watchTotal,
    { duration: isFirst ? 950 : 650, decimals: watchTotal < 100 ? 1 : 0, suffix: "h" }
  );
  setSpark(document.getElementById("watchSparkPath"), sparkWatch, COLORS[watchTier]);
  state.watchTotal = watchTotal;

  document.getElementById("updated").textContent = `Updated: ${nowStamp()} • Auto-refresh: 1 min`;
  showToast(`Updated ✓ ${nowStamp()}`);
}

async function load(isFirst) {
  const data = await fetchJSON("/api/yt-kpis");
  if (data.error) {
    document.getElementById("updated").textContent = "Error: " + data.error;
    showToast("Update failed ✕");
    return;
  }
  render(data, isFirst);
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
