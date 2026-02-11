// functions/api/yt-kpis.js
// Weekly is ONLY for "This week:" line.
// Monthly focus (28D windows) for: Last28 / Prev28 / vs Last 6M Avg / Feedback / Sparkline / Main Symbol.
// Uses edge cache (~55s) so 1-min refresh is safe.

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
  const arr = (nums || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
}

function avg(nums) {
  const arr = (nums || []).map(Number).filter(Number.isFinite);
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

function safeStartDateFromPublishedAt(publishedAt) {
  if (!publishedAt) return "2006-01-01";
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return "2006-01-01";
  const iso = isoDate(d);
  return iso < "2006-01-01" ? "2006-01-01" : iso;
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

  const data = await r.json();
  if (!data.access_token) throw new Error(JSON.stringify(data));
  return data.access_token;
}

async function fetchChannelBasics(token) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("mine", "true");

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  const ch = data.items?.[0];

  const thumbs = ch?.snippet?.thumbnails || {};
  const logo = thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || "";

  return {
    channelId: ch?.id || null,
    title: ch?.snippet?.title || "",
    publishedAt: ch?.snippet?.publishedAt || null,
    logo,
    subscribers: Number(ch?.statistics?.subscriberCount || 0),
    totalViews: Number(ch?.statistics?.viewCount || 0),
  };
}

async function fetchAnalyticsRange(token, startDate, endDate) {
  const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  q.searchParams.set("ids", "channel==MINE");
  q.searchParams.set("startDate", startDate);
  q.searchParams.set("endDate", endDate);
  q.searchParams.set("metrics", "views,estimatedMinutesWatched,subscribersGained,subscribersLost");

  const r = await fetch(q.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();

  const row = data.rows?.[0] || [0, 0, 0, 0];
  const views = Number(row[0] || 0);
  const minutes = Number(row[1] || 0);
  const gained = Number(row[2] || 0);
  const lost = Number(row[3] || 0);

  return {
    views,
    watchHours: round1(minutes / 60),
    netSubs: gained - lost,
  };
}

function build28dWindows(endDateObj) {
  // 7 windows:
  // idx0 = last28 (ends yesterday)
  // idx1 = prev28, ...
  // idx6 = prev6
  const windows = [];
  for (let i = 0; i < 7; i++) {
    const end_i = shiftDays(endDateObj, -28 * i);
    const start_i = shiftDays(end_i, -27);
    windows.push({
      idx: i,
      startDate: isoDate(start_i),
      endDate: isoDate(end_i),
    });
  }
  return windows; // newest-first
}

async function fetchLifetimeWatchHours(token, publishedAt, endIso) {
  const startIso = safeStartDateFromPublishedAt(publishedAt);
  const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  q.searchParams.set("ids", "channel==MINE");
  q.searchParams.set("startDate", startIso);
  q.searchParams.set("endDate", endIso);
  q.searchParams.set("metrics", "estimatedMinutesWatched");

  const r = await fetch(q.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  const minutes = Number(data.rows?.[0]?.[0] || 0);
  return { startIso, totalHours: round1(minutes / 60) };
}

async function computeKPIs(env) {
  const token = await getAccessToken(env);
  const ch = await fetchChannelBasics(token);

  // Use yesterday as end for both weekly + monthly to avoid partial "today"
  const end = shiftDays(new Date(), -1);
  const endIso = isoDate(end);

  // Weekly (7 days ending yesterday)
  const weekStart = isoDate(shiftDays(end, -6));
  const weekEnd = endIso;
  const weekly = await fetchAnalyticsRange(token, weekStart, weekEnd);

  // Monthly 28D windows (7 points for trend)
  const windows = build28dWindows(end); // idx0..idx6 newest-first

  const winResults = await Promise.all(
    windows.map((w) =>
      fetchAnalyticsRange(token, w.startDate, w.endDate).then((m) => ({
        ...w,
        metrics: m,
      }))
    )
  );

  const last28 = winResults.find((x) => x.idx === 0);
  const prev28 = winResults.find((x) => x.idx === 1);

  const prev6 = winResults.filter((x) => x.idx >= 1 && x.idx <= 6);

  const medianSubs = median(prev6.map((w) => w.metrics.netSubs));
  const medianViews = median(prev6.map((w) => w.metrics.views));
  const medianWatch = median(prev6.map((w) => w.metrics.watchHours));

  const avgSubs = avg(prev6.map((w) => w.metrics.netSubs));
  const avgViews = avg(prev6.map((w) => w.metrics.views));
  const avgWatch = avg(prev6.map((w) => w.metrics.watchHours));

  // History for sparkline should be oldest->newest
  const history28d = [...winResults].sort((a,b)=>b.idx-a.idx).map((w)=>({
    startDate: w.startDate,
    endDate: w.endDate,
    netSubs: w.metrics.netSubs,
    views: w.metrics.views,
    watchHours: w.metrics.watchHours,
  }));

  const life = await fetchLifetimeWatchHours(token, ch.publishedAt, endIso);

  return {
    channel: ch,
    weekly: {
      startDate: weekStart,
      endDate: weekEnd,
      netSubs: weekly.netSubs,
      views: weekly.views,
      watchHours: weekly.watchHours,
    },

    m28: {
      last28: {
        startDate: last28.startDate,
        endDate: last28.endDate,
        netSubs: last28.metrics.netSubs,
        views: last28.metrics.views,
        watchHours: last28.metrics.watchHours,
      },
      prev28: {
        startDate: prev28.startDate,
        endDate: prev28.endDate,
        netSubs: prev28.metrics.netSubs,
        views: prev28.metrics.views,
        watchHours: prev28.metrics.watchHours,
      },

      // 6 months-ish based on previous 6×28D windows
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
      startDate: life.startIso,
      endDate: endIso,
      watchHours: life.totalHours,
    },

    history28d,
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
