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

function toCommentItem(it) {
  const s = it?.snippet?.topLevelComment?.snippet;
  return {
    author: s?.authorDisplayName,
    text: s?.textDisplay,
    publishedAt: s?.publishedAt,
    videoId: s?.videoId,
  };
}

export async function onRequest(context) {
  try {
    const token = await getAccessToken(context.env);
    const u = new URL(context.request.url);
    const limit = Math.min(Number(u.searchParams.get("limit") || 8), 20);

    // 1) Get channelId
    const base = new URL(context.request.url);
    base.pathname = "/api/yt-channel";
    base.search = "";
    const ch = await (await fetch(base.toString())).json();
    if (!ch.channelId) return Response.json({ items: [], debug: "No channelId" });

    // 2) Try channel-wide comments first (default moderationStatus is 'published')
    // Docs: commentThreads.list supports allThreadsRelatedToChannelId + order=time :contentReference[oaicite:2]{index=2}
    const url1 = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url1.searchParams.set("part", "snippet");
    url1.searchParams.set("allThreadsRelatedToChannelId", ch.channelId);
    url1.searchParams.set("order", "time");
    url1.searchParams.set("maxResults", String(limit));
    url1.searchParams.set("textFormat", "plainText");

    const r1 = await fetch(url1.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data1 = await r1.json();

    const items1 = (data1.items || []).map(toCommentItem).filter(x => x.text);
    if (items1.length > 0) {
      return Response.json({ items: items1, mode: "channel" });
    }

    // 3) Fallback: fetch latest videos, then pull latest comments per video
    // This is more reliable when channel-wide returns empty. :contentReference[oaicite:3]{index=3}
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "id");
    searchUrl.searchParams.set("channelId", ch.channelId);
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "10");

    const sr = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sd = await sr.json();
    const videoIds = (sd.items || [])
      .map(x => x.id?.videoId)
      .filter(Boolean);

    let collected = [];

    for (const vid of videoIds) {
      // grab a few latest threads per video
      const ct = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
      ct.searchParams.set("part", "snippet");
      ct.searchParams.set("videoId", vid);
      ct.searchParams.set("order", "time");
      ct.searchParams.set("maxResults", "5");
      ct.searchParams.set("textFormat", "plainText");

      const rr = await fetch(ct.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      // skip videos with comments disabled
      if (!rr.ok) continue;

      const dd = await rr.json();
      const these = (dd.items || []).map(toCommentItem).filter(x => x.text);
      collected.push(...these);
    }

    collected.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    collected = collected.slice(0, limit);

    return Response.json({ items: collected, mode: "per-video-fallback" });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
