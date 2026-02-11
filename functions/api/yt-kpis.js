// functions/api/yt-kpis.js
// Cloudflare Pages Functions (ESM) — returns KPIs for 3 cards + AI HUD extras.
// Caches response 55s at edge for smooth 60s front-end refresh.

// ---------------------------
// Helpers
// ---------------------------

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function shiftDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function clamp(n, a, b) {
  n = Number(n);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}
function sumDailyRows(rows, i0, i1) {
  const out = { views: 0, minutes: 0, gained: 0, lost: 0 };
  for (let i = i0; i <= i1; i++) {
    const r = rows[i];
    out.views += Number(r?.views || 0);
    out.minutes += Number(r?.minutes || 0);
    out.gained += Number(r?.gained || 0);
    out.lost += Number(r?.lost || 0);
  }
  return out;
}
function packMetrics(sum) {
  const views = Number(sum?.views || 0);
  const minutes = Number(sum?.minutes || 0);
  const gained = Number(sum?.gained || 0);
  const lost = Number(sum?.lost || 0);
  const netSubs = gained - lost;
  const watchHours = minutes / 60;
  return { views, minutes, watchHours, gained, lost, netSubs };
}
function median(nums) {
  nums = (nums || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function avg(nums) {
  nums = (nums || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function uniq(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr || []) {
    if (!x) continue;
    if (s.has(x)) continue;
    s.add(x);
    out.push(x);
  }
  return out;
}
function rowsToDimList(resp, dimName, metricName) {
  const rows = resp?.rows || [];
  const headers = resp?.columnHeaders || [];
  const dimIdx = headers.findIndex((h) => h.name === dimName);
  const metIdx = headers.findIndex((h) => h.name === metricName);
  if (dimIdx < 0 || metIdx < 0) return null;
  return rows.map((r) => ({ name: String(r[dimIdx]), value: Number(r[metIdx] || 0) }));
}

// ---------------------------
// OAuth token
// ---------------------------

async function getAccessToken(env) {
  const url = "https://oauth2.googleapis.com/token";
  const form = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const r = await fetch(url, { method: "POST", body: form });
  const j = await r.json();
  if (!j.access_token) throw new Error("No access_token");
  return j.access_token;
}

async function ytFetch(token, url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (j?.error?.message) throw new Error(j.error.message);
  return j;
}

async function ytAnalytics(token, params) {
  const base = "https://youtubeanalytics.googleapis.com/v2/reports";
  const qs = new URLSearchParams({
    ids: "channel==MINE",
    ...params,
  });
  return ytFetch(token, `${base}?${qs.toString()}`);
}

// Some analytics metrics/dimensions are not available for all channels.
// "safeAnalytics" returns null instead of throwing, so HUD stays alive.
async function safeAnalytics(token, params) {
  try {
    return await ytAnalytics(token, params);
  } catch {
    return null;
  }
}

// ---------------------------
// Data API: channel basics + uploads playlist
// ---------------------------

async function fetchChannelBasics(token) {
  const url =
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true";
  const j = await ytFetch(token, url);
  const item = j.items?.[0];
  if (!item) throw new Error("No channel");
  const subs = Number(item.statistics?.subscriberCount || 0);
  const views = Number(item.statistics?.viewCount || 0);
  const publishedAt = item.snippet?.publishedAt || null;
  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads || null;
  return { subs, views, publishedAt, uploadsPlaylistId };
}

// ---------------------------
// Analytics: daily series for 196 days
// ---------------------------

async function fetchDailyCore(token, startDate, endDate) {
  const resp = await ytAnalytics(token, {
    startDate,
    endDate,
    dimensions: "day",
    metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
    sort: "day",
  });

  const rows = resp?.rows || [];
  const out = [];
  for (const r of rows) {
    out.push({
      day: String(r[0]),
      views: Number(r[1] || 0),
      minutes: Number(r[2] || 0),
      gained: Number(r[3] || 0),
      lost: Number(r[4] || 0),
    });
  }
  return out;
}

// ---------------------------
// Lifetime watch hours
// ---------------------------

async function fetchLifetimeWatchHours(token, startDate, endDate) {
  const resp = await ytAnalytics(token, {
    startDate,
    endDate,
    metrics: "estimatedMinutesWatched",
  });
  const min = Number(resp?.rows?.[0]?.[0] || 0);
  return { totalHours: min / 60 };
}

// ---------------------------
// Uploads list (recent videos)
// ---------------------------

async function fetchRecentUploads(token, uploadsPlaylistId, maxResults = 25) {
  if (!uploadsPlaylistId) return [];
  const url =
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}` +
    `&maxResults=${clamp(maxResults, 1, 50)}`;
  const j = await ytFetch(token, url);
  const items = j.items || [];
  return items.map((it) => ({
    videoId: it.snippet?.resourceId?.videoId || null,
    publishedAt: it.snippet?.publishedAt || null,
    title: it.snippet?.title || "",
  })).filter((x) => x.videoId);
}

// ---------------------------
// Videos details (title, stats, duration)
// ---------------------------

function parseISO8601DurationToSec(iso) {
  // PT#H#M#S
  if (!iso || typeof iso !== "string") return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + mm * 60 + s;
}

async function fetchVideos(token, videoIds) {
  videoIds = uniq(videoIds).filter(Boolean);
  if (!videoIds.length) return [];

  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const out = [];
  for (const chunk of chunks) {
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${chunk.join(",")}`;
    const j = await ytFetch(token, url);
    for (const it of j.items || []) {
      const vid = it.id;
      const title = it.snippet?.title || "";
      const publishedAt = it.snippet?.publishedAt || null;
      const views = Number(it.statistics?.viewCount || 0);
      const likes = Number(it.statistics?.likeCount || 0);
      const comments = Number(it.statistics?.commentCount || 0);
      const duration = it.contentDetails?.duration || "";
      const durationSec = parseISO8601DurationToSec(duration);
      out.push({ videoId: vid, title, publishedAt, views, likes, comments, duration, durationSec });
    }
  }
  return out;
}

// ---------------------------
// Video analytics 7D bundle (top recent videos)
// ---------------------------

function parseVideoRows(resp, metricNames) {
  // resp rows: [videoId, metric1, metric2...]
  const headers = resp?.columnHeaders || [];
  const rows = resp?.rows || [];
  const vidIdx = headers.findIndex((h) => h.name === "video");
  if (vidIdx < 0) return new Map();

  const metricIdxs = metricNames.map((m) => headers.findIndex((h) => h.name === m));
  const map = new Map();

  for (const r of rows) {
    const vid = String(r[vidIdx]);
    const obj = {};
    for (let i = 0; i < metricNames.length; i++) {
      const idx = metricIdxs[i];
      obj[metricNames[i]] = idx >= 0 ? Number(r[idx] || 0) : null;
    }
    map.set(vid, obj);
  }
  return map;
}

async function fetchVideoAnalytics7dBundle(token, startIso, endIso, maxResults = 25) {
  // We use multiple "safe" calls so one unavailable metric doesn't kill everything.
  // Each returns a map: videoId -> metrics

  const [base, retention, thumbs, engage] = await Promise.all([
    safeAnalytics(token, {
      startDate: startIso,
      endDate: endIso,
      dimensions: "video",
      metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
      sort: "-views",
      maxResults: String(clamp(maxResults, 1, 50)),
    }),

    safeAnalytics(token, {
      startDate: startIso,
      endDate: endIso,
      dimensions: "video",
      metrics: "averageViewDuration,averageViewPercentage",
      sort: "-views",
      maxResults: String(clamp(maxResults, 1, 50)),
    }),

    safeAnalytics(token, {
      startDate: startIso,
      endDate: endIso,
      dimensions: "video",
      metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
      sort: "-views",
      maxResults: String(clamp(maxResults, 1, 50)),
    }),

    safeAnalytics(token, {
      startDate: startIso,
      endDate: endIso,
      dimensions: "video",
      metrics: "likes,comments,shares",
      sort: "-views",
      maxResults: String(clamp(maxResults, 1, 50)),
    }),
  ]);

  return {
    baseMap: parseVideoRows(base, ["views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"]),
    retentionMap: parseVideoRows(retention, ["averageViewDuration", "averageViewPercentage"]),
    thumbsMap: parseVideoRows(thumbs, ["videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"]),
    engageMap: parseVideoRows(engage, ["likes", "comments", "shares"]),
    rawOk: !!(base && base.rows && base.rows.length),
  };
}

function buildVideoIntelList(videoDetails, bundle, endIso) {
  const base = bundle.baseMap;
  const ret = bundle.retentionMap;
  const th = bundle.thumbsMap;
  const en = bundle.engageMap;

  const byId = new Map(videoDetails.map((v) => [v.videoId, v]));
  const vids = [];

  for (const [vid, m] of base.entries()) {
    const det = byId.get(vid) || {};
    const gained = Number(m.subscribersGained || 0);
    const lost = Number(m.subscribersLost || 0);
    const netSubs = gained - lost;
    const minutes = Number(m.estimatedMinutesWatched || 0);
    const watchHours = minutes / 60;

    const r = ret.get(vid) || {};
    const t = th.get(vid) || {};
    const e = en.get(vid) || {};

    vids.push({
      videoId: vid,
      title: det.title || "",
      publishedAt: det.publishedAt || null,

      views7d: Number(m.views || 0),
      watchHours7d: watchHours,
      netSubs7d: netSubs,

      avgViewDurationSec7d: r.averageViewDuration ?? null,
      avgViewPercentage7d: r.averageViewPercentage ?? null,

      thumbImpressions7d: t.videoThumbnailImpressions ?? null,
      thumbCtr7d: t.videoThumbnailImpressionsClickRate ?? null,

      likes7d: e.likes ?? null,
      comments7d: e.comments ?? null,
      shares7d: e.shares ?? null,
    });
  }

  // Keep most relevant first
  vids.sort((a, b) => Number(b.views7d || 0) - Number(a.views7d || 0));
  return vids;
}

// ---------------------------
// Main KPI compute (optimized w/ Promise.all)
// ---------------------------

async function computeKPIs(env) {
  const token = await getAccessToken(env);

  // Analytics ends at yesterday (stable). Totals (subs/views) are real-time from channels.list.
  const end = shiftDays(new Date(), -1);
  const endIso = isoDate(end);

  // We want 7 blocks of 28 days = 196 days. Start at end-195.
  const dailyStart = isoDate(shiftDays(end, -195));

  // Run the two big base calls in parallel (Data API + Analytics)
  const [ch, daily] = await Promise.all([
    fetchChannelBasics(token),
    fetchDailyCore(token, dailyStart, endIso),
  ]);

  const N = daily.length;

  // Weekly (last 7 days, and previous 7 days)
  const weekSum =
    N >= 7 ? sumDailyRows(daily, N - 7, N - 1) : { views: 0, minutes: 0, gained: 0, lost: 0 };
  const prevWeekSum =
    N >= 14 ? sumDailyRows(daily, N - 14, N - 8) : { views: 0, minutes: 0, gained: 0, lost: 0 };

  const weeklyStart = N >= 7 ? daily[N - 7].day : isoDate(shiftDays(end, -6));
  const prevWeeklyStart = N >= 14 ? daily[N - 14].day : isoDate(shiftDays(end, -13));
  const prevWeeklyEnd = N >= 14 ? daily[N - 8].day : isoDate(shiftDays(end, -7));

  const weeklyPacked = packMetrics(weekSum);
  const prevWeeklyPacked = packMetrics(prevWeekSum);

  // Build 28-day windows from daily array
  const winResults = [];
  for (let i = 0; i < 7; i++) {
    const endIdx = (N - 1) - 28 * i;
    const startIdx = endIdx - 27;
    if (startIdx < 0 || endIdx < 0 || startIdx >= N || endIdx >= N) continue;

    const sum = sumDailyRows(daily, startIdx, endIdx);
    const metrics = packMetrics(sum);

    winResults.push({
      idx: i,
      startDate: daily[startIdx].day,
      endDate: daily[endIdx].day,
      metrics,
    });
  }

  const last28 = winResults.find((x) => x.idx === 0) || { startDate: null, endDate: null, metrics: packMetrics({}) };
  const prev28 = winResults.find((x) => x.idx === 1) || { startDate: null, endDate: null, metrics: packMetrics({}) };
  const prev6 = winResults.filter((x) => x.idx >= 1 && x.idx <= 6);

  const medianSubs = median(prev6.map((w) => w.metrics.netSubs));
  const medianViews = median(prev6.map((w) => w.metrics.views));
  const medianWatch = median(prev6.map((w) => w.metrics.watchHours));

  const avgSubs = avg(prev6.map((w) => w.metrics.netSubs));
  const avgViews = avg(prev6.map((w) => w.metrics.views));
  const avgWatch = avg(prev6.map((w) => w.metrics.watchHours));

  const history28d = [...winResults]
    .sort((a, b) => b.idx - a.idx)
    .map((w) => ({
      startDate: w.startDate,
      endDate: w.endDate,
      netSubs: w.metrics.netSubs,
      views: w.metrics.views,
      watchHours: w.metrics.watchHours,
    }));

  // Dates used by optional “Holy Grail” analytics (channel-level, safe + optional)
  const last28Start = last28.startDate || isoDate(shiftDays(end, -27));
  const prev28Start = prev28.startDate || isoDate(shiftDays(end, -55));
  const prev28End = prev28.endDate || isoDate(shiftDays(end, -28));

  // Kick off independent work in parallel
  const lifeP = fetchLifetimeWatchHours(token, ch.publishedAt, endIso);
  const uploadsP = fetchRecentUploads(token, ch.uploadsPlaylistId, 25);

  const top7P = safeAnalytics(token, {
    startDate: weeklyStart,
    endDate: endIso,
    dimensions: "video",
    metrics: "views",
    sort: "-views",
    maxResults: "1",
  });

  const thumb28P = safeAnalytics(token, {
    startDate: last28Start,
    endDate: endIso,
    metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
  });

  const ret28P = safeAnalytics(token, {
    startDate: last28Start,
    endDate: endIso,
    metrics: "averageViewDuration,averageViewPercentage",
  });

  const uniq28P = safeAnalytics(token, {
    startDate: last28Start,
    endDate: endIso,
    metrics: "uniqueViewers",
  });

  const traffic28P = safeAnalytics(token, {
    startDate: last28Start,
    endDate: endIso,
    dimensions: "insightTrafficSourceType",
    metrics: "views",
    sort: "-views",
    maxResults: "10",
  });

  const trafficPrev28P = safeAnalytics(token, {
    startDate: prev28Start,
    endDate: prev28End,
    dimensions: "insightTrafficSourceType",
    metrics: "views",
    sort: "-views",
    maxResults: "10",
  });

  const subStatus28P = safeAnalytics(token, {
    startDate: last28Start,
    endDate: endIso,
    dimensions: "subscribedStatus",
    metrics: "views",
    sort: "-views",
    maxResults: "5",
  });

  const country28P = safeAnalytics(token, {
    startDate: last28Start,
    endDate: endIso,
    dimensions: "country",
    metrics: "views",
    sort: "-views",
    maxResults: "5",
  });

  // Video-level intel bundle (7D) in parallel too
  const v7dBundleP = fetchVideoAnalytics7dBundle(token, weeklyStart, endIso, 25);

  const [
    life,
    uploads,
    top7Resp,
    thumb28,
    ret28,
    uniq28,
    traffic28,
    trafficPrev28,
    subStatus28,
    country28,
    v7dBundle,
  ] = await Promise.all([
    lifeP,
    uploadsP,
    top7P,
    thumb28P,
    ret28P,
    uniq28P,
    traffic28P,
    trafficPrev28P,
    subStatus28P,
    country28P,
    v7dBundleP,
  ]);

  const latestUpload = uploads[0] || null;

  const top7VideoId = top7Resp?.rows?.[0]?.[0] || null;
  const top7Views = Number(top7Resp?.rows?.[0]?.[1] || 0);

  // Fetch details for recent uploads (+ top video if not already included)
  const videoIds = uniq([...(uploads.map((u) => u.videoId)), top7VideoId]);
  const videoDetails = await fetchVideos(token, videoIds);
  const vidsById = Object.fromEntries(videoDetails.map((v) => [v.videoId, v]));

  const latestVideo = latestUpload?.videoId ? vidsById[latestUpload.videoId] || null : null;
  const top7Video = top7VideoId ? vidsById[top7VideoId] || null : null;

  // 48h-ish (last 2 days) views from daily core
  const v48 = N >= 2 ? Number(daily[N - 1]?.views || 0) + Number(daily[N - 2]?.views || 0) : 0;

  // Build video intel list (top ~25 recent videos + their 7D analytics)
  const videoIntelList = buildVideoIntelList(videoDetails, v7dBundle, endIso);

  // Pack HUD extras (keeps old shape; adds "videoIntel")
  const hud = {
    statsThrough: endIso,

    uploads: {
      latest: latestUpload
        ? {
            videoId: latestUpload.videoId,
            publishedAt: latestUpload.publishedAt,
            title: latestUpload.title || (latestVideo?.title || ""),
          }
        : null,
      recent: uploads,
    },

    latestVideo: latestVideo
      ? {
          videoId: latestVideo.videoId,
          title: latestVideo.title,
          publishedAt: latestVideo.publishedAt,
          views: latestVideo.views,
          likes: latestVideo.likes,
          comments: latestVideo.comments,
          duration: latestVideo.duration,
          durationSec: latestVideo.durationSec,
        }
      : null,

    topVideo7d: top7VideoId
      ? {
          videoId: top7VideoId,
          title: top7Video?.title || "",
          views: top7Views,
        }
      : null,

    thumb28: thumb28?.rows?.[0]
      ? {
          impressions: Number(thumb28.rows[0][0] || 0),
          ctr: Number(thumb28.rows[0][1] || 0), // percent
        }
      : null,

    retention28: ret28?.rows?.[0]
      ? {
          avgViewDurationSec: Number(ret28.rows[0][0] || 0),
          avgViewPercentage: Number(ret28.rows[0][1] || 0),
        }
      : null,

    uniqueViewers28: Number(uniq28?.rows?.[0]?.[0] || 0) || null,

    traffic: {
      last28: traffic28 ? rowsToDimList(traffic28, "insightTrafficSourceType", "views") : null,
      prev28: trafficPrev28 ? rowsToDimList(trafficPrev28, "insightTrafficSourceType", "views") : null,
    },

    subscribedStatus: subStatus28 ? rowsToDimList(subStatus28, "subscribedStatus", "views") : null,
    countries: country28 ? rowsToDimList(country28, "country", "views") : null,

    views48h: v48,

    // ready for 26+ video-specific HUD insights
    videoIntel: {
      range7d: { startDate: weeklyStart, endDate: endIso },
      count: videoIntelList.length,
      dataOk: v7dBundle.rawOk,
      videos: videoIntelList,
    },
  };

  return {
    channel: ch,

    weekly: {
      startDate: weeklyStart,
      endDate: endIso,

      netSubs: weeklyPacked.netSubs,
      views: weeklyPacked.views,
      watchHours: weeklyPacked.watchHours,

      // extra (HUD uses)
      subscribersGained: weeklyPacked.gained,
      subscribersLost: weeklyPacked.lost,
      minutesWatched: weeklyPacked.minutes,

      prevNetSubs: prevWeeklyPacked.netSubs,
      prevViews: prevWeeklyPacked.views,
      prevWatchHours: prevWeeklyPacked.watchHours,
      prevSubscribersGained: prevWeeklyPacked.gained,
      prevSubscribersLost: prevWeeklyPacked.lost,
      prevMinutesWatched: prevWeeklyPacked.minutes,

      prevStartDate: prevWeeklyStart,
      prevEndDate: prevWeeklyEnd,
    },

    m28: {
      last28: {
        netSubs: last28.metrics.netSubs,
        views: last28.metrics.views,
        watchHours: last28.metrics.watchHours,
      },
      prev28: {
        netSubs: prev28.metrics.netSubs,
        views: prev28.metrics.views,
        watchHours: prev28.metrics.watchHours,
      },
      avg6m: {
        netSubs: avgSubs,
        views: avgViews,
        watchHours: avgWatch,
      },
      median6m: {
        netSubs: medianSubs,
        views: medianViews,
        watchHours: medianWatch,
      },
    },

    lifetime: {
      watchHours: life.totalHours,
    },

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

    const res = Response.json(data, {
      headers: { "Cache-Control": "public, max-age=55" },
    });

    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
