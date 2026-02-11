// functions/api/yt-kpis.js
// Adds: richer HUD + video-level intel (recent uploads + per-video 7D analytics) without breaking top 3 cards data shape.

const REQUIRED_ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
const CHANNEL_CACHE_TTL = 60 * 1000;
const UPLOADS_CACHE_TTL = 60 * 1000;

const channelCache = { data: null, expires: 0 };
const uploadsCache = new Map();

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
  const arr = (nums || [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
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
    return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function safeReadJson(response) {
  const txt = await response.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch (err) {
    console.error("safeReadJson: invalid JSON", {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      sample: txt.slice(0, 300),
    });
    throw new Error("Upstream returned invalid JSON");
  }
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

// ISO 8601 duration like "PT1H2M3S" -> seconds
function parseISODurationToSeconds(isoDur) {
  if (!isoDur || typeof isoDur !== "string") return 0;
  const m = isoDur.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + mm * 60 + s;
}

function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return round1(x);
}

function safeDiv(a, b) {
  const A = Number(a || 0);
  const B = Number(b || 0);
  if (!B) return 0;
  return A / B;
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
  if (!data.access_token) {
    const err = new Error("Failed to obtain access token");
    err.statusCode = r.status || 500;
    err.details = data;
    throw err;
  }
  return data.access_token;
}

async function ytDataGET(token, path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await safeReadJson(r);
  if (!r.ok) {
    const err = new Error(`YouTube Data API error (${r.status})`);
    err.statusCode = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function ytAnalyticsGET(token, params = {}) {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", "channel==MINE");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await safeReadJson(r);
  if (!r.ok) {
    const err = new Error(`YouTube Analytics API error (${r.status})`);
    err.statusCode = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function safeAnalytics(token, params) {
  try {
    return await ytAnalyticsGET(token, params);
  } catch (err) {
    console.warn("safeAnalytics failure", { params, message: err.message });
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

  const uploadsPlaylistId = ch?.contentDetails?.relatedPlaylists?.uploads || "";

  return {
    channelId: ch?.id || null,
    title: ch?.snippet?.title || "",
    publishedAt: ch?.snippet?.publishedAt || null,
    logo,
    uploadsPlaylistId,
    subscribers: Number(ch?.statistics?.subscriberCount || 0),
    totalViews: Number(ch?.statistics?.viewCount || 0),
  };
}

async function fetchChannelBasicsCached(token) {
  const now = Date.now();
  if (channelCache.data && channelCache.expires > now) {
    return channelCache.data;
  }
  const data = await fetchChannelBasics(token);
  channelCache.data = data;
  channelCache.expires = now + CHANNEL_CACHE_TTL;
  return data;
}

async function fetchRecentUploads(token, uploadsPlaylistId, maxResults = 25) {
  if (!uploadsPlaylistId) return [];
  const cacheKey = `${uploadsPlaylistId}:${maxResults}`;
  const cached = uploadsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const data = await ytDataGET(token, "playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(clamp(maxResults, 1, 50)),
  });

  const items = data.items || [];
  const out = items
    .map((it) => ({
      videoId: it?.contentDetails?.videoId || null,
      publishedAt: it?.contentDetails?.videoPublishedAt || it?.snippet?.publishedAt || null,
      title: it?.snippet?.title || "",
    }))
    .filter((x) => x.videoId);

  uploadsCache.set(cacheKey, { data: out, expires: now + UPLOADS_CACHE_TTL });
  return out;
}

async function fetchVideos(token, ids = []) {
  const idList = uniq(ids);
  if (!idList.length) return [];
  const chunks = [];
  for (let i = 0; i < idList.length; i += 50) {
    const chunkIds = idList.slice(i, i + 50);
    const data = await ytDataGET(token, "videos", {
      part: "snippet,statistics,contentDetails",
      id: chunkIds.join(","),
    });
    chunks.push(
      (data.items || []).map((v) => ({
        videoId: v?.id || null,
        title: v?.snippet?.title || "",
        publishedAt: v?.snippet?.publishedAt || null,
        views: Number(v?.statistics?.viewCount || 0),
        likes: Number(v?.statistics?.likeCount || 0),
        comments: Number(v?.statistics?.commentCount || 0),
        duration: v?.contentDetails?.duration || null,
        durationSec: parseISODurationToSeconds(v?.contentDetails?.duration || null),
      }))
    );
  }
  return chunks.flat().filter((x) => x.videoId);
}

function buildDailyPrefix(rows) {
  const prefix = {
    views: [0],
    minutes: [0],
    gained: [0],
    lost: [0],
  };
  rows.forEach((row, idx) => {
    prefix.views[idx + 1] = prefix.views[idx] + Number(row.views || 0);
    prefix.minutes[idx + 1] = prefix.minutes[idx] + Number(row.minutes || 0);
    prefix.gained[idx + 1] = prefix.gained[idx] + Number(row.gained || 0);
    prefix.lost[idx + 1] = prefix.lost[idx] + Number(row.lost || 0);
  });
  return prefix;
}

function sumDailyRows(prefix, startIdx, endIdx) {
  if (!prefix) return { views: 0, minutes: 0, gained: 0, lost: 0 };
  const a = clamp(startIdx, 0, prefix.views.length - 2);
  const b = clamp(endIdx, a, prefix.views.length - 2);
  return {
    views: prefix.views[b + 1] - prefix.views[a],
    minutes: prefix.minutes[b + 1] - prefix.minutes[a],
    gained: prefix.gained[b + 1] - prefix.gained[a],
    lost: prefix.lost[b + 1] - prefix.lost[a],
  };
}

function packMetrics(sum) {
  const views = Number(sum.views || 0);
  const minutes = Number(sum.minutes || 0);
  const gained = Number(sum.gained || 0);
  const lost = Number(sum.lost || 0);
  return {
    views,
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

  const rows = (data.rows || []).map((r) => ({
    day: r[0],
    views: Number(r[1] || 0),
    minutes: Number(r[2] || 0),
    gained: Number(r[3] || 0),
    lost: Number(r[4] || 0),
  }));

  return rows;
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
  const rows = resp?.rows || [];
  return rows.map((r) => ({
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
    const [videoId, ...metrics] = r;
    if (!videoId) continue;
    const entry = out[videoId] || {};
    metricKeys.forEach((key, idx) => {
      entry[key] = Number(metrics[idx] || 0);
    });
    out[videoId] = entry;
  }
  return out;
}

async function fetchVideoAnalytics7dBundle(token, startIso, endIso, maxResults = 25) {
  const safeArgs = (metrics) => ({
    startDate: startIso,
    endDate: endIso,
    dimensions: "video",
    metrics,
    sort: "-views",
    maxResults: String(clamp(maxResults, 1, 50)),
  });

  const [base, retention, thumbs, engage] = await Promise.all([
    safeAnalytics(token, safeArgs("views,estimatedMinutesWatched,subscribersGained,subscribersLost")),
    safeAnalytics(token, safeArgs("averageViewDuration,averageViewPercentage")),
    safeAnalytics(token, safeArgs("videoThumbnailImpressions,videoThumbnailImpressionsClickRate")),
    safeAnalytics(token, safeArgs("likes,comments,shares")),
  ]);

  return {
    baseMap: parseVideoRows(base, ["views7d", "minutes7d", "subsGained7d", "subsLost7d"]),
    retentionMap: parseVideoRows(retention, ["avgViewDurationSec7d", "avgViewPercentage7d"]),
    thumbsMap: parseVideoRows(thumbs, ["impressions7d", "ctr7d"]),
    engageMap: parseVideoRows(engage, ["likes7d", "comments7d", "shares7d"]),
    rawOk: {
      base: !!base,
      retention: !!retention,
      thumbs: !!thumbs,
      engage: !!engage,
    },
  };
}

function buildVideoIntelList(videoDetails, maps, endIso) {
  const vids = (videoDetails || []).slice(0, 50);
  const out = [];

  for (const v of vids) {
    const id = v.videoId;
    if (!id) continue;
    const entry = {
      videoId: id,
      title: v.title,
      publishedAt: v.publishedAt,
      duration: v.duration,
      durationSec: v.durationSec,
      lifetimeViews: v.views,
      lifetimeLikes: v.likes,
      lifetimeComments: v.comments,
      reportThrough: endIso,
    };

    const base = maps.baseMap[id];
    if (base) {
      entry.views7d = Number(base.views7d || 0);
      entry.minutes7d = Number(base.minutes7d || 0);
      entry.watchHours7d = round1((base.minutes7d || 0) / 60);
      entry.subsGained7d = Number(base.subsGained7d || 0);
      entry.subsLost7d = Number(base.subsLost7d || 0);
      entry.netSubs7d = entry.subsGained7d - entry.subsLost7d;
    }

    const retention = maps.retentionMap[id];
    if (retention) {
      entry.avgViewDurationSec7d = Number(retention.avgViewDurationSec7d || 0);
      entry.avgViewPercentage7d = pct(retention.avgViewPercentage7d || 0);
    }

    const thumbs = maps.thumbsMap[id];
    if (thumbs) {
      entry.thumbnailImpressions7d = Number(thumbs.impressions7d || 0);
      entry.thumbnailCtr7d = pct(thumbs.ctr7d || 0);
    }

    const engage = maps.engageMap[id];
    if (engage) {
      entry.likes7d = Number(engage.likes7d || 0);
      entry.comments7d = Number(engage.comments7d || 0);
      entry.shares7d = Number(engage.shares7d || 0);
    }

    out.push(entry);
  }

  out.sort((a, b) => (b.views7d || 0) - (a.views7d || 0));
  return out;
}

function selectTop(rows, limit = 10) {
  return (rows || []).slice(0, limit);
}

function assertEnv(env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length) {
    const err = new Error(`Missing required environment variables: ${missing.join(", ")}`);
    err.statusCode = 500;
    throw err;
  }
}

function buildWeeklySummary(dailyRows, prefix, endIso) {
  const N = dailyRows.length;
  const weekSum = N >= 7 ? sumDailyRows(prefix, N - 7, N - 1) : { views: 0, minutes: 0, gained: 0, lost: 0 };
  const prevWeekSum = N >= 14 ? sumDailyRows(prefix, N - 14, N - 8) : { views: 0, minutes: 0, gained: 0, lost: 0 };

  const weeklyPacked = packMetrics(weekSum);
  const prevWeeklyPacked = packMetrics(prevWeekSum);

  const latestDay = dailyRows[N - 1]?.day || endIso;
  const prevWeekEndIdx = N >= 14 ? N - 8 : N - 1;
  const prevWeekEnd = dailyRows[clamp(prevWeekEndIdx, 0, N - 1)]?.day || endIso;
  const weeklyStart = N >= 7 ? dailyRows[N - 7]?.day || isoDate(shiftDays(new Date(endIso), -6)) : isoDate(shiftDays(new Date(endIso), -6));
  const prevWeeklyStart = N >= 14 ? dailyRows[N - 14]?.day || isoDate(shiftDays(new Date(endIso), -13)) : isoDate(shiftDays(new Date(endIso), -13));

  return {
    weeklyPacked,
    prevWeeklyPacked,
    summary: {
      views: weeklyPacked.views,
      prevViews: prevWeeklyPacked.views,
      watchHours: weeklyPacked.watchHours,
      prevWatchHours: prevWeeklyPacked.watchHours,
      netSubs: weeklyPacked.netSubs,
      prevNetSubs: prevWeeklyPacked.netSubs,
      minutesWatched: weekSum.minutes,
      prevMinutesWatched: prevWeekSum.minutes,
      subscribersGained: weekSum.gained,
      subscribersLost: weekSum.lost,
      prevSubscribersGained: prevWeekSum.gained,
      prevSubscribersLost: prevWeekSum.lost,
      startDate: weeklyStart,
      prevStartDate: prevWeeklyStart,
      endDate: latestDay,
      prevEndDate: prevWeekEnd,
    },
  };
}

function buildWindowHistory(dailyRows, prefix) {
  const windows = [];
  const N = dailyRows.length;
  for (let idx = 0; idx < 7; idx++) {
    const endIdx = N - 1 - idx * 28;
    const startIdx = endIdx - 27;
    if (startIdx < 0 || endIdx < 0) break;
    const sum = sumDailyRows(prefix, startIdx, endIdx);
    const metrics = packMetrics(sum);
    windows.push({
      idx,
      startDate: dailyRows[startIdx].day,
      endDate: dailyRows[endIdx].day,
      metrics,
    });
  }
  return windows;
}

async function computeKPIs(env) {
  assertEnv(env);
  const token = await getAccessToken(env);
  const channel = await fetchChannelBasicsCached(token);

  const end = shiftDays(new Date(), -1);
  const endIso = isoDate(end);
  const dailyStart = isoDate(shiftDays(end, -195));

  const [dailyRows, lifetimePromise, uploadsPromise] = await Promise.all([
    fetchDailyCore(token, dailyStart, endIso),
    fetchLifetimeWatchHours(token, channel.publishedAt, endIso),
    fetchRecentUploads(token, channel.uploadsPlaylistId, 25),
  ]);

  const prefix = buildDailyPrefix(dailyRows);
  const N = dailyRows.length;

  const { weeklyPacked, prevWeeklyPacked, summary } = buildWeeklySummary(dailyRows, prefix, endIso);
  const historyWindows = buildWindowHistory(dailyRows, prefix);

  const last28 = historyWindows.find((x) => x.idx === 0)?.metrics || packMetrics({});
  const prev28 = historyWindows.find((x) => x.idx === 1)?.metrics || packMetrics({});
  const prevSix = historyWindows.filter((x) => x.idx >= 1 && x.idx <= 6).map((x) => x.metrics);

  const medianSubs = median(prevSix.map((w) => w.netSubs));
  const medianViews = median(prevSix.map((w) => w.views));
  const medianWatch = median(prevSix.map((w) => w.watchHours));

  const avgSubs = avg(prevSix.map((w) => w.netSubs));
  const avgViews = avg(prevSix.map((w) => w.views));
  const avgWatch = avg(prevSix.map((w) => w.watchHours));

  const history28d = [...historyWindows]
    .sort((a, b) => b.idx - a.idx)
    .map((w) => ({
      startDate: w.startDate,
      endDate: w.endDate,
      netSubs: w.metrics.netSubs,
      views: w.metrics.views,
      watchHours: w.metrics.watchHours,
    }));

  const lifetime = await lifetimePromise;
  const uploads = await uploadsPromise;
  const latestUpload = uploads[0] || null;

  const weeklyStart = summary.startDate;
  const top7Resp = await safeAnalytics(token, {
    startDate: weeklyStart,
    endDate: endIso,
    dimensions: "video",
    metrics: "views",
    sort: "-views",
    maxResults: "1",
  });
  const top7VideoId = top7Resp?.rows?.[0]?.[0] || null;
  const top7Views = Number(top7Resp?.rows?.[0]?.[1] || 0);

  const videoIds = uniq([...(uploads.map((u) => u.videoId)), top7VideoId]);
  const videoDetails = await fetchVideos(token, videoIds);
  const vidsById = Object.fromEntries(videoDetails.map((v) => [v.videoId, v]));
  const latestVideo = latestUpload?.videoId ? vidsById[latestUpload.videoId] || null : null;
  const top7Video = top7VideoId ? vidsById[top7VideoId] || null : null;

  const last28Start = historyWindows.find((x) => x.idx === 0)?.startDate || isoDate(shiftDays(end, -27));
  const prev28Start = historyWindows.find((x) => x.idx === 1)?.startDate || isoDate(shiftDays(end, -55));
  const prev28End = historyWindows.find((x) => x.idx === 1)?.endDate || isoDate(shiftDays(end, -28));

  const [thumb28, ret28, uniq28, traffic28, trafficPrev28, subStatus28, country28] = await Promise.all([
    safeAnalytics(token, {
      startDate: last28Start,
      endDate: endIso,
      metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
    }),
    safeAnalytics(token, {
      startDate: last28Start,
      endDate: endIso,
      metrics: "averageViewDuration,averageViewPercentage",
    }),
    safeAnalytics(token, {
      startDate: last28Start,
      endDate: endIso,
      metrics: "uniqueViewers",
    }),
    safeAnalytics(token, {
      startDate: last28Start,
      endDate: endIso,
      dimensions: "insightTrafficSourceType",
      metrics: "views",
      sort: "-views",
      maxResults: "10",
    }),
    safeAnalytics(token, {
      startDate: prev28Start,
      endDate: prev28End,
      dimensions: "insightTrafficSourceType",
      metrics: "views",
      sort: "-views",
      maxResults: "10",
    }),
    safeAnalytics(token, {
      startDate: last28Start,
      endDate: endIso,
      dimensions: "subscribedStatus",
      metrics: "views",
      sort: "-views",
      maxResults: "5",
    }),
    safeAnalytics(token, {
      startDate: last28Start,
      endDate: endIso,
      dimensions: "country",
      metrics: "views",
      sort: "-views",
      maxResults: "5",
    }),
  ]);

  const v48 = N >= 2 ? Number(dailyRows[N - 1]?.views || 0) + Number(dailyRows[N - 2]?.views || 0) : (dailyRows[0]?.views || 0);

  const v7dBundle = await fetchVideoAnalytics7dBundle(token, weeklyStart, endIso, 25);
  const videoIntelList = buildVideoIntelList(videoDetails, v7dBundle, endIso);

  const hudPayload = {
    statsThrough: endIso,
    uploads: {
      latest: latestUpload,
      recent: uploads.slice(0, 10),
    },
    latestVideo: latestVideo ? { ...latestVideo } : null,
    topVideo7d: top7VideoId ? { ...(top7Video || {}), views: top7Views, videoId: top7VideoId } : null,
    thumb28: thumb28 ? {
      impressions: Number(thumb28.rows?.[0]?.[0] || 0),
      ctr: pct(thumb28.rows?.[0]?.[1] || 0),
    } : null,
    retention28: ret28 ? {
      avgViewDurationSec: Number(ret28.rows?.[0]?.[0] || 0),
      avgViewPercentage: pct(ret28.rows?.[0]?.[1] || 0),
    } : null,
    uniqueViewers28: uniq28 ? Number(uniq28.rows?.[0]?.[0] || 0) : null,
    traffic: {
      last28: selectTop(rowsToDimList(traffic28, "trafficSource", "views"), 10),
      prev28: selectTop(rowsToDimList(trafficPrev28, "trafficSource", "views"), 10),
    },
    subscribedStatus: selectTop(rowsToDimList(subStatus28, "subscribedStatus", "views"), 5),
    countries: selectTop(rowsToDimList(country28, "country", "views"), 5),
    views48h: v48,
    videoIntel: videoIntelList,
  };

  return {
    channel,
    lifetime,
    weekly: {
      ...summary,
    },
    weeklyStart,
    m28: {
      last28,
      prev28,
      median6m: {
        netSubs: medianSubs,
        views: medianViews,
        watchHours: medianWatch,
      },
      avg6m: {
        netSubs: avgSubs,
        views: avgViews,
        watchHours: avgWatch,
      },
    },
    history28d,
    hud: hudPayload,
  };
}

export async function onRequest(context) {
  try {
    const data = await computeKPIs(context.env || {});
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    console.error("computeKPIs error", err);
    const status = err.statusCode || 500;
    return new Response(JSON.stringify({ error: err.message || "Internal Error" }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
