const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
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

/* Floating icons (white SVG) */
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

/**
 * ✅ Real casino roll:
 * - If change is small (like 742 → 743), we build a vertical list and slide it slowly.
 * - If change is big, we fall back to fast stepping.
 */
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

  // stop previous transitions
  ensureRoll(el);
  const wrap = el._rollWrap;
  const col = el._rollCol;

  const scale = Math.pow(10, decimals);
  const a = Math.round(Number(from || 0) * scale);
  const b = Math.round(Number(to || 0) * scale);
  const dir = b >= a ? 1 : -1;
  const diff = Math.abs(b - a);

  // If no change, just show target
  if (diff === 0) {
    col.style.transition = "none";
    col.style.transform = "translateY(0px)";
    col.innerHTML = `<span class="rollLine">${formatValue(b/scale, decimals, suffix)}</span>`;
    return;
  }

  // ✅ slow, visible roll for small diffs (even 1)
  const maxLines = isFirst ? 18 : 26; // keep DOM small
  if (!isFirst && diff <= maxLines) {
    const lines = [];
    for (let i = 0; i <= diff; i++) {
      const v = (a + dir * i) / scale;
      lines.push(`<span class="rollLine">${formatValue(v, decimals, suffix)}</span>`);
    }
    col.innerHTML = lines.join("");
    col.style.transition = "none";
    col.style.transform = "translateY(0px)";

    const h = wrap.getBoundingClientRect().height || 38;
    const targetY = -h * diff;

    // Slow on auto refresh
    const dur = 1400;
    requestAnimationFrame(() => {
      col.style.transition = `transform ${dur}ms cubic-bezier(.18,.90,.18,1)`;
      col.style.transform = `translateY(${targetY}px)`;
    });

    clearTimeout(el._rollCleanup);
    el._rollCleanup = setTimeout(() => {
      col.style.transition = "none";
      col.style.transform = "translateY(0px)";
      col.innerHTML = `<span class="rollLine">${formatValue(b/scale, decimals, suffix)}</span>`;
    }, dur + 60);

    return;
  }

  // Fast stepped roll (first load or big diffs)
  if (el._rollTimer) {
    clearInterval(el._rollTimer);
    el._rollTimer = null;
  }

  let cur = a;
  const target = b;

  const intervalMs = isFirst ? 7 : 20;
  const maxTicks = isFirst ? 120 : 170;
  const step = Math.max(1, Math.ceil(diff / maxTicks));

  col.style.transition = "none";
  col.style.transform = "translateY(0px)";
  col.innerHTML = `<span class="rollLine">${formatValue(cur/scale, decimals, suffix)}</span>`;

  el._rollTimer = setInterval(() => {
    if (cur === target) {
      clearInterval(el._rollTimer);
      el._rollTimer = null;
      return;
    }
    cur += dir * step;
    if (dir > 0 && cur > target) cur = target;
    if (dir < 0 && cur < target) cur = target;
    col.innerHTML = `<span class="rollLine">${formatValue(cur/scale, decimals, suffix)}</span>`;
  }, intervalMs);
}

let state = { subsNow: 0, viewsTotal: 0, watchTotal: 0 };

function render(data, isFirst) {
  setLogo(data.channel?.logo);

  // weekly line only
  const weekly = data.weekly || {};
  const weeklySubs = Number(weekly.netSubs || 0);
  const weeklyViews = Number(weekly.views || 0);
  const weeklyWatch = Number(weekly.watchHours || 0);

  // monthly
  const last28 = data.m28?.last28 || {};
  const prev28 = data.m28?.prev28 || {};
  const avg6m  = data.m28?.avg6m || {};
  const med6m  = data.m28?.median6m || {};

  // sparkline (monthly)
  const hist = data.history28d || [];
  const sparkSubs = hist.map(p => p.netSubs);
  const sparkViews = hist.map(p => p.views);
  const sparkWatch = hist.map(p => p.watchHours);

  // totals
  const subsNow = Number(data.channel?.subscribers || 0);
  const viewsTotal = Number(data.channel?.totalViews || 0);
  const watchTotal = Number(data.lifetime?.watchHours || 0);

  // floating icons only when increased
  if (!isFirst && subsNow > state.subsNow) spawnFloatIcon("cardSubs", "subs");
  if (!isFirst && viewsTotal > state.viewsTotal) spawnFloatIcon("cardViews", "views");
  if (!isFirst && watchTotal > state.watchTotal) spawnFloatIcon("cardWatch", "watch");

  // SUBS tier from monthly baseline
  const subsTier = tierFromBaseline(last28.netSubs, med6m.netSubs, 30, 0.10);
  setChip("subsDot", "subsChipText", subsTier, FEEDBACK.subs[subsTier]);
  setMainArrow("subsMainArrow", subsTier);
  setSpark(document.getElementById("subsSparkPath"), sparkSubs, COLORS[subsTier]);

  document.getElementById("subsWeek").textContent = `This week: ${weeklySubs >= 0 ? "+" : ""}${fmt(weeklySubs)}`;
  document.getElementById("subsLast28").textContent = `${Number(last28.netSubs||0) >= 0 ? "+" : ""}${fmt(last28.netSubs)}`;
  document.getElementById("subsPrev28").textContent = `${Number(prev28.netSubs||0) >= 0 ? "+" : ""}${fmt(prev28.netSubs)}`;
  setVsRG("subsVsNum", "subsVsArrow", Number(last28.netSubs||0) - Number(avg6m.netSubs||0), 0, "");

  // ✅ casino roll (auto refresh will be slow even for +1)
  animateCasinoRoll(document.getElementById("subsNow"), isFirst ? 0 : state.subsNow, subsNow, { isFirst });

  // VIEWS
  const viewsTier = tierFromBaseline(last28.views, med6m.views, 25000, 0.10);
  setChip("viewsDot", "viewsChipText", viewsTier, FEEDBACK.views[viewsTier]);
  setMainArrow("viewsMainArrow", viewsTier);
  setSpark(document.getElementById("viewsSparkPath"), sparkViews, COLORS[viewsTier]);

  document.getElementById("viewsWeek").textContent = `This week: ${fmt(weeklyViews)}`;
  document.getElementById("viewsLast28").textContent = fmt(last28.views);
  document.getElementById("viewsPrev28").textContent = fmt(prev28.views);
  setVsRG("viewsVsNum", "viewsVsArrow", Number(last28.views||0) - Number(avg6m.views||0), 0, "");

  animateCasinoRoll(document.getElementById("viewsTotal"), isFirst ? 0 : state.viewsTotal, viewsTotal, { isFirst });

  // WATCH
  const watchTier = tierFromBaseline(last28.watchHours, med6m.watchHours, 50, 0.10);
  setChip("watchDot", "watchChipText", watchTier, FEEDBACK.watch[watchTier]);
  setMainArrow("watchMainArrow", watchTier);
  setSpark(document.getElementById("watchSparkPath"), sparkWatch, COLORS[watchTier]);

  document.getElementById("watchWeek").textContent = `This week: ${fmt(weeklyWatch)}h`;
  document.getElementById("watchLast28").textContent = `${fmt(last28.watchHours)}h`;
  document.getElementById("watchPrev28").textContent = `${fmt(prev28.watchHours)}h`;
  setVsRG("watchVsNum", "watchVsArrow", Number(last28.watchHours||0) - Number(avg6m.watchHours||0), 1, "h");

  animateCasinoRoll(
    document.getElementById("watchNow"),
    isFirst ? 0 : state.watchTotal,
    watchTotal,
    { isFirst, decimals: watchTotal < 100 ? 1 : 0, suffix: "h" }
  );

  // update state AFTER starting animations
  state.subsNow = subsNow;
  state.viewsTotal = viewsTotal;
  state.watchTotal = watchTotal;

  document.getElementById("updated").textContent = `Updated: ${nowStamp()} • Auto-refresh: 1 min`;
  showToast(`Updated ✓ ${nowStamp()}`);
}

async function load(isFirst) {
  const data = await fetchJSON("/api/yt-kpis");
  if (data.error) {
    document.getElementById("updated").textContent = "Error: " + data.error;
    showToast("Update failed");
    return;
  }
  render(data, isFirst);
}

(async function init() {
  await load(true);
  setInterval(() => load(false), 60 * 1000);
})();
