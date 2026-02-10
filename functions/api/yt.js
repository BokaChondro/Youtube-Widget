export function onRequest() {
  return new Response(JSON.stringify({ ok: true, route: "/api/yt" }, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
