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
    const warnings = [];
  if (!ch?.ok && ch?.error) {
    const msg = (typeof ch.error === 'string' ? ch.error : JSON.stringify(ch.error));
    if (msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('scope')) {
      warnings.push('OAuth token missing YouTube Data API scope. Re-generate refresh token with youtube.readonly (or set YT_API_KEY for Data API calls).');
    } else {
      warnings.push('Could not fetch channel metadata from YouTube Data API.');
    }
  }

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

function getEnv(env, ...keys) {
  for (const k of keys) {
    const v = env?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

async function getAccessToken(env) {
  const clientId = getEnv(env, "GOOGLE_CLIENT_ID", "YT_CLIENT_ID", "CLIENT_ID");
  const clientSecret = getEnv(env, "GOOGLE_CLIENT_SECRET", "YT_CLIENT_SECRET", "CLIENT_SECRET");
  const refreshToken = getEnv(env, "GOOGLE_REFRESH_TOKEN", "YT_REFRESH_TOKEN", "REFRESH_TOKEN");

  if (!clientId) throw new Error("Missing env.GOOGLE_CLIENT_ID (or YT_CLIENT_ID)");
  if (!clientSecret) throw new Error("Missing env.GOOGLE_CLIENT_SECRET (or YT_CLIENT_SECRET)");
  if (!refreshToken) throw new Error("Missing env.GOOGLE_REFRESH_TOKEN (or YT_REFRESH_TOKEN)");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
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
async function ytDataGET(apiKey, token, path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);

  // If apiKey is present, we use API-key auth (public Data API calls) and DO NOT send OAuth header.
  if (apiKey) url.searchParams.set("key", apiKey);

  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const init = {};
  if (!apiKey && token) {
    init.headers = { Authorization: `Bearer ${token}` };
  }

  const r = await fetch(url.toString(), init);
  const data = await safeReadJson(r);

  if (!r.ok) {
    throw new Error(`YT_DATA ${path} ${r.status}: ${JSON.stringify(data)}`);
  }
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

async function safeAnalytics(token, params = {}, env = null) {
  // ✅ Never return null (prevents TypeError: cannot read rows)
  const fallback = { columnHeaders: [], rows: [], _error: null };

  try {
    const data = await ytAnalyticsGET(token, params);
    return {
      columnHeaders: Array.isArray(data?.columnHeaders) ? data.columnHeaders : [],
      rows: Array.isArray(data?.rows) ? data.rows : [],
      _error: null
    };
  } catch (e) {
    // Best-effort single retry using refresh token env (if provided)
    if (env && typeof getAccessToken === "function") {
      try {
        const t2 = await getAccessToken(env);
        const data2 = await ytAnalyticsGET(t2, params);
        return {
          columnHeaders: Array.isArray(data2?.columnHeaders) ? data2.columnHeaders : [],
          rows: Array.isArray(data2?.rows) ? data2.rows : [],
          _error: null
        };
      } catch (e2) {
        fallback._error = String(e2);
        return fallback;
      }
    }
    fallback._error = String(e);
    return fallback;
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
async function fetchChannelBasics(apiKey, channelId, token = "") {
  // Prefer API-key auth (public) when channelId is provided.
  if (apiKey && channelId) {
    const data = await ytDataGET(apiKey, "", "channels", {
      part: "snippet,statistics,contentDetails",
      id: channelId
    });
    const it = data?.items?.[0];
    if (!it) return null;

    const uploadsPlaylistId = it?.contentDetails?.relatedPlaylists?.uploads || "";
    return {
      channelId: it.id,
      title: it.snippet?.title || "",
      publishedAt: it.snippet?.publishedAt || "",
      thumbnail:
        it.snippet?.thumbnails?.high?.url ||
        it.snippet?.thumbnails?.default?.url ||
        "",
      subscribers: safeNum(it.statistics?.subscriberCount, 0),
      totalViews: safeNum(it.statistics?.viewCount, 0),
      videos: safeNum(it.statistics?.videoCount, 0),
      uploadsPlaylistId
    };
  }

  // Fallback (requires OAuth token with YouTube Data API scopes like youtube.readonly):
  if (token) {
    const data = await ytDataGET("", token, "channels", {
      part: "snippet,statistics,contentDetails",
      mine: "true"
    });
    const it = data?.items?.[0];
    if (!it) return null;

    const uploadsPlaylistId = it?.contentDetails?.relatedPlaylists?.uploads || "";
    return {
      channelId: it.id,
      title: it.snippet?.title || "",
      publishedAt: it.snippet?.publishedAt || "",
      thumbnail:
        it.snippet?.thumbnails?.high?.url ||
        it.snippet?.thumbnails?.default?.url ||
        "",
      subscribers: safeNum(it.statistics?.subscriberCount, 0),
      totalViews: safeNum(it.statistics?.viewCount, 0),
      videos: safeNum(it.statistics?.videoCount, 0),
      uploadsPlaylistId
    };
  }

  return null;
}

async function fetchRecentUploads(apiKey, uploadsPlaylistId, maxResults = 25) {
  if (!apiKey || !uploadsPlaylistId) return [];
  const data = await ytDataGET(apiKey, "", "playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: clamp(maxResults, 1, 50)
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map(it => ({
      videoId: it?.contentDetails?.videoId || "",
      title: it?.snippet?.title || "",
      publishedAt: it?.contentDetails?.videoPublishedAt || it?.snippet?.publishedAt || ""
    }))
    .filter(x => x.videoId);
}

async function fetchVideos(apiKey, videoIds = []) {
  const ids = Array.from(new Set((videoIds || []).filter(Boolean))).slice(0, 50);
  if (!apiKey || !ids.length) return [];

  const data = await ytDataGET(apiKey, "", "videos", {
    part: "snippet,contentDetails,statistics",
    id: ids.join(",")
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(v => {
    const id = v?.id || "";
    return {
      // keep BOTH for compatibility
      id,
      videoId: id,
      title: v?.snippet?.title || "",
      publishedAt: v?.snippet?.publishedAt || "",
      durationSec: parseISODurationToSeconds(v?.contentDetails?.duration || ""),
      views: safeNum(v?.statistics?.viewCount, 0),
      likes: safeNum(v?.statistics?.likeCount, 0),
      comments: safeNum(v?.statistics?.commentCount, 0)
    };
  });
}

async function fetchPlaylistTitles(apiKey, playlistIds = []) {
  const ids = Array.from(new Set((playlistIds || []).filter(Boolean))).slice(0, 50);
  if (!apiKey || !ids.length) return {};

  const data = await ytDataGET(apiKey, "", "playlists", {
    part: "snippet",
    id: ids.join(",")
  });

  const out = {};
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const pl of items) {
    const id = pl?.id;
    if (!id) continue;
    out[id] = pl?.snippet?.title || "";
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
   HUD Message Engine (300+ templates)
   ---------------------------------------------------------
   Returns a pre-computed message pool so the front-end HUD can rotate
   without touching the Top Cards logic.
   ========================================================= */

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

function interpolate(templateText, ctx) {
  return templateText.replace(/{([a-zA-Z0-9_.]+)}/g, (_, t) => {
    const v = resolvePath(ctx, t);
    return v === undefined || v === null ? "" : String(v);
  });
}

function isSafeTemplate(templateText, ctx) {
  const tokens = extractTokens(templateText);
  for (const t of tokens) {
    const v = resolvePath(ctx, t);
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
  }
  return true;
}

function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("en-US");
}

function fmt1(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.0";
  return (Math.round(v * 10) / 10).toFixed(1);
}

function fmtPct1(n) {
  return `${fmt1(n)}%`;
}

function calcPctChange(now, prev) {
  now = Number(now) || 0;
  prev = Number(prev) || 0;
  if (prev <= 0) return null;
  return ((now - prev) / prev) * 100;
}

function pickTopVideoBy(list, selectorFn, minGuardFn = null) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const ok = minGuardFn ? arr.filter(minGuardFn) : arr;
  ok.sort((a, b) => Number(selectorFn(b) || 0) - Number(selectorFn(a) || 0));
  return ok[0] || null;
}

function buildHudTemplateDeck() {
  // We generate lots of variants programmatically so you get 300+ unique lines
  // without sending a huge payload to the front-end.
  const deck = [];
  let id = 1;

  const add = (tag, type, iconKey, guard, texts) => {
    for (const t of texts) deck.push({ id: `t_${id++}`, tag, type, iconKey, guard, text: t });
  };

  // ---------------- PULSE ----------------
  const pulsePrefixes = ["PULSE", "SIGNAL", "REALTIME", "HEARTBEAT", "LIVE CHECK", "SYSTEM"];
  const pulseBodies = [
    "{rt.views48hFmt} views in the last 48h. Keep feeding the algorithm.",
    "Last hour: {rt.lastHourFmt} views. Prev hour: {rt.prevHourFmt}.",
    "24h is at {rt.last24hFmt} vs {rt.prev24hFmt} the day before.",
    "Your 7D pacing vs baseline is {rt.vs7dAvgDeltaFmt}.",
  ];
  const pulseVar = [];
  for (const p of pulsePrefixes) for (const b of pulseBodies) pulseVar.push(`${p}: ${b}`);
  add("PULSE", "blue", "live", "hasRealtime", pulseVar);

  // ---------------- WEEKLY ----------------
  const weeklyLines = [
    "WEEK: {wk.viewsFmt} views • {wk.watchHoursFmt} watch hours • {wk.netSubsFmt} net subs.",
    "WEEKLY NET: +{wk.subsGainedFmt} gained / -{wk.subsLostFmt} lost → {wk.netSubsFmt} net.",
    "Conversion: {wk.convPer1kFmt} net subs per 1K views.",
    "Week vs previous: views {wk.viewsChgPctFmt}, subs {wk.subsChgPctFmt}, watch {wk.watchChgPctFmt}.",
  ];
  const weeklyTone = ["STATUS", "WEEKLY", "ROLLING 7D", "TREND"];
  const weeklyVar = [];
  for (const p of weeklyTone) for (const l of weeklyLines) weeklyVar.push(`${p}: ${l}`);
  add("WEEKLY", "green", "up", "hasWeekly", weeklyVar);

  // ---------------- 28D ----------------
  const m28Lines = [
    "Last 28D: {m28.lastViewsFmt} views vs {m28.prevViewsFmt} prior 28D ({m28.viewsChgPctFmt}).",
    "Last 28D net subs: {m28.lastSubsFmt} vs {m28.prevSubsFmt} prior ({m28.subsChgPctFmt}).",
    "Baseline check: 28D views {m28.lastViewsFmt} vs 6M median {m28.medianViewsFmt}.",
    "Watch hours 28D: {m28.lastWatchFmt} vs {m28.prevWatchFmt} ({m28.watchChgPctFmt}).",
  ];
  const m28Prefix = ["MONTH", "28D", "ROLLING 28D", "STABILITY"];
  const m28Var = [];
  for (const p of m28Prefix) for (const l of m28Lines) m28Var.push(`${p}: ${l}`);
  add("28D", "purple", "target", "hasM28", m28Var);

  // ---------------- FOCUS VIDEO ----------------
  const focusVar = [];
  const focusOpen = ["FOCUS", "SPOTLIGHT", "CURRENT WINNER", "PRIMARY SIGNAL", "TOP IDEA"];
  const focusBody = [
    "‘{focus.titleUpper}’ pulled {focus.views7dFmt} views in 7D ({focus.viewsPerDayFmt}/day).",
    "CTR on ‘{focus.titleUpper}’: {focus.ctrFmt} from {focus.impressionsFmt} impressions.",
    "Retention on ‘{focus.titleUpper}’: {focus.avgViewPctFmt} avg viewed.",
    "Engagement: {focus.likesFmt} likes • {focus.commentsFmt} comments • {focus.sharesFmt} shares.",
    "Subs: +{focus.subsGainedFmt} / -{focus.subsLostFmt} (churn {focus.churnPctFmt}).",
  ];
  for (const o of focusOpen) for (const b of focusBody) focusVar.push(`${o}: ${b}`);
  add("VIDEO", "orange", "rocket", "hasFocus", focusVar);

  // ---------------- BEST / LEADERBOARD ----------------
  const bestVar = [];
  const bestBody = [
    "Best views (7D): ‘{best.views.titleUpper}’ with {best.views.valueFmt} views.",
    "Best CTR (7D): ‘{best.ctr.titleUpper}’ at {best.ctr.valueFmt} CTR.",
    "Best retention (7D): ‘{best.ret.titleUpper}’ at {best.ret.valueFmt} avg viewed.",
    "Best subs per 1K views: ‘{best.subs.titleUpper}’ at {best.subs.valueFmt}.",
    "Highest like density: ‘{best.likeRate.titleUpper}’ at {best.likeRate.valueFmt}.",
    "Warning: churn is highest on ‘{best.churn.titleUpper}’ ({best.churn.valueFmt}).",
  ];
  const bestPrefix = ["LEADERBOARD", "RANKING", "TOP SIGNALS", "CHANNEL META"];
  for (const p of bestPrefix) for (const b of bestBody) bestVar.push(`${p}: ${b}`);
  add("LEADERBOARD", "yellow", "target", "hasBest", bestVar);

  // ---------------- SHORTS (only if focus is a Short) ----------------
  const shortsOpen = ["SHORTS", "VERTICAL", "FEED WAR", "SWIPE ZONE"];
  const shortsBody = [
    "Your focus Short is ‘{focus.titleUpper}’. Keep the first second explosive.",
    "Short retention is {focus.avgViewPctFmt}. Tight edits win the feed.",
    "Short CTR is {focus.ctrFmt}. Make the first frame readable.",
    "Shorts + subs: {focus.subsPer1kFmt} subs per 1K views on the focus Short.",
  ];
  const shortsVar = [];
  for (const o of shortsOpen) for (const b of shortsBody) shortsVar.push(`${o}: ${b}`);
  add("SHORTS", "pink", "live", "isShortFocus", shortsVar);

  // ---------------- DISCOVERY / TRAFFIC ----------------
  const trafficVar = [];
  const trafficPrefix = ["DISCOVERY", "TRAFFIC", "DISTRIBUTION", "ENTRY POINT"];
  const trafficBody = [
    "Top traffic door (28D): {traffic.topSourceKey} at {traffic.topSourcePctFmt}.",
    "Top country (28D): {aud.topCountryKey} at {aud.topCountryPctFmt}.",
    "Subscribed vs Unsubscribed (28D views): {aud.subPctFmt} / {aud.unsubPctFmt}.",
    "Top sharing service: {traffic.topShareKey} ({traffic.topSharePctFmt}).",
  ];
  for (const p of trafficPrefix) for (const b of trafficBody) trafficVar.push(`${p}: ${b}`);
  add("DISCOVERY", "blue", "rocket", "hasTraffic", trafficVar);

  // ---------------- CADENCE ----------------
  const cadVar = [];
  const cadPrefix = ["CADENCE", "RHYTHM", "UPLOAD CLOCK", "MOMENTUM"];
  const cadBody = [
    "Days since last upload: {cad.daysSinceUpload}.",
    "Best hour (UTC) from your audience curve: {cad.bestHourUtc}.",
    "If you want browse to wake up, post again inside 72 hours.",
    "Old videos are carrying today—fresh uploads re-trigger recommendations.",
  ];
  for (const p of cadPrefix) for (const b of cadBody) cadVar.push(`${p}: ${b}`);
  add("CADENCE", "green", "up", "hasCadence", cadVar);

  // ---------------- STATIC (TIP / FACT / MOTIVATION) ----------------
  const tips = [
    "TIP: Write titles like a promise, not a label.",
    "TIP: If CTR is low, simplify the thumbnail to ONE focal point.",
    "TIP: Put your strongest payoff in the first 15 seconds.",
    "TIP: Add a pinned comment that asks a simple question.",
    "TIP: Use end screens to force a 2-video session.",
    "TIP: Upload when your audience is most active: {cad.bestHourUtc}.",
    "TIP: If retention dips at the same timestamp, that moment needs a pattern interrupt.",
    "TIP: Make the first frame readable on a phone at arm’s length.",
    "TIP: One clear series format builds returning viewers.",
    "TIP: Short hook, long payoff. Keep intros under 5 seconds.",
  ];
  const facts = [
    "FUN FACT: YouTube often tests thumbnails with small audience pockets before scaling impressions.",
    "FUN FACT: A 2-video session is a strong recommendation signal for many niches.",
    "FUN FACT: CTR and retention work together—high CTR + low retention can cap distribution.",
    "FUN FACT: Browse traffic usually rewards consistent upload rhythm.",
    "FUN FACT: Returning viewers drive stability; new viewers drive growth.",
    "FUN FACT: Shorts can be top-of-funnel; playlists turn viewers into fans.",
    "FUN FACT: Watch time per viewer is often more important than raw views for recommendations.",
    "FUN FACT: Big screens (TV/console) tend to favor cleaner thumbnails and slower cuts.",
    "FUN FACT: ‘Evergreen’ topics earn search views long after upload.",
    "FUN FACT: Comments can pull more impressions when conversation stays active.",
  ];
  const mot = [
    "MOTIVATION: Don’t chase views—chase repeatable formats.",
    "MOTIVATION: One better thumbnail can revive an entire library.",
    "MOTIVATION: You’re one strong hook away from a breakout.",
    "MOTIVATION: Consistency compounds. Keep the channel warm.",
    "MOTIVATION: Make the next upload a direct sequel to what’s working.",
    "MOTIVATION: Your library is an asset. Improve packaging and it pays forever.",
    "MOTIVATION: The algorithm follows the audience—serve them and it follows you.",
    "MOTIVATION: Build episodes, not one-offs.",
    "MOTIVATION: Speed beats perfection. Ship, learn, iterate.",
    "MOTIVATION: A good idea + good hook = unstoppable combo.",
  ];

  const addVarExp = (tag, type, iconKey, guard, baseLines, prefixes) => {
    const out = [];
    for (const p of prefixes) for (const l of baseLines) out.push(`${p}${p ? " " : ""}${l}`);
    add(tag, type, iconKey, guard, out);
  };
  addVarExp("TIP", "yellow", "bulb", "hasCadence", tips, ["", "SYSTEM:", "NOTE:", "FIELD DATA:", "PLAYBOOK:"]);
  addVarExp("FACT", "purple", "bulb", "always", facts, ["", "SYSTEM:", "OBSERVATION:", "META:", "FYI:"]);
  addVarExp("MOTIVATION", "pink", "live", "always", mot, ["", "SYSTEM:", "PUSH:", "REMINDER:", "ENERGY:"]);


  // ---------------- Stable Deck Size ----------------
  // Keep a predictable number of templates so the HUD feels "full" even if you edit/trim above.
  // We cap to exactly 380 (as requested) and backfill with safe, always-resolvable templates.
  const TARGET_TEMPLATES = 380;

  const fillers = [
    { tag: "SYSTEMS", type: "system", iconKey: "spark", guard: null, text: "Signal check: {weekly.lastViewsFmt} views in the last 7 days. Keep the flywheel spinning." },
    { tag: "SYSTEMS", type: "system", iconKey: "spark", guard: null, text: "Momentum: {weekly.lastWatchHoursFmt} watch-hours this week. Session time is compounding." },
    { tag: "PACKAGING", type: "packaging", iconKey: "cursor", guard: null, text: "Packaging check: CTR is {focus.ctrFmt} on '{focus.title}'. Keep iterating titles/thumbnails." },
    { tag: "RETENTION", type: "retention", iconKey: "clock", guard: null, text: "Retention check: avg view % is {focus.avgViewPctFmt} on '{focus.title}'. Tighten pacing where it dips." },
    { tag: "DISCOVERY", type: "discovery", iconKey: "search", guard: null, text: "Your current growth door is {m28.topTrafficSource}. Make the next upload fit that entry path." },
    { tag: "AUDIENCE", type: "audience", iconKey: "users", guard: null, text: "Audience split: {weekly.subscribedPctFmt}% subscribed vs {weekly.unsubscribedPctFmt}% unsubscribed views this week." },
    { tag: "CADENCE", type: "cadence", iconKey: "calendar", guard: null, text: "Cadence check: {cadence.daysSinceUpload} days since upload. Consistency keeps Browse warm." },
    { tag: "MONEY", type: "money", iconKey: "dollar", guard: null, text: "Revenue check: ${m28.revFmt} estimated in the last 28 days. Library value is real." }
  ];

  let fi = 0;
  while (deck.length < TARGET_TEMPLATES) {
    const f = fillers[fi % fillers.length];
    deck.push({ id: `t_${id++}`, tag: f.tag, type: f.type, iconKey: f.iconKey, guard: f.guard, text: f.text });
    fi++;
  }
  if (deck.length > TARGET_TEMPLATES) deck.length = TARGET_TEMPLATES;

  return deck;

}

function buildHudEnginePayload(ctx, options = {}) {
  const deck = buildHudTemplateDeck();
  const totalTemplates = deck.length;

  const guards = {
    always: () => true,
    hasRealtime: () => Number(ctx?.rt?.views48hNum || 0) > 0,
    hasWeekly: () => Number(ctx?.wk?.viewsNum || 0) > 0 || Number(ctx?.wk?.netSubsNum || 0) !== 0,
    hasM28: () => Number(ctx?.m28?.lastViewsNum || 0) > 0 || Number(ctx?.m28?.lastSubsNum || 0) !== 0,
    hasFocus: () => !!ctx?.focus?.titleUpper,
    hasBest: () => !!ctx?.best?.views?.titleUpper,
    hasTraffic: () => !!ctx?.traffic?.topSourceKey || !!ctx?.aud?.topCountryKey,
    hasCadence: () => ctx?.cad?.daysSinceUpload !== null && ctx?.cad?.daysSinceUpload !== undefined,
    isShortFocus: () => ctx?.focus?.isShort === true,
  };

  const safe = deck.filter(t => {
    const g = guards[t.guard] ? guards[t.guard]() : true;
    if (!g) return false;
    return isSafeTemplate(t.text, ctx);
  });

  const poolSize = clamp(safeNum(options.poolSize, 120), 3, 380);
  const includeTemplates = Boolean(options.includeTemplates);
  

  // shuffle
  const shuffled = safe.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const chosen = [];
  const seen = new Set();
  for (const t of shuffled) {
    if (chosen.length >= poolSize) break;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    chosen.push({
      key: t.id,
      tag: t.tag,
      type: t.type,
      iconKey: t.iconKey,
      text: interpolate(t.text, ctx).toUpperCase(),
    });
  }

  const out = { templatesCount: totalTemplates, safeTemplatesCount: safe.length, poolSize, poolCount: chosen.length, messages: chosen };
  if (includeTemplates) out.templates = safe;
  return out;
}

function buildHudEngineContext(data) {
  const wk = data?.weekly || {};
  const m28 = data?.m28 || {};
  const rt = data?.realtime || {};
  const hud = data?.hud || {};
  const vids = hud?.videoIntel?.videos || [];

  const focusId = hud?.topVideo7d?.videoId || hud?.latestVideo?.videoId || null;
  const focus = vids.find(v => v.videoId === focusId) || vids[0] || null;

  const focusA = focus?.a7d || {};
  const focusD = focus?.derived || {};
  const titleUpper = (focus?.title || hud?.latestVideo?.title || "").toUpperCase();
  const isShort = (Number(focus?.durationSec || 0) > 0 && Number(focus?.durationSec || 0) <= 60) || /#shorts\b/i.test(focus?.title || "");

  const bestViews = pickTopVideoBy(vids, v => v?.a7d?.views, v => Number(v?.a7d?.views || 0) > 0);
  const bestCtr = pickTopVideoBy(vids, v => v?.a7d?.ctr, v => Number(v?.a7d?.impressions || 0) >= 500 && Number(v?.a7d?.ctr || 0) > 0);
  const bestRet = pickTopVideoBy(vids, v => v?.a7d?.avgViewPercentage, v => Number(v?.a7d?.avgViewPercentage || 0) > 0);
  const bestSubs = pickTopVideoBy(vids, v => v?.derived?.subsPer1kViews, v => Number(v?.derived?.subsPer1kViews || 0) > 0);
  const bestLikeRate = pickTopVideoBy(vids, v => (Number(v?.a7d?.likes || 0) / Math.max(1, Number(v?.a7d?.views || 0))) * 1000, v => Number(v?.a7d?.views || 0) > 0);
  const worstChurn = pickTopVideoBy(vids, v => v?.derived?.churnPct, v => Number(v?.derived?.churnPct || 0) > 0);

  const traffic28 = hud?.traffic?.last28 || [];
  const trafficSum = traffic28.reduce((s, x) => s + Number(x.value || 0), 0);
  const topTraffic = traffic28[0] || null;

  const share28 = hud?.sharingServices || [];
  const shareSum = share28.reduce((s, x) => s + Number(x.value || 0), 0);
  const topShare = share28[0] || null;

  const countries = hud?.countries || [];
  const countrySum = countries.reduce((s, x) => s + Number(x.value || 0), 0);
  const topCountry = countries[0] || null;

  const subStatus = hud?.subscribedStatus || [];
  const subViews = subStatus.reduce((s, x) => s + Number(x.value || 0), 0);
  const subRow = subStatus.find(x => String(x.key).toUpperCase().includes("SUBSCRIBED")) || null;
  const unsubRow = subStatus.find(x => String(x.key).toUpperCase().includes("UNSUB")) || null;
  const subPct = subViews > 0 ? (Number(subRow?.value || 0) / subViews) * 100 : null;
  const unsubPct = subViews > 0 ? (Number(unsubRow?.value || 0) / subViews) * 100 : null;

  const daysSinceUpload = (hud?.uploads?.latest?.publishedAt && hud?.statsThrough)
    ? daysBetween(isoDate(new Date(hud.uploads.latest.publishedAt)), hud.statsThrough)
    : null;

  const wkViewsChg = calcPctChange(wk.views, wk.prevViews);
  const wkSubsChg = calcPctChange(wk.netSubs, wk.prevNetSubs);
  const wkWatchChg = calcPctChange(wk.watchHours, wk.prevWatchHours);

  const m28ViewsChg = calcPctChange(m28?.last28?.views, m28?.prev28?.views);
  const m28SubsChg = calcPctChange(m28?.last28?.netSubs, m28?.prev28?.netSubs);
  const m28WatchChg = calcPctChange(m28?.last28?.watchHours, m28?.prev28?.watchHours);

  const rtVs7d = Number(rt.vs7dAvgDelta || 0);

  return {
    rt: {
      views48hNum: Number(rt.views48h || 0),
      views48hFmt: fmtInt(rt.views48h || 0),
      last24hFmt: fmtInt(rt.last24h || 0),
      prev24hFmt: fmtInt(rt.prev24h || 0),
      lastHourFmt: fmtInt(rt.lastHour || 0),
      prevHourFmt: fmtInt(rt.prevHour || 0),
      vs7dAvgDeltaFmt: rtVs7d >= 0 ? `+${fmt1(rtVs7d)}%` : `${fmt1(rtVs7d)}%`,
    },
    wk: {
      viewsNum: Number(wk.views || 0),
      viewsFmt: fmtInt(wk.views || 0),
      watchHoursFmt: fmtInt(wk.watchHours || 0),
      netSubsFmt: fmtInt(wk.netSubs || 0),
      subsGainedFmt: fmtInt(wk.subscribersGained || 0),
      subsLostFmt: fmtInt(wk.subscribersLost || 0),
      netSubsNum: Number(wk.netSubs || 0),
      convPer1kFmt: (Number(wk.views || 0) > 0) ? fmt1((Number(wk.netSubs || 0) / Number(wk.views || 1)) * 1000) : "0.0",
      viewsChgPctFmt: wkViewsChg === null ? "N/A" : (wkViewsChg >= 0 ? `+${fmt1(wkViewsChg)}%` : `${fmt1(wkViewsChg)}%`),
      subsChgPctFmt: wkSubsChg === null ? "N/A" : (wkSubsChg >= 0 ? `+${fmt1(wkSubsChg)}%` : `${fmt1(wkSubsChg)}%`),
      watchChgPctFmt: wkWatchChg === null ? "N/A" : (wkWatchChg >= 0 ? `+${fmt1(wkWatchChg)}%` : `${fmt1(wkWatchChg)}%`),
    },
    m28: {
      lastViewsNum: Number(m28?.last28?.views || 0),
      lastViewsFmt: fmtInt(m28?.last28?.views || 0),
      prevViewsFmt: fmtInt(m28?.prev28?.views || 0),
      medianViewsFmt: fmtInt(m28?.median6m?.views || 0),
      lastSubsNum: Number(m28?.last28?.netSubs || 0),
      lastSubsFmt: fmtInt(m28?.last28?.netSubs || 0),
      prevSubsFmt: fmtInt(m28?.prev28?.netSubs || 0),
      lastWatchFmt: fmtInt(m28?.last28?.watchHours || 0),
      prevWatchFmt: fmtInt(m28?.prev28?.watchHours || 0),
      viewsChgPctFmt: m28ViewsChg === null ? "N/A" : (m28ViewsChg >= 0 ? `+${fmt1(m28ViewsChg)}%` : `${fmt1(m28ViewsChg)}%`),
      subsChgPctFmt: m28SubsChg === null ? "N/A" : (m28SubsChg >= 0 ? `+${fmt1(m28SubsChg)}%` : `${fmt1(m28SubsChg)}%`),
      watchChgPctFmt: m28WatchChg === null ? "N/A" : (m28WatchChg >= 0 ? `+${fmt1(m28WatchChg)}%` : `${fmt1(m28WatchChg)}%`),
    },
    focus: {
      titleUpper,
      isShort,
      views7dFmt: fmtInt(focusA.views || 0),
      viewsPerDayFmt: fmt1(focusD.viewsPerDay || 0),
      impressionsFmt: fmtInt(focusA.impressions || 0),
      ctrFmt: fmtPct1(focusA.ctr || 0),
      avgViewPctFmt: fmtPct1(focusA.avgViewPercentage || 0),
      likesFmt: fmtInt(focusA.likes || 0),
      commentsFmt: fmtInt(focusA.comments || 0),
      sharesFmt: fmtInt(focusA.shares || 0),
      subsGainedFmt: fmtInt(focusA.subsGained || 0),
      subsLostFmt: fmtInt(focusA.subsLost || 0),
      churnPctFmt: fmtPct1(focusD.churnPct || 0),
      subsPer1kFmt: fmt1(focusD.subsPer1kViews || 0),
    },
    best: {
      views: bestViews ? { titleUpper: (bestViews.title || "").toUpperCase(), valueFmt: fmtInt(bestViews?.a7d?.views || 0) } : {},
      ctr: bestCtr ? { titleUpper: (bestCtr.title || "").toUpperCase(), valueFmt: fmtPct1(bestCtr?.a7d?.ctr || 0) } : {},
      ret: bestRet ? { titleUpper: (bestRet.title || "").toUpperCase(), valueFmt: fmtPct1(bestRet?.a7d?.avgViewPercentage || 0) } : {},
      subs: bestSubs ? { titleUpper: (bestSubs.title || "").toUpperCase(), valueFmt: `${fmt1(bestSubs?.derived?.subsPer1kViews || 0)} SUBS/1K` } : {},
      likeRate: bestLikeRate ? { titleUpper: (bestLikeRate.title || "").toUpperCase(), valueFmt: `${fmt1((Number(bestLikeRate?.a7d?.likes || 0) / Math.max(1, Number(bestLikeRate?.a7d?.views || 0))) * 1000)} LIKES/1K` } : {},
      churn: worstChurn ? { titleUpper: (worstChurn.title || "").toUpperCase(), valueFmt: fmtPct1(worstChurn?.derived?.churnPct || 0) } : {},
    },
    traffic: {
      topSourceKey: topTraffic ? String(topTraffic.key) : "UNKNOWN",
      topSourcePctFmt: (trafficSum > 0 && topTraffic) ? fmtPct1((Number(topTraffic.value || 0) / trafficSum) * 100) : "0%",
      topShareKey: topShare ? String(topShare.key) : "OTHER",
      topSharePctFmt: (shareSum > 0 && topShare) ? fmtPct1((Number(topShare.value || 0) / shareSum) * 100) : "0%",
    },
    aud: {
      topCountryKey: topCountry ? String(topCountry.key) : "UNKNOWN",
      topCountryPctFmt: (countrySum > 0 && topCountry) ? fmtPct1((Number(topCountry.value || 0) / countrySum) * 100) : "",
      subPctFmt: subPct === null ? "0%" : fmtPct1(subPct),
      unsubPctFmt: unsubPct === null ? "0%" : fmtPct1(unsubPct),
    },
    cad: {
      daysSinceUpload,
      bestHourUtc: hud?.cadence?.bestHourUtc || "—",
    }
  };
}

function buildHudEngine(data) {
  const ctx = buildHudEngineContext(data);
  return buildHudEnginePayload(ctx, { poolSize: 32 });
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
async function computeKPIs(env, opts = {}) {
  const token = await getAccessToken(env);
  const apiKey = env.YT_API_KEY || "";
  const channelId = opts.channelId || env.YT_CHANNEL_ID || "";

  const ch = await fetchChannelBasics(apiKey, channelId, token);
  if (!ch) {
    throw new Error(
      "Unable to fetch channel basics. Provide ?channelId=YOUR_CHANNEL_ID and set YT_API_KEY (or re-auth with YouTube Data API scopes like youtube.readonly)."
    );
  }
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
  const uploads = await fetchRecentUploads(apiKey, ch.uploadsPlaylistId, 25);
  const latestUpload = uploads[0] || null;

  const top7Resp = await safeAnalytics(token, { startDate: weeklyStart, endDate: endIso, dimensions: "video", metrics: "views", sort: "-views", maxResults: "1" });
  const top7VideoId = top7Resp?.rows?.[0]?.[0] || null;
  
  const videoIds = uniq([...(uploads.map((u) => u.videoId)), top7VideoId]);
  const videoDetails = await fetchVideos(apiKey, videoIds);
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
const sharing28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "sharingService", metrics: "views", sort: "-views", maxResults: "5" });
const playlist28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "playlist", metrics: "views", sort: "-views", maxResults: "5" });
const searchTerms28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "insightTrafficSourceDetail", metrics: "views", sort: "-views", maxResults: "5", filters: "insightTrafficSourceType==YT_SEARCH" });

// cadence (best hour UTC) from last 28D hourly views
const hour28 = await safeAnalytics(token, { startDate: last28Start, endDate: endIso, dimensions: "hour", metrics: "views", sort: "-views", maxResults: "1" });
const bestHourUtc = hour28?.rows?.[0]?.[0] !== undefined ? String(hour28.rows[0][0]).padStart(2, "0") + ":00 UTC" : null;

// Playlist titles (optional)
const playlistIds = (playlist28?.rows || []).map(r => String(r?.[0] || "")).filter(Boolean).slice(0, 25);
const playlistTitlesMap = await fetchPlaylistTitles(apiKey, playlistIds);


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
    sharingServices: rowsToDimList(sharing28, "sharingService", "views"),
    searchTerms: rowsToDimList(searchTerms28, "insightTrafficSourceDetail", "views"),
    playlists: { last28: (playlist28?.rows || []).map(r => ({ key: String(r[0]||""), title: playlistTitlesMap[String(r[0]||"")] || "", value: Number(r[1]||0) })).filter(x => x.key) },
    cadence: { bestHourUtc },
    videoIntel: { range7d: { startDate: weeklyStart, endDate: endIso }, videos: videoIntelList },
  };

  return {
    channel: ch,
    warnings,
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
    hudEngine: buildHudEngine({
      poolSize: opts?.poolSize,
      includeTemplates: opts?.includeTemplates,
       channel: ch, weekly: {
      startDate: weeklyStart, endDate: endIso,
      netSubs: weeklyPacked.netSubs, views: weeklyPacked.views, watchHours: weeklyPacked.watchHours,
      subscribersGained: weeklyPacked.gained, subscribersLost: weeklyPacked.lost, minutesWatched: weeklyPacked.minutes,
      prevNetSubs: prevWeeklyPacked.netSubs, prevViews: prevWeeklyPacked.views, prevWatchHours: prevWeeklyPacked.watchHours,
      prevSubscribersGained: prevWeeklyPacked.gained, prevSubscribersLost: prevWeeklyPacked.lost,
    }, m28: {
      last28: { netSubs: last28.metrics.netSubs, views: last28.metrics.views, watchHours: last28.metrics.watchHours },
      prev28: { netSubs: prev28.metrics.netSubs, views: prev28.metrics.views, watchHours: prev28.metrics.watchHours },
      avg6m: { netSubs: avgSubs, views: avgViews, watchHours: avgWatch },
      median6m: { netSubs: medianSubs, views: medianViews, watchHours: medianWatch },
    }, realtime, lifetime: { watchHours: life.totalHours }, history28d, hud }),
  };
}

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS"
      }
    });
  }

  if (req.method !== "GET") {
    return Response.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  }

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
  };

  try {
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const opts = {
      poolSize: url.searchParams.get("pool"),
      includeTemplates: ["1", "true", "yes"].includes((url.searchParams.get("templates") || "").toLowerCase()),
      channelId: url.searchParams.get("channelId") || url.searchParams.get("cid") || ""
    };

    const data = await computeKPIs(context.env, opts);
    const res = Response.json(data, { headers: { "Cache-Control": "public, max-age=55", ...cors } });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500, headers: cors });
  }
}
