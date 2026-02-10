function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function rangeToDates(range, channelPublishedAt) {
  const end = new Date();
  const start = new Date(end);

  if (range === "48h") start.setDate(end.getDate() - 2);
  else if (range === "7d") start.setDate(end.getDate() - 7);
  else if (range === "28d") start.setDate(end.getDate() - 28);
  else if (range === "1y") start.setDate(end.getDate() - 365);
  else if (range === "all") start.setTime(new Date(channelPublishedAt).getTime());
  else start.setDate(end.getDate() - 28);

  return { startDate: isoDate(start), endDate: isoDate(end) };
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

export async function onRequest(context) {
  try {
    const token = await getAccessToken(context.env);
    const range = new URL(context.request.url).searchParams.get("range") || "28d";

    // reuse our own channel endpoint to get publishedAt
    const base = new URL(context.request.url);
    base.pathname = "/api/yt-channel";
    base.search = "";
    const ch = await (await fetch(base.toString())).json();

    const { startDate, endDate } = rangeToDates(range, ch.publishedAt);

    const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    q.searchParams.set("ids", "channel==MINE");
    q.searchParams.set("startDate", startDate);
    q.searchParams.set("endDate", endDate);
    q.searchParams.set("metrics", "views,estimatedMinutesWatched,subscribersGained,subscribersLost");

    const r = await fetch(q.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json();
    const row = data.rows?.[0] || [0, 0, 0, 0];

    const views = Number(row[0] || 0);
    const minutes = Number(row[1] || 0);
    const gained = Number(row[2] || 0);
    const lost = Number(row[3] || 0);

    return Response.json({
      range,
      startDate,
      endDate,
      views,
      watchTimeHours: Math.round((minutes / 60) * 10) / 10,
      netSubscribers: gained - lost,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
