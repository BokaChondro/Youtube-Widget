function fmt(n) { return Intl.NumberFormat().format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleString(); }

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
    orange: "Needs a push",
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

// main symbol mapping
function tierArrow(tier) {
  if (tier === "red" || tier === "orange") return "↓";
  if (tier === "yellow") return "–";
  if (tier === "green") return "↑";
  if (tier === "blue") return "⟰";
  return "⟰⟰";
}

// Tier based on LAST 28D vs baseline MEDIAN of prev 6×28D (stable)
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

  // prevent fake blue/purple spikes
  if ((tier === "blue" || tier === "purple") && delta < gate) tier = "green";
  return tier;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
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

// vs last 6M avg: ONLY red/green (no multi-color tiering)
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
  const shown = decimals ? abs.toFixed(decimals) : fmt(Math.round(abs));
  numEl.textContent = shown + suffix;
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
    const p = pts[i - 1];
    const c = pts[i];
    const cx = ((p.x + c.x) / 2).toFixed(2);
    const cy = ((p.y + c.y) / 2).toFixed(2);
    d += ` Q ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${cx} ${cy}`;
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
  showToast._timer = setTimeout(() => t.classList.remove("show"), 1200);
}

function setLogo(url) {
  if (!url) return;
  const v = `url("${url}")`;
  document.getElementById("cardSubs").style.setProperty("--logo-url", v);
  document.getElementById("cardViews").style.setProperty("--logo-url", v);
  document.getElementById("cardWatch").style.setProperty("--logo-url", v);
}

/**
 * Stepped/casino-ish counter:
 * - first load: fast 0 -> target
 * - refresh: slower stepped animation from prev -> next
 */
function animateStepped(el, from, to, opts = {}) {
  const isFirst = !!opts.isFirst;
  const suffix = opts.suffix || "";
  const decimals = opts.decimals || 0;

  // durations: first is faster, refresh is slower
  const duration = isFirst ? 700 : 1600;

  const a = Number(from || 0);
  const b = Number(to || 0);
  const diff = b - a;
  const absDiff = Math.abs(diff);

  // Step count controls "slow roll"
  const steps = isFirst ? 90 : 140;

  // For huge gaps, step size increases automatically
  const stepSize = Math.max(1, Math.floor(absDiff / steps));

  const start = performance.now();
  const dir = diff >= 0 ? 1 : -1;

  function formatVal(v) {
    if (decimals) return v.toFixed(decimals) + suffix;
    return fmt(Math.round(v)) + suffix;
  }

  function tick(t) {
    const p = Math.min((t - start) / duration, 1);

    // easeOut
    const eased = 1 - Math.pow(1 - p, 3);

    // stepped progress (quantized)
    const totalSteps = Math.max(1, Math.floor(absDiff / stepSize));
    const stepIndex = Math.floor(eased * totalSteps);

    let v = a + dir * stepIndex * stepSize;

    // clamp to target on final frame
    if (p >= 1) v = b;
    if (dir > 0) v = Math.min(v, b);
    else v = Math.max(v, b);

    el.textContent = formatVal(v);

    if (p < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

let state = { subsNow: 0, viewsTotal: 0, watchTotal: 0 };

function render(data, isFirst) {
  setLogo(data.channel?.logo);

  // weekly line ONLY
  const w = data.weekly || {};
  const weeklySubs = Number(w.netSubs || 0);
  const weeklyViews = Number(w.views || 0);
  const weeklyWatch = Number(w.watchHours || 0);

  // monthly 28D focus
  const last28 = data.m28?.last28 || {};
  const prev28 = data.m28?.prev28 || {};
  const avg6m = data.m28?.avg6m || {};
  const med6m = data.m28?.median6m || {};

  // sparkline monthly
  const hist = data.history28d || []; // oldest->newest (7)
  const sparkSubs = hist.map(p => p.netSubs);
  const sparkViews = hist.map(p => p.views);
  const sparkWatch = hist.map(p => p.watchHours);

  // ---------- SUBS CARD ----------
  const subsNow = Number(data.channel?.subscribers || 0);
  const subsTier = tierFromBaseline(last28.netSubs, med6m.netSubs, 30, 0.10);

  setChip("subsDot", "subsChipText", subsTier, FEEDBACK.subs[subsTier]);
  setMainArrow("subsMainArrow", subsTier);

  document.getElementById("subsWeek").textContent =
    `This week: ${weeklySubs >= 0 ? "+" : ""}${fmt(weeklySubs)}`;

  document.getElementById("subsLast28").textContent =
    `${Number(last28.netSubs || 0) >= 0 ? "+" : ""}${fmt(last28.netSubs)}`;

  document.getElementById("subsPrev28").textContent =
    `${Number(prev28.netSubs || 0) >= 0 ? "+" : ""}${fmt(prev28.netSubs)}`;

  setVsRG("subsVsNum", "subsVsArrow",
    Number(last28.netSubs || 0) - Number(avg6m.netSubs || 0),
    0, ""
  );

  animateStepped(document.getElementById("subsNow"), isFirst ? 0 : state.subsNow, subsNow, { isFirst });
  setSpark(document.getElementById("subsSparkPath"), sparkSubs, COLORS[subsTier]);
  state.subsNow = subsNow;

  // ---------- VIEWS CARD ----------
  const viewsTotal = Number(data.channel?.totalViews || 0);
  const viewsTier = tierFromBaseline(last28.views, med6m.views, 25000, 0.10);

  setChip("viewsDot", "viewsChipText", viewsTier, FEEDBACK.views[viewsTier]);
  setMainArrow("viewsMainArrow", viewsTier);

  document.getElementById("viewsWeek").textContent = `This week: ${fmt(weeklyViews)}`;
  document.getElementById("viewsLast28").textContent = fmt(last28.views);
  document.getElementById("viewsPrev28").textContent = fmt(prev28.views);

  setVsRG("viewsVsNum", "viewsVsArrow",
    Number(last28.views || 0) - Number(avg6m.views || 0),
    0, ""
  );

  animateStepped(document.getElementById("viewsTotal"), isFirst ? 0 : state.viewsTotal, viewsTotal, { isFirst });
  setSpark(document.getElementById("viewsSparkPath"), sparkViews, COLORS[viewsTier]);
  state.viewsTotal = viewsTotal;

  // ---------- WATCH CARD ----------
  const watchTotal = Number(data.lifetime?.watchHours || 0);
  const watchTier = tierFromBaseline(last28.watchHours, med6m.watchHours, 50, 0.10);

  setChip("watchDot", "watchChipText", watchTier, FEEDBACK.watch[watchTier]);
  setMainArrow("watchMainArrow", watchTier);

  document.getElementById("watchWeek").textContent = `This week: ${fmt(weeklyWatch)}h`;
  document.getElementById("watchLast28").textContent = `${fmt(last28.watchHours)}h`;
  document.getElementById("watchPrev28").textContent = `${fmt(prev28.watchHours)}h`;

  setVsRG("watchVsNum", "watchVsArrow",
    Number(last28.watchHours || 0) - Number(avg6m.watchHours || 0),
    1, "h"
  );

  animateStepped(
    document.getElementById("watchNow"),
    isFirst ? 0 : state.watchTotal,
    watchTotal,
    { isFirst, decimals: watchTotal < 100 ? 1 : 0, suffix: "h" }
  );

  setSpark(document.getElementById("watchSparkPath"), sparkWatch, COLORS[watchTier]);
  state.watchTotal = watchTotal;

  document.getElementById("updated").textContent =
    `Updated: ${nowStamp()} • Auto-refresh: 1 min`;

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
