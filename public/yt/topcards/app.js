function fmt(n) {
  return Intl.NumberFormat().format(Number(n || 0));
}

function fmtSigned(n) {
  const v = Number(n || 0);
  const sign = v > 0 ? "+" : "";
  return sign + fmt(v);
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

function animateNumber(el, fromValue, toValue, options = {}) {
  const duration = options.duration ?? 850;
  const decimals = options.decimals ?? 0;
  const suffix = options.suffix ?? "";
  const prefix = options.prefix ?? "";

  const start = performance.now();

  function tick(t) {
    const p = Math.min((t - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = fromValue + (toValue - fromValue) * eased;

    el.textContent =
      prefix +
      (decimals ? val.toFixed(decimals) : fmt(Math.round(val))) +
      suffix;

    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

// Tier based on last28 vs baseline median, with a "delta gate" to avoid false spikes.
function tierFromBaseline(last, baselineMedian, absMin, minPct) {
  const L = Number(last || 0);
  const B = Number(baselineMedian || 0);

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

function setDelta(elId, last, prev, suffix = "") {
  const d = Number(last || 0) - Number(prev || 0);
  const sign = d > 0 ? "+" : "";
  document.getElementById(elId).textContent = sign + fmt(d) + suffix;
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

let state = { subsNow: 0, viewsTotal: 0, watchTotal: 0 };

function setDates(data) {
  const lastW = data.windows.last28;
  const prevW = data.windows.prev28;
  const lifeW = data.windows.lifetime;

  document.getElementById("subsDates").textContent =
    `${prevW.startDate} → ${prevW.endDate} vs ${lastW.startDate} → ${lastW.endDate}`;
  document.getElementById("viewsDates").textContent =
    `${prevW.startDate} → ${prevW.endDate} vs ${lastW.startDate} → ${lastW.endDate}`;
  document.getElementById("watchDates").textContent =
    `Lifetime ${lifeW.startDate} → ${lifeW.endDate} • compare last/prev below`;
}

function render(data, isFirst) {
  setDates(data);

  const histSubs = data.history.map((p) => p.netSubs);
  const histViews = data.history.map((p) => p.views);
  const histWatch = data.history.map((p) => p.watchHours);

  // SUBS
  const subsNow = Number(data.subs.current || 0);
  const subsLast = Number(data.subs.last28Net || 0);
  const subsPrev = Number(data.subs.prev28Net || 0);
  const subsBase = Number(data.subs.baselineMedian || 0);

  const subsTier = tierFromBaseline(subsLast, subsBase, 10, 0.12);
  setChip("subsDot", "subsChipText", subsTier, FEEDBACK.subs[subsTier]);
  document.getElementById("subsLast").textContent = fmtSigned(subsLast);
  document.getElementById("subsPrev").textContent = fmtSigned(subsPrev);
  setDelta("subsDelta", subsLast, subsPrev);
  document.getElementById("subsBase").textContent =
    `Baseline (median of prev 6×28D): ${fmtSigned(subsBase)}`;
  animateNumber(document.getElementById("subsNow"), isFirst ? 0 : state.subsNow, subsNow, { duration: isFirst ? 950 : 650 });
  setSpark(document.getElementById("subsSparkPath"), histSubs, COLORS[subsTier]);
  state.subsNow = subsNow;

  // VIEWS
  const viewsTotal = Number(data.views.total || 0);
  const viewsLast = Number(data.views.last28 || 0);
  const viewsPrev = Number(data.views.prev28 || 0);
  const viewsBase = Number(data.views.baselineMedian || 0);

  const viewsTier = tierFromBaseline(viewsLast, viewsBase, 1000, 0.12);
  setChip("viewsDot", "viewsChipText", viewsTier, FEEDBACK.views[viewsTier]);
  document.getElementById("viewsLast").textContent = fmt(viewsLast);
  document.getElementById("viewsPrev").textContent = fmt(viewsPrev);
  setDelta("viewsDelta", viewsLast, viewsPrev);
  document.getElementById("viewsBase").textContent =
    `Baseline (median of prev 6×28D): ${fmt(viewsBase)}`;
  animateNumber(document.getElementById("viewsTotal"), isFirst ? 0 : state.viewsTotal, viewsTotal, { duration: isFirst ? 1000 : 650 });
  setSpark(document.getElementById("viewsSparkPath"), histViews, COLORS[viewsTier]);
  state.viewsTotal = viewsTotal;

  // WATCH (lifetime big)
  const watchTotal = Number(data.watch.totalHours || 0);
  const watchLast = Number(data.watch.last28Hours || 0);
  const watchPrev = Number(data.watch.prev28Hours || 0);
  const watchBase = Number(data.watch.baselineMedian || 0);

  const watchTier = tierFromBaseline(watchLast, watchBase, 5, 0.12);
  setChip("watchDot", "watchChipText", watchTier, FEEDBACK.watch[watchTier]);
  document.getElementById("watchLast").textContent = fmt(watchLast) + "h";
  document.getElementById("watchPrev").textContent = fmt(watchPrev) + "h";
  setDelta("watchDelta", watchLast, watchPrev, "h");
  document.getElementById("watchBase").textContent =
    `Baseline (median of prev 6×28D): ${fmt(watchBase)}h`;
  animateNumber(
    document.getElementById("watchNow"),
    isFirst ? 0 : state.watchTotal,
    watchTotal,
    { duration: isFirst ? 950 : 650, decimals: watchTotal < 100 ? 1 : 0, suffix: "h" }
  );
  setSpark(document.getElementById("watchSparkPath"), histWatch, COLORS[watchTier]);
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
  setInterval(() => load(false), 60 * 1000); // ✅ 1 minute
})();
