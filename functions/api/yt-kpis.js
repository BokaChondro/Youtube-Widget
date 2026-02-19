/* =========================================================
   functions/api/yt-kpis.js — Server KPI aggregator (YouTube Data + Analytics APIs)
   ---------------------------------------------------------
       Responsibilities:
             - Authenticate with OAuth (access token from refresh token / env vars)
             - Pull channel totals (subs + lifetime views) from YouTube Data API
             - Pull day-by-day metrics from YouTube Analytics API (views, minutes, subs gained/lost)
             - Compute rolling windows (last 7d, prev 7d, last 28d, rolling 6M baseline, etc.)
             - Compute 48H 'realtime-ish' views and an hourly series for the sparkline
             - Build extra intel lists for the HUD (top videos, CTR, retention, etc.)
             - Return a single JSON blob for the front-end to render

           Key output consumers:
             - app.js render() uses window metrics + sparklines
             - app.js HUD engine uses the 'intel' fields to craft messages
   ========================================================= */

// functions/api/yt-kpis.js
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function shiftDays(dateObj, deltaDays) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + deltaDays);
  return d;
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function median(nums) {
  const arr = (nums || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function avg(nums) {
  const arr = (nums || []).map(Number).filter(Number.isFinite);
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function safeStartDateFromPublishedAt(publishedAt) {
  if (!publishedAt) return "2006-01-01";
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return "2006-01-01";
  const iso = isoDate(d);
  return iso < "2006-01-01" ? "2006-01-01" : iso;
}

function daysBetween(isoA, isoB) {
  try {
    const a = new Date(isoA);
    const b = new Date(isoB);
    const ms = b.getTime() - a.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/* =========================================================
   Tiny utilities
   ---------------------------------------------------------
       clamp / round1 / pct / uniq / isoDate / shiftDays etc.
       These keep calculations consistent across all KPI computations.
   ========================================================= */
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function safeReadJson(r) {
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { raw: txt };
  }
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function parseISODurationToSeconds(isoDur) {
  if (!isoDur || typeof isoDur !== "string") return null;
  const m = isoDur.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  const h = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + mm * 60 + s;
}

function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return round1(x);
}

/* ---------------------- OAuth Auto-Refresh (Production) ----------------------
 * Required ENV:
 *   - YT_CLIENT_ID
 *   - YT_CLIENT_SECRET
 *   - YT_REFRESH_TOKEN
 *
 * This function auto-refreshes Google OAuth access tokens so you never manually update tokens.
 */
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Best-effort in-memory cache (works across warm requests on the same isolate)
let _tokenCache = { accessToken: "", expiresAtMs: 0 };

function hasRefreshConfig(env) {
  return Boolean(env?.YT_CLIENT_ID && env?.YT_CLIENT_SECRET && env?.YT_REFRESH_TOKEN);
}

async function refreshAccessTokenFromGoogle(env) {
  const body = new URLSearchParams({
    client_id: env.YT_CLIENT_ID,
    client_secret: env.YT_CLIENT_SECRET,
    refresh_token: env.YT_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const r = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    const msg = j?.error_description || j?.error || `OAuth refresh failed (HTTP ${r.status})`;
    throw new Error(msg);
  }

  const expiresInSec = Number(j.expires_in) || 3600;
  _tokenCache.accessToken = String(j.access_token);
  _tokenCache.expiresAtMs = Date.now() + expiresInSec * 1000;
  return _tokenCache.accessToken;
}

async function getAccessToken(env, forceRefresh = false) {
  if (!hasRefreshConfig(env)) {
    throw new Error("Missing OAuth env. Set YT_CLIENT_ID, YT_CLIENT_SECRET, and YT_REFRESH_TOKEN.");
  }

  const now = Date.now();
  const safetyWindowMs = 60 * 1000; // refresh 60s early

  if (
    !forceRefresh &&
    _tokenCache.accessToken &&
    _tokenCache.expiresAtMs &&
    now < (_tokenCache.expiresAtMs - safetyWindowMs)
  ) {
    return _tokenCache.accessToken;
  }

  return await refreshAccessTokenFromGoogle(env);
}

/* =========================================================
   YouTube HTTP wrappers
   ---------------------------------------------------------
       ytDataGET(): calls YouTube Data API (channels, playlistItems, videos)
       ytAnalyticsGET(): calls YouTube Analytics API (reports/query)
       safeAnalytics(): same as ytAnalyticsGET but returns null on failure (HUD should degrade gracefully)
   ========================================================= */
/* ------------------- V3 HUD Templates + Safe Rendering ------------------- */

function percent(part, total) {
  total = safeNum(total, 0);
  part = safeNum(part, 0);
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function hostnameFromUrl(input) {
  try {
    if (!input) return "";
    let u = String(input).trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return String(input || "").trim();
  }
}

function titleizeEnum(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function pickRandomN(arr, n = 3) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  const out = [];
  while (a.length && out.length < n) {
    const i = Math.floor(Math.random() * a.length);
    out.push(a.splice(i, 1)[0]);
  }
  return out;
}

function extractTokens(text) {
  const re = /{([a-zA-Z0-9_.]+)}/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) tokens.push(m[1]);
  return tokens;
}

function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function renderTemplate(templateText, v3Data) {
  if (typeof templateText !== "string") return "";
  const re = /{([a-zA-Z0-9_.]+)}/g;
  return templateText.replace(re, (_, token) => {
    const v = resolvePath({ v3: v3Data }, token);
    if (v === undefined || v === null) return "";
    return String(v);
  });
}

function isSafeTemplate(templateText, v3Data) {
  const tokens = extractTokens(templateText);
  for (const t of tokens) {
    const v = resolvePath({ v3: v3Data }, t);
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
  }
  return true;
}

/* -------------------------- 380 Template Decks ------------------------- */

const HUD_TEMPLATE_DECKS_V3 = {
  PULSE: [
    "I'm tracking {v3.realtime.viewsLastHour} views in the last hour. You're moving faster than yesterday.",
    "The channel heartbeat is strong. {v3.realtime.estimatedConcurrent} people are watching you right this second.",
    "I've detected a surge. Your 48-hour performance is {v3.realtime.vsBaseline48hPct}% above your baseline.",
    "Current pace: You are capturing about {v3.realtime.attentionHoursPerDay} hours of human attention every single day.",
    "It's a bit too quiet. Real-time velocity is {v3.realtime.vsBaseline48hPct}% off normal. Do we need a new upload?",
    "We are cruising at a steady altitude of {v3.realtime.avgViewsPerDay7d} views per day. No turbulence detected.",
    "Momentum is building. Today is running {v3.realtime.vsYesterdayPct}% above yesterday.",
    "We just crossed your highest single-day view count this week: {v3.realtime.bestDayViews7d}. High five.",
    "You have managed to grab {v3.realtime.viewsLast48Hours} views in the last 48 hours. That is strong work.",
    "If you keep this pace up, you will beat last week's total by mid-week."
  ],

  SHORTS: [
    "Too many people are swiping away from '{v3.shorts.title}'. We need to make the first second louder.",
    "You own the feed right now. '{v3.shorts.title}' has a Viewed Rate of {v3.shorts.viewedRatePct}%. That is elite.",
    "I think people are watching '{v3.shorts.title}' twice. Retention is over {v3.shorts.loopRetentionPct}%. The loop is perfect.",
    "Just so you know, your Shorts are currently driving {v3.shorts.trafficPct}% of your total traffic.",
    "Shorts are converting subscribers {v3.shorts.subsPer1kPct}% faster than your long-form videos right now.",
    "Viral trigger: '{v3.shorts.title}' just passed {v3.shorts.viewsSpotlight} views in the feed.",
    "Discovery mode: {v3.shorts.discoveryPct}% of your new viewers found you via Shorts surfaces.",
    "Only {v3.shorts.stopRatePct}% of people stopped to watch. The competition in the feed is fierce today.",
    "Vertical Velocity! Your Shorts views are up {v3.shorts.vsLastWeekPct}% this week.",
    "Volume check: You got {v3.shorts.views48h} Shorts views in the last ~48 hours."
  ],

  CTR: [
    "'{v3.focus.title}' is a click beast. The CTR is {v3.packaging.ctrPct}%. Whatever you did, do it again.",
    "We have a packaging issue. '{v3.focus.title}' has high impressions but very low clicks.",
    "Remember the 2% rule. If CTR is under 2%, the video is effectively invisible.",
    "Impression spike! YouTube showed '{v3.focus.title}' to {v3.packaging.impressions} people recently.",
    "For every 1,000 people who saw '{v3.focus.title}', {v3.packaging.clicksPer1kImpressions} decided to watch. That's the math."
  ],

  RETENTION: [
    "Great hook! '{v3.focus.title}' retained {v3.retention.avgViewPct}%. Strong opening.",
    "Glue Factor: High. '{v3.focus.title}' has an Average View Duration of {v3.retention.avdMinutes} minutes.",
    "Completionist: {v3.retention.completionPct}% of viewers watched '{v3.focus.title}' to the end.",
    "Retention is the engine. Your high AVD is triggering more recommendations.",
    "On average, a viewer watches {v3.retention.avgViewPct}% of your videos before leaving."
  ],
};

Object.assign(HUD_TEMPLATE_DECKS_V3, buildRemainingDecksV3());
ensureTemplateCountExact(HUD_TEMPLATE_DECKS_V3, 380);

function buildRemainingDecksV3() {
  return {
    MONEY: [
      "Estimated Revenue for the last 28 days is ${v3.money.estimatedRevenue28d}.",
      "Your current revenue per 1,000 views is ${v3.money.rpm}.",
      "CPM Update: Your niche is currently paying ${v3.money.cpm} per 1,000 views.",
      "Your top 10 videos are generating {v3.money.top10IncomePct}% of your total income."
    ],

    LOYALTY: [
      "Fresh Blood: {v3.audience.newViewerPct}% of viewers on '{v3.focus.title}' are brand new.",
      "The Core: You have about {v3.audience.coreViewers} unique viewers who watch everything.",
      "Unique Viewers: {v3.audience.uniqueViewers28} individual humans watched you this month.",
      "Avg Views per Viewer: {v3.audience.avgViewsPerViewer28}. They are watching multiple videos per session.",
      "Subscribed viewers are {v3.audience.subscribedViewsPct}% today. That's stability."
    ],

    TRAFFIC: [
      "Algo Love: {v3.discovery.browsePct}% of traffic is coming from Browse Features (Homepage).",
      "Notification Squad: {v3.discovery.notificationPct}% of traffic came from the bell.",
      "Search Win: People are finding you by typing '{v3.discovery.keyword}'.",
      "External Spike: Traffic coming from {v3.discovery.website}. Who shared you?",
      "Playlist Power: '{v3.discovery.playlistName}' is driving binge sessions."
    ],

    ENGAGEMENT: [
      "People aren't just watching — they're reacting. {v3.engagement.focusLikes} likes on '{v3.focus.title}' is a strong signal.",
      "'{v3.focus.title}' is getting shared {v3.engagement.focusShares} times. That's free distribution.",
      "Your audience is in chat mode today. Comments are up {v3.engagement.commentsUpPct}%.",
      "Your best engagement today is coming from '{v3.engagement.topEngagedTitle}'. That's your current audience language."
    ],

    PLAYLISTS: [
      "Your best binge starter is '{v3.playlists.bingeStarterTitle}'. It's acting like an entry ramp.",
      "End Screen: push viewers from '{v3.focus.title}' into '{v3.playlists.nextVideoTitle}'.",
      "Think like Netflix: each video should feel like next episode energy."
    ],

    AUDIENCE_QUALITY: [
      "Unsubscribed viewers are {v3.audience.unsubscribedViewsPct}%. Discovery is the growth lever.",
      "Subscribed vs unsubscribed split is telling a story. Today's story: {v3.audience.storyLine}.",
      "Your engagement is strongest from {v3.audience.topCountry} right now. That's where loyal fans live."
    ],

    CADENCE: [
      "It's been {v3.cadence.daysSinceUpload} days since the last upload. Momentum decays when the feed goes quiet.",
      "Your audience is most active around {v3.cadence.bestHour}. That's a safe upload window."
    ],

    SYSTEMS: [
      "Signal check: {v3.realtime.avgViewsPerDay7d} views/day pace. Keep the flywheel spinning.",
      "Your discovery door is {v3.discovery.topTrafficSource}. Make the next upload fit that door.",
      "Retention on '{v3.focus.title}' is {v3.retention.avgViewPct}%. Keep the pacing tight.",
      "Real-time 48h views: {v3.realtime.viewsLast48Hours}. That's the current momentum."
    ],
  };
}

/**
 * Ensures we have exactly N templates:
 * - If under target: appends safe patterns.
 * - If over target: trims from the end (stable ordering).
 */
function ensureTemplateCountExact(decks, target = 380) {
  const count = () =>
    Object.values(decks).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0);

  const tags = [
    "GROWTH",
    "ALGORITHM",
    "COMMUNITY",
    "QUALITY",
    "FORMAT",
    "STRATEGY",
    "SYSTEMS",
    "DISCOVERY",
    "PACKAGING",
    "RETENTION_PLUS",
  ];

  const patterns = [
    "Signal check: {v3.realtime.avgViewsPerDay7d} views/day pace. Keep the flywheel spinning.",
    "Your discovery door is {v3.discovery.topTrafficSource}. Make the next upload fit that door.",
    "If CTR stays at {v3.packaging.ctrPct}%, the algorithm will keep testing you. Keep refining packaging.",
    "Your watch-time engine is {v3.realtime.attentionHoursPerDay} hours/day. That's compounding attention.",
    "Subscribed views are {v3.audience.subscribedViewsPct}%. Loyalty stabilizes your channel.",
    "Unsubscribed views are {v3.audience.unsubscribedViewsPct}%. Discovery is your growth lever.",
    "Your top search phrase is '{v3.discovery.keyword}'. Make a sequel targeting the same intent.",
    "External traffic is coming from {v3.discovery.website}. Double down on that distribution channel.",
    "Playlist sessions matter: push viewers from '{v3.focus.title}' into '{v3.playlists.nextVideoTitle}'.",
    "Retention on '{v3.focus.title}' is {v3.retention.avgViewPct}%. Tight pacing wins."
  ];

  let total = count();
  let i = 0;

  while (total < target) {
    const tag = tags[i % tags.length];
    if (!decks[tag]) decks[tag] = [];
    decks[tag].push(patterns[i % patterns.length]);
    i++;
    total = count();
  }

  // Trim if over target
  if (total > target) {
    const deckKeys = Object.keys(decks);
    // stable trim from the end of last decks
    while (total > target && deckKeys.length) {
      const k = deckKeys[deckKeys.length - 1];
      if (Array.isArray(decks[k]) && decks[k].length) {
        decks[k].pop();
        total--;
      } else {
        deckKeys.pop();
      }
    }
  }
}

function buildHUDMessageTemplatesV3(v3Data) {
  const decks = HUD_TEMPLATE_DECKS_V3;
  const templates = [];
  let id = 1;

  for (const [tag, list] of Object.entries(decks)) {
    for (const raw of (Array.isArray(list) ? list : [])) {
      if (typeof raw !== "string") continue;
      const text = raw.trim();
      if (!text) continue;
      if (!isSafeTemplate(text, v3Data)) continue;
      const rendered = renderTemplate(text, v3Data).trim();
      if (!rendered) continue;
      templates.push({ id: `v3_${id++}`, tag, text: rendered });
    }
  }
  return templates;
}

/* -------------------------- V3 Data Builder (Minimal) ------------------------ */

async function safeAnalyticsTable(token, params = {}) {
  try {
    const p = { ids: "channel==MINE", ...params };
    const data = await ytAnalyticsGET(token, p);
    return {
      columnHeaders: Array.isArray(data?.columnHeaders) ? data.columnHeaders : [],
      rows: Array.isArray(data?.rows) ? data.rows : [],
    };
  } catch {
    return { columnHeaders: [], rows: [] };
  }
}

function buildHeaderIndex(columnHeaders = []) {
  const idx = {};
  for (let i = 0; i < columnHeaders.length; i++) {
    const name = columnHeaders[i]?.name;
    if (name) idx[name] = i;
  }
  return idx;
}

function rowObj(headersIdx, row) {
  const o = {};
  for (const [k, i] of Object.entries(headersIdx)) o[k] = row?.[i];
  return o;
}

function rowsToDimListSimple(rows, dimIndex = 0, metricIndex = 1) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(r => ({ dim: r?.[dimIndex], value: safeNum(r?.[metricIndex], 0) }))
    .filter(x => x.dim !== undefined && x.dim !== null && String(x.dim).trim() !== "")
    .sort((a, b) => b.value - a.value);
}

function pickTop(rows, dimIndex = 0, metricIndex = 1) {
  const list = rowsToDimListSimple(rows, dimIndex, metricIndex);
  return list?.[0] || null;
}

async function buildV3DataFromKpis({
  token,
  endIso,
  start7Iso,
  start14Iso,
  start28Iso,
  channelTitle,
  uploads,
  vidsById,
  latestVideo,
  weekly,
  m28,
  realtime,
  hud,
  videoIntelList,
}) {
  const v3 = {
    focus: { title: (latestVideo?.title || channelTitle || "Your latest video") },

    realtime: {
      viewsLastHour: safeNum(realtime?.lastHour, 0),
      estimatedConcurrent: 0,
      vsBaseline48hPct: 0,
      attentionHoursPerDay: 0,
      avgViewsPerDay7d: 0,
      vsYesterdayPct: safeNum(realtime?.last24hDelta, 0),
      bestDayViews7d: 0,
      viewsLast48Hours: safeNum(realtime?.views48h, 0),
    },

    shorts: {
      title: "Your Shorts",
      viewedRatePct: 0,
      loopRetentionPct: 0,
      trafficPct: 0,
      views48h: 0,
      subsPer1kPct: 0,
      last3DropPct: 0,
      viewsSpotlight: 0,
      discoveryPct: 0,
      stopRatePct: 0,
      vsLastWeekPct: 0,
    },

    packaging: { impressions: 0, ctrPct: 0, clicksPer1kImpressions: 0 },

    retention: { avgViewPct: 0, avdMinutes: 0, avdSeconds: 0, completionPct: 0 },

    engagement: {
      focusLikes: 0,
      focusShares: 0,
      focusCardClicks: 0,
      commentsUpPct: 0,
      topEngagedTitle: latestVideo?.title || "Your top video",
    },

    discovery: {
      keyword: "",
      website: "",
      sharingService: "Other",
      playlistName: "your playlists",
      browsePct: 0,
      notificationPct: 0,
      topTrafficSource: "Unknown",
    },

    playlists: {
      bingeStarterTitle: latestVideo?.title || "Your best binge starter",
      nextVideoTitle: (uploads?.[1]?.title || latestVideo?.title || "Your next video"),
    },

    audience: {
      subscribedViewsPct: 0,
      unsubscribedViewsPct: 0,
      viewerLoggedInPct: 0,
      newViewerPct: 0,
      coreViewers: 0,
      uniqueViewers28: safeNum(hud?.uniqueViewers28, 0),
      uniqueGrowthPct: 0,
      avgViewsPerViewer28: 1.2,
      topCountry: String((hud?.countries28?.[0]?.dim || "Unknown")),
      storyLine: "",
    },

    cadence: {
      daysSinceUpload: 0,
      bestHour: "18:00 UTC",
    },

    live: {
      concurrentNow: 0,
      peakConcurrent: 0,
      minuteMark: "5:00",
      topTrafficSource: "Unknown",
    },

    money: {
      estimatedRevenueToday: 0,
      estimatedRevenue28d: 0,
      cpm: 0,
      rpm: 0,
      top10IncomePct: 0,
    },
  };

  /* ---------- cadence from uploads ---------- */
  try {
    const latestUploadAt = uploads?.[0]?.publishedAt;
    if (latestUploadAt) v3.cadence.daysSinceUpload = daysBetween(latestUploadAt, new Date().toISOString());

    const hours = (uploads || [])
      .map(u => u?.publishedAt)
      .filter(Boolean)
      .map(ts => new Date(ts).getUTCHours());

    if (hours.length) {
      const freq = new Map();
      for (const h of hours) freq.set(h, (freq.get(h) || 0) + 1);
      let bestH = hours[0], bestC = -1;
      for (const [h, c] of freq.entries()) {
        if (c > bestC) { bestC = c; bestH = h; }
      }
      v3.cadence.bestHour = `${String(bestH).padStart(2, "0")}:00 UTC`;
    }
  } catch {}

  /* ---------- realtime derived ---------- */
  try {
    const baseline48 = safeNum(realtime?.avgPrior6d, 0) * 2;
    const last48 = safeNum(realtime?.views48h, 0);
    v3.realtime.vsBaseline48hPct = baseline48 > 0 ? Math.round(((last48 - baseline48) / baseline48) * 100) : 0;

    const spark = Array.isArray(realtime?.sparkline) ? realtime.sparkline : [];
    if (spark.length) {
      v3.realtime.avgViewsPerDay7d = Math.round(spark.reduce((a, x) => a + safeNum(x, 0), 0) / spark.length);
      v3.realtime.bestDayViews7d = spark.reduce((m, x) => Math.max(m, safeNum(x, 0)), 0);
    } else {
      v3.realtime.avgViewsPerDay7d = Math.round(safeNum(weekly?.views, 0) / 7);
      v3.realtime.bestDayViews7d = 0;
    }

    v3.realtime.attentionHoursPerDay = Math.round(safeNum(weekly?.watchHours, 0) / 7);
  } catch {}

  /* ---------- focus video + packaging/retention/engagement ---------- */
  try {
    const focusId = latestVideo?.videoId || uploads?.[0]?.videoId || "";
    const focusIntel = (videoIntelList || []).find(v => v?.videoId === focusId) || (videoIntelList || [])[0] || null;

    if (focusIntel?.title) v3.focus.title = focusIntel.title;

    if (focusIntel?.a7d) {
      v3.packaging.impressions = Math.round(safeNum(focusIntel.a7d.impressions, 0));
      v3.packaging.ctrPct = Math.round(safeNum(focusIntel.a7d.ctr, 0) * 100) / 100;
      v3.packaging.clicksPer1kImpressions = Math.round((v3.packaging.ctrPct / 100) * 1000);

      const avdSec = Math.round(safeNum(focusIntel.a7d.avgViewDurationSec, 0));
      v3.retention.avdSeconds = avdSec;
      v3.retention.avdMinutes = Math.round((avdSec / 60) * 10) / 10;
      v3.retention.avgViewPct = Math.round(safeNum(focusIntel.a7d.avgViewPercentage, 0) * 10) / 10;
      v3.retention.completionPct = Math.round(v3.retention.avgViewPct);

      v3.engagement.focusLikes = Math.round(safeNum(focusIntel.a7d.likes, 0));
      v3.engagement.focusShares = Math.round(safeNum(focusIntel.a7d.shares, 0));
    }

    // engagement leader
    let topEng = null, bestScore = -1;
    for (const r of (videoIntelList || [])) {
      const a7 = r?.a7d || {};
      const score = safeNum(a7.likes, 0) + safeNum(a7.comments, 0) * 2 + safeNum(a7.shares, 0) * 3;
      if (score > bestScore) { bestScore = score; topEng = r; }
    }
    if (topEng?.title) v3.engagement.topEngagedTitle = topEng.title;
  } catch {}

  /* ---------- traffic + notifications + shorts discovery ---------- */
  try {
    const trafficList = Array.isArray(hud?.traffic28) ? hud.traffic28 : [];
    const total = trafficList.reduce((a, x) => a + safeNum(x.value, 0), 0);

    const top = trafficList[0]?.dim ? trafficList[0] : null;
    v3.discovery.topTrafficSource = titleizeEnum(top?.dim || "UNKNOWN") || "Unknown";

    const notif = trafficList.find(x => x.dim === "NOTIFICATION")?.value || 0;
    v3.discovery.notificationPct = Math.round(percent(notif, total) * 10) / 10;

    const browse = trafficList.find(x => x.dim === "BROWSE")?.value || trafficList.find(x => x.dim === "BROWSE_FEATURES")?.value || 0;
    v3.discovery.browsePct = Math.round(percent(browse, total) * 10) / 10;

    const shortsSurf = trafficList.find(x => x.dim === "SHORTS")?.value || 0;
    v3.shorts.discoveryPct = Math.round(percent(shortsSurf, total) * 10) / 10;

    // lightweight defaults for string fields (so templates always render)
    v3.discovery.keyword = (v3.focus.title.split(/\s+/).slice(0, 3).join(" ") || "your topic");
    v3.discovery.website = "external websites";
  } catch {}

  /* ---------- subscribed vs unsubscribed (28d) ---------- */
  try {
    const subList = Array.isArray(hud?.subscribed28) ? hud.subscribed28 : [];
    const total = subList.reduce((a, x) => a + safeNum(x.value, 0), 0);
    const subViews = subList.find(x => x.dim === "SUBSCRIBED")?.value || 0;
    const unsubViews = subList.find(x => x.dim === "UNSUBSCRIBED")?.value || 0;
    v3.audience.subscribedViewsPct = Math.round(percent(subViews, total) * 10) / 10;
    v3.audience.unsubscribedViewsPct = Math.round(percent(unsubViews, total) * 10) / 10;
    v3.audience.newViewerPct = Math.round(v3.audience.unsubscribedViewsPct);

    v3.audience.storyLine =
      v3.audience.unsubscribedViewsPct >= 70 ? "Discovery-heavy day" :
      v3.audience.subscribedViewsPct >= 40 ? "Loyalty is strong" :
      "Balanced reach + loyalty";
  } catch {}

  /* ---------- unique viewers + growth (approx) ---------- */
  try {
    const views28 = safeNum(m28?.last28?.views, 0);
    const unique28 = safeNum(v3.audience.uniqueViewers28, 0);
    if (unique28 > 0) {
      v3.audience.avgViewsPerViewer28 = Math.round((views28 / unique28) * 10) / 10;
    }
    // approximate "core viewers"
    const subList = Array.isArray(hud?.subscribed28) ? hud.subscribed28 : [];
    const subViews = subList.find(x => x.dim === "SUBSCRIBED")?.value || 0;
    v3.audience.coreViewers = Math.round((subViews / 28) / Math.max(0.8, v3.audience.avgViewsPerViewer28));

    const prevViews28 = safeNum(m28?.prev28?.views, 0);
    const prevUniqueApprox = Math.round(prevViews28 / Math.max(1, v3.audience.avgViewsPerViewer28));
    const curUniqueApprox = Math.round(views28 / Math.max(1, v3.audience.avgViewsPerViewer28));
    v3.audience.uniqueGrowthPct = prevUniqueApprox > 0 ? Math.round(((curUniqueApprox - prevUniqueApprox) / prevUniqueApprox) * 100) : 0;
  } catch {}

  /* ---------- Shorts metrics (minimal extra analytics calls) ---------- */
  try {
    // Content type split (28d)
    const type28 = await safeAnalyticsTable(token, {
      startDate: start28Iso,
      endDate: endIso,
      dimensions: "creatorContentType",
      metrics: "views",
      sort: "-views",
      maxResults: "10",
    });
    const typeList = rowsToDimListSimple(type28.rows, 0, 1);
    const totalTypeViews = typeList.reduce((a, x) => a + x.value, 0);
    const shortsTypeViews = typeList.find(x => x.dim === "SHORTS")?.value || 0;
    v3.shorts.trafficPct = Math.round(percent(shortsTypeViews, totalTypeViews) * 10) / 10;

    // Shorts 7d + prev 7d
    const shorts7 = await safeAnalyticsTable(token, {
      startDate: start7Iso,
      endDate: endIso,
      filters: "creatorContentType==SHORTS",
      metrics: "views,subscribersGained",
    });
    const s7Idx = buildHeaderIndex(shorts7.columnHeaders);
    const s7Row = shorts7.rows?.[0] ? rowObj(s7Idx, shorts7.rows[0]) : {};
    const shorts7Views = safeNum(s7Row.views, 0);
    const shorts7Subs = safeNum(s7Row.subscribersGained, 0);

    const prev7End = isoDate(shiftDays(new Date(start7Iso), -1));
    const prev7Start = isoDate(shiftDays(new Date(prev7End), -6));
    const shortsPrev7 = await safeAnalyticsTable(token, {
      startDate: prev7Start,
      endDate: prev7End,
      filters: "creatorContentType==SHORTS",
      metrics: "views",
    });
    const spIdx = buildHeaderIndex(shortsPrev7.columnHeaders);
    const spRow = shortsPrev7.rows?.[0] ? rowObj(spIdx, shortsPrev7.rows[0]) : {};
    const shortsPrevViews = safeNum(spRow.views, 0);

    v3.shorts.vsLastWeekPct = shortsPrevViews > 0 ? Math.round(((shorts7Views - shortsPrevViews) / shortsPrevViews) * 100) : 0;
    v3.shorts.subsPer1kPct = shorts7Views > 0 ? Math.round((shorts7Subs / shorts7Views) * 1000 * 10) / 10 : 0;

    // top Shorts video (28d)
    const shortsTop = await safeAnalyticsTable(token, {
      startDate: start28Iso,
      endDate: endIso,
      dimensions: "video",
      filters: "creatorContentType==SHORTS",
      metrics: "views,averageViewDuration,averageViewPercentage",
      sort: "-views",
      maxResults: "1",
    });
    const stIdx = buildHeaderIndex(shortsTop.columnHeaders);
    const stRow = shortsTop.rows?.[0] ? rowObj(stIdx, shortsTop.rows[0]) : {};
    const topShortId = String(stRow.video || "").trim();

    if (topShortId) {
      const d = vidsById?.[topShortId] || null;
      if (d?.title) v3.shorts.title = d.title;

      const topShortViews = safeNum(stRow.views, 0);
      const avp = safeNum(stRow.averageViewPercentage, 0);
      const avd = safeNum(stRow.averageViewDuration, 0);
      const dur = safeNum(d?.durationSec, 0) || 60;

      v3.shorts.viewsSpotlight = Math.round(topShortViews);
      v3.shorts.stopRatePct = Math.round(avp * 10) / 10;
      v3.shorts.viewedRatePct = v3.shorts.stopRatePct;
      v3.shorts.loopRetentionPct = Math.round((avd / Math.max(1, dur)) * 100 * 10) / 10;
    } else {
      // fallback: use latest short upload title if present
      const latestShort = (uploads || []).map(u => vidsById?.[u.videoId]).find(v => v && v.durationSec > 0 && v.durationSec <= 60);
      if (latestShort?.title) v3.shorts.title = latestShort.title;
    }

    // approx shorts views48h using share of 28d views applied to 48h total
    v3.shorts.views48h = Math.round((v3.shorts.trafficPct / 100) * safeNum(realtime?.views48h, 0));

    // last3DropPct from last 6 Shorts uploads (lifetime views proxy)
    const shortUploads = (uploads || [])
      .map(u => vidsById?.[u.videoId])
      .filter(v => v && v.durationSec > 0 && v.durationSec <= 60)
      .slice(0, 6);

    const last3 = shortUploads.slice(0, 3).map(v => safeNum(v.views, 0));
    const prev3 = shortUploads.slice(3, 6).map(v => safeNum(v.views, 0));
    const avgLast3 = last3.reduce((a, x) => a + x, 0) / Math.max(1, last3.length);
    const avgPrev3 = prev3.reduce((a, x) => a + x, 0) / Math.max(1, prev3.length);
    v3.shorts.last3DropPct = avgPrev3 > 0 ? Math.round(((avgLast3 - avgPrev3) / avgPrev3) * 100) : 0;
  } catch {}

  // Ensure string fields are never empty (template safety)
  if (!v3.discovery.keyword) v3.discovery.keyword = (v3.focus.title.split(/\s+/).slice(0, 3).join(" ") || "your topic");
  if (!v3.discovery.website) v3.discovery.website = "external websites";
  if (!v3.discovery.sharingService) v3.discovery.sharingService = "Other";
  if (!v3.discovery.playlistName) v3.discovery.playlistName = "your playlists";
  if (!v3.discovery.topTrafficSource) v3.discovery.topTrafficSource = "Unknown";
  if (!v3.audience.topCountry) v3.audience.topCountry = "Unknown";
  if (!v3.cadence.bestHour) v3.cadence.bestHour = "18:00 UTC";
  if (!v3.shorts.title) v3.shorts.title = "Your Shorts";

  return v3;
}

async function ytDataGET(token, path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await safeReadJson(r);
  if (!r.ok) throw new Error(`YT_DATA ${path} ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

async function ytAnalyticsGET(token, params = {}) {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", "channel==MINE");

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await safeReadJson(r);
  if (!r.ok) throw new Error(`YT_ANALYTICS ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

async function safeAnalytics(token, params) {
  try {
    return await ytAnalyticsGET(token, params);
  } catch {
    return null;
  }
}

/* =========================================================
   Channel / upload discovery
   ---------------------------------------------------------
       fetchChannelBasics():
         - channelId, title, publishedAt, logo URL
         - current subscribers + lifetime views (these power the top card headlines)
       fetchRecentUploads() + fetchVideos():
         - gets recent video IDs and pulls titles + publish dates + durations.
   ========================================================= */
async function fetchChannelBasics(token) {
  const data = await ytDataGET(token, "channels", {
    part: "snippet,statistics,contentDetails",
    mine: "true",
  });
  const ch = data.items?.[0];
  const thumbs = ch?.snippet?.thumbnails || {};
  const logo = thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || "";
  return {
    channelId: ch?.id || null,
    title: ch?.snippet?.title || "",
    publishedAt: ch?.snippet?.publishedAt || null,
    logo,
    uploadsPlaylistId: ch?.contentDetails?.relatedPlaylists?.uploads || "",
    subscribers: Number(ch?.statistics?.subscriberCount || 0),
    totalViews: Number(ch?.statistics?.viewCount || 0),
  };
}

async function fetchRecentUploads(token, uploadsPlaylistId, maxResults = 25) {
  if (!uploadsPlaylistId) return [];
  const data = await ytDataGET(token, "playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(clamp(maxResults, 1, 50)),
  });
  return (data.items || [])
    .map((it) => ({
      videoId: it?.contentDetails?.videoId || null,
      publishedAt: it?.contentDetails?.videoPublishedAt || it?.snippet?.publishedAt || null,
      title: it?.snippet?.title || "",
    }))
    .filter((x) => x.videoId);
}

async function fetchVideos(token, ids = []) {
  const idList = uniq(ids);
  if (!idList.length) return [];
  const data = await ytDataGET(token, "videos", {
    part: "snippet,statistics,contentDetails",
    id: idList.slice(0, 50).join(","),
  });
  return (data.items || [])
    .map((v) => ({
      videoId: v?.id || null,
      title: v?.snippet?.title || "",
      publishedAt: v?.snippet?.publishedAt || null,
      views: Number(v?.statistics?.viewCount || 0),
      likes: Number(v?.statistics?.likeCount || 0),
      comments: Number(v?.statistics?.commentCount || 0),
      duration: v?.contentDetails?.duration || null,
      durationSec: parseISODurationToSeconds(v?.contentDetails?.duration || null),
    }))
    .filter((x) => x.videoId);
}

/* =========================================================
   Window reducers
   ---------------------------------------------------------
       sumDailyRows(): sum a slice of the daily array
       packMetrics(): convert sum into {views, minutes, watchHours, gained, lost, netSubs}
       These are used for 7D and 28D windows to keep front-end field naming stable.
   ========================================================= */
function sumDailyRows(rows, startIdx, endIdx) {
  const out = { views: 0, minutes: 0, gained: 0, lost: 0 };
  if (!Array.isArray(rows)) return out;
  const a = clamp(startIdx, 0, rows.length - 1);
  const b = clamp(endIdx, 0, rows.length - 1);
  for (let i = a; i <= b; i++) {
    const r = rows[i];
    out.views += Number(r.views || 0);
    out.minutes += Number(r.minutes || 0);
    out.gained += Number(r.gained || 0);
    out.lost += Number(r.lost || 0);
  }
  return out;
}

function packMetrics(sum) {
  const minutes = Number(sum.minutes || 0);
  const gained = Number(sum.gained || 0);
  const lost = Number(sum.lost || 0);
  return {
    views: Number(sum.views || 0),
    minutes,
    watchHours: round1(minutes / 60),
    gained,
    lost,
    netSubs: gained - lost,
  };
}

/* =========================================================
   Daily time-series (the backbone of all window comparisons)
   ---------------------------------------------------------
       fetchDailyCore(startIso, endIso):
         - returns rows per day: views, minutes watched, subs gained/lost
         - used to compute last 7D / prev 7D, last 28D / prev 28D, and rolling 6M baseline
   ========================================================= */
async function fetchDailyCore(token, startIso, endIso) {
  const data = await ytAnalyticsGET(token, {
    startDate: startIso,
    endDate: endIso,
    dimensions: "day",
    metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
    sort: "day",
    maxResults: "500",
  });
  return (data.rows || []).map((r) => ({
    day: r[0],
    views: Number(r[1] || 0),
    minutes: Number(r[2] || 0),
    gained: Number(r[3] || 0),
    lost: Number(r[4] || 0),
  }));
}

async function fetchLifetimeWatchHours(token, publishedAt, endIso) {
  const startIso = safeStartDateFromPublishedAt(publishedAt);
  const data = await ytAnalyticsGET(token, {
    startDate: startIso,
    endDate: endIso,
    metrics: "estimatedMinutesWatched",
  });
  const minutes = Number(data.rows?.[0]?.[0] || 0);
  return { startIso, totalHours: round1(minutes / 60) };
}

function rowsToDimList(resp, dimName, metricName) {
  return (resp?.rows || []).map((r) => ({
    key: String(r[0]),
    value: Number(r[1] || 0),
    dim: dimName,
    metric: metricName,
  }));
}

function parseVideoRows(resp, metricKeys = []) {
  const rows = resp?.rows || [];
  const out = {};
  for (const r of rows) {
    const videoId = String(r[0] || "");
    if (!videoId) continue;
    const obj = {};
    for (let i = 0; i < metricKeys.length; i++) {
      obj[metricKeys[i]] = Number(r[i + 1] || 0);
    }
    out[videoId] = obj;
  }
  return out;
}

async function fetchVideoAnalytics7dBundle(token, startIso, endIso, maxResults = 25) {
  const common = { startDate: startIso, endDate: endIso, dimensions: "video", sort: "-views", maxResults: String(clamp(maxResults, 1, 50)) };
  
  const base = await safeAnalytics(token, { ...common, metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost" });
  const retention = await safeAnalytics(token, { ...common, metrics: "averageViewDuration,averageViewPercentage" });
  const thumbs = await safeAnalytics(token, { ...common, metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate" });
  const engage = await safeAnalytics(token, { ...common, metrics: "likes,comments,shares" });

  return {
    baseMap: parseVideoRows(base, ["views7d", "minutes7d", "subsGained7d", "subsLost7d"]),
    retentionMap: parseVideoRows(retention, ["avgViewDurationSec7d", "avgViewPercentage7d"]),
    thumbsMap: parseVideoRows(thumbs, ["impressions7d", "ctr7d"]),
    engageMap: parseVideoRows(engage, ["likes7d", "comments7d", "shares7d"]),
    rawOk: { base: !!base, retention: !!retention, thumbs: !!thumbs, engage: !!engage },
  };
}

function buildVideoIntelList(videoDetails, maps, endIso) {
  const vids = (videoDetails || []).slice(0, 50);
  return vids.map((v) => {
    const id = v.videoId;
    const base = maps.baseMap[id] || {};
    const ret = maps.retentionMap[id] || {};
    const th = maps.thumbsMap[id] || {};
    const en = maps.engageMap[id] || {};

    const views7d = Number(base.views7d || 0);
    const minutes7d = Number(base.minutes7d || 0);
    const subsG7d = Number(base.subsGained7d || 0);
    const subsL7d = Number(base.subsLost7d || 0);

    const publishedIso = v.publishedAt ? isoDate(new Date(v.publishedAt)) : null;
    const ageDays = publishedIso ? daysBetween(publishedIso, endIso) : null;
    const daysOnline = ageDays === null ? 7 : clamp(ageDays + 1, 1, 7);
    const viewsPerDay = round1(views7d / Math.max(1, daysOnline));

    return {
      videoId: id,
      title: v.title || "",
      publishedAt: v.publishedAt || null,
      ageDays: ageDays,
      durationSec: v.durationSec || null,
      a7d: {
        views: views7d,
        subsGained: subsG7d,
        subsLost: subsL7d,
        impressions: Number(th.impressions7d || 0),
        ctr: pct(th.ctr7d),
        avgViewDurationSec: Number(ret.avgViewDurationSec7d || 0),
        avgViewPercentage: pct(ret.avgViewPercentage7d),
        likes: Number(en.likes7d || 0),
        comments: Number(en.comments7d || 0),
        shares: Number(en.shares7d || 0),
      },
      derived: {
        viewsPerDay,
        minsPerView: views7d > 0 ? round1(minutes7d / views7d) : 0,
        subsPer1kViews: views7d > 0 ? round1((subsG7d / views7d) * 1000) : 0,
        churnPct: (subsG7d + subsL7d) > 0 ? round1((subsL7d / (subsG7d + subsL7d)) * 100) : 0,
      },
    };
  });
}

/* =========================================================
   computeKPIs(env) — main orchestrator
   ---------------------------------------------------------
       Steps (high level):
         1) Get access token
         2) Fetch channel totals + daily analytics series
         3) Build:
             - last 7D vs prev 7D
             - last 28D vs prev 28D
             - a rolling set of 28D windows to estimate '6M baseline' (median or avg)
         4) Fetch extra optional metrics (retention, CTR, top videos) for HUD messages
         5) Return the final JSON shape consumed by app.js
   ========================================================= */
async function computeKPIs(env) {
  const token = await getAccessToken(env);
  const ch = await fetchChannelBasics(token);
  const end = shiftDays(new Date(), -1);
  const endIso = isoDate(end);
  const dailyStart = isoDate(shiftDays(end, -195));
  const daily = await fetchDailyCore(token, dailyStart, endIso);
  const N = daily.length;

  const weekSum = N >= 7 ? sumDailyRows(daily, N - 7, N - 1) : {};
  const prevWeekSum = N >= 14 ? sumDailyRows(daily, N - 14, N - 8) : {};
  const weeklyStart = N >= 7 ? daily[N - 7].day : isoDate(shiftDays(end, -6));
  const weeklyPacked = packMetrics(weekSum);
  const prevWeeklyPacked = packMetrics(prevWeekSum);

  const winResults = [];
  for (let i = 0; i < 7; i++) {
    const endIdx = (N - 1) - 28 * i;
    const startIdx = endIdx - 27;
    if (startIdx >= 0 && endIdx >= 0 && startIdx < N && endIdx < N) {
      winResults.push({ idx: i, startDate: daily[startIdx].day, endDate: daily[endIdx].day, metrics: packMetrics(sumDailyRows(daily, startIdx, endIdx)) });
    }
  }

  const last28 = winResults.find((x) => x.idx === 0) || { metrics: packMetrics({}) };
  const prev28 = winResults.find((x) => x.idx === 1) || { metrics: packMetrics({}) };
  const prev6 = winResults.filter((x) => x.idx >= 1 && x.idx <= 6);

  const medianSubs = median(prev6.map((w) => w.metrics.netSubs));
  const medianViews = median(prev6.map((w) => w.metrics.views));
  const medianWatch = median(prev6.map((w) => w.metrics.watchHours));
  
  const avgSubs = avg(prev6.map((w) => w.metrics.netSubs));
  const avgViews = avg(prev6.map((w) => w.metrics.views));
  const avgWatch = avg(prev6.map((w) => w.metrics.watchHours));

  // --- REVISED: SOLID REALTIME & 7D LOGIC ---
  const lastDay = daily[N - 1] || {};
  const prevDay = daily[N - 2] || {};
  
  // 1. Solid Data Points
  const viewsLast24 = Number(lastDay.views || 0); // Day N-1
  const viewsPrev24 = Number(prevDay.views || 0); // Day N-2
  const views48h = viewsLast24 + viewsPrev24;

  // 2. Hourly estimates (Mathematical Average of solid data)
  const estLastHour = Math.round(viewsLast24 / 24);
  const estPrevHour = Math.round(viewsPrev24 / 24);

  // 3. Sparkline & 7D Avg Calculation
  // We need exactly the last 7 days of data for the sparkline and formula.
  const sevenDaySlice = daily.slice(-7); // The last 7 days
  const sparklineData = sevenDaySlice.map(r => r.views);
  
  // Formula: LAST 24H vs [(LAST 7D - LAST 24H) / 6]
  const viewsLast7dTotal = sparklineData.reduce((a, b) => a + Number(b||0), 0);
  const viewsPrior6dTotal = viewsLast7dTotal - viewsLast24;
  const avgPrior6d = viewsPrior6dTotal > 0 ? (viewsPrior6dTotal / 6) : 0;
  
  // The delta for the card ("VS 7D AVG")
  const vs7dAvgDelta = viewsLast24 - avgPrior6d;

  const realtime = {
    views48h,
    last24h: viewsLast24,
    prev24h: viewsPrev24,
    lastHour: estLastHour,
    prevHour: estPrevHour,
    vs7dAvgDelta: round1(vs7dAvgDelta),
    avgPrior6d: round1(avgPrior6d), // Sent for debug/context if needed
    sparkline: sparklineData
  };
  // --- END REVISED LOGIC ---

  const history28d = [...winResults].sort((a, b) => b.idx - a.idx).map((w) => ({
    startDate: w.startDate, endDate: w.endDate, netSubs: w.metrics.netSubs, views: w.metrics.views, watchHours: w.metrics.watchHours,
  }));

  const life = await fetchLifetimeWatchHours(token, ch.publishedAt, endIso);
  const uploads = await fetchRecentUploads(token, ch.uploadsPlaylistId, 25);
  const latestUpload = uploads[0] || null;

  const top7Resp = await safeAnalytics(token, { startDate: weeklyStart, endDate: endIso, dimensions: "video", metrics: "views", sort: "-views", maxResults: "1" });
  const top7VideoId = top7Resp?.rows?.[0]?.[0] || null;
  
  const videoIds = uniq([...(uploads.map((u) => u.videoId)), top7VideoId]);
  const videoDetails = await fetchVideos(token, videoIds);
  const vidsById = Object.fromEntries(videoDetails.map((v) => [v.videoId, v]));
  const latestVideo = latestUpload?.videoId ? vidsById[latestUpload.videoId] || null : null;
  const top7Video = top7VideoId ? vidsById[top7VideoId] || null : null;

  const last28Start = last28.startDate || isoDate(shiftDays(end, -27));
  const thumb28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate" });
  const ret28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, metrics: "averageViewDuration,averageViewPercentage" });
  const uniq28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, metrics: "uniqueViewers" });
  const traffic28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views", maxResults: "10" });
  const trafficPrev28 = await safeAnalytics(token, { startDate: prev28.startDate || isoDate(shiftDays(end, -55)), endDate: prev28.endDate || isoDate(shiftDays(end, -28)), dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views", maxResults: "10" });
  const subStatus28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "subscribedStatus", metrics: "views", sort: "-views", maxResults: "5" });
  const country28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "country", metrics: "views", sort: "-views", maxResults: "5" });

  const v7dBundle = await fetchVideoAnalytics7dBundle(token, weeklyStart, endIso, 25);
  const videoIntelList = buildVideoIntelList(videoDetails, v7dBundle, endIso);

  const hud = {
    statsThrough: endIso,
    uploads: { latest: latestUpload, recent: uploads },
    latestVideo,
    topVideo7d: top7VideoId ? { videoId: top7VideoId, title: top7Video?.title || "", views: Number(top7Resp?.rows?.[0]?.[1] || 0) } : null,
    thumb28: thumb28?.rows?.[0] ? { impressions: Number(thumb28.rows[0][0] || 0), ctr: Number(thumb28.rows[0][1] || 0) } : null,
    retention28: ret28?.rows?.[0] ? { avgViewDurationSec: Number(ret28.rows[0][0] || 0), avgViewPercentage: Number(ret28.rows[0][1] || 0) } : null,
    uniqueViewers28: Number(uniq28?.rows?.[0]?.[0] || 0) || null,
    traffic: { last28: rowsToDimList(traffic28, "insightTrafficSourceType", "views"), prev28: rowsToDimList(trafficPrev28, "insightTrafficSourceType", "views") },
    subscribedStatus: rowsToDimList(subStatus28, "subscribedStatus", "views"),
    countries: rowsToDimList(country28, "country", "views"),
    videoIntel: { range7d: { startDate: weeklyStart, endDate: endIso }, videos: videoIntelList },
  };

  

  // ---------------- V3 HUD templates (server-rendered, safe) ----------------
  let v3 = null;
  let templates = [];
  let templatesSample = [];
  try {
    const start7Iso = weeklyStart || isoDate(shiftDays(end, -6));
    const start14Iso = isoDate(shiftDays(end, -13));
    const start28Iso = (last28 && last28.startDate) ? last28.startDate : isoDate(shiftDays(end, -27));

    v3 = await buildV3DataFromKpis({
      token,
      endIso,
      start7Iso,
      start14Iso,
      start28Iso,
      channelTitle: ch?.title || "",
      uploads,
      vidsById,
      latestVideo,
      weekly: weeklyPacked,
      m28: { last28: last28.metrics, prev28: prev28.metrics },
      realtime,
      hud,
      videoIntelList,
    });

    templates = buildHUDMessageTemplatesV3(v3);
    templatesSample = pickRandomN(templates, 3);
  } catch {
    v3 = null;
    templates = [];
    templatesSample = [];
  }
return {
    channel: ch,
    weekly: {
      startDate: weeklyStart, endDate: endIso,
      netSubs: weeklyPacked.netSubs, views: weeklyPacked.views, watchHours: weeklyPacked.watchHours,
      subscribersGained: weeklyPacked.gained, subscribersLost: weeklyPacked.lost, minutesWatched: weeklyPacked.minutes,
      prevNetSubs: prevWeeklyPacked.netSubs, prevViews: prevWeeklyPacked.views, prevWatchHours: prevWeeklyPacked.watchHours,
      prevSubscribersGained: prevWeeklyPacked.gained, prevSubscribersLost: prevWeeklyPacked.lost,
    },
    m28: {
      last28: { netSubs: last28.metrics.netSubs, views: last28.metrics.views, watchHours: last28.metrics.watchHours },
      prev28: { netSubs: prev28.metrics.netSubs, views: prev28.metrics.views, watchHours: prev28.metrics.watchHours },
      avg6m: { netSubs: avgSubs, views: avgViews, watchHours: avgWatch },
      median6m: { netSubs: medianSubs, views: medianViews, watchHours: medianWatch },
    },
    realtime,
    lifetime: { watchHours: life.totalHours },
    history28d,
    hud,
    v3,
    templatesCount: templates.length,
    templates,
    templatesSample,
  };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

export async function onRequest(context) {
  const req = context.request;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }, null, 2), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
    });
  }

  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL(req.url).toString(), { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const data = await computeKPIs(context.env || {});

    const res = new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        ...CORS_HEADERS,
      },
    });

    context.waitUntil?.(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
    });
  }
}
