/* =========================================================
   public/yt/topcards/app.js — Front-end runtime (NO UI redesign here)
   ---------------------------------------------------------
       Purpose:
         - Fetch KPI JSON from /api/yt-kpis every 60s and paint the 4 Top Cards + Sci‑Fi HUD.
         - All DOM updates are "safe" helpers (safeSetText / safeSetHTML / safeSetStyle).
         - Visual behaviors (rolling numbers, glow, float icons) are triggered only on value deltas.

       High-level flow:
         init() -> load(isFirst=true) -> render(data, isFirst) -> updateHud(data)
                  -> setInterval(load(false), 60s)

       Where to look when changing behavior later:
         - Number tiers + labels: COLORS + FEEDBACK + tierFromBaseline()
         - Card paint: render() (subs / realtime / views / watch)
         - Animations: ensureRoll() / animateCasinoRoll() / spawnFloatIcon() / triggerGlowOnce()
         - HUD messages: buildIntel() -> showNextIntel() -> animateHudBorder()
   ========================================================= */

// public/yt/topcards/app.js

/* =========================================================
   Number formatting helpers
   ---------------------------------------------------------
       NF_INT / NF_1:
         - Centralized Intl.NumberFormat instances to keep output consistent.
         - fmt()  -> integer formatting (views/subs)
         - fmt1() -> 1-decimal formatting (watch hours when < 100h)
         - nowStamp() -> tiny UI footer timestamp string
   ========================================================= */
const NF_INT = new Intl.NumberFormat();
const NF_1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmt(n) { return NF_INT.format(Number(n || 0)); }
function fmt1(n) { return NF_1.format(Number(n || 0)); }
function nowStamp() { return new Date().toLocaleTimeString(); }

/* =========================================================
   Tier color palette
   ---------------------------------------------------------
       COLORS drives:
         - Tier dot glow color (CSS uses --c-tier)
         - Sparkline stroke + fill gradient
         - HUD accent (tag/icon/border trace)
       NOTE: Tiers are semantic labels (red/orange/yellow/green/blue/purple), not business logic by themselves.
   ========================================================= */
const COLORS = {
  green:  "#00FF00",
  red:    "#fe0000",
  blue:   "#0073FF",
  yellow: "#fdfe02",
  purple: "#ab20fd",
  pink:   "#FF85EF",
  orange: "#FF9500",
  white:  "#ffffff"
};

/* =========================================================
   Tier -> label dictionaries (text shown in the small chip on each card)
   ---------------------------------------------------------
       FEEDBACK maps "metric type" -> tier -> short label.
       Example: realtime { red: "Big Drop", ... purple: "On Fire" }.
       These labels are purely UI text; tier assignment happens elsewhere (tierFromBaseline / tierRealtime etc.).
   ========================================================= */
const FEEDBACK = {
  subs: { red: "Audience Leak", orange: "Slow Convert", yellow: "Steady Growth", green: "Strong Pull", blue: "Rising Fast", purple: "Exceptional" },
  views: { red: "Reach Down", orange: "Low Reach", yellow: "Stable Reach", green: "Reach Up", blue: "Trending", purple: "Viral" },
  watch: { red: "Poor Engage", orange: "Retention Issue", yellow: "Consistent", green: "Engage Up", blue: "Hooked", purple: "Outstanding" },
  realtime: { red: "Big Drop", orange: "Drop Alert", yellow: "Going Flat", green: "Good Pace", blue: "Uptrend", purple: "On Fire" }
};

/* =========================================================
   Tier arrow glyphs
   ---------------------------------------------------------
       Converts tier to an arrow symbol placed beside the big number.
       This is separate from the chip label (FEEDBACK) and the dot color (COLORS).
   ========================================================= */
function tierArrow(tier) {
  if (tier === "red") return "↓↓";
  if (tier === "orange") return "↓";
  if (tier === "yellow") return "-";
  if (tier === "green") return "↑";
  if (tier === "blue") return "↑↑";
  return "⟰";
}

/* =========================================================
   Tiering: compare 'current window' vs 'baseline window'
   ---------------------------------------------------------
       Used by the 'Last 28D vs 6M Avg' style comparisons.
       Inputs:
         - last28: the active window value (what user sees as the main period)
         - median6m: the baseline (computed server-side from rolling history)
         - absMin: fallback threshold when baseline is 0 / unavailable
       Output: one of {red, orange, yellow, green, blue, purple}.
   ========================================================= */
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

// Special tier logic for Realtime (Last 24H vs Prev 6D Avg)
function tierRealtime(last24, prev6Avg, absMin = 100) {
  const L = Number(last24 || 0);
  const B = Number(prev6Avg || 0);
  if (B <= 0) return L > absMin ? "green" : "orange"; // fallback if no history
  const ratio = L / B;
  
  if (ratio < 0.5) return "red";      // Big Drop
  if (ratio < 0.9) return "orange";   // Drop Alert
  if (ratio < 1.1) return "yellow";  // Going Flat
  if (ratio < 1.5) return "green";    // Good Pace
  if (ratio < 2.0) return "blue";     // Uptrend
  return "purple";                    // On Fire
}

// Updated Milestone Logic: Returns Range { min, max }
function getMilestoneLimits(val, type) {
  const v = Number(val || 0);
  if (v < 0) return { min: 0, max: 100 };

  // Watch Hours (Specific YT Milestones)
  if (type === "watch") {
    if (v < 100) return { min: 0, max: 100 };
    if (v < 4000) return { min: 100, max: 4000 }; // Monetization jump
    if (v < 10000) {
      const step = 1000;
      const min = Math.floor(v / step) * step;
      return { min, max: min + step };
    }
    const step = 5000;
    const min = Math.floor(v / step) * step;
    return { min, max: min + step };
  }

// Standard (Subs, Views, Realtime)
  let step = 100;
  
  if (v >= 10000000) step = 10000000;      // 10M -> 20M
  else if (v >= 1000000) step = 1000000;   // 1M -> 2M
  else if (v >= 100000) step = 100000;     // 100k -> 200k
  else if (v >= 10000) step = 10000;       // 10k -> 20k
  else if (v >= 1000) step = 1000;         // 1k -> 2k
  else step = 100;                         // 0 -> 100

  const min = Math.floor(v / step) * step;
  return { min, max: min + step };
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// --- DOM HELPERS ---
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function safeSetStyle(id, prop, val) { const el = document.getElementById(id); if (el) el.style[prop] = val; }
function safeSetHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

// --- LOGIC ---
/* =========================================================
   Tier arrow glyphs
   ---------------------------------------------------------
       Converts tier to an arrow symbol placed beside the big number.
       This is separate from the chip label (FEEDBACK) and the dot color (COLORS).
   ========================================================= */
function tierArrow(tier) {
  if (tier === "red") return "↓↓";
  if (tier === "orange") return "↓";
  if (tier === "yellow") return "-";
  if (tier === "green") return "↑";
  if (tier === "blue") return "↑↑";
  return "⟰";
}

/* =========================================================
   Tiering: compare 'current window' vs 'baseline window'
   ---------------------------------------------------------
       Used by the 'Last 28D vs 6M Avg' style comparisons.
       Inputs:
         - last28: the active window value (what user sees as the main period)
         - median6m: the baseline (computed server-side from rolling history)
         - absMin: fallback threshold when baseline is 0 / unavailable
       Output: one of {red, orange, yellow, green, blue, purple}.
   ========================================================= */
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

// Special tier logic for Realtime (Last 24H vs Prev 6D Avg)
function tierRealtime(last24, prev6Avg, absMin = 100) {
  const L = Number(last24 || 0);
  const B = Number(prev6Avg || 0);
  if (B <= 0) return L > absMin ? "green" : "orange"; // fallback if no history
  const ratio = L / B;
  
  if (ratio < 0.5) return "red";      // Big Drop
  if (ratio < 0.9) return "orange";   // Drop Alert
  if (ratio < 1.1) return "yellow";  // Going Flat
  if (ratio < 1.5) return "green";    // Good Pace
  if (ratio < 2.0) return "blue";     // Uptrend
  return "purple";                    // On Fire
}

// Updated Milestone Logic: Returns Range { min, max }
function getMilestoneLimits(val, type) {
  const v = Number(val || 0);
  if (v < 0) return { min: 0, max: 100 };

  // Watch Hours (Specific YT Milestones)
  if (type === "watch") {
    if (v < 100) return { min: 0, max: 100 };
    if (v < 4000) return { min: 100, max: 4000 }; // Monetization jump
    if (v < 10000) {
      const step = 1000;
      const min = Math.floor(v / step) * step;
      return { min, max: min + step };
    }
    const step = 5000;
    const min = Math.floor(v / step) * step;
    return { min, max: min + step };
  }

// Standard (Subs, Views, Realtime)
  let step = 100;
  
  if (v >= 10000000) step = 10000000;      // 10M -> 20M
  else if (v >= 1000000) step = 1000000;   // 1M -> 2M
  else if (v >= 100000) step = 100000;     // 100k -> 200k
  else if (v >= 10000) step = 10000;       // 10k -> 20k
  else if (v >= 1000) step = 1000;         // 1k -> 2k
  else step = 100;                         // 0 -> 100

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
  stops[0].setAttribute("stop-color", rgbaFromHex(tierHex, 0.3));
  stops[1].setAttribute("stop-color", rgbaFromHex(tierHex, 0.15));
  stops[2].setAttribute("stop-color", rgbaFromHex(tierHex, 0.0));
  return gradId;
}

function paintSpark(idFill, idPath, gradId, points, tierHex, w = 120, h = 40) {
  const fillEl = document.getElementById(idFill);
  const pathEl = document.getElementById(idPath);
  if (!fillEl || !pathEl) return;
  if (!points.length) { fillEl.setAttribute("d", ""); pathEl.setAttribute("d", ""); return; }
  const maxY = Math.max(...points);
  const minY = Math.min(...points);
  const range = maxY - minY || 1;
  const norm = points.map((y, i) => ({ x: (i / (points.length - 1)) * w, y: h - ((y - minY) / range) * h }));
  let dFill = `M0,${h} L${norm[0].x},${norm[0].y}`;
  let dPath = `M${norm[0].x},${norm[0].y}`;
  for (let i = 1; i < norm.length; i++) {
    dFill += ` L${norm[i].x},${norm[i].y}`;
    dPath += ` L${norm[i].x},${norm[i].y}`;
  }
  dFill += ` L${w},${h} Z`;
  fillEl.setAttribute("d", dFill);
  fillEl.setAttribute("fill", `url(#${gradId})`);
  pathEl.setAttribute("d", dPath);
  pathEl.setAttribute("stroke", tierHex);
  pathEl.setAttribute("stroke-width", "2");
}

function setProgressFill(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${clamp(pct, 0, 100)}%`;
}

function setMilestoneText(nextId, pctId, nextGoal, pct) {
  safeSetText(nextId, fmt(nextGoal));
  safeSetText(pctId, `${Math.round(pct)}%`);
}

function setMilestone(cardId, curVal, type) {
  const { max } = getMilestoneLimits(curVal, type);
  const pct = (curVal / max) * 100;
  setMilestoneText(`${cardId}NextGoal`, `${cardId}NextPct`, max, pct);
  setProgressFill(`${cardId}ProgressFill`, pct);
}

function setPrev28(id, val) { safeSetText(id, fmt(val)); }

function setVs6M(numId, arrowId, last28, median6m, absMin) {
  const tier = tierFromBaseline(last28, median6m, absMin);
  const delta = Number(last28) - Number(median6m);
  setVsRG(numId, arrowId, delta / Number(median6m || absMin || 1), 2, "%");
  return tier;
}

function setWeekLine(id, val) { safeSetText(id, fmt(val)); }

function setRollingNumber(id, newVal, isFirst) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isFirst) { el.textContent = fmt(newVal); return; }
  ensureRoll(el, newVal);
  animateCasinoRoll(el, newVal);
}

function triggerGlowOnce(cardId) {
  const card = document.getElementById(cardId);
  if (card) {
    card.classList.add("glow-once");
    setTimeout(() => card.classList.remove("glow-once"), 4200);
  }
}

function spawnFloatIcon(cardId, iconSvg = "↑") {
  const card = document.getElementById(cardId);
  if (!card) return;
  const float = document.createElement("div");
  float.className = "floatIcon";
  float.innerHTML = iconSvg;
  card.appendChild(float);
  setTimeout(() => float.remove(), 5200);
}

function renderSubs(cardId, data, isFirst) {
  const cur = Number(data.channel.subscribers || 0);
  const last28 = Number(data.m28.last28.netSubs || 0);
  const prev28 = Number(data.m28.prev28.netSubs || 0);
  const median6m = Number(data.m28.median6m.netSubs || 0);
  const week = Number(data.weekly.netSubs || 0);
  const tier = tierFromBaseline(last28, median6m, 100);
  setCardTheme(cardId, tier);
  setChip(`${cardId}Dot`, `${cardId}ChipText`, tier, FEEDBACK.subs[tier]);
  setMainArrow(`${cardId}MainArrow`, tier);
  setRollingNumber(`${cardId}Now`, cur, isFirst);
  paintSpark(`${cardId}SparkFill`, `${cardId}SparkPath`, `${cardId}Grad`, data.history28d.map(w => w.netSubs), COLORS[tier]);
  setMilestone(cardId, cur, "subs");
  setWeekLine(`${cardId}Week`, week);
  setPrev28(`${cardId}Last28`, last28);
  setPrev28(`${cardId}Prev28`, prev28);
  setVs6M(`${cardId}VsNum`, `${cardId}VsArrow`, last28, median6m, 100);
  if (!isFirst && week > 0) {
    spawnFloatIcon(cardId, HUD_ICONS.up);
    triggerGlowOnce(cardId);
  }
}

function renderRealtime(cardId, data, isFirst) {
  const cur = Number(data.realtime.views48h || 0);
  const last24 = Number(data.realtime.last24h || 0);
  const prev24 = Number(data.realtime.prev24h || 0);
  const vs7d = Number(data.realtime.vs7dAvgDelta || 0);
  const avg6d = Number(data.realtime.avgPrior6d || 0);
  const pacing = Number(data.realtime.lastHour || 0);
  const tier = tierRealtime(last24, avg6d, 1000);
  setCardTheme(cardId, tier);
  setChip(`${cardId}Dot`, `${cardId}ChipText`, tier, FEEDBACK.realtime[tier]);
  setMainArrow(`${cardId}MainArrow`, tier);
  setRollingNumber(`${cardId}Now`, cur, isFirst);
  paintSpark(`${cardId}SparkFill`, `${cardId}SparkPath`, `${cardId}Grad`, data.realtime.sparkline, COLORS[tier]);
  setMilestone(cardId, cur, "realtime");
  safeSetText(`${cardId}Pacing`, fmt(pacing));
  setPrev28(`${cardId}Last24`, fmt(last24));
  setPrev28(`${cardId}Prev24`, fmt(prev24));
  setVsRG(`${cardId}VsNum`, `${cardId}VsArrow`, vs7d, 0, "");
  if (!isFirst && pacing > 0) {
    spawnFloatIcon(cardId, HUD_ICONS.up);
    triggerGlowOnce(cardId);
  }
}

function renderViews(cardId, data, isFirst) {
  const cur = Number(data.channel.totalViews || 0);
  const last28 = Number(data.m28.last28.views || 0);
  const prev28 = Number(data.m28.prev28.views || 0);
  const median6m = Number(data.m28.median6m.views || 0);
  const week = Number(data.weekly.views || 0);
  const tier = tierFromBaseline(last28, median6m, 1000);
  setCardTheme(cardId, tier);
  setChip(`${cardId}Dot`, `${cardId}ChipText`, tier, FEEDBACK.views[tier]);
  setMainArrow(`${cardId}MainArrow`, tier);
  setRollingNumber(`${cardId}Total`, cur, isFirst);
  paintSpark(`${cardId}SparkFill`, `${cardId}SparkPath`, `${cardId}Grad`, data.history28d.map(w => w.views), COLORS[tier]);
  setMilestone(cardId, cur, "views");
  setWeekLine(`${cardId}Week`, fmt(week));
  setPrev28(`${cardId}Last28`, fmt(last28));
  setPrev28(`${cardId}Prev28`, fmt(prev28));
  setVs6M(`${cardId}VsNum`, `${cardId}VsArrow`, last28, median6m, 1000);
  if (!isFirst && week > 0) {
    spawnFloatIcon(cardId, HUD_ICONS.up);
    triggerGlowOnce(cardId);
  }
}

function renderWatch(cardId, data, isFirst) {
  const cur = Number(data.lifetime.watchHours || 0);
  const last28 = Number(data.m28.last28.watchHours || 0);
  const prev28 = Number(data.m28.prev28.watchHours || 0);
  const median6m = Number(data.m28.median6m.watchHours || 0);
  const week = Number(data.weekly.watchHours || 0);
  const tier = tierFromBaseline(last28, median6m, 10);
  setCardTheme(cardId, tier);
  setChip(`${cardId}Dot`, `${cardId}ChipText`, tier, FEEDBACK.watch[tier]);
  setMainArrow(`${cardId}MainArrow`, tier);
  setRollingNumber(`${cardId}Now`, cur < 100 ? fmt1(cur) : fmt(cur), isFirst);
  paintSpark(`${cardId}SparkFill`, `${cardId}SparkPath`, `${cardId}Grad`, data.history28d.map(w => w.watchHours), COLORS[tier]);
  setMilestone(cardId, cur, "watch");
  setWeekLine(`${cardId}Week`, fmt1(week));
  setPrev28(`${cardId}Last28`, fmt1(last28));
  setPrev28(`${cardId}Prev28`, fmt1(prev28));
  setVs6M(`${cardId}VsNum`, `${cardId}VsArrow`, last28, median6m, 10);
  if (!isFirst && week > 0) {
    spawnFloatIcon(cardId, HUD_ICONS.up);
    triggerGlowOnce(cardId);
  }
}

function render(data, isFirst) {
  safeSetText("updated", `UPDATED ${nowStamp()}`);
  renderSubs("cardSubs", data, isFirst);
  renderRealtime("cardRealtime", data, isFirst);
  renderViews("cardViews", data, isFirst);
  renderWatch("cardWatch", data, isFirst);
  const cards = ["cardSubs", "cardRealtime", "cardViews", "cardWatch"];
  cards.forEach((id, i) => {
    const card = document.getElementById(id);
    if (card) card.style.animationDelay = `${i * 0.2}s`;
  });
  if (!isFirst) showToast();
}

function showToast() {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }
}

const HUD_CONFIG = { started: false, timer: null };
let intelQueue = [];

const HUD_ICONS = {
  up: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l-8 8h6v12h4V10h6z"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22l8-8h-6V2h-4v12H4z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm7.93 9h-3.17a15.7 15.7 0 0 0-1.45-6A8.02 8.02 0 0 1 19.93 11zM12 4c.9 1.3 1.7 3.3 2.1 7H9.9C10.3 7.3 11.1 5.3 12 4zM4.07 13h3.17a15.7 15.7 0 0 0 1.45 6A8.02 8.02 0 0 1 4.07 13zm3.17-2H4.07A8.02 8.02 0 0 1 8.69 5a15.7 15.7 0 0 0-1.45 6zm2.66 2h4.2c-.4 3.7-1.2 5.7-2.1 7-.9-1.3-1.7-3.3-2.1-7zm6.86 6a15.7 15.7 0 0 0 1.45-6h3.17A8.02 8.02 0 0 1 15.31 19z"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v12H5.17L4 17.17V4zm2 2v7.17L6.83 14H18V6H6z"/></svg>`,
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

// --- HUD BORDER ANIMATION (Counter Clockwise from Top-Left) ---
/* =========================================================
   HUD border geometry (SVG path generation)
   ---------------------------------------------------------
       Calculates a rounded-rect path around the current HUD content size.
       The SVG path 'hudTracePath' is used by animateHudBorder() to draw a moving trace.
   ========================================================= */
function updateHudPathGeometry() {
  const path = document.getElementById("hudTracePath");
  const box = document.getElementById("hudBox");
  if (!path || !box) return;

  const w = box.offsetWidth - 2; 
  const h = box.offsetHeight - 2;
  
  // Path: Start Top-Left(0,0) -> Down(0,H) -> Right(W,H) -> Up(W,0) -> Left(0,0)
  const d = `M 1 1 L 1 ${h} L ${w} ${h} L ${w} 1 L 1 1`;
  path.setAttribute("d", d);
  
  // Ensure dasharray covers the whole new length so it can appear solid if needed
  const len = path.getTotalLength() || 1000;
  path.style.strokeDasharray = len;
}

function initHudBorder() {
  updateHudPathGeometry();
  
  const path = document.getElementById("hudTracePath");
  if (!path) return;
  const len = path.getTotalLength() || 1000;
  
  // Reset style for animation start
  path.style.transition = "none";
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len; // Hidden start

  // Start ResizeObserver once to handle window resize or fluid layout changes
  if (!window._hudRo) {
      const box = document.getElementById("hudBox");
      if (box) {
          window._hudRo = new ResizeObserver(() => {
              updateHudPathGeometry();
          });
          window._hudRo.observe(box);
      }
  }
}

function animateHudBorder(color) {
  const path = document.getElementById("hudTracePath");
  if (!path) return;
  const len = path.getTotalLength() || 1000;

  path.style.stroke = color;
  
  // 1. Reset to empty (hidden) with NO transition
  path.style.transition = "none";
  path.style.strokeDashoffset = len;

  // 2. Force reflow + Start animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      path.style.transition = "stroke-dashoffset 16s linear";
      path.style.strokeDashoffset = "0";
    });
  });
}

function buildIntel(data) {
  const out = []; const ch = data.channel || {}, w = data.weekly || {}, m28 = data.m28 || {}, hud = data.hud || {}, hist = data.history28d || [];
  const weekViews = Number(w.views || 0), weekG = Number(w.subscribersGained || 0), weekL = Number(w.subscribersLost || 0), weekNet = Number(w.netSubs || 0);
  const churnPct = weekG > 0 ? Math.round((weekL / weekG) * 100) : (weekL > 0 ? 100 : 0);
  const subsPer1k = weekViews > 0 ? (weekNet / weekViews) * 1000 : 0;
  
  const uploadDaysAgo = (hud.uploads?.latest?.publishedAt && hud.statsThrough) ? daysBetweenISO(hud.uploads.latest.publishedAt, hud.statsThrough) : null;
  if (uploadDaysAgo !== null && uploadDaysAgo > 14) out.push({ key: "warn_gap", cat: "warning", weight: 3, icon: HUD_ICONS.warn, tag: "WARNING", type: "red", text: `UPLOAD BUFFER EMPTY. LAST UPLOAD WAS ${uploadDaysAgo} DAYS AGO.` });
  else if (uploadDaysAgo !== null && uploadDaysAgo <= 3) out.push({ key: "good_gap", cat: "good", weight: 2, icon: HUD_ICONS.up, tag: "RISING", type: "green", text: `CONSISTENCY DETECTED. LAST UPLOAD ${uploadDaysAgo} DAYS AGO.` });

  if (weekG > 0 || weekL > 0) out.push({ key: "churn", cat: "subs", weight: 3.2, icon: weekL>weekG?HUD_ICONS.down:HUD_ICONS.up, tag: weekL>weekG?"DROPPING":"GROWTH", type: weekL>weekG?"red":"green", text: `NET SUBS: ${weekNet}. GAINED ${weekG}, LOST ${weekL}.` });

  if (weekViews > 0) out.push({ key: "conv", cat: "conversion", weight: 2.6, icon: HUD_ICONS.target, tag: "CONVERSION", type: subsPer1k>=2?"green":"yellow", text: `CONVERSION RATE: ${subsPer1k.toFixed(2)} NET SUBS PER 1K VIEWS.` });

  const thumb = hud.thumb28;
  if (thumb && thumb.ctr) {
    const ctr = thumb.ctr;
    out.push({ key: "ctr", cat: "packaging", weight: 2.1, icon: ctr<2?HUD_ICONS.warn:HUD_ICONS.bulb, tag: ctr<2?"WARNING":"PACKAGING", type: ctr<2?"red":(ctr>8?"green":"yellow"), text: `AVG CTR IS ${ctr.toFixed(1)}%. ${ctr<2?"OPTIMIZE THUMBNAILS.":"HEALTHY METRIC."}` });
  }

  const ret = hud.retention28;
  if (ret && ret.avgViewPercentage) {
    const r = ret.avgViewPercentage;
    out.push({ key: "ret", cat: "retention", weight: 2, icon: r<35?HUD_ICONS.warn:HUD_ICONS.up, tag: r<35?"WARNING":"RETENTION", type: r<35?"red":"green", text: `AVG VIEW PERCENTAGE IS ${r.toFixed(0)}%. ${r<35?"TIGHTEN INTROS.":"AUDIENCE ENGAGED."}` });
  }

  const lv = hud.latestVideo;
  if (lv && lv.title) {
    const vViews = Number(lv.views||0);
    out.push({ key: "lv_stat", cat: "video", weight: 2.8, icon: HUD_ICONS.rocket, tag: "LATEST", type: "purple", text: `LATEST UPLOAD: "${lv.title.toUpperCase()}" — ${fmt(vViews)} VIEWS.` });
  }

  const nextSub = getMilestoneLimits(Number(ch.subscribers||0), "subs").max;
  if (nextSub > Number(ch.subscribers||0)) out.push({ key: "goal", cat: "goal", weight: 1.4, icon: HUD_ICONS.target, tag: "MILESTONE", type: "blue", text: `${fmt(nextSub - Number(ch.subscribers))} SUBS REMAINING TO REACH ${fmt(nextSub)}.` });

  const tip = pick(KB.tips); if (tip) out.push({ key: "tip", cat: "tip", weight: 0.4, icon: HUD_ICONS.bulb, tag: "TIP", type: "yellow", text: tip.toUpperCase() });
  const fact = pick(KB.facts); if (fact) out.push({ key: "fact", cat: "trivia", weight: 0.3, icon: HUD_ICONS.bulb, tag: "FACT", type: "pink", text: fact.toUpperCase() });
  const mot = pick(KB.motivation); if (mot) out.push({ key: "mot", cat: "motivation", weight: 0.2, icon: HUD_ICONS.live, tag: "INSIGHT", type: "purple", text: mot.toUpperCase() });

  return out;
}

function showNextIntel() {
  const item = intelQueue.length ? intelQueue[Math.floor(Math.random() * intelQueue.length)] : null;
  if (!item) return;

  const msg = document.getElementById("hudMessage");
  const tag = document.getElementById("hudTag");
  const icon = document.getElementById("hudIcon");
  const box = document.getElementById("hudBox");
  
  // Glitch Out
  box.classList.remove("glitch-active");
  msg.style.opacity = "0"; 
  tag.style.opacity = "0";
  icon.style.opacity = "0";

  setTimeout(() => {
    // Update
    msg.textContent = item.text;
    tag.textContent = item.tag;
    icon.innerHTML = item.icon || "⚡";
    
    // RECALCULATE GEOMETRY FOR NEW CONTENT SIZE
    updateHudPathGeometry();

    const c = COLORS[item.type] || COLORS.orange;
    
    box.style.setProperty("--hud-accent", c);
    tag.style.color = c;
    tag.style.textShadow = `0 0 10px ${c}`;
    icon.style.color = c; // for fill="currentColor"

    // Restart Trace
    animateHudBorder(c);

    // Glitch In
    msg.style.opacity = "1";
    tag.style.opacity = "1";
    icon.style.opacity = "1";
    box.classList.add("glitch-active");
    
  }, 200);
}

function updateHud(data) {
  intelQueue = buildIntel(data);
  if (!HUD_CONFIG.started) {
    HUD_CONFIG.started = true;
    setTimeout(() => {
      initHudBorder();
      showNextIntel();
      HUD_CONFIG.timer = setInterval(showNextIntel, 16000);
    }, 1200);
  }
}

// Random glitch trigger for main counters, insights, and HUD message
function randomGlitch() {
  const elements = [
    ...document.querySelectorAll('.bigNumber'),
    ...document.querySelectorAll('.metaValue'),
    document.getElementById('hudMessage')
  ].filter(el => el);

  if (elements.length > 0) {
    const randomEl = elements[Math.floor(Math.random() * elements.length)];
    randomEl.classList.add('glitch-active');
    setTimeout(() => randomEl.classList.remove('glitch-active'), 300);
  }

  // Schedule next glitch in 10-30 seconds
  setTimeout(randomGlitch, Math.floor(Math.random() * 20000) + 10000);
}

/* =========================================================
   Boot sequence
   ---------------------------------------------------------
       Immediately-invoked async init():
         - First paint isFirst=true
         - Then refresh every 60 seconds
   ========================================================= */
(async function init() { 
  await load(true); 
  setInterval(() => load(false), 60 * 1000); 
  setTimeout(randomGlitch, 10000); // Start random glitches after init
})();
