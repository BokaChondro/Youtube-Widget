// functions/api/yt-kpis.js
// KPIs for top cards with baseline median (previous 6×28D).
// Adds 55s edge-cache to reduce YouTube API calls for 1-min refresh.

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function safeStartDateFromPublishedAt(publishedAt) {
  if (!publishedAt) return "2006-01-01";
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return "2006-01-01";
  const iso = isoDate(d);
  return iso < "2006-01-01" ? "2006-01-01" : iso;
}

function median(nums) {
  const arr = (nums || [])
    .map(Number)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  if (arr.length === 0) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
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

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json();
  const ch = data.items?.[0];

  return {
    channelId: ch?.id || null,
    title: ch?.snippet?.title || "",
    publishedAt: ch?.snippet?.publishedAt || null,
    subscribers: Number(ch?.statistics?.subscriberCount || 0),
    totalViews: Number(ch?.statistics?.viewCount || 0),
  };
}

async function fetchAnalyticsRange(token, startDate, endDate) {
  const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  q.searchParams.set("ids", "channel==MINE");
  q.searchParams.set("startDate", startDate);
  q.searchParams.set("endDate", endDate);
  q.searchParams.set(
    "metrics",
    "views,estimatedMinutesWatched,subscribersGained,subscribersLost"
  );

  const r = await fetch(q.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json();
  const row = data.rows?.[0] || [0, 0, 0, 0];

  const views = Number(row[0] || 0);
  const minutes = Number(row[1] || 0);
  const gained = Number(row[2] || 0);
  const lost = Number(row[3] || 0);

  return {
    views,
    watchHours: Math.round((minutes / 60) * 10) / 10,
    netSubs: gained - lost,
  };
}

function build28dWindows() {
  const periods = [];
  for (let i = 0; i < 7; i++) {
    const end = daysAgo(28 * i);
    const start = daysAgo(28 * (i + 1));
    periods.push({
      idx: i,
      startDate: isoDate(start),
      endDate: isoDate(end),
    });
  }
  return periods; // [last28, prev1, ... prev6]
}

async function computeKPIs(env) {
  const token = await getAccessToken(env);

  const ch = await fetchChannelBasics(token);
  const periods = build28dWindows();

  const periodResults = await Promise.all(
    periods.map((p) =>
      fetchAnalyticsRange(token, p.startDate, p.endDate).then((m) => ({
        ...p,
        metrics: m,
      }))
    )
  );

  const last = periodResults.find((x) => x.idx === 0);
  const prev1 = periodResults.find((x) => x.idx === 1);

  const prev6 = periodResults
    .filter((x) => x.idx >= 1 && x.idx <= 6)
    .sort((a, b) => b.idx - a.idx); // prev6..prev1

  const baselineNetSubs = median(prev6.map((p) => p.metrics.netSubs));
  const baselineViews = median(prev6.map((p) => p.metrics.views));
  const baselineWatch = median(prev6.map((p) => p.metrics.watchHours));

  // History for sparklines: oldest->newest = prev6..prev1..last
  const history = [...prev6.reverse(), last].map((p) => ({
    startDate: p.startDate,
    endDate: p.endDate,
    netSubs: p.metrics.netSubs,
    views: p.metrics.views,
    watchHours: p.metrics.watchHours,
  }));

  const endIso = isoDate(new Date());

  // Lifetime watch hours
  const lifetimeStart = safeStartDateFromPublishedAt(ch.publishedAt);
  const lifetime = await fetchAnalyticsRange(token, lifetimeStart, endIso);

  return {
    channel: ch,
    windows: {
      last28: { startDate: last.startDate, endDate: last.endDate },
      prev28: { startDate: prev1.startDate, endDate: prev1.endDate },
      baseline: {
        type: "median",
        periods: 6,
        note: "Median of previous 6×28D periods (excludes last28).",
      },
      lifetime: { startDate: lifetimeStart, endDate: endIso },
    },
    history,
    subs: {
      current: ch.subscribers,
      last28Net: last.metrics.netSubs,
      prev28Net: prev1.metrics.netSubs,
      baselineMedian: baselineNetSubs,
    },
    views: {
      total: ch.totalViews,
      last28: last.metrics.views,
      prev28: prev1.metrics.views,
      baselineMedian: baselineViews,
    },
    watch: {
      totalHours: lifetime.watchHours,
      last28Hours: last.metrics.watchHours,
      prev28Hours: prev1.metrics.watchHours,
      baselineMedian: baselineWatch,
    },
  };
}

export async function onRequest(context) {
  try {
    // Edge cache key (same URL always)
    const cache = caches.default;
    const cacheKey = new Request(new URL(context.request.url).toString(), {
      method: "GET",
    });

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const data = await computeKPIs(context.env);

    const res = Response.json(data, {
      headers: {
        "Cache-Control": "public, max-age=55",
      },
    });

    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
