/* =========================================================
   functions/api/yt-kpis.js — Server KPI aggregator
   Features:
   - Deep Forensic Analytics (Devices, Search Terms, Video Specifics)
   - Realtime 48h Estimates
   - Backward compatibility for existing UI Cards
   ========================================================= */

// --- UTILITIES ---
function isoDate(d) { return d.toISOString().slice(0, 10); }
function shiftDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function round1(n) { return Math.round(Number(n || 0) * 10) / 10; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))]; }

async function safeReadJson(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

function median(nums) {
  const arr = (nums || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function avg(nums) {
  const arr = (nums || []).map(Number).filter(Number.isFinite);
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function parseISODurationToSeconds(isoDur) {
  if (!isoDur || typeof isoDur !== "string") return null;
  const m = isoDur.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  return (Number(m[1]||0) * 3600) + (Number(m[2]||0) * 60) + Number(m[3]||0);
}

// --- AUTHENTICATION ---
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

// --- API WRAPPERS ---
async function ytGet(token, url, params = {}) {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, String(v)); });
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const data = await safeReadJson(r);
  if (!r.ok) throw new Error(`YT API Error ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

async function ytAnalytics(token, params) { return ytGet(token, "https://youtubeanalytics.googleapis.com/v2/reports", { ids: "channel==MINE", ...params }); }
async function ytData(token, path, params) { return ytGet(token, `https://www.googleapis.com/youtube/v3/${path}`, params); }

// Safe wrapper for optional reports (like revenue) that might fail
async function safeAnalytics(token, params) {
  try {
    return await ytAnalytics(token, params);
  } catch (e) {
    // console.warn("Analytics fetch failed (optional):", params, e);
    return null; 
  }
}

// --- DATA FETCHING ---
async function fetchChannelBasics(token) {
  const data = await ytData(token, "channels", { part: "snippet,statistics,contentDetails", mine: "true" });
  const ch = data.items?.[0];
  return {
    channelId: ch?.id,
    title: ch?.snippet?.title,
    publishedAt: ch?.snippet?.publishedAt,
    logo: ch?.snippet?.thumbnails?.medium?.url,
    uploadsPlaylistId: ch?.contentDetails?.relatedPlaylists?.uploads,
    subscribers: Number(ch?.statistics?.subscriberCount || 0),
    totalViews: Number(ch?.statistics?.viewCount || 0),
    videoCount: Number(ch?.statistics?.videoCount || 0)
  };
}

async function fetchDailyCore(token, startIso, endIso) {
  const data = await safeAnalytics(token, {
    startDate: startIso, endDate: endIso, dimensions: "day", sort: "day",
    metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue,averageViewDuration",
    maxResults: 500
  });
  return (data?.rows || []).map(r => ({
    day: r[0], 
    views: Number(r[1]||0), 
    minutes: Number(r[2]||0),
    gained: Number(r[3]||0), 
    lost: Number(r[4]||0),
    revenue: Number(r[5]||0),
    avd: Number(r[6]||0)
  }));
}

// --- DEEP FORENSICS ---
async function fetchDeepInsights(token, start28, endIso) {
  // Parallel execution for speed
  const [
    trafficSearch, trafficExt, device,
    topVidsViews, topVidsSubs, topVidsRev, topVidsRetention
  ] = await Promise.all([
    // 1. Top Search Terms
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "insightTrafficSourceDetail", filters: "insightTrafficSourceType==YT_SEARCH", metrics: "views", sort: "-views", maxResults: 10 }),
    // 2. Top External Sites
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "insightTrafficSourceDetail", filters: "insightTrafficSourceType==EXT_URL", metrics: "views", sort: "-views", maxResults: 5 }),
    // 3. Device Types (Mobile/TV/Desktop)
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "deviceType", metrics: "views", sort: "-views" }),
    // 4. Video Leaders (Views/Engagement)
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "video", metrics: "views,likes,shares,comments", sort: "-views", maxResults: 10 }),
    // 5. Video Magnets (Subs)
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "video", metrics: "subscribersGained,subscribersLost", sort: "-subscribersGained", maxResults: 5 }),
    // 6. Video Revenue (if monetized)
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "video", metrics: "estimatedRevenue", sort: "-estimatedRevenue", maxResults: 5 }),
    // 7. Video Retention Leaders
    safeAnalytics(token, { startDate: start28, endDate: endIso, dimensions: "video", metrics: "averageViewPercentage,averageViewDuration", sort: "-averageViewPercentage", maxResults: 10 })
  ]);

  return {
    search: (trafficSearch?.rows || []).map(r => ({ term: r[0], views: r[1] })),
    external: (trafficExt?.rows || []).map(r => ({ site: r[0], views: r[1] })),
    devices: (device?.rows || []).map(r => ({ type: r[0], views: r[1] })),
    videos: {
      byViews: (topVidsViews?.rows || []).map(r => ({ id: r[0], views: r[1], likes: r[2], shares: r[3], comments: r[4] })),
      bySubs: (topVidsSubs?.rows || []).map(r => ({ id: r[0], gained: r[1], lost: r[2] })),
      byRevenue: (topVidsRev?.rows || []).map(r => ({ id: r[0], revenue: r[1] })),
      byRetention: (topVidsRetention?.rows || []).map(r => ({ id: r[0], pct: r[1], dur: r[2] }))
    }
  };
}

async function fetchVideoDetails(token, videoIds) {
  const ids = uniq(videoIds).slice(0, 50);
  if (!ids.length) return {};
  const data = await ytData(token, "videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") });
  const map = {};
  (data.items || []).forEach(v => {
    map[v.id] = {
      title: v.snippet?.title || "",
      publishedAt: v.snippet?.publishedAt || "",
      duration: v.contentDetails?.duration || "",
      durationSec: parseISODurationToSeconds(v.contentDetails?.duration),
      thumb: v.snippet?.thumbnails?.medium?.url
    };
  });
  return map;
}

function sumDailyRows(rows, startIdx, endIdx) {
  const out = { views: 0, minutes: 0, gained: 0, lost: 0, revenue: 0 };
  const a = clamp(startIdx, 0, rows.length - 1);
  const b = clamp(endIdx, 0, rows.length - 1);
  for (let i = a; i <= b; i++) {
    out.views += Number(rows[i].views || 0);
    out.minutes += Number(rows[i].minutes || 0);
    out.gained += Number(rows[i].gained || 0);
    out.lost += Number(rows[i].lost || 0);
    out.revenue += Number(rows[i].revenue || 0);
  }
  return out;
}

function packMetrics(sum) {
  return {
    views: sum.views,
    watchHours: round1(sum.minutes / 60),
    netSubs: sum.gained - sum.lost,
    revenue: round1(sum.revenue)
  };
}

// --- MAIN AGGREGATOR ---
async function computeKPIs(env) {
  const token = await getAccessToken(env);
  const ch = await fetchChannelBasics(token);
  
  const today = new Date();
  const end = shiftDays(today, -1); // YT stats delay
  const endIso = isoDate(end);
  const startDaily = isoDate(shiftDays(end, -195));
  const start28 = isoDate(shiftDays(end, -30));

  // 1. Daily Core Series
  const daily = await fetchDailyCore(token, startDaily, endIso);
  
  // 2. Deep Insights (Forensics)
  const insights = await fetchDeepInsights(token, start28, endIso);

  // 3. Resolve Video Details
  const vidIds = new Set();
  Object.values(insights.videos).forEach(list => list.forEach(v => vidIds.add(v.id)));
  
  const recentRaw = await ytData(token, "playlistItems", { playlistId: ch.uploadsPlaylistId, part: "snippet,contentDetails", maxResults: 10 });
  const recent = (recentRaw.items || []).map(i => ({
    id: i.contentDetails?.videoId,
    title: i.snippet?.title,
    publishedAt: i.contentDetails?.videoPublishedAt
  }));
  recent.forEach(v => vidIds.add(v.id));

  const vidMap = await fetchVideoDetails(token, Array.from(vidIds));

  // 4. Build Forensics Structure
  const forensics = {
    search: insights.search,
    external: insights.external,
    devices: insights.devices,
    heroes: {
      views: insights.videos.byViews.map(v => ({ ...v, ...vidMap[v.id] })),
      subs: insights.videos.bySubs.map(v => ({ ...v, ...vidMap[v.id] })),
      revenue: insights.videos.byRevenue.map(v => ({ ...v, ...vidMap[v.id] })),
      retention: insights.videos.byRetention.map(v => ({ ...v, ...vidMap[v.id] }))
    },
    recentUploads: recent.map(v => ({ ...v, ...vidMap[v.id] }))
  };

  // 5. Windows (For Legacy Cards)
  const N = daily.length;
  const weekSum = N >= 7 ? sumDailyRows(daily, N - 7, N - 1) : {};
  const prevWeekSum = N >= 14 ? sumDailyRows(daily, N - 14, N - 8) : {};
  const weekly = { 
    netSubs: weekSum.gained - weekSum.lost, views: weekSum.views, watchHours: round1(weekSum.minutes/60),
    prevNetSubs: prevWeekSum.gained - prevWeekSum.lost, prevViews: prevWeekSum.views, prevWatchHours: round1(prevWeekSum.minutes/60)
  };

  const winResults = [];
  for (let i = 0; i < 7; i++) {
    const endIdx = (N - 1) - 28 * i;
    const startIdx = endIdx - 27;
    if (startIdx >= 0) winResults.push({ idx: i, metrics: packMetrics(sumDailyRows(daily, startIdx, endIdx)) });
  }
  
  const last28 = winResults[0]?.metrics || {};
  const prev28 = winResults[1]?.metrics || {};
  const prev6 = winResults.slice(1, 7);
  
  const m28 = {
    last28, prev28,
    avg6m: { netSubs: avg(prev6.map(w=>w.metrics.netSubs)), views: avg(prev6.map(w=>w.metrics.views)), watchHours: avg(prev6.map(w=>w.metrics.watchHours)) },
    median6m: { netSubs: median(prev6.map(w=>w.metrics.netSubs)), views: median(prev6.map(w=>w.metrics.views)), watchHours: median(prev6.map(w=>w.metrics.watchHours)) }
  };

  // 6. Realtime Simulation
  const lastDay = daily[N - 1] || {};
  const prevDay = daily[N - 2] || {};
  const views48h = (lastDay.views || 0) + (prevDay.views || 0);
  const sevenDaySlice = daily.slice(-7);
  const avgPrior6d = sevenDaySlice.length ? (sevenDaySlice.reduce((a,b)=>a+(b.views||0),0) - lastDay.views) / 6 : 0;

  const realtime = {
    views48h,
    last24h: lastDay.views,
    prev24h: prevDay.views,
    lastHour: Math.round(lastDay.views / 24),
    prevHour: Math.round(prevDay.views / 24),
    avgPrior6d: round1(avgPrior6d),
    vs7dAvgDelta: round1(lastDay.views - avgPrior6d),
    sparkline: sevenDaySlice.map(r => r.views)
  };

  const life = await fetchLifetimeWatchHours(token, ch.publishedAt, endIso);

  return {
    channel: ch,
    weekly,
    m28,
    realtime,
    lifetime: { watchHours: life.totalHours },
    history28d: winResults.map(w => w.metrics), 
    // Deep data for the new HUD
    forensics,
    dailySeries: daily
  };
}

export async function onRequest(context) {
  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL(context.request.url).toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const data = await computeKPIs(context.env);
    const res = Response.json(data, { headers: { "Cache-Control": "public, max-age=120" } });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
