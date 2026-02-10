export async function onRequest(context) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = context.env;

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await r.json();
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
