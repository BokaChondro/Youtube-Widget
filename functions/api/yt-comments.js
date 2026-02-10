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

function toItem(thread) {
  const s = thread?.snippet?.topLevelComment?.snippet;
  return {
    author: s?.authorDisplayName,
    text: s?.textDisplay,
    publishedAt: s?.publishedAt,
    videoId: s?.videoId,
    moderationStatus: s?.moderationStatus, // may appear for held comments
  };
}

async function fetchThreads({ token, channelId, videoId, moderationStatus, maxResults }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("order", "time");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("textFormat", "plainText");

  // exactly one filter:
  if (videoId) url.searchParams.set("videoId", videoId);
  else url.searchParams.set("allThreadsRelatedToChannelId", channelId);

  // published / heldForReview / likelySpam (default is published) :contentReference[oaicite:2]{index=2}
  if (moderationStatus && moderationStatus !== "published") {
  url.searchParams.set("moderationStatus", moderationStatus);
}


  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  let data = null;
  try { data = await r.json(); } catch { data = { raw: await r.text() }; }

  return { ok: r.ok, status: r.status, data, url: url.toString() };
}

export async function onRequest(context) {
  const u = new URL(context.request.url);
  const limit = Math.min(Number(u.searchParams.get("limit") || 8), 20);
  const debug = u.searchParams.get("debug") === "1";

  try {
    const token = await getAccessToken(context.env);

    // get channelId
    const base = new URL(context.request.url);
    base.pathname = "/api/yt-channel";
    base.search = "";
    const ch = await (await fetch(base.toString())).json();
    const channelId = ch.channelId;

    const dbg = { channelId, tried: [], videosChecked: 0 };

    // 1) Channel-wide: published + heldForReview + likelySpam
    const moderationModes = ["published", "heldForReview", "likelySpam"];
    let collected = [];

    for (const m of moderationModes) {
      const res = await fetchThreads({ token, channelId, moderationStatus: m, maxResults: limit });
      dbg.tried.push({ scope: "channel", moderationStatus: m, ok: res.ok, status: res.status });

      if (res.ok) {
        const items = (res.data.items || []).map(toItem).filter(x => x.text);
        collected.push(...items.map(x => ({ ...x, _scope: "channel", _mode: m })));
      }
    }

    // If we found any, return them
    if (collected.length) {
      collected.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      collected = collected.slice(0, limit);
      return Response.json({ items: collected, mode: "channel-mixed", ...(debug ? { debug: dbg } : {}) });
    }

    // 2) Fallback: latest 10 videos, then comments per-video (published + heldForReview)
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "id");
    searchUrl.searchParams.set("channelId", channelId);
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "10");

    const sr = await fetch(searchUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const sd = await sr.json();
    const videoIds = (sd.items || []).map(x => x.id?.videoId).filter(Boolean);

    dbg.videosChecked = videoIds.length;

    for (const vid of videoIds) {
      for (const m of ["published", "heldForReview"]) {
        const res = await fetchThreads({ token, channelId, videoId: vid, moderationStatus: m, maxResults: 10 });
        // API can return 403 commentsDisabled when comments are off. :contentReference[oaicite:3]{index=3}
        const reason = res.data?.error?.errors?.[0]?.reason;

        dbg.tried.push({ scope: "video", videoId: vid, moderationStatus: m, ok: res.ok, status: res.status, reason });

        if (res.ok) {
          const items = (res.data.items || []).map(toItem).filter(x => x.text);
          collected.push(...items.map(x => ({ ...x, _scope: "video", _mode: m })));
        }
      }
    }

    collected.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    collected = collected.slice(0, limit);

    const cleanItems = collected.map(x => ({
  author: x.author,
  text: x.text,
  publishedAt: x.publishedAt,
  videoId: x.videoId,
}));

cleanItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

return Response.json({
  items: cleanItems.slice(0, limit),
  mode: "clean",
  ...(debug ? { debug: dbg } : {}),
});

  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
