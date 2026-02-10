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
    const limit = Number(new URL(context.request.url).searchParams.get("limit") || 8);

    // get channelId
    const base = new URL(context.request.url);
    base.pathname = "/api/yt-channel";
    base.search = "";
    const ch = await (await fetch(base.toString())).json();

    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("allThreadsRelatedToChannelId", ch.channelId);
    url.searchParams.set("order", "time");
    url.searchParams.set("maxResults", String(Math.min(limit, 20)));
    url.searchParams.set("textFormat", "plainText");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json();
    const items = (data.items || []).map(it => {
      const s = it.snippet?.topLevelComment?.snippet;
      return {
        author: s?.authorDisplayName,
        text: s?.textDisplay,
        publishedAt: s?.publishedAt,
        videoId: s?.videoId,
      };
    });

    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
