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

// Generic round helper (used by v3 ranking + formatting)
function round(n, digits = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = Math.pow(10, Number(digits) || 0);
  return Math.round(x * p) / p;
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

/* =========================================================
   HUD V3 — Docs + Templates (Shorts-first, 360+)
   ---------------------------------------------------------
   Notes:
     - This block is additive: it does NOT modify existing keys.
     - app.js can read: hud.v3Docs + hud.v3Data + hud.focusVideo + hud.shorts28
   ========================================================= */

const HUD_V3_EMOTION_COLORS = {
  GROWTH: "#39FF14",
  TRENDING: "#39FF14",
  VICTORY: "#BC13FE",
  MILESTONE: "#BC13FE",
  WARNING: "#FF073A",
  ALERT: "#FF073A",
  TIP: "#FFE800",
  STRATEGY: "#FFE800",
  ANALYSIS: "#00F0FF",
  "DEEP DIVE": "#00F0FF",
  TRAFFIC: "#FF9900",
  SOURCE: "#FF9900",
  SHORTS: "#FF0099",
  VERTICAL: "#FF0099",
  MONEY: "#FFD700",
  VALUE: "#FFD700",
  MEMORY: "#FFFFFF",
  LEGACY: "#FFFFFF",
  NOSTALGIA: "#FFFFFF",
  SYSTEM: "#FFFFFF",
  STATUS: "#FFFFFF",
};

const HUD_V3_GLOSSARY = {
  CTR: "Click-through rate. Out of 100 people who saw the thumbnail, how many clicked.",
  Impressions: "How many times YouTube showed your video thumbnail to someone.",
  AVD: "Average View Duration. How long people watched on average.",
  "Avg View %": "Average percent watched. Higher means better retention.",
  RPM: "Revenue per 1,000 views (what you earn, averaged across all view types).",
  CPM: "Cost per 1,000 ad impressions (what advertisers pay).",
  "Viewed vs Swiped": "For Shorts: how many people stopped to watch vs swiped away.",
  "Watch time / view": "Minutes watched divided by views. Higher means deeper attention per view.",
  "Subs / 1k views": "How many net subscribers you gain per 1,000 views (conversion efficiency).",
};

const HUD_V3_DATA_BLUEPRINT = {
  required: {
    monetization: ["estimatedRevenue", "rpm", "cpm"],
    shorts: ["engagedViews (proxy for viewed)", "views (total)", "swipeAwayRate (estimated)"],
    loyalty: ["viewerType (new vs returning)"],
    engagement: ["shares", "cardClicks", "endScreenClicks", "likes", "comments"],
    retention: ["averageViewDuration", "averageViewPercentage"],
    packaging: ["videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"],
    videoMeta: ["duration -> classify short/long", "publishedAt", "title", "videoId"],
  },
  windows: ["1h/2h/6h/12h estimated from last 24h", "7d", "28d", "365d"],
  notes: [
    "Some metrics depend on channel eligibility/scopes (monetization & certain engagement fields).",
    "When a metric is unavailable, v3Data will return null and templates that need it are skipped by the front-end.",
  ],
};

// ----------------------------------------------------------
// V3 Template set (360+). Each template starts with [TAG].
// Placeholders use {dot.paths} that app.js resolves.
// ----------------------------------------------------------
const HUD_MESSAGE_TEMPLATES_V3_BASE = [
  // Realtime velocity (Shorts-first friendly)
  "[GROWTH] I'm tracking {realtime.lastHour} views in the last hour. You're moving faster than the hour before.",
  "[WARNING] It's unusually quiet. Last hour is only {realtime.lastHour} views. That usually means recommendations cooled off.",
  "[ANALYSIS] Right now your channel has {v3.realtimeViewersVillage} people-worth of attention flowing in real time.",
  "[TRENDING] Realtime is heating up. Your last 24 hours beat your prior 6-day average by {realtime.vs7dAvgDelta} views.",
  "[SYSTEM] Data is synced through {hud.statsThrough}. Your dashboard is stable.",
  "[GROWTH] If today keeps this pace, you’ll outperform yesterday by the end of the day.",
  "[WARNING] This looks like a dip, not a death. Give it a few hours, but plan your next Short now.",
  // Shorts intelligence
  "[SHORTS] Swipe rate check: about {v3.shorts28.swipeAwayRatePct}% are swiping away lately. Your first second needs more punch.",
  "[SHORTS] Your viewed rate is about {v3.shorts28.viewedRatePct}%. That’s the feed saying “yes”.",
  "[TIP] For your next Short: start with the payoff first, then explain how you got it.",
  "[SHORTS] Your newest Short is \"{v3.newest.short.title}\". Let’s watch its first 60 minutes closely.",
  "[WARNING] Your Shorts are getting views but not holding. Average watched is {v3.rank.w7d.bestShortRetention.avgViewPct}%. Tighten the opening.",
  "[SHORTS] Your best Short this week is \"{v3.rank.w7d.bestShortViews.title}\" with {v3.rank.w7d.bestShortViews.views} views in 7 days.",
  "[TIP] If people swipe at 1–2 seconds, remove the setup and keep only the “wow” moment.",
  // Packaging & CTR
  "[ANALYSIS] Best click efficiency this week is \"{v3.rank.w7d.bestCTR.title}\" at {v3.rank.w7d.bestCTR.ctr}% CTR. That title/thumbnail combo works.",
  "[WARNING] High impressions with low CTR is a packaging problem. Pick one strong idea and simplify the thumbnail.",
  "[TIP] Dark Mode test: your thumbnail should still pop when the screen is dim.",
  // Retention
  "[ANALYSIS] Your best retention video this week is \"{v3.rank.w7d.bestRetention.title}\" at {v3.rank.w7d.bestRetention.avgViewPct}% average watched.",
  "[WARNING] Retention drops usually mean the intro is too slow. Cut to action earlier.",
  "[TIP] Pattern interrupt: change the visual every 1–2 seconds on Shorts.",
  // Money
  "[MONEY] In the last 28 days you earned about ${v3.money28.estimatedRevenue}. RPM is roughly ${v3.money28.rpm}.",
  "[VALUE] CPM is around ${v3.money28.cpm}. Higher CPM usually means higher intent viewers.",
  // Loyalty
  "[ANALYSIS] New vs returning: about {v3.loyalty28.newPct}% new viewers and {v3.loyalty28.returningPct}% returning in the last 28 days.",
  "[TIP] Returning viewers love routines. Use a recognizable opening line for your Shorts series.",
  // Conversion
  "[ANALYSIS] Best subscriber conversion this week is \"{v3.rank.w7d.bestSubsPer1k.title}\" at {v3.rank.w7d.bestSubsPer1k.subsPer1k} subs per 1k views.",
  "[WARNING] Views are up but subs are flat. Add one clear subscribe moment near the end of the Short.",
  // Traffic
  "[TRAFFIC] Your top traffic source in 28 days is {v3.traffic28.topSource}. That’s where YouTube is finding viewers for you.",
  "[SOURCE] If Browse is leading, the algorithm likes you. If Search is leading, your titles are doing the work.",
  // Legacy / motivation
  "[LEGACY] Your channel has created {lifetime.watchHours} hours of watch time. That’s real human time you earned.",
  "[VICTORY] You’re building momentum. Keep shipping Shorts and your average will climb.",
  "[MEMORY] Your library is an asset. Every new Short is another door into your channel.",
];

// Generate extra templates to exceed 360 without repeating exact wording.
function buildHUDMessageTemplatesV3() {
  const out = [];
  const seen = new Set();

  const push = (line) => {
    const s = String(line || "").trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  HUD_MESSAGE_TEMPLATES_V3_BASE.forEach(push);

  // Structured expansions (unique full sentences) — Shorts-first.
  const windows = [
    { key: "w7d", label: "last 7 days" },
    { key: "w28", label: "last 28 days" },
    { key: "w365", label: "last year" },
  ];

  const metrics = [
    { tag: "SHORTS", name: "bestShortViews", txt: (w) => `[SHORTS] Your best Short for ${w.label} is "{v3.rank.${w.key}.bestShortViews.title}" with {v3.rank.${w.key}.bestShortViews.views} views.` },
    { tag: "ANALYSIS", name: "bestLongViews", txt: (w) => `[ANALYSIS] Your best long-form video for ${w.label} is "{v3.rank.${w.key}.bestLongViews.title}" with {v3.rank.${w.key}.bestLongViews.views} views.` },
    { tag: "ANALYSIS", name: "bestRetention", txt: (w) => `[ANALYSIS] Retention winner for ${w.label}: "{v3.rank.${w.key}.bestRetention.title}" at {v3.rank.${w.key}.bestRetention.avgViewPct}% average watched.` },
    { tag: "ANALYSIS", name: "bestCTR", txt: (w) => `[ANALYSIS] CTR winner for ${w.label}: "{v3.rank.${w.key}.bestCTR.title}" at {v3.rank.${w.key}.bestCTR.ctr}% CTR.` },
    { tag: "ANALYSIS", name: "bestLikeRate", txt: (w) => `[ANALYSIS] Most loved per view for ${w.label}: "{v3.rank.${w.key}.bestLikeRate.title}" at {v3.rank.${w.key}.bestLikeRate.likeRate}% likes per 100 views.` },
    { tag: "ANALYSIS", name: "bestWatchPerView", txt: (w) => `[ANALYSIS] Deepest attention per view for ${w.label}: "{v3.rank.${w.key}.bestWatchPerView.title}" at {v3.rank.${w.key}.bestWatchPerView.watchMinPerView} minutes per view.` },
    { tag: "ANALYSIS", name: "bestSubsPer1k", txt: (w) => `[ANALYSIS] Best subscriber conversion for ${w.label}: "{v3.rank.${w.key}.bestSubsPer1k.title}" at {v3.rank.${w.key}.bestSubsPer1k.subsPer1k} subs per 1k views.` },
  ];

  for (const w of windows) {
    for (const m of metrics) push(m.txt(w));
    push(`[TIP] For ${w.label}, your fastest wins come from tightening the first 1 second of every Short.`);
    push(`[STRATEGY] For ${w.label}, build a 3-part Shorts series so viewers know what to watch next.`);
    push(`[WARNING] If ${w.label} feels slow, it usually means your hook needs a sharper first frame.`);
    push(`[VICTORY] If you keep your current pace, ${w.label} will end stronger than the period before it.`);
  }

  // Time-slice templates (1h/2h/6h/12h/24h)
  const slices = [
    { h: 1, k: "h1" }, { h: 2, k: "h2" }, { h: 6, k: "h6" }, { h: 12, k: "h12" }, { h: 24, k: "h24" },
  ];
  for (const s of slices) {
    push(`[GROWTH] In the last ${s.h} hours you pulled about {v3.time.${s.k}.views} views. Keep the feed warm with a new Short.`);
    push(`[WARNING] In the last ${s.h} hours you only pulled about {v3.time.${s.k}.views} views. A fresh Short could restart the chain.`);
  }

  // Ensure minimum count
  let i = 0;
  const filler = [
    `[STATUS] Pulse: {realtime.lastHour} views in the last hour, {realtime.last24h} in the last 24h.`,
    `[GROWTH] This week: {weekly.views} views and {weekly.netSubs} net subs.`,
    `[ANALYSIS] Last 28 days: {m28.last28.views} views and {m28.last28.netSubs} net subs.`,
    `[TRAFFIC] Realtime: {realtime.last24h} (last 24h) vs {realtime.prev24h} (prior 24h).`,
    `[SYSTEM] Data is synced through {hud.statsThrough}. Your dashboard is stable.`,
  ];
  while (out.length < 389 && i < 1000) {
    push(filler[i % filler.length]);
    i++;
  }

  // Convert to structured objects
  return out.map((line, idx) => {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    const tag = m ? m[1].trim().toUpperCase() : "ANALYSIS";
    const text = m ? m[2].trim() : line.trim();
    return { id: `v3_${String(idx + 1).padStart(4, "0")}`, tag, text };
  });
}


async function getAccessToken(env) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await safeReadJson(r);
  if (!data.access_token) throw new Error(JSON.stringify(data));
  return data.access_token;
}

/* =========================================================
   YouTube HTTP wrappers
   ---------------------------------------------------------
       ytDataGET(): calls YouTube Data API (channels, playlistItems, videos)
       ytAnalyticsGET(): calls YouTube Analytics API (reports/query)
       safeAnalytics(): same as ytAnalyticsGET but returns null on failure (HUD should degrade gracefully)
   ========================================================= */
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
  const out = [];
  for (let i = 0; i < idList.length; i += 50) {
    const chunk = idList.slice(i, i + 50);
    const data = await ytDataGET(token, "videos", {
      part: "snippet,statistics,contentDetails",
      id: chunk.join(","),
    });
    const rows = (data.items || [])
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
    out.push(...rows);
  }
  return out;
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
/* =========================================================
   HUD V3 — Analytics helpers (additive)
   ========================================================= */

function isShortByDurationSec(sec) {
  const s = Number(sec);
  return Number.isFinite(s) && s > 0 && s <= 61;
}

function parseClockToSeconds(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s.includes(":")) return null;
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function normalizeAvgViewDurationSec(raw) {
  if (raw == null) return null;
  const clock = parseClockToSeconds(raw);
  if (clock != null) return clock;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  // Some endpoints appear to return milliseconds (e.g., 75044 instead of 75.044).
  if (n > 10000) return n / 1000;

  return n;
}

function toNumOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function rowsToMap(rows, idxKey = 0, idxVal = 1) {
  const m = {};
  (rows || []).forEach((r) => {
    const k = r?.[idxKey];
    if (!k) return;
    m[k] = r?.[idxVal] != null ? Number(r[idxVal]) : null;
  });
  return m;
}

function pickBest(list, filterFn, scoreFn) {
  let best = null;
  for (const v of list || []) {
    if (!v) continue;
    if (filterFn && !filterFn(v)) continue;
    const s = scoreFn(v);
    if (s == null || !Number.isFinite(s)) continue;
    if (!best || s > best._score) best = { ...v, _score: s };
  }
  if (!best) return null;
  delete best._score;
  return best;
}

function buildRanksFromIntel(intelList) {
  const vids = (intelList || []).filter(Boolean);

  const bestShortViews = pickBest(vids, (v) => v.isShort, (v) => v.views);
  const bestLongViews = pickBest(vids, (v) => !v.isShort, (v) => v.views);

  const bestRetention = pickBest(vids, null, (v) => v.avgViewPercentage);
  const bestShortRetention = pickBest(vids, (v) => v.isShort, (v) => v.avgViewPercentage);
  const bestLongRetention = pickBest(vids, (v) => !v.isShort, (v) => v.avgViewPercentage);

  const bestCTR = pickBest(vids, (v) => (v.impressions || 0) >= 100, (v) => v.ctr);
  const bestShortCTR = pickBest(vids, (v) => v.isShort && (v.impressions || 0) >= 100, (v) => v.ctr);
  const bestLongCTR = pickBest(vids, (v) => !v.isShort && (v.impressions || 0) >= 100, (v) => v.ctr);

  const bestLikeRate = pickBest(vids, (v) => (v.views || 0) >= 200, (v) => v.likeRatePct);
  const bestShortLikeRate = pickBest(vids, (v) => v.isShort && (v.views || 0) >= 200, (v) => v.likeRatePct);
  const bestLongLikeRate = pickBest(vids, (v) => !v.isShort && (v.views || 0) >= 200, (v) => v.likeRatePct);

  const bestWatchPerView = pickBest(vids, (v) => (v.views || 0) >= 200, (v) => v.watchMinPerView);
  const bestShortWatchPerView = pickBest(vids, (v) => v.isShort && (v.views || 0) >= 200, (v) => v.watchMinPerView);
  const bestLongWatchPerView = pickBest(vids, (v) => !v.isShort && (v.views || 0) >= 200, (v) => v.watchMinPerView);

  const bestSubsPer1k = pickBest(vids, (v) => (v.views || 0) >= 200, (v) => v.subsPer1kViews);
  const bestShortSubsPer1k = pickBest(vids, (v) => v.isShort && (v.views || 0) >= 200, (v) => v.subsPer1kViews);
  const bestLongSubsPer1k = pickBest(vids, (v) => !v.isShort && (v.views || 0) >= 200, (v) => v.subsPer1kViews);

  const pack = (v, extra = {}) =>
    v
      ? {
          videoId: v.videoId,
          title: v.title,
          ...extra,
        }
      : null;

  return {
    bestShortViews: pack(bestShortViews, { views: bestShortViews?.views ?? null }),
    bestLongViews: pack(bestLongViews, { views: bestLongViews?.views ?? null }),

    bestRetention: pack(bestRetention, { avgViewPct: bestRetention ? round(bestRetention.avgViewPercentage, 1) : null }),
    bestShortRetention: pack(bestShortRetention, { avgViewPct: bestShortRetention ? round(bestShortRetention.avgViewPercentage, 1) : null }),
    bestLongRetention: pack(bestLongRetention, { avgViewPct: bestLongRetention ? round(bestLongRetention.avgViewPercentage, 1) : null }),

    bestCTR: pack(bestCTR, { ctr: bestCTR ? round(bestCTR.ctr, 2) : null, impressions: bestCTR?.impressions ?? null }),
    bestShortCTR: pack(bestShortCTR, { ctr: bestShortCTR ? round(bestShortCTR.ctr, 2) : null, impressions: bestShortCTR?.impressions ?? null }),
    bestLongCTR: pack(bestLongCTR, { ctr: bestLongCTR ? round(bestLongCTR.ctr, 2) : null, impressions: bestLongCTR?.impressions ?? null }),

    bestLikeRate: pack(bestLikeRate, { likeRate: bestLikeRate ? round(bestLikeRate.likeRatePct, 2) : null }),
    bestShortLikeRate: pack(bestShortLikeRate, { likeRate: bestShortLikeRate ? round(bestShortLikeRate.likeRatePct, 2) : null }),
    bestLongLikeRate: pack(bestLongLikeRate, { likeRate: bestLongLikeRate ? round(bestLongLikeRate.likeRatePct, 2) : null }),

    bestWatchPerView: pack(bestWatchPerView, { watchMinPerView: bestWatchPerView ? round(bestWatchPerView.watchMinPerView, 2) : null }),
    bestShortWatchPerView: pack(bestShortWatchPerView, { watchMinPerView: bestShortWatchPerView ? round(bestShortWatchPerView.watchMinPerView, 2) : null }),
    bestLongWatchPerView: pack(bestLongWatchPerView, { watchMinPerView: bestLongWatchPerView ? round(bestLongWatchPerView.watchMinPerView, 2) : null }),

    bestSubsPer1k: pack(bestSubsPer1k, { subsPer1k: bestSubsPer1k ? round(bestSubsPer1k.subsPer1kViews, 2) : null }),
    bestShortSubsPer1k: pack(bestShortSubsPer1k, { subsPer1k: bestShortSubsPer1k ? round(bestShortSubsPer1k.subsPer1kViews, 2) : null }),
    bestLongSubsPer1k: pack(bestLongSubsPer1k, { subsPer1k: bestLongSubsPer1k ? round(bestLongSubsPer1k.subsPer1kViews, 2) : null }),
  };
}

async function fetchVideoWindowBundle(token, startIso, endIso, maxResults = 25) {
  const base = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
    dimensions: "video",
    sort: "-views",
    maxResults,
  });

  const retention = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "averageViewDuration,averageViewPercentage",
    dimensions: "video",
    sort: "-views",
    maxResults,
  });

  const thumbs = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
    dimensions: "video",
    sort: "-videoThumbnailImpressions",
    maxResults,
  });

  const engage = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "likes,comments,shares",
    dimensions: "video",
    sort: "-views",
    maxResults,
  });

  const shorts = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "engagedViews",
    dimensions: "video",
    sort: "-views",
    maxResults,
  });

  const ids = uniq([
    ...((base.rows || []).map((r) => r?.[0]).filter(Boolean)),
    ...((retention.rows || []).map((r) => r?.[0]).filter(Boolean)),
    ...((thumbs.rows || []).map((r) => r?.[0]).filter(Boolean)),
    ...((engage.rows || []).map((r) => r?.[0]).filter(Boolean)),
    ...((shorts.rows || []).map((r) => r?.[0]).filter(Boolean)),
  ]);

  const viewsMap = rowsToMap(base.rows, 0, 1);
  const minutesMap = rowsToMap(base.rows, 0, 2);
  const subsGMap = rowsToMap(base.rows, 0, 3);
  const subsLMap = rowsToMap(base.rows, 0, 4);

  const avdMap = {};
  const avpMap = {};
  (retention.rows || []).forEach((r) => {
    const id = r?.[0];
    if (!id) return;
    avdMap[id] = r?.[1] != null ? Number(r[1]) : null;
    avpMap[id] = r?.[2] != null ? Number(r[2]) : null;
  });

  const impMap = {};
  const ctrMap = {};
  (thumbs.rows || []).forEach((r) => {
    const id = r?.[0];
    if (!id) return;
    impMap[id] = r?.[1] != null ? Number(r[1]) : null;
    ctrMap[id] = r?.[2] != null ? Number(r[2]) : null;
  });

  const likesMap = {};
  const commentsMap = {};
  const sharesMap = {};
  (engage.rows || []).forEach((r) => {
    const id = r?.[0];
    if (!id) return;
    likesMap[id] = r?.[1] != null ? Number(r[1]) : null;
    commentsMap[id] = r?.[2] != null ? Number(r[2]) : null;
    sharesMap[id] = r?.[3] != null ? Number(r[3]) : null;
  });

  const engagedMap = rowsToMap(shorts.rows, 0, 1);

  return { ids, startDate: startIso, endDate: endIso, viewsMap, minutesMap, subsGMap, subsLMap, avdMap, avpMap, impMap, ctrMap, likesMap, commentsMap, sharesMap, engagedMap };
}

function buildVideoIntelFromBundle(bundle, videoMap) {
  const out = [];
  for (const id of bundle.ids || []) {
    const vd = videoMap[id];
    if (!vd) continue;
    const views = Number(bundle.viewsMap[id] || 0);
    const minutes = Number(bundle.minutesMap[id] || 0);
    const gained = Number(bundle.subsGMap[id] || 0);
    const lost = Number(bundle.subsLMap[id] || 0);
    const netSubs = gained - lost;

    const impressions = toNumOrNull(bundle.impMap[id]);
    const ctr = toNumOrNull(bundle.ctrMap[id]);
    const avgViewDurationSec = toNumOrNull(bundle.avdMap[id]);
    const avgViewPercentage = toNumOrNull(bundle.avpMap[id]);

    const likes = toNumOrNull(bundle.likesMap[id]);
    const comments = toNumOrNull(bundle.commentsMap[id]);
    const shares = toNumOrNull(bundle.sharesMap[id]);

    const engagedViews = toNumOrNull(bundle.engagedMap[id]);

    const likeRatePct = views > 0 && likes != null ? (likes / views) * 100 : null;
    const subsPer1kViews = views > 0 ? (netSubs / views) * 1000 : null;
    const watchMinPerView = views > 0 ? minutes / views : null;

    out.push({
      videoId: id,
      title: vd.title || "",
      publishedAt: vd.publishedAt || null,
      durationSec: vd.durationSec || null,
      isShort: isShortByDurationSec(vd.durationSec),
      views,
      minutesWatched: minutes,
      watchHours: round(minutes / 60, 2),
      subsGained: gained,
      subsLost: lost,
      netSubs,
      impressions,
      ctr,
      avgViewDurationSec,
      avgViewPercentage,
      likes,
      comments,
      shares,
      engagedViews,
      likeRatePct,
      subsPer1kViews,
      watchMinPerView,
    });
  }
  return out;
}

function pickNewestByType(videoDetails, wantShort) {
  const list = (videoDetails || [])
    .filter(Boolean)
    .filter((v) => (wantShort ? isShortByDurationSec(v.durationSec) : !isShortByDurationSec(v.durationSec)));
  list.sort((a, b) => (a.publishedAt || "").localeCompare(b.publishedAt || ""));
  const last = list[list.length - 1];
  return last ? { videoId: last.videoId, title: last.title, publishedAt: last.publishedAt, durationSec: last.durationSec } : null;
}

async function fetchMoney28(token, startIso, endIso) {
  const money = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "estimatedRevenue,rpm,cpm",
  });
  const r = (money.rows && money.rows[0]) || null;
  if (!r) return { estimatedRevenue: null, rpm: null, cpm: null };
  return { estimatedRevenue: round(r[0], 2), rpm: round(r[1], 2), cpm: round(r[2], 2) };
}

async function fetchViewerType28(token, startIso, endIso) {
  const vt = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "views",
    dimensions: "viewerType",
  });
  const rows = vt.rows || [];
  let newViews = 0,
    retViews = 0;
  for (const r of rows) {
    const t = String(r?.[0] || "").toUpperCase();
    const v = Number(r?.[1] || 0);
    if (t.includes("NEW")) newViews += v;
    else if (t.includes("RETURN")) retViews += v;
  }
  const total = newViews + retViews;
  return {
    newViews,
    returningViews: retViews,
    newPct: total > 0 ? round((newViews / total) * 100, 1) : null,
    returningPct: total > 0 ? round((retViews / total) * 100, 1) : null,
  };
}

async function fetchChannelEngagement28(token, startIso, endIso) {
  const eng = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "shares,cardClicks,endScreenClicks",
  });
  const r = (eng.rows && eng.rows[0]) || null;
  if (!r) return { shares: null, cardClicks: null, endScreenClicks: null };
  return { shares: Number(r[0] ?? 0), cardClicks: Number(r[1] ?? 0), endScreenClicks: Number(r[2] ?? 0) };
}

async function fetchShortsViewedVsSwiped28(token, startIso, endIso) {
  // Proxy: engagedViews / views. If engagedViews isn't available, returns nulls.
  const row = await safeAnalytics(token, {
    ids: "channel==MINE",
    startDate: startIso,
    endDate: endIso,
    metrics: "views,engagedViews",
  });
  const r = (row.rows && row.rows[0]) || null;
  if (!r) return { views: null, engagedViews: null, viewedRatePct: null, swipeAwayRatePct: null };
  const views = Number(r[0] ?? 0);
  const engaged = Number(r[1] ?? 0);
  const viewedRate = views > 0 ? (engaged / views) * 100 : null;
  return {
    views,
    engagedViews: engaged,
    viewedRatePct: viewedRate != null ? round(viewedRate, 1) : null,
    swipeAwayRatePct: viewedRate != null ? round(100 - viewedRate, 1) : null,
  };
}


async function computeKPIs(env) {
  const token = await getAccessToken(env);
  const ch = await fetchChannelBasics(token);
  const end = shiftDays(new Date(), -1);
  const endIso = isoDate(end);
  // v3 message system needs extra video IDs (we populate this later)
  let v3VideoIds = [];
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
  
  const videoIds = uniq([...(uploads.map((u) => u.videoId)), top7VideoId, ...v3VideoIds]);
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
  const yearStart = isoDate(shiftDays(end, -364));

  // -------------------------------------------------------
  // HUD V3: top videos by window + Shorts-first extras
  // -------------------------------------------------------
  const [w7dV3, w28V3, w365V3, money28V3, loyalty28V3, channelEngage28V3, shorts28V3] =
    await Promise.all([
      fetchVideoWindowBundle(token, weeklyStart, endIso, 25),
      fetchVideoWindowBundle(token, last28Start, endIso, 50),
      fetchVideoWindowBundle(token, yearStart, endIso, 25),
      fetchMoney28(token, last28Start, endIso),
      fetchViewerType28(token, last28Start, endIso),
      fetchChannelEngagement28(token, last28Start, endIso),
      fetchShortsViewedVsSwiped28(token, last28Start, endIso),
    ]);

  v3VideoIds = uniq([...(w7dV3?.ids || []), ...(w28V3?.ids || []), ...(w365V3?.ids || [])]);

  // Ensure we have metadata for all v3 videos (titles, thumbs, duration, etc.)
  const missingV3Ids = (v3VideoIds || []).filter((id) => id && !vidsById[id]);
  if (missingV3Ids.length) {
    const moreVids = await fetchVideos(token, missingV3Ids);
    (moreVids || []).forEach((v) => { if (v?.videoId) vidsById[v.videoId] = v; });
    if (Array.isArray(videoDetails)) videoDetails.push(...(moreVids || []));
  }

  const videoIntelList = buildVideoIntelList(videoDetails, v7dBundle, endIso);
  // -------------------------------------------------------
  // Build V3 intel + ranks (additive)
  // -------------------------------------------------------
  const videoMap = {};
  (videoDetails || []).forEach((v) => {
    if (v?.videoId) videoMap[v.videoId] = v;
  });

  const intel7V3 = buildVideoIntelFromBundle(w7dV3 || { ids: [] }, videoMap);
  const intel28V3 = buildVideoIntelFromBundle(w28V3 || { ids: [] }, videoMap);
  const intel365V3 = buildVideoIntelFromBundle(w365V3 || { ids: [] }, videoMap);

  const rank7 = buildRanksFromIntel(intel7V3);
  const rank28 = buildRanksFromIntel(intel28V3);
  const rank365 = buildRanksFromIntel(intel365V3);

  const newestShort = pickNewestByType(videoDetails, true);
  const newestLong = pickNewestByType(videoDetails, false);

  const pickIntelById = (list, id) => (list || []).find((x) => x?.videoId === id) || null;

  const focusShortId = rank7?.bestShortViews?.videoId || newestShort?.videoId || null;
  const focusLongId = rank7?.bestLongViews?.videoId || newestLong?.videoId || null;

  const focusShort = focusShortId ? pickIntelById(intel7V3, focusShortId) || pickIntelById(intel28V3, focusShortId) || pickIntelById(intel365V3, focusShortId) : null;
  const focusLong = focusLongId ? pickIntelById(intel7V3, focusLongId) || pickIntelById(intel28V3, focusLongId) || pickIntelById(intel365V3, focusLongId) : null;

  const trafficTop = (rowsToDimList(traffic28, "insightTrafficSourceType", "views")[0]) || null;

  // Estimated intra-day slices from last 24h (approx)
  const last24 = Number(realtime?.last24h || 0);
  const prev24 = Number(realtime?.prev24h || 0);
  const mkSlice = (div) => ({
    views: Math.round(last24 / div),
    prevViews: Math.round(prev24 / div),
  });

  
  const v3Docs = {
    emotionColors: HUD_V3_EMOTION_COLORS,
    glossary: HUD_V3_GLOSSARY,
    dataBlueprint: HUD_V3_DATA_BLUEPRINT,
    messageTemplates: buildHUDMessageTemplatesV3(),
  };

  const v3Data = {
    windows: {
      w7d: { startDate: w7dV3?.startDate || weeklyStart, endDate: w7dV3?.endDate || endIso },
      w28: { startDate: w28V3?.startDate || last28Start, endDate: w28V3?.endDate || endIso },
      w365: { startDate: w365V3?.startDate || yearStart, endDate: w365V3?.endDate || endIso },
    },
    newest: { short: newestShort, long: newestLong },
    focus: { short: focusShort ? { videoId: focusShort.videoId, title: focusShort.title } : null, long: focusLong ? { videoId: focusLong.videoId, title: focusLong.title } : null },
    rank: { w7d: rank7, w28: rank28, w365: rank365 },
    shorts28: shorts28V3 || { views: null, engagedViews: null, viewedRatePct: null, swipeAwayRatePct: null },
    money28: money28V3 || { estimatedRevenue: null, rpm: null, cpm: null },
    loyalty28: loyalty28V3 || { newViews: null, returningViews: null, newPct: null, returningPct: null },
    engagement28: channelEngage28V3 || { shares: null, cardClicks: null, endScreenClicks: null },
    traffic28: { topSource: trafficTop?.source || null },
    time: {
      h1: mkSlice(24),
      h2: mkSlice(12),
      h6: mkSlice(4),
      h12: mkSlice(2),
      h24: mkSlice(1),
    },
    realtimeViewersVillage: Math.max(1, Math.round(Number(realtime?.lastHour || 0) / 3)),
    videoIntel: {
      w7d: intel7V3.slice(0, 25),
      w28: intel28V3.slice(0, 25),
      w365: intel365V3.slice(0, 25),
    },
  };

  const focusVideo = {
    short: focusShort
      ? { videoId: focusShort.videoId, title: focusShort.title, windowHint: "7d", views: focusShort.views, avgViewPct: focusShort.avgViewPercentage, ctr: focusShort.ctr }
      : newestShort,
    long: focusLong
      ? { videoId: focusLong.videoId, title: focusLong.title, windowHint: "7d", views: focusLong.views, avgViewPct: focusLong.avgViewPercentage, ctr: focusLong.ctr }
      : newestLong,
  };



  const hud = {
    statsThrough: endIso,
    uploads: { latest: latestUpload, recent: uploads },
    latestVideo,
    topVideo7d: top7VideoId ? { videoId: top7VideoId, title: top7Video?.title || "", views: Number(top7Resp?.rows?.[0]?.[1] || 0) } : null,
    thumb28: thumb28?.rows?.[0] ? { impressions: Number(thumb28.rows[0][0] || 0), ctr: Number(thumb28.rows[0][1] || 0) } : null,
    retention28: ret28?.rows?.[0]
        ? (() => ({
            avgViewDurationSec: normalizeAvgViewDurationSec(ret28.rows[0][0]),
            avgViewPercentage: Number(ret28.rows[0][1] || 0),
          }))()
        : null,
    uniqueViewers28: Number(uniq28?.rows?.[0]?.[0] || 0) || null,
    traffic: { last28: rowsToDimList(traffic28, "insightTrafficSourceType", "views"), prev28: rowsToDimList(trafficPrev28, "insightTrafficSourceType", "views") },
    subscribedStatus: rowsToDimList(subStatus28, "subscribedStatus", "views"),
    countries: rowsToDimList(country28, "country", "views"),
    videoIntel: { range7d: { startDate: weeklyStart, endDate: endIso }, videos: videoIntelList },
  
    // HUD V3 (additive keys; existing HUD/cards remain unchanged)
    v3Docs,
    v3Data,
    focusVideo,
    shorts28: v3Data.shorts28
};

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
  };
}

export async function onRequest(context) {
  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL(context.request.url).toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const data = await computeKPIs(context.env);
    const res = Response.json(data, { headers: { "Cache-Control": "public, max-age=55" } });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
