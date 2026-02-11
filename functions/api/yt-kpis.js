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
  const prevWeeklyStart = N >= 14 ? daily[N - 14].day : isoDate(shiftDays(end, -13));
  const prevWeeklyEnd = N >= 14 ? daily[N - 8].day : isoDate(shiftDays(end, -7));
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
    views48h: N >= 2 ? Number(daily[N - 1]?.views || 0) + Number(daily[N - 2]?.views || 0) : 0,
    videoIntel: { range7d: { startDate: weeklyStart, endDate: endIso }, videos: videoIntelList },
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
