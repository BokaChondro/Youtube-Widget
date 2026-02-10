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

    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet,statistics");
    url.searchParams.set("mine", "true");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json();
    const ch = data.items?.[0];

    return Response.json({
      channelId: ch?.id,
      title: ch?.snippet?.title,
      publishedAt: ch?.snippet?.publishedAt,
      subscribers: Number(ch?.statistics?.subscriberCount || 0),
      totalViews: Number(ch?.statistics?.viewCount || 0),
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
