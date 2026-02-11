// functions/api/yt-kpis.js
// Weekly KPIs + 6-month weekly average baseline.
// Card needs:
// - Subs: current, thisWeekNet, avg6mNet
// - Views: total, thisWeekViews, avg6mViews
// - Watch: lifetime totalHours, thisWeekHours, avg6mHours
// Also returns: channel.logo (for background), spark history (last 8 weeks)
//
// Uses edge cache (~55s) so 1-min refresh doesn't hammer YouTube APIs.

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function shiftDays(dateObj, deltaDays) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + deltaDays);
  return d;
}

function safeStartDateFromPublishedAt(publishedAt) {
  if (!publishedAt) return "2006-01-01";
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return "2006-01-01";
  const iso = isoDate(d);
  return iso < "2006-01-01" ? "2006-01-01" : iso;
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
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

  const thumbs = ch?.snippet?.thumbnails || {};
  const logo =
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    "";

  return {
    channelId: ch?.id || null,
    title: ch?.snippet?.title || "",
    publishedAt: ch?.snippet?.publishedAt || null,
    logo,
    subscribers: Number(ch?.statistics?.subscriberCount || 0),
    totalViews: Number(ch?.statistics?.viewCount || 0),
  };
}

async function fetchAnalyticsDaily(token, startDate, endDate) {
  const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  q.searchParams.set("ids", "channel==MINE");
  q.searchParams.set("startDate", startDate);
  q.searchParams.set("endDate", endDate);
  q.searchParams.set("dimensions", "day");
  q.searchParams.set("sort", "day");
  q.searchParams.set(
    "metrics",
    "views,estimatedMinutesWatched,subscribersGained,subscribersLost"
  );

  const r = await fetch(q.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json();
  const rows = data.rows || [];
  // columns: day, views, minutes, gained, lost
  const map = new Map();
  for (const row of rows) {
    const day = row[0];
    map.set(day, {
      views: Number(row[1] || 0),
      minutes: Number(row[2] || 0),
      gained: Number(row[3] || 0),
      lost: Number(row[4] || 0),
    });
  }
  return map;
}

async function fetchLifetimeWatchHours(token, publishedAt, endIso) {
  const startIso = safeStartDateFromPublishedAt(publishedAt);

  const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  q.searchParams.set("ids", "channel==MINE");
  q.searchParams.set("startDate", startIso);
  q.searchParams.set("endDate", endIso);
  q.searchParams.set("metrics", "estimatedMinutesWatched");

  const r = await fetch(q.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json();
  const minutes = Number(data.rows?.[0]?.[0] || 0);
  return { startIso, totalHours: round1(minutes / 60) };
}

function buildWeeklyTotals(dailyMap, endDateObj, weekCount) {
  // week 0: last 7 days ending on endDateObj (inclusive)
  // week 1: the 7 days before that, etc.
  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const weekEnd = shiftDays(endDateObj, -7 * w);
    const weekStart = shiftDays(weekEnd, -6);

    let views = 0;
    let minutes = 0;
    let gained = 0;
    let lost = 0;

    for (let i = 0; i < 7; i++) {
      const d = shiftDays(weekStart, i);
      const key = isoDate(d);
      const m = dailyMap.get(key);
      if (m) {
        views += m.views;
        minutes += m.minutes;
        gained += m.gained;
        lost += m.lost;
      }
    }

    weeks.push({
      idx: w,
      startDate: isoDate(weekStart),
      endDate: isoDate(weekEnd),
      views,
      watchHours: round1(minutes / 60),
      netSubs: gained - lost,
    });
  }
  return weeks; // [week0, week1, ...]
}

function avg(nums) {
  const arr = (nums || []).map(Number).filter((x) => Number.isFinite(x));
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function computeKPIs(env) {
  const token = await getAccessToken(env);
  const ch = await fetchChannelBasics(token);

  // Define "this week" as last 7 FULL days ending yesterday (avoids partial today data)
  const end = shiftDays(new Date(), -1);
  const endIso = isoDate(end);

  // We need 27 weeks (this week + previous 26 weeks) => 189 days
  const start = shiftDays(end, -(189 - 1));
  const startIso = isoDate(start);

  const dailyMap = await fetchAnalyticsDaily(token, startIso, endIso);

  // weeks[0] = this week, weeks[1] = previous week ... weeks[26]
  const weeks = buildWeeklyTotals(dailyMap, end, 27);

  const thisWeek = weeks[0];
  const prevWeek = weeks[1];

  // 6M avg = average of previous 26 weeks (exclude this week)
  const baselineWeeks = weeks.slice(1, 27); // 26 weeks

  const avgSubs = avg(baselineWeeks.map((w) => w.netSubs));
  const avgViews = avg(baselineWeeks.map((w) => w.views));
  const avgWatch = avg(baselineWeeks.map((w) => w.watchHours));

  // Spark history: last 8 weeks (week7..week0) oldest->newest
  const spark = weeks.slice(0, 8).reverse(); // week7..week0

  const life = await fetchLifetimeWatchHours(token, ch.publishedAt, endIso);

  return {
    channel: ch,
    week: { startDate: thisWeek.startDate, endDate: thisWeek.endDate },
    baseline6m: { weeks: 26, type: "avg" },

    subs: {
      current: ch.subscribers,
      thisWeekNet: thisWeek.netSubs,
      prevWeekNet: prevWeek.netSubs,
      avg6mNet: avgSubs,
    },

    views: {
      total: ch.totalViews,
      thisWeek: thisWeek.views,
      prevWeek: prevWeek.views,
      avg6m: avgViews,
    },

    watch: {
      lifetimeStart: life.startIso,
      totalHours: life.totalHours,
      thisWeekHours: thisWeek.watchHours,
      prevWeekHours: prevWeek.watchHours,
      avg6mHours: avgWatch,
    },

    // 8-week spark points (oldest->newest)
    spark: spark.map((w) => ({
      startDate: w.startDate,
      endDate: w.endDate,
      netSubs: w.netSubs,
      views: w.views,
      watchHours: w.watchHours,
    })),
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
