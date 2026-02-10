function isoDate(d) { return d.toISOString().slice(0, 10); }

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

    // channel publishedAt for "all"
    const base = new URL(context.request.url);
    base.pathname = "/api/yt-channel";
    base.search = "";
    const ch = await (await fetch(base.toString())).json();
    const { startDate, endDate } = rangeToDates(range, ch.publishedAt);

    // 1) Analytics: top 10 by views
    const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    q.searchParams.set("ids", "channel==MINE");
    q.searchParams.set("startDate", startDate);
    q.searchParams.set("endDate", endDate);
    q.searchParams.set("dimensions", "video");
    q.searchParams.set("metrics", "views,averageViewPercentage,likes");
    q.searchParams.set("sort", "-views");
    q.searchParams.set("maxResults", "10");

    const r = await fetch(q.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json();
    const rows = data.rows || [];
    const videoIds = rows.map(row => row[0]).filter(Boolean);

    // 2) Data API: titles + thumbs for those videoIds
    let details = {};
    if (videoIds.length) {
      const v = new URL("https://www.googleapis.com/youtube/v3/videos");
      v.searchParams.set("part", "snippet,contentDetails");
      v.searchParams.set("id", videoIds.join(","));

      const vr = await fetch(v.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const vd = await vr.json();

      for (const item of (vd.items || [])) {
        details[item.id] = {
          title: item.snippet?.title,
          thumb: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
          publishedAt: item.snippet?.publishedAt,
          duration: item.contentDetails?.duration,
        };
      }
    }

    const items = rows.map((row, i) => {
      const videoId = row[0];
      const views = Number(row[1] || 0);
      const avgPct = Number(row[2] || 0);
      const likes = Number(row[3] || 0);
      return {
        rank: i + 1,
        videoId,
        views,
        averageViewPercentage: Math.round(avgPct * 10) / 10,
        likes,
        ...details[videoId],
      };
    });

    return Response.json({ range, startDate, endDate, items });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
