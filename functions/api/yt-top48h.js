export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = "/api/yt-top10";
  url.searchParams.set("range", "48h");

  const r = await fetch(url.toString());
  const data = await r.json();

  // keep top 5
  const items = (data.items || []).slice(0, 5);
  return Response.json({ ...data, items });
}
