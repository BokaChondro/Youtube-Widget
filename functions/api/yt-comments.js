// functions/api/yt-comments.js
// Published comments only (safe for Notion)
// Channel-wide first, then per-video fallback if channel-wide returns empty.

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
    author: s?.authorDisplayName || "Unknown",
    text: s?.textDisplay || "",
    publishedAt: s?.publishedAt || null,
    videoId: s?.videoId || null,
  };
}

function clean(items, limit) {
  const cleaned = (items || [])
    .map((x) => ({
      author: x.author,
      text: x.text,
      publishedAt: x.publishedAt,
      videoId: x.videoId,
    }))
    .filter((x) => x.text && x.publishedAt);

  cleaned.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return cleaned.slice(0, limit);
}

async function fetchThreads({ token, channelId, videoId, maxResults }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("order", "time");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("textFormat", "plainText");

  // exactly one filter:
  if (videoId) url.searchParams.set("videoId", videoId);
  else url.searchParams.set("allThreadsRelatedToChannelId", channelId);

  // moderationStatus omitted => defaults to "published"

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  let data = null;
  try {
    data = await r.json();
  } catch {
    data = { raw: await r.text() };
  }

  return { ok: r.ok, status: r.status, data };
}

export async function onRequest(context) {
  const u = new URL(context.request.url);
  const limit = Math.min(Number(u.searchParams.get("limit") || 8), 20);
  const debug = u.searchParams.get("debug") === "1";

  try {
    const token = await getAccessToken(context.env);

    // get channelId from your own endpoint
    const base = new URL(context.request.url);
    base.pathname = "/api/yt-channel";
    base.search = "";
    const ch = await (await fetch(base.toString())).json();

    if (ch?.error) {
      return Response.json(
        { items: [], mode: "channel-error", ...(debug ? { debug: { ch } } : {}) },
        { status: 200 }
      );
    }

    const channelId = ch.channelId;
    if (!channelId) {
      return Response.json(
        { items: [], mode: "no-channelId", ...(debug ? { debug: { ch } } : {}) },
        { status: 200 }
      );
    }

    const dbg = { channelId, tried: [], videosChecked: 0 };
    const collected = [];

    // 1) Channel-wide published
    const res1 = await fetchThreads({ token, channelId, maxResults: limit });
    dbg.tried.push({ scope: "channel", ok: res1.ok, status: res1.status });

    if (res1.ok) {
      const items = (res1.data.items || []).map(toItem).filter((x) => x.text);
      collected.push(...items);
    }

    if (collected.length) {
      return Response.json({
        items: clean(collected, limit),
        mode: "channel",
        ...(debug ? { debug: dbg } : {}),
      });
    }

    // 2) Fallback: latest 10 videos → pull latest published comments per video
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "id");
    searchUrl.searchParams.set("channelId", channelId);
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "10");

    const sr = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sd = await sr.json();
    const videoIds = (sd.items || []).map((x) => x.id?.videoId).filter(Boolean);

    dbg.videosChecked = videoIds.length;

    for (const vid of videoIds) {
      const res = await fetchThreads({ token, channelId, videoId: vid, maxResults: 10 });
      const reason = res.data?.error?.errors?.[0]?.reason;

      dbg.tried.push({ scope: "video", videoId: vid, ok: res.ok, status: res.status, reason });

      if (res.ok) {
        const items = (res.data.items || []).map(toItem).filter((x) => x.text);
        collected.push(...items);
      }
    }

    return Response.json({
      items: clean(collected, limit),
      mode: "per-video-fallback",
      ...(debug ? { debug: dbg } : {}),
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
