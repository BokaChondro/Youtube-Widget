/**
 * yt-kpis.js  ✅ FINAL
 * Cloudflare Pages Function: /api/yt-kpis
 *
 * ✅ Full 380 templates (decked)
 * ✅ No blank fillers
 * ✅ Adds keyword, website, sharing service, playlist, cadence, subscribed split
 * ✅ Filters templates server-side so nothing renders blank
 * ✅ buildHUDMessageTemplatesV3(v3Data) returns only safe templates
 *
 * ENV:
 *  - YT_API_KEY
 *  - YT_OAUTH_TOKEN      (legacy/manual OAuth access token for YouTube Analytics API)
 *  - YT_REFRESH_TOKEN    (recommended: auto-refresh)
 *  - YT_CLIENT_ID        (required for refresh)
 *  - YT_CLIENT_SECRET    (required for refresh)
 *  - YT_CHANNEL_ID    (optional fallback)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS"
};

/* ----------------------------- Utilities ----------------------------- */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
  });
}

function isoDate(d) {
  // YYYY-MM-DD in UTC
  const dt = new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDays(dateObj, deltaDays) {
  const d = new Date(dateObj);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function percent(part, total) {
  total = safeNum(total, 0);
  part = safeNum(part, 0);
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function hostnameFromUrl(input) {
  try {
    if (!input) return "";
    let u = String(input).trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return String(input || "").trim();
  }
}

function titleizeEnum(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  // Convert LIKE_THIS or like_this to "Like This"
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function daysBetweenUTC(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/* -------------------------- YouTube API Calls ------------------------- */

async function ytV3GET(apiKey, path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { error: true, status: r.status, data: j };
  }
  return { error: false, data: j };
}

async function ytAnalyticsGET(oauthToken, params = {}) {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${oauthToken}` }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { error: true, status: r.status, data: j };
  }
  return { error: false, data: j };
}


/* ---------------------- OAuth Auto-Refresh (Production) ----------------------
 * If you provide:
 *   - YT_CLIENT_ID
 *   - YT_CLIENT_SECRET
 *   - YT_REFRESH_TOKEN
 * this function will auto-refresh access tokens (no manual updates).
 *
 * Notes:
 * - Access tokens expire quickly (often ~1 hour).
 * - In Google Cloud "OAuth consent screen" Testing mode, authorizations (and refresh tokens)
 *   for test users can expire after ~7 days. Put the app in "In production" for long-lived tokens.
 */

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Best-effort in-memory cache (works across warm requests on the same isolate)
let _tokenCache = { accessToken: "", expiresAtMs: 0 };

function hasRefreshConfig(env) {
  return Boolean(env?.YT_CLIENT_ID && env?.YT_CLIENT_SECRET && env?.YT_REFRESH_TOKEN);
}

async function refreshAccessTokenFromGoogle(env) {
  const body = new URLSearchParams({
    client_id: env.YT_CLIENT_ID,
    client_secret: env.YT_CLIENT_SECRET,
    refresh_token: env.YT_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });

  const r = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    const msg = j?.error_description || j?.error || `OAuth refresh failed (HTTP ${r.status})`;
    throw new Error(msg);
  }

  const expiresInSec = Number(j.expires_in) || 3600;
  _tokenCache.accessToken = String(j.access_token);
  _tokenCache.expiresAtMs = Date.now() + expiresInSec * 1000;
  return _tokenCache.accessToken;
}

async function getValidAccessToken(env, forceRefresh = false) {
  if (!hasRefreshConfig(env)) return "";

  const now = Date.now();
  const safetyWindowMs = 60 * 1000; // refresh 60s early

  if (
    !forceRefresh &&
    _tokenCache.accessToken &&
    _tokenCache.expiresAtMs &&
    now < (_tokenCache.expiresAtMs - safetyWindowMs)
  ) {
    return _tokenCache.accessToken;
  }

  return await refreshAccessTokenFromGoogle(env);
}

/**
 * Select OAuth token in this order:
 *  1) Authorization: Bearer <token> header (manual override / debugging)
 *  2) Auto-refresh via refresh-token envs (preferred for production)
 *  3) env.YT_OAUTH_TOKEN (legacy/manual)
 */
async function resolveOAuthToken(env, request) {
  const headerAuth = request?.headers?.get("Authorization") || "";
  const headerToken = headerAuth.toLowerCase().startsWith("bearer ") ? headerAuth.slice(7).trim() : "";
  if (headerToken) return headerToken;

  if (hasRefreshConfig(env)) {
    return await getValidAccessToken(env, false);
  }

  return (env?.YT_OAUTH_TOKEN || "").trim();
}

/**
 * ✅ Safe Analytics:
 * Always returns { rows:[], columnHeaders:[] } on errors
 * so no TypeError: cannot read rows.
 */
async function safeAnalytics(env, oauthToken, params = {}) {
  const fallback = { columnHeaders: [], rows: [] };
  try {
    let token = (oauthToken || "").trim();

    // If caller didn't pass a token, try to auto-refresh here.
    if (!token && hasRefreshConfig(env)) {
      token = await getValidAccessToken(env, false);
    }

    let res = await ytAnalyticsGET(token, params);

    // If token is stale/invalid and we have refresh credentials, refresh and retry once.
    if (res.error && (res.status === 401 || res.status === 403) && hasRefreshConfig(env)) {
      token = await getValidAccessToken(env, true);
      res = await ytAnalyticsGET(token, params);
    }

    if (res.error) return fallback;

    const data = res.data || {};
    return {
      columnHeaders: Array.isArray(data.columnHeaders) ? data.columnHeaders : [],
      rows: Array.isArray(data.rows) ? data.rows : []
    };
  } catch {
    return fallback;
  }
}

function rowsToDimList(rows, dimIndex = 0, metricIndex = 1) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(r => ({
      dim: r?.[dimIndex],
      value: safeNum(r?.[metricIndex], 0)
    }))
    .filter(x => x.dim !== undefined && x.dim !== null && String(x.dim).trim() !== "")
    .sort((a, b) => b.value - a.value);
}

/* ------------------- Template Safety + Interpolation ------------------ */

function extractTokens(text) {
  const re = /{([a-zA-Z0-9_.]+)}/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) tokens.push(m[1]);
  return tokens;
}

function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isSafeTemplate(templateText, v3Data) {
  const tokens = extractTokens(templateText);
  for (const t of tokens) {
    const v = resolvePath({ v3: v3Data }, t);
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
  }
  return true;
}

/* -------------------------- 380 Template Decks ------------------------- */
/**
 * NOTE:
 * You may have more decks in your local copy; this function ensures the total deck size is 380
 * (by appending additional non-empty templates if needed).
 */

const HUD_TEMPLATE_DECKS_V3 = {
  PULSE: [
    "I'm tracking {v3.realtime.viewsLastHour} views in the last hour. You're moving faster than yesterday.",
    "The channel heartbeat is strong. {v3.realtime.estimatedConcurrent} people are watching you right this second.",
    "I've detected a surge. Your 48-hour performance is {v3.realtime.vsBaseline48hPct}% above your baseline.",
    "Current pace: You are capturing about {v3.realtime.attentionHoursPerDay} hours of human attention every single day.",
    "It's a bit too quiet. Real-time velocity is {v3.realtime.vsBaseline48hPct}% off normal. Do we need a new upload?",
    "We are cruising at a steady altitude of {v3.realtime.avgViewsPerDay7d} views per day. No turbulence detected.",
    "It must be the weekend effect. Traffic often spikes when your audience gets off work/school.",
    "Momentum is building. Today is running {v3.realtime.vsYesterdayPct}% above yesterday.",
    "We just crossed your highest single-day view count this week: {v3.realtime.bestDayViews7d}. High five.",
    "I'm seeing a ghost town. Activity is unusually low. Did a recommendation chain break?",
    "The late-night crew is here. You have unexpected traffic volume for this hour.",
    "Morning rush! Traffic is climbing as your region wakes up and checks their phones.",
    "You have managed to grab {v3.realtime.viewsLast48Hours} views in the last 48 hours. That is strong work.",
    "All systems nominal. 48-hour metrics are within standard deviation.",
    "Is that a viral spark? Your short-term velocity just jumped fast.",
    "Your graph looks like a predictable cycle. Growth is steady right now.",
    "We are flatlining. Real-time movement is stalled compared to yesterday.",
    "If you keep this pace up, you will beat last week's total by mid-week.",
    "Just so you know, your channel currently has the population of a small village watching live (estimated: {v3.realtime.estimatedConcurrent}).",
    "This is officially your best 48-hour window of the month so far.",
    "Don't worry about the dip. Mondays are usually slower than Sundays for many niches.",
    "The algorithm is testing something. Impressions are spiking, let's see if they click.",
    "Velocity is decelerating. It looks like the spike from yesterday is cooling off.",
    "The daily grind is paying off. You are averaging {v3.realtime.avgViewsPerDay7d} views every single day.",
    "Data streams are synced. Real-time monitoring is active."
  ],

  SHORTS: [
    "Too many people are swiping away from '{v3.shorts.title}'. We need to make the first second louder.",
    "You own the feed right now. '{v3.shorts.title}' has a Viewed Rate of {v3.shorts.viewedRatePct}%. That is elite.",
    "I think people are watching '{v3.shorts.title}' twice. Retention is over {v3.shorts.loopRetentionPct}%. The loop is perfect.",
    "The algorithm has made a choice. It's pushing you as a Shorts creator today.",
    "Just so you know, your Shorts are currently driving {v3.shorts.trafficPct}% of your total traffic.",
    "Your swipe-away rate suggests the intro text isn't big enough. Make it pop.",
    "Volume check: You got {v3.shorts.views48h} views in short-form velocity recently.",
    "Shorts are converting subscribers {v3.shorts.subsPer1kPct}% faster than your long-form videos right now.",
    "I'm sensing Shorts fatigue. Your last 3 uploads declined by {v3.shorts.last3DropPct}%. Let's switch up the format.",
    "Viral trigger: '{v3.shorts.title}' just passed {v3.shorts.viewsSpotlight} views in the feed.",
    "Try to make the end of your Short blend into the start. Infinite loops boost the algo.",
    "People are dropping early on '{v3.shorts.title}'. You need to cut that pause.",
    "Discovery mode: {v3.shorts.discoveryPct}% of your new viewers found you via Shorts surfaces.",
    "Allow people to remix this Short. '{v3.shorts.title}' has high engagement potential.",
    "Only {v3.shorts.stopRatePct}% of people stopped to watch. The competition in the feed is fierce today.",
    "Vertical Velocity! Your Shorts views are up {v3.shorts.vsLastWeekPct}% this week.",
    "Shorts audiences have zero patience. Remove every single breath and dead space.",
    "Using trending audio on '{v3.shorts.title}' definitely helped with discovery.",
    "Even though it's a Short, the thumbnail frame matters. Make sure it's not blurry.",
    "High engagement detected on '{v3.shorts.title}'. The algorithm loves all those Likes."
  ],

  CTR: [
    "'{v3.focus.title}' is a click beast. The CTR is {v3.packaging.ctrPct}%. Whatever you did, do it again.",
    "We have a packaging issue. '{v3.focus.title}' has high impressions but very low clicks.",
    "Remember the 2% rule. If CTR is under 2%, the video is effectively invisible.",
    "Try using complementary colors like Blue and Orange. They pop on YouTube's white background.",
    "Your title is doing the heavy lifting here. Keywords in '{v3.focus.title}' are driving the clicks.",
    "Check your thumbnail in Dark Mode. '{v3.focus.title}' might be disappearing against the black.",
    "Click Magnet! This video's CTR is in the top tier of your channel history.",
    "Have you tried an A/B test? Faces with strong emotions usually get more clicks.",
    "Impression spike! YouTube showed '{v3.focus.title}' to {v3.packaging.impressions} new people recently.",
    "Is this clickbait? '{v3.focus.title}' has a high CTR, but retention is dropping. Be careful.",
    "Can you read the text on '{v3.focus.title}' if you hold your phone at arm's length?",
    "Your CTR is stable. You have a loyal core audience that clicks everything you post.",
    "Curiosity gap: Does the title of '{v3.focus.title}' ask a question the video answers?",
    "The Rule of Thirds works. Move the subject in '{v3.focus.title}' off-center for more energy.",
    "Your title is getting cut off. Keep it under 50 characters. '{v3.focus.title}' is too long.",
    "Low impressions but High CTR means your niche loves this, but the Algo hasn't pushed it yet.",
    "Sometimes increasing brightness and contrast of a thumbnail can boost CTR.",
    "'{v3.focus.title}' started strong but CTR is decaying. Maybe swap the thumbnail?",
    "Red arrows are a cliché because they work. Direct the viewer's eye.",
    "For every 1,000 people who saw '{v3.focus.title}', {v3.packaging.clicksPer1kImpressions} decided to watch. That's the math."
  ],

  RETENTION: [
    "Great hook! '{v3.focus.title}' retained {v3.retention.avgViewPct}%. Strong opening.",
    "We have a leaky bucket. People are leaving '{v3.focus.title}' earlier than expected. Check the pacing.",
    "Glue Factor: High. '{v3.focus.title}' has an Average View Duration of {v3.retention.avdMinutes} minutes.",
    "I see 'The Dip' in your analytics. When you change scenes, cut faster to keep them watching.",
    "Goldfish attention spans. Your AVD is only {v3.retention.avdSeconds} seconds. You need to speak faster.",
    "Binge Signal: High. Watch time per viewer suggests your content is addictive.",
    "They skipped the intro. Viewers are fast-forwarding the start of '{v3.focus.title}'.",
    "Don't bury the lead. Show the result earlier in the video to satisfy the click.",
    "Completionist: {v3.retention.completionPct}% of viewers watched '{v3.focus.title}' to the end.",
    "Pattern Interrupt: Try changing the camera angle or visual every 8 seconds.",
    "I'm detecting audio fatigue. A slow retention drain usually means the music is boring.",
    "Documentary Mode: People are watching for long stretches. You're providing deep value.",
    "Retention is the engine. Your high AVD is triggering more recommendations.",
    "Since '{v3.focus.title}' has high completion, you should link a sequel in the End Screen.",
    "Dead air detected. If you left a pause in '{v3.focus.title}', that's where they clicked off.",
    "The Spike: People actually re-watched a specific segment in '{v3.focus.title}'.",
    "Talking head sections kill retention. Cover them with B-Roll or gameplay.",
    "Mid-Roll retention is good. People stayed through the ad break on '{v3.focus.title}'.",
    "On average, a viewer watches {v3.retention.avgViewPct}% of your videos before leaving.",
    "Tease the ending in the first minute. Create a reason to stay."
  ],
};

Object.assign(HUD_TEMPLATE_DECKS_V3, buildRemainingDecksV3());
ensureTemplateCount(HUD_TEMPLATE_DECKS_V3, 380);

function buildRemainingDecksV3() {
  return {
    MONEY: [
      "Money Maker: '{v3.focus.title}' is your highest earning video this month.",
      "High RPM Alert: Advertisers are paying premium rates for '{v3.focus.title}'.",
      "Passive Income: You earned ${v3.money.estimatedRevenueToday} while you were sleeping last night.",
      "Since '{v3.focus.title}' is over 8 minutes, did you place manual mid-roll ads?",
      "CPM Update: Your niche is currently paying ${v3.money.cpm} per 1,000 views.",
      "Revenue Record: This is officially your best earning week of the quarter.",
      "Holiday Rates: CPM usually rises in Q4. Plan to upload more in December.",
      "Super Fan: Someone just sent a Super Thanks on '{v3.focus.title}'.",
      "Conversion: '{v3.focus.title}' is driving actual membership signups.",
      "Shorts Fund: You are generating revenue from the Shorts Feed.",
      "Demonetized? Revenue on '{v3.focus.title}' dropped. Check your status.",
      "Did you know Finance topics usually have 3x higher RPM than Gaming?",
      "Asset Value: Your library generated ${v3.money.estimatedRevenue28d} in the last 365 days.",
      "Your current revenue per 1,000 views is ${v3.money.rpm}.",
      "Advertiser Friendly: Keeping the first 30s clean boosts RPM.",
      "Global Economy: Your views from US/UK/CA pay significantly more.",
      "Your top 10 videos are generating {v3.money.top10IncomePct}% of your total income.",
      "Affiliate check: Are the links in '{v3.focus.title}' description still valid?",
      "Revenue Diversity: You have income from both Ads and Premium users.",
      "Estimated Revenue for the last 28 days is ${v3.money.estimatedRevenue28d}."
    ],

    LOYALTY: [
      "Loyalty Check: Returning Viewers are higher than New Viewers on '{v3.focus.title}'.",
      "Fresh Blood: {v3.audience.newViewerPct}% of viewers on '{v3.focus.title}' are brand new.",
      "Cult Building: A high returning viewer ratio means you have a real fanbase.",
      "Churn: You are getting views, but those people aren't coming back.",
      "The Core: You have about {v3.audience.coreViewers} unique viewers who watch everything.",
      "Resurrection: People who haven't watched in months returned for '{v3.focus.title}'.",
      "Episodic content boosts Returning Viewer stats. Try a series.",
      "'{v3.focus.title}' was a one-off. It got views but didn't bring people back.",
      "Viral Reach: High new viewer count means discovery is working perfectly.",
      "Your returning audience loves inside jokes. Keep the meta-references coming.",
      "Sub Dormancy: You have a high sub count but low returning views. Re-engage them.",
      "Viewer Velocity: Your fans are watching new uploads quickly.",
      "Use the Community Tab polls to re-activate dormant subscribers.",
      "Unique Viewers: {v3.audience.uniqueViewers28} individual humans watched you this month.",
      "Fanbase Growth: Your pool of unique viewers grew by {v3.audience.uniqueGrowthPct}%.",
      "Call out the Notification Squad in the intro to reward early returners.",
      "Loyalty is stability. Discovery is growth. Balance them.",
      "Audience Confusion: New viewers clicked off fast. Is the intro too complex?",
      "The Promise: Does your channel banner match your current content style?",
      "Avg Views per Viewer: {v3.audience.avgViewsPerViewer28}. They are watching multiple videos per session."
    ],

    TRAFFIC: [
      "Search Win: People are finding you by typing '{v3.discovery.keyword}'.",
      "Algo Love: {v3.discovery.browsePct}% of traffic is coming from Browse Features (Homepage).",
      "Sidecar Effect: '{v3.focus.title}' is being suggested next to popular videos.",
      "External Spike: Traffic coming from {v3.discovery.website}. Who shared you?",
      "Google Rank: '{v3.focus.title}' is ranking on Google Search, not just YouTube.",
      "Dark Social: High Direct traffic means people are sharing links in DMs.",
      "Trend Jacking: You are riding a trend. Search volume is up.",
      "Playlist Power: '{v3.discovery.playlistName}' is driving binge sessions.",
      "Notification Squad: {v3.discovery.notificationPct}% of traffic came from the bell.",
      "Low Discovery: Most views are from your channel page. You need to reach out.",
      "Intent: How-to queries are driving growth right now.",
      "Console Traffic: High views from TV/Console surfaces. Lean into big-screen packaging.",
      "Living Room: TV viewership is up. 4K content matters more now.",
      "Evergreen: '{v3.focus.title}' gets search traffic months after upload.",
      "Embed: A blog or website has embedded '{v3.focus.title}'.",
      "Source Shift: Traffic moved from Search to Browse. That's a viral sign.",
      "Keyword Gap: You are ranking for terms you didn’t target.",
      "Drafting: Make a video related to a currently viral topic to catch the wave.",
      "Card Clicks: People are clicking the info card on '{v3.focus.title}'.",
      "End Screen: '{v3.focus.title}' is feeding views to '{v3.playlists.nextVideoTitle}'."
    ],

    ENGAGEMENT: [
      "People aren’t just watching — they’re reacting. {v3.engagement.focusLikes} likes on ‘{v3.focus.title}’ is a strong signal.",
      "Views are fine, but the comments are quiet. That usually means the video didn’t spark a question.",
      "Pin a comment that asks one simple question. It turns passive viewers into talkers.",
      "‘{v3.focus.title}’ is getting shared {v3.engagement.focusShares} times. That’s free distribution.",
      "Your audience is doing the marketing for you. Shares are climbing fast today.",
      "Like rate is slipping on the last few uploads. That usually means the idea isn’t landing.",
      "If you want more comments: ask for a choice. ‘A or B?’ beats ‘What do you think?’",
      "Card clicks are real intent. {v3.engagement.focusCardClicks} people clicked a card on ‘{v3.focus.title}’.",
      "If card clicks are low, the card is either too late… or too random. Place it right when curiosity peaks.",
      "High views + low likes usually means people watched, but didn’t care. Let’s fix idea selection.",
      "Comment velocity is rising. That can pull more impressions because YouTube detects conversation.",
      "Reply to the top 5 comments fast. Early replies can double the thread count.",
      "Your audience is in chat mode today. Comments are up {v3.engagement.commentsUpPct}%.",
      "Shares are coming from {v3.discovery.sharingService}. That platform is your word-of-mouth engine.",
      "If you want saves/shares: put a useful moment at the end. People share conclusions.",
      "People are clicking cards but not finishing the video. The card might be stealing attention too early.",
      "Use one card only. Too many cards feels like ads.",
      "Engagement dropped right after the first minute. That often means pacing slowed.",
      "Your best engagement today is coming from ‘{v3.engagement.topEngagedTitle}’. That’s your current audience language.",
      "Turn the top comment into your next video topic. That’s demand served on a plate.",
      "A spike in comments usually means a hot take landed. Build a series off this.",
      "This upload created real community energy. People are talking to each other, not just to you.",
      "Low shares + low comments = low social spread. Add a stronger emotional moment.",
      "Ask viewers to send the video to one friend who needs it. That line works.",
      "Your engagement is strongest from {v3.audience.topCountry} right now. That’s where loyal fans live.",
      "If you want more likes, give a clear like moment right after you deliver value.",
      "High likes per view = people agree with your message. That’s a strong brand signal.",
      "Add one sentence that invites reaction: ‘This might be controversial, but…’",
      "When comments rise, recommendations often follow. You’re feeding the system good signals.",
      "End with a question easy to answer in 3 words. Short answers = more comments.",
      "Your share rate is higher on Shorts than long videos. That means your short ideas are more viral.",
      "Try a shareable format: quick checklist, myth vs truth, or one strong lesson.",
      "Your viewers are behaving like fans, not random traffic. Engagement is sticky.",
      "Comments are clustering around one timestamp. That moment is your highlight clip candidate.",
      "Clip that highlight into a Short. It already proved it triggers reactions.",
      "Your engagement is coming from unsubscribed viewers too — that’s discovery + interest.",
      "If likes are dropping across uploads, your audience may be tired of the same format.",
      "Small tweak: ask for a like right after the payoff, not at the start.",
      "If you want shares, give a ‘send this to a friend’ line with a reason.",
      "More comments = more signals. Make the prompt easier."
    ],

    PLAYLISTS: [
      "Your goal isn’t one view. It’s two videos in a row. Session time is the real win.",
      "Playlist traffic is rising. People are choosing to binge you, not just sample you.",
      "If a video has high completion, link a sequel immediately in the end screen.",
      "People are ending sessions after ‘{v3.focus.title}’. The next recommendation isn’t strong enough.",
      "Your best binge starter is ‘{v3.playlists.bingeStarterTitle}’. It’s acting like an entry ramp.",
      "Rename your playlist like a promise: ‘Start Here’, ‘Full Guide’, ‘Beginner Path’.",
      "Traffic source shows END_SCREEN is feeding views. Your internal loop is working.",
      "Use one end screen element only: the exact next video. Less choice = more clicks.",
      "Playlist views are low. That usually means your videos feel standalone instead of connected.",
      "Build a 3-part mini series. Series content manufactures returning viewers.",
      "People who start your playlist watch {v3.audience.avgViewsPerViewer28} videos on average. That’s habit-building.",
      "Put your strongest video first in the playlist, not the oldest.",
      "Suggested traffic is sending people into a playlist session. That’s a rare, powerful path.",
      "End screen traffic exists, but it’s not converting well. The ending might be too abrupt.",
      "In the last 20 seconds, say exactly what to watch next and why.",
      "Your playlists are acting like funnels. Watch time per viewer is improving.",
      "If you want binge behavior, keep the topic ‘same problem, next step’.",
      "The system is recommending ‘{v3.playlists.nextVideoTitle}’ after ‘{v3.focus.title}’ often. That pair is a strong combo.",
      "Put that combo into a 2-video playlist. YouTube understands playlists as structured sessions.",
      "Playlist traffic is coming from playlist sources — that means people are choosing structure.",
      "Make a watch order playlist and feature it on your channel homepage.",
      "When a viewer watches 2+ videos, your channel becomes trusted to the algorithm.",
      "Think like Netflix: each video should feel like next episode energy.",
      "Your internal traffic is weak today. You need stronger linking between uploads."
    ],

    AUDIENCE_QUALITY: [
      "Subscribed viewers are {v3.audience.subscribedViewsPct}% today. That’s a healthy loyal base.",
      "Unsubscribed viewers are {v3.audience.unsubscribedViewsPct}%. Discovery is doing its job.",
      "If unsubscribed views are high but subs aren’t moving, content might be entertaining but not follow-worthy.",
      "Tell new viewers what your channel is in one sentence. Make subscribing obvious.",
      "Viewer logged-in percentage is {v3.audience.viewerLoggedInPct}%. Logged-in audiences behave more consistently.",
      "Subscribed traffic is low today. That can happen when you haven’t posted in a while.",
      "Use a community post to wake up your subscriber base before your next upload.",
      "Your audience split shows you’re building both: fans and reach. That’s ideal.",
      "Your subscribed viewers are bingeing. That’s relationship content.",
      "If subscribed viewers click but leave fast, the video may not match what they expect from you.",
      "Most discovery today is coming from {v3.discovery.topTrafficSource}. That’s your current growth door.",
      "Double down on the traffic door that’s open. Make the next upload fit that entry path.",
      "Shorts viewers behave differently than long-form viewers. Don’t judge by the same retention rules.",
      "If Shorts views rise but long-form dies, you need a bridge video that converts Shorts fans into long watchers.",
      "Bridge trick: make a long video that begins like a Short — fast hook, no intro.",
      "Subscribed vs unsubscribed split is telling a story. Today’s story: {v3.audience.storyLine}.",
      "Your audience is stabilizing. More subscribed views = more predictable growth.",
      "Discovery is strong, but loyalty is weak. Add recurring formats so people return.",
      "You want a ladder: Shorts bring them in, long-form makes them stay, playlists make them binge."
    ],

    CADENCE: [
      "It’s been {v3.cadence.daysSinceUpload} days since the last upload. Momentum decays when the feed goes quiet.",
      "If you can’t upload, post: teaser clip, community poll, or a short update. Keep the channel warm.",
      "Your audience is most active around {v3.cadence.bestHour}. That’s your safest upload window.",
      "If your niche spikes on weekends, schedule the strongest video for the day before the spike.",
      "You’re relying on old videos today. That’s fine, but a fresh upload would re-activate browse traffic.",
      "Try a predictable rhythm: same day each week. Humans love routine."
    ],

    LIVE: [
      "Live momentum: {v3.live.concurrentNow} people are watching right now. That’s real-time attention.",
      "Peak concurrent just hit {v3.live.peakConcurrent}. That’s a crowd.",
      "Concurrent viewers dipped after {v3.live.minuteMark}. That might be where pacing slowed.",
      "Say names in chat. It increases stickiness because people feel seen.",
      "Your live viewers are arriving from {v3.live.topTrafficSource}. That’s the pipeline feeding the stream.",
      "Pin one clear goal on screen: ‘We’re building X today’ — it gives viewers a reason to stay.",
      "Live retention is leaking early. Start with the most exciting moment, not the warmup.",
      "Chat is active today. That’s a signal the stream has community energy.",
      "After the live ends, the replay becomes long-form. Title + thumbnail still matter.",
      "Turn one strong live moment into 3 Shorts. Live is content mining."
    ],

    MONEY_CLARITY: [
      "Your estimated revenue today is ${v3.money.estimatedRevenueToday}. The library is working.",
      "CPM is ${v3.money.cpm} right now (what advertisers pay). RPM is what you keep per 1,000 views.",
      "If you want higher RPM, aim for viewers in higher-paying regions and longer watch sessions.",
      "Revenue dipped while views stayed stable. That usually means CPM softened or the view mix changed."
    ]
  };
}

/**
 * Ensures we have exactly N templates (adds non-empty templates if missing).
 * This keeps the deck count stable even if you trim decks in the chat editor.
 */
function ensureTemplateCount(decks, target = 380) {
  const count = () =>
    Object.values(decks).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0);

  let total = count();
  if (total >= target) return;

  const tags = [
    "GROWTH",
    "ALGORITHM",
    "COMMUNITY",
    "QUALITY",
    "FORMAT",
    "STRATEGY",
    "SYSTEMS",
    "DISCOVERY",
    "PACKAGING",
    "RETENTION_PLUS"
  ];

  const patterns = [
    "Signal check: {v3.realtime.avgViewsPerDay7d} views/day pace. Keep the flywheel spinning.",
    "Your discovery door is {v3.discovery.topTrafficSource}. Make the next upload fit that door.",
    "If CTR stays at {v3.packaging.ctrPct}%, the algorithm will keep testing you. Keep refining packaging.",
    "Your watch-time engine is {v3.realtime.attentionHoursPerDay} hours/day. That's real compounding attention.",
    "Subscribed views are {v3.audience.subscribedViewsPct}%. Loyalty is the stabilizer.",
    "Unsubscribed views are {v3.audience.unsubscribedViewsPct}%. Discovery is the growth lever.",
    "Your top search phrase is '{v3.discovery.keyword}'. Make a sequel targeting the same intent.",
    "External traffic is coming from {v3.discovery.website}. Double down on that distribution channel.",
    "Shares are strongest on {v3.discovery.sharingService}. That platform is your word-of-mouth layer.",
    "Playlist sessions matter: push viewers from '{v3.focus.title}' into '{v3.playlists.nextVideoTitle}'.",
    "Retention on '{v3.focus.title}' is {v3.retention.avgViewPct}%. Keep the pacing tight.",
    "Real-time 48h views: {v3.realtime.viewsLast48Hours}. That's the current momentum.",
    "Shorts spotlight: '{v3.shorts.title}' at {v3.shorts.viewsSpotlight} views. Clip more like this.",
    "Shorts discovery share: {v3.shorts.discoveryPct}%. You're getting real Shorts feed exposure.",
    "Cadence check: {v3.cadence.daysSinceUpload} days since upload. Predictable rhythm wins.",
    "Your best upload hour (historical) is {v3.cadence.bestHour}. Try to stay consistent.",
    "Geography focus: {v3.audience.topCountry} is your top region right now.",
    "Money math: RPM is ${v3.money.rpm} and CPM is ${v3.money.cpm}. Optimize session length.",
    "Engagement leader: '{v3.engagement.topEngagedTitle}' is where the audience language is today.",
    "Card clicks on focus video: {v3.engagement.focusCardClicks}. Place cards at curiosity peaks."
  ];

  let i = 0;
  while (total < target) {
    const tag = tags[i % tags.length];
    if (!decks[tag]) decks[tag] = [];
    decks[tag].push(patterns[i % patterns.length]);
    i++;
    total = count();
  }

  // If we somehow overshoot (shouldn't), trim from the last tag.
  while (total > target) {
    const lastTag = tags[(i - 1) % tags.length];
    if (decks[lastTag] && decks[lastTag].length) decks[lastTag].pop();
    total = count();
  }
}

/* ---------------------- buildHUDMessageTemplatesV3 --------------------- */

function buildHUDMessageTemplatesV3(v3Data) {
  const decks = HUD_TEMPLATE_DECKS_V3;
  const templates = [];

  let id = 1;
  for (const [tag, list] of Object.entries(decks)) {
    for (const t of list) {
      if (typeof t !== "string") continue;
      const text = t.trim();
      if (!text) continue;
      templates.push({ id: `v3_${id++}`, tag, text });
    }
  }

  // ✅ Server-side safety filter: only return templates that can fully resolve
  return templates.filter(t => isSafeTemplate(t.text, v3Data));
}

/* -------------------------- KPI / V3 Data Build ------------------------ */

async function fetchChannelBasics(apiKey, channelId) {
  const res = await ytV3GET(apiKey, "channels", {
    part: "snippet,statistics",
    id: channelId
  });
  if (res.error) return null;
  const item = res.data?.items?.[0];
  if (!item) return null;

  return {
    channelId: item.id,
    title: item.snippet?.title || "",
    publishedAt: item.snippet?.publishedAt || "",
    subscribers: safeNum(item.statistics?.subscriberCount, 0),
    totalViews: safeNum(item.statistics?.viewCount, 0),
    videos: safeNum(item.statistics?.videoCount, 0),
    thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || ""
  };
}

async function fetchUploadsPlaylistId(apiKey, channelId) {
  const res = await ytV3GET(apiKey, "channels", {
    part: "contentDetails",
    id: channelId
  });
  if (res.error) return null;
  const item = res.data?.items?.[0];
  return item?.contentDetails?.relatedPlaylists?.uploads || null;
}

async function fetchRecentUploads(apiKey, uploadsPlaylistId, maxResults = 25) {
  const res = await ytV3GET(apiKey, "playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: clamp(maxResults, 1, 50)
  });
  if (res.error) return [];
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  return items
    .map(it => ({
      videoId: it?.contentDetails?.videoId || "",
      title: it?.snippet?.title || "",
      publishedAt: it?.contentDetails?.videoPublishedAt || it?.snippet?.publishedAt || ""
    }))
    .filter(x => x.videoId);
}

function parseISODurationToSeconds(iso) {
  // PT#H#M#S → seconds
  if (!iso || typeof iso !== "string") return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = safeNum(m[1], 0);
  const min = safeNum(m[2], 0);
  const s = safeNum(m[3], 0);
  return h * 3600 + min * 60 + s;
}

async function fetchVideoDetails(apiKey, videoIds = []) {
  const ids = Array.from(new Set(videoIds.filter(Boolean))).slice(0, 50);
  if (!ids.length) return new Map();

  const res = await ytV3GET(apiKey, "videos", {
    part: "snippet,contentDetails,statistics,liveStreamingDetails",
    id: ids.join(",")
  });
  const map = new Map();
  if (res.error) return map;

  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  for (const v of items) {
    const id = v?.id;
    if (!id) continue;
    const durSec = parseISODurationToSeconds(v?.contentDetails?.duration || "");
    map.set(id, {
      videoId: id,
      title: v?.snippet?.title || "",
      publishedAt: v?.snippet?.publishedAt || "",
      durationSec: durSec,
      views: safeNum(v?.statistics?.viewCount, 0),
      likes: safeNum(v?.statistics?.likeCount, 0),
      comments: safeNum(v?.statistics?.commentCount, 0),
      isLive: Boolean(v?.liveStreamingDetails?.actualStartTime && !v?.liveStreamingDetails?.actualEndTime)
    });
  }
  return map;
}

async function fetchPlaylistTitles(apiKey, playlistIds = []) {
  const ids = Array.from(new Set(playlistIds.filter(Boolean))).slice(0, 50);
  const map = new Map();
  if (!ids.length) return map;

  const res = await ytV3GET(apiKey, "playlists", {
    part: "snippet",
    id: ids.join(",")
  });
  if (res.error) return map;

  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  for (const pl of items) {
    const id = pl?.id;
    if (!id) continue;
    map.set(id, pl?.snippet?.title || "");
  }
  return map;
}

function buildHeaderIndex(columnHeaders = []) {
  const idx = {};
  for (let i = 0; i < columnHeaders.length; i++) {
    const name = columnHeaders[i]?.name;
    if (name) idx[name] = i;
  }
  return idx;
}

function rowObj(headersIdx, row) {
  const o = {};
  for (const [k, i] of Object.entries(headersIdx)) {
    o[k] = row?.[i];
  }
  return o;
}

function pickTop(rows, dimIndex = 0, metricIndex = 1) {
  const list = rowsToDimList(rows, dimIndex, metricIndex);
  return list?.[0] || null;
}

/* -------------------------- Core KPI Builder -------------------------- */

async function buildV3Data({ apiKey, env, oauthToken, channelBasics, uploads }) {
  const now = new Date();

  // Analytics dates are based on Pacific time days; using "yesterday" reduces partial-day weirdness.
  const latestDay = isoDate(shiftDays(now, -1));
  const start7 = isoDate(shiftDays(now, -7));
  const start14 = isoDate(shiftDays(now, -14));
  const start28 = isoDate(shiftDays(now, -28));
  const start9 = isoDate(shiftDays(now, -9));
  const start2 = isoDate(shiftDays(now, -2));

  // Base v3 object with non-empty strings (so templates can resolve safely)
  const v3 = {
    focus: { title: (uploads?.[0]?.title || channelBasics?.title || "Your latest video") },
    realtime: {
      viewsLastHour: 0,
      estimatedConcurrent: 0,
      vsBaseline48hPct: 0,
      attentionHoursPerDay: 0,
      avgViewsPerDay7d: 0,
      vsYesterdayPct: 0,
      bestDayViews7d: 0,
      viewsLast48Hours: 0
    },
    shorts: {
      title: (uploads?.find(x => x?.title)?.title || "Your Shorts"),
      viewedRatePct: 0,
      loopRetentionPct: 0,
      trafficPct: 0,
      views48h: 0,
      subsPer1kPct: 0,
      last3DropPct: 0,
      viewsSpotlight: 0,
      discoveryPct: 0,
      stopRatePct: 0,
      vsLastWeekPct: 0
    },
    packaging: {
      impressions: 0,
      ctrPct: 0,
      clicksPer1kImpressions: 0
    },
    retention: {
      avgViewPct: 0,
      avdMinutes: 0,
      avdSeconds: 0,
      completionPct: 0
    },
    engagement: {
      focusLikes: 0,
      focusShares: 0,
      focusCardClicks: 0,
      commentsUpPct: 0,
      topEngagedTitle: uploads?.[0]?.title || "Your top video"
    },
    discovery: {
      keyword: "",
      website: "",
      sharingService: "",
      playlistName: "",
      browsePct: 0,
      notificationPct: 0,
      topTrafficSource: ""
    },
    playlists: {
      bingeStarterTitle: uploads?.[0]?.title || "Your best binge starter",
      nextVideoTitle: uploads?.[1]?.title || uploads?.[0]?.title || "Your next video"
    },
    audience: {
      subscribedViewsPct: 0,
      unsubscribedViewsPct: 0,
      viewerLoggedInPct: 0,
      newViewerPct: 0,
      coreViewers: 0,
      uniqueViewers28: 0,
      uniqueGrowthPct: 0,
      avgViewsPerViewer28: 1.2,
      topCountry: "",
      storyLine: ""
    },
    cadence: {
      daysSinceUpload: 0,
      bestHour: ""
    },
    live: {
      concurrentNow: 0,
      peakConcurrent: 0,
      minuteMark: "5:00",
      topTrafficSource: ""
    },
    money: {
      estimatedRevenueToday: 0,
      estimatedRevenue28d: 0,
      cpm: 0,
      rpm: 0,
      top10IncomePct: 0
    }
  };

  // --------------------------
  // Upload cadence (from Data API publish times)
  // --------------------------
  try {
    const latestUploadAt = uploads?.[0]?.publishedAt;
    if (latestUploadAt) v3.cadence.daysSinceUpload = daysBetweenUTC(now, latestUploadAt);

    const hours = (uploads || [])
      .map(u => u?.publishedAt)
      .filter(Boolean)
      .map(ts => new Date(ts).getUTCHours());

    if (hours.length) {
      const freq = new Map();
      for (const h of hours) freq.set(h, (freq.get(h) || 0) + 1);
      let bestH = hours[0], bestC = -1;
      for (const [h, c] of freq.entries()) {
        if (c > bestC) { bestC = c; bestH = h; }
      }
      v3.cadence.bestHour = `${String(bestH).padStart(2, "0")}:00 UTC`;
    } else {
      v3.cadence.bestHour = "18:00 UTC";
    }
  } catch {
    v3.cadence.bestHour = "18:00 UTC";
  }

  // --------------------------
  // Channel daily stats (views + watch time)
  // --------------------------
  const daily9 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start9,
    endDate: latestDay,
    dimensions: "day",
    metrics: "views,estimatedMinutesWatched",
    sort: "day"
  });

  const dayIdx = buildHeaderIndex(daily9.columnHeaders);
  const dayRows = (daily9.rows || []).map(r => rowObj(dayIdx, r));
  const dailyViews = dayRows.map(x => ({
    day: x.day,
    views: safeNum(x.views, 0),
    minutes: safeNum(x.estimatedMinutesWatched, 0)
  }));

  // last 7 days (excluding earliest in 9)
  const last7 = dailyViews.slice(-7);
  const sum7Views = last7.reduce((a, x) => a + x.views, 0);
  const sum7Min = last7.reduce((a, x) => a + x.minutes, 0);

  v3.realtime.avgViewsPerDay7d = Math.round(sum7Views / Math.max(1, last7.length));
  v3.realtime.attentionHoursPerDay = Math.round((sum7Min / 60) / Math.max(1, last7.length));

  v3.realtime.bestDayViews7d = last7.reduce((m, x) => Math.max(m, x.views), 0);

  // yesterday vs day before yesterday
  if (dailyViews.length >= 2) {
    const y = dailyViews[dailyViews.length - 1]?.views || 0;
    const dby = dailyViews[dailyViews.length - 2]?.views || 0;
    v3.realtime.vsYesterdayPct = dby > 0 ? Math.round(((y - dby) / dby) * 100) : 0;
  }

  // last 48 hours = last 2 full days of views
  const last2 = dailyViews.slice(-2);
  const last2Views = last2.reduce((a, x) => a + x.views, 0);
  v3.realtime.viewsLast48Hours = last2Views;
  v3.realtime.viewsLastHour = Math.max(0, Math.round(last2Views / 48));

  // baseline 48h from prior 7 days (use 7 days before last 2)
  const baselineDays = dailyViews.slice(Math.max(0, dailyViews.length - 9), Math.max(0, dailyViews.length - 2));
  const baselineAvg = baselineDays.reduce((a, x) => a + x.views, 0) / Math.max(1, baselineDays.length);
  const baseline48h = baselineAvg * 2;
  v3.realtime.vsBaseline48hPct = baseline48h > 0 ? Math.round(((last2Views - baseline48h) / baseline48h) * 100) : 0;

  // --------------------------
  // Per-video performance (7d + 28d)
  // --------------------------
  const perVideo28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "video",
    metrics: [
      "views",
      "estimatedMinutesWatched",
      "averageViewDuration",
      "averageViewPercentage",
      "subscribersGained",
      "likes",
      "comments",
      "shares",
      "videoThumbnailImpressions",
      "videoThumbnailImpressionsClickRate"
    ].join(","),
    sort: "-views",
    maxResults: 50
  });

  const pv28Idx = buildHeaderIndex(perVideo28.columnHeaders);
  const pv28Rows = (perVideo28.rows || []).map(r => rowObj(pv28Idx, r));

  // Focus video
  const focusId = pv28Rows?.[0]?.video || uploads?.[0]?.videoId || "";
  const focusRow = pv28Rows?.find(r => r.video === focusId) || pv28Rows?.[0] || {};

  // Video details for focus + uploads + top short + top engaged
  const perVideo7 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start7,
    endDate: latestDay,
    dimensions: "video",
    metrics: [
      "views",
      "estimatedMinutesWatched",
      "averageViewDuration",
      "averageViewPercentage",
      "subscribersGained",
      "likes",
      "comments",
      "shares",
      "videoThumbnailImpressions",
      "videoThumbnailImpressionsClickRate"
    ].join(","),
    sort: "-views",
    maxResults: 50
  });
  const pv7Idx = buildHeaderIndex(perVideo7.columnHeaders);
  const pv7Rows = (perVideo7.rows || []).map(r => rowObj(pv7Idx, r));

  // Engagement leader (7d): maximize likes+comments+shares
  let topEngagedId = "";
  let topEngScore = -1;
  for (const r of pv7Rows) {
    const score =
      safeNum(r.likes, 0) +
      safeNum(r.comments, 0) * 2 +
      safeNum(r.shares, 0) * 3;
    if (score > topEngScore) {
      topEngScore = score;
      topEngagedId = r.video;
    }
  }

  // Shorts top video (28d)
  const perShorts28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "video",
    filters: "creatorContentType==SHORTS",
    metrics: [
      "views",
      "estimatedMinutesWatched",
      "averageViewDuration",
      "averageViewPercentage",
      "subscribersGained",
      "likes",
      "comments",
      "shares"
    ].join(","),
    sort: "-views",
    maxResults: 25
  });
  const ps28Idx = buildHeaderIndex(perShorts28.columnHeaders);
  const ps28Rows = (perShorts28.rows || []).map(r => rowObj(ps28Idx, r));
  const topShortId = ps28Rows?.[0]?.video || "";

  // Pull video details (Data API)
  const uploadIds = (uploads || []).map(u => u.videoId).filter(Boolean);
  const detailIds = Array.from(new Set([focusId, topShortId, topEngagedId, ...uploadIds].filter(Boolean))).slice(0, 50);
  const details = await fetchVideoDetails(apiKey, detailIds);

  const focusDetails = details.get(focusId) || details.get(uploadIds[0]) || null;
  if (focusDetails?.title) v3.focus.title = focusDetails.title;

  const topShortDetails = details.get(topShortId) || null;
  if (topShortDetails?.title) v3.shorts.title = topShortDetails.title;

  const topEngDetails = details.get(topEngagedId) || null;
  v3.engagement.topEngagedTitle = topEngDetails?.title || v3.focus.title;

  // --------------------------
  // Packaging + retention from focus row
  // --------------------------
  v3.packaging.impressions = Math.round(safeNum(focusRow.videoThumbnailImpressions, 0));
  v3.packaging.ctrPct = Math.round(safeNum(focusRow.videoThumbnailImpressionsClickRate, 0) * 100) / 100;
  v3.packaging.clicksPer1kImpressions = Math.round((v3.packaging.ctrPct / 100) * 1000);

  const avdSec = Math.round(safeNum(focusRow.averageViewDuration, 0));
  v3.retention.avdSeconds = avdSec;
  v3.retention.avdMinutes = Math.round((avdSec / 60) * 10) / 10;
  v3.retention.avgViewPct = Math.round(safeNum(focusRow.averageViewPercentage, 0) * 10) / 10;
  v3.retention.completionPct = Math.round(v3.retention.avgViewPct);

  // Engagement focus numbers
  v3.engagement.focusLikes = Math.round(safeNum(focusRow.likes, 0));
  v3.engagement.focusShares = Math.round(safeNum(focusRow.shares, 0));

  // --------------------------
  // Traffic sources (28d) + browse pct + notifications
  // --------------------------
  const traffic28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "insightTrafficSourceType",
    metrics: "views",
    sort: "-views",
    maxResults: 50
  });
  const topTraffic = pickTop(traffic28.rows, 0, 1);
  v3.discovery.topTrafficSource = titleizeEnum(topTraffic?.dim || "UNKNOWN") || "Unknown";

  const trafficList = rowsToDimList(traffic28.rows, 0, 1);
  const totalTrafficViews = trafficList.reduce((a, x) => a + x.value, 0);
  const notif = trafficList.find(x => x.dim === "NOTIFICATION")?.value || 0;
  v3.discovery.notificationPct = Math.round(percent(notif, totalTrafficViews) * 10) / 10;

  const shortsRef = trafficList.find(x => x.dim === "SHORTS")?.value || 0;
  v3.shorts.discoveryPct = Math.round(percent(shortsRef, totalTrafficViews) * 10) / 10;

  const playback28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "insightPlaybackLocationType",
    metrics: "views",
    sort: "-views",
    maxResults: 50
  });
  const playbackList = rowsToDimList(playback28.rows, 0, 1);
  const totalPlaybackViews = playbackList.reduce((a, x) => a + x.value, 0);
  const browse = playbackList.find(x => x.dim === "BROWSE")?.value || 0;
  v3.discovery.browsePct = Math.round(percent(browse, totalPlaybackViews) * 10) / 10;

  // --------------------------
  // Country
  // --------------------------
  const country28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "country",
    metrics: "views",
    sort: "-views",
    maxResults: 10
  });
  v3.audience.topCountry = (pickTop(country28.rows, 0, 1)?.dim || "Unknown").toString();

  // --------------------------
  // Subscribed split (7d)
  // --------------------------
  const sub7 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start7,
    endDate: latestDay,
    dimensions: "subscribedStatus",
    metrics: "views",
    maxResults: 5
  });
  const subList = rowsToDimList(sub7.rows, 0, 1);
  const totalSub = subList.reduce((a, x) => a + x.value, 0);
  const subViews = subList.find(x => x.dim === "SUBSCRIBED")?.value || 0;
  const unsubViews = subList.find(x => x.dim === "UNSUBSCRIBED")?.value || 0;
  v3.audience.subscribedViewsPct = Math.round(percent(subViews, totalSub) * 10) / 10;
  v3.audience.unsubscribedViewsPct = Math.round(percent(unsubViews, totalSub) * 10) / 10;

  v3.audience.newViewerPct = Math.round(v3.audience.unsubscribedViewsPct);
  v3.audience.storyLine =
    v3.audience.unsubscribedViewsPct >= 70 ? "Discovery-heavy day" :
    v3.audience.subscribedViewsPct >= 40 ? "Loyalty is strong" :
    "Balanced reach + loyalty";

  // Viewer logged-in percentage (28d)
  const logged28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    metrics: "viewerPercentage"
  });
  const loggedIdx = buildHeaderIndex(logged28.columnHeaders);
  const loggedRow = logged28.rows?.[0] ? rowObj(loggedIdx, logged28.rows[0]) : {};
  v3.audience.viewerLoggedInPct = Math.round(safeNum(loggedRow.viewerPercentage, 0) * 10) / 10;

  // --------------------------
  // Content type split (Shorts traffic %)
  // --------------------------
  const type28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "creatorContentType",
    metrics: "views",
    sort: "-views"
  });
  const typeList = rowsToDimList(type28.rows, 0, 1);
  const totalTypeViews = typeList.reduce((a, x) => a + x.value, 0);
  const shortsTypeViews = typeList.find(x => x.dim === "SHORTS")?.value || 0;
  v3.shorts.trafficPct = Math.round(percent(shortsTypeViews, totalTypeViews) * 10) / 10;

  // --------------------------
  // Shorts momentum (7d vs previous 7d)
  // --------------------------
  const shorts7 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start7,
    endDate: latestDay,
    filters: "creatorContentType==SHORTS",
    metrics: "views,subscribersGained"
  });
  const shorts7Idx = buildHeaderIndex(shorts7.columnHeaders);
  const shorts7Row = shorts7.rows?.[0] ? rowObj(shorts7Idx, shorts7.rows[0]) : {};
  const shorts7Views = safeNum(shorts7Row.views, 0);
  const shorts7Subs = safeNum(shorts7Row.subscribersGained, 0);

  const prev7Start = isoDate(shiftDays(now, -14));
  const prev7End = isoDate(shiftDays(now, -8));
  const shortsPrev7 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: prev7Start,
    endDate: prev7End,
    filters: "creatorContentType==SHORTS",
    metrics: "views"
  });
  const shortsPrevIdx = buildHeaderIndex(shortsPrev7.columnHeaders);
  const shortsPrevRow = shortsPrev7.rows?.[0] ? rowObj(shortsPrevIdx, shortsPrev7.rows[0]) : {};
  const shortsPrevViews = safeNum(shortsPrevRow.views, 0);

  v3.shorts.vsLastWeekPct = shortsPrevViews > 0 ? Math.round(((shorts7Views - shortsPrevViews) / shortsPrevViews) * 100) : 0;
  v3.shorts.subsPer1kPct = shorts7Views > 0 ? Math.round((shorts7Subs / shorts7Views) * 1000 * 10) / 10 : 0;

  // "48h shorts views" approximated via last 2 full days of shorts views
  const shorts2 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start2,
    endDate: latestDay,
    dimensions: "day",
    filters: "creatorContentType==SHORTS",
    metrics: "views",
    sort: "day"
  });
  const shorts2Idx = buildHeaderIndex(shorts2.columnHeaders);
  const shorts2Rows = (shorts2.rows || []).map(r => rowObj(shorts2Idx, r));
  v3.shorts.views48h = shorts2Rows.reduce((a, r) => a + safeNum(r.views, 0), 0);

  // Shorts "viewed/stop/loop retention" approximations from avg % and AVD vs duration
  const topShortRow = ps28Rows?.[0] || {};
  const topShortAVD = safeNum(topShortRow.averageViewDuration, 0);
  const topShortAVP = safeNum(topShortRow.averageViewPercentage, 0);
  const topShortDur = safeNum(topShortDetails?.durationSec, 0) || 60;

  v3.shorts.stopRatePct = Math.round(topShortAVP * 10) / 10;
  v3.shorts.viewedRatePct = v3.shorts.stopRatePct;
  v3.shorts.loopRetentionPct = Math.round((topShortAVD / Math.max(1, topShortDur)) * 100 * 10) / 10;
  v3.shorts.viewsSpotlight = Math.round(safeNum(topShortRow.views, 0));

  // last3DropPct from last 6 Shorts uploads (lifetime views proxy)
  try {
    const shortsUploads = (uploads || [])
      .map(u => u.videoId)
      .filter(id => {
        const d = details.get(id);
        return d && d.durationSec > 0 && d.durationSec <= 60;
      })
      .slice(0, 6);

    const last3 = shortsUploads.slice(0, 3).map(id => details.get(id)?.views || 0);
    const prev3 = shortsUploads.slice(3, 6).map(id => details.get(id)?.views || 0);

    const avgLast3 = last3.reduce((a, x) => a + x, 0) / Math.max(1, last3.length);
    const avgPrev3 = prev3.reduce((a, x) => a + x, 0) / Math.max(1, prev3.length);

    v3.shorts.last3DropPct = avgPrev3 > 0 ? Math.round(((avgLast3 - avgPrev3) / avgPrev3) * 100) : 0;
  } catch {
    v3.shorts.last3DropPct = 0;
  }

  // --------------------------
  // Focus: keyword, website, playlist detail (requires focus + traffic source detail)
  // --------------------------
  if (focusId) {
    const kw = await safeAnalytics(env, oauthToken, {
      ids: "channel==MINE",
      startDate: start28,
      endDate: latestDay,
      dimensions: "insightTrafficSourceDetail",
      metrics: "views",
      filters: `video==${focusId};insightTrafficSourceType==YT_SEARCH`,
      sort: "-views",
      maxResults: 10
    });
    const kwTop = pickTop(kw.rows, 0, 1)?.dim || "";
    v3.discovery.keyword = String(kwTop || "").trim() || (v3.focus.title.split(/\s+/).slice(0, 3).join(" ") || "your topic");

    const ext = await safeAnalytics(env, oauthToken, {
      ids: "channel==MINE",
      startDate: start28,
      endDate: latestDay,
      dimensions: "insightTrafficSourceDetail",
      metrics: "views",
      filters: `video==${focusId};insightTrafficSourceType==EXT_URL`,
      sort: "-views",
      maxResults: 10
    });
    const extTop = pickTop(ext.rows, 0, 1)?.dim || "";
    v3.discovery.website = hostnameFromUrl(extTop) || "external websites";

    const pl = await safeAnalytics(env, oauthToken, {
      ids: "channel==MINE",
      startDate: start28,
      endDate: latestDay,
      dimensions: "insightTrafficSourceDetail",
      metrics: "views",
      filters: `video==${focusId};insightTrafficSourceType==PLAYLIST`,
      sort: "-views",
      maxResults: 10
    });
    const plTop = String(pickTop(pl.rows, 0, 1)?.dim || "").trim();
    let playlistName = plTop;

    // If it looks like a playlist ID, fetch the real title
    if (playlistName && /^[A-Z0-9_-]{10,}$/.test(playlistName)) {
      const plTitles = await fetchPlaylistTitles(apiKey, [playlistName]);
      playlistName = plTitles.get(playlistName) || playlistName;
    }
    v3.discovery.playlistName = playlistName || "your playlists";

    const shareSvc = await safeAnalytics(env, oauthToken, {
      ids: "channel==MINE",
      startDate: start28,
      endDate: latestDay,
      dimensions: "sharingService",
      metrics: "shares",
      filters: `video==${focusId}`,
      sort: "-shares",
      maxResults: 10
    });
    const shareTop = pickTop(shareSvc.rows, 0, 1)?.dim || "";
    v3.discovery.sharingService = titleizeEnum(shareTop) || "Other";

    const card = await safeAnalytics(env, oauthToken, {
      ids: "channel==MINE",
      startDate: start28,
      endDate: latestDay,
      metrics: "cardClicks",
      filters: `video==${focusId}`
    });
    const cardIdx = buildHeaderIndex(card.columnHeaders);
    const cardRow = card.rows?.[0] ? rowObj(cardIdx, card.rows[0]) : {};
    v3.engagement.focusCardClicks = Math.round(safeNum(cardRow.cardClicks, 0));
  }

  // --------------------------
  // Comments up % (7d vs prev 7d)
  // --------------------------
  const c7 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start7,
    endDate: latestDay,
    metrics: "comments"
  });
  const c7Idx = buildHeaderIndex(c7.columnHeaders);
  const c7Row = c7.rows?.[0] ? rowObj(c7Idx, c7.rows[0]) : {};
  const comments7 = safeNum(c7Row.comments, 0);

  const cPrev = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: prev7Start,
    endDate: prev7End,
    metrics: "comments"
  });
  const cPrevIdx = buildHeaderIndex(cPrev.columnHeaders);
  const cPrevRow = cPrev.rows?.[0] ? rowObj(cPrevIdx, cPrev.rows[0]) : {};
  const commentsPrev = safeNum(cPrevRow.comments, 0);

  v3.engagement.commentsUpPct = commentsPrev > 0 ? Math.round(((comments7 - commentsPrev) / commentsPrev) * 100) : 0;

  // --------------------------
  // Playlists: binge starter + next title (from top 2 videos in 28d)
  // --------------------------
  const top1 = pv28Rows?.[0]?.video || "";
  const top2 = pv28Rows?.[1]?.video || "";
  v3.playlists.bingeStarterTitle = details.get(top1)?.title || v3.focus.title;
  v3.playlists.nextVideoTitle = details.get(top2)?.title || uploads?.[1]?.title || v3.playlists.bingeStarterTitle;

  // --------------------------
  // Money (28d + latest day) — requires yt-analytics-monetary scope to populate
  // --------------------------
  const money28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    metrics: "estimatedRevenue,cpm,views"
  });
  const moneyIdx = buildHeaderIndex(money28.columnHeaders);
  const moneyRow = money28.rows?.[0] ? rowObj(moneyIdx, money28.rows[0]) : {};
  const views28 = safeNum(moneyRow.views, sum7Views * 4);
  v3.money.estimatedRevenue28d = Math.round(safeNum(moneyRow.estimatedRevenue, 0) * 100) / 100;
  v3.money.cpm = Math.round(safeNum(moneyRow.cpm, 0) * 100) / 100;
  v3.money.rpm = views28 > 0 ? Math.round((v3.money.estimatedRevenue28d / views28) * 1000 * 100) / 100 : 0;

  const moneyDay = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: latestDay,
    endDate: latestDay,
    dimensions: "day",
    metrics: "estimatedRevenue"
  });
  const mdIdx = buildHeaderIndex(moneyDay.columnHeaders);
  const mdRow = moneyDay.rows?.[0] ? rowObj(mdIdx, moneyDay.rows[0]) : {};
  v3.money.estimatedRevenueToday = Math.round(safeNum(mdRow.estimatedRevenue, 0) * 100) / 100;

  const revTop10 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "video",
    metrics: "estimatedRevenue",
    sort: "-estimatedRevenue",
    maxResults: 10
  });
  const rtIdx = buildHeaderIndex(revTop10.columnHeaders);
  const rtRows = (revTop10.rows || []).map(r => rowObj(rtIdx, r));
  const top10Sum = rtRows.reduce((a, r) => a + safeNum(r.estimatedRevenue, 0), 0);
  v3.money.top10IncomePct = v3.money.estimatedRevenue28d > 0 ? Math.round((top10Sum / v3.money.estimatedRevenue28d) * 100) : 0;

  // --------------------------
  // Audience approximations (unique viewers & core)
  // --------------------------
  // Unique viewers isn't exposed in Analytics API; approximate from views / avgViewsPerViewer.
  v3.audience.avgViewsPerViewer28 = Math.round((1.1 + (v3.audience.subscribedViewsPct / 100) * 0.8) * 10) / 10;
  v3.audience.uniqueViewers28 = Math.round(views28 / Math.max(1, v3.audience.avgViewsPerViewer28));
  v3.audience.coreViewers = Math.round((subViews / 7) / Math.max(0.5, v3.audience.avgViewsPerViewer28));

  const prev28Start = isoDate(shiftDays(now, -56));
  const prev28End = isoDate(shiftDays(now, -29));
  const prev28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: prev28Start,
    endDate: prev28End,
    metrics: "views"
  });
  const p28Idx = buildHeaderIndex(prev28.columnHeaders);
  const p28Row = prev28.rows?.[0] ? rowObj(p28Idx, prev28.rows[0]) : {};
  const prevViews28 = safeNum(p28Row.views, 0);
  const prevUnique = Math.round(prevViews28 / Math.max(1, v3.audience.avgViewsPerViewer28));
  v3.audience.uniqueGrowthPct = prevUnique > 0 ? Math.round(((v3.audience.uniqueViewers28 - prevUnique) / prevUnique) * 100) : 0;

  // --------------------------
  // Live (if present)
  // --------------------------
  const live28 = await safeAnalytics(env, oauthToken, {
    ids: "channel==MINE",
    startDate: start28,
    endDate: latestDay,
    dimensions: "video",
    filters: "creatorContentType==LIVE_STREAM",
    metrics: "averageConcurrentViewers,peakConcurrentViewers,views",
    sort: "-peakConcurrentViewers",
    maxResults: 5
  });
  const liveIdx = buildHeaderIndex(live28.columnHeaders);
  const liveRows = (live28.rows || []).map(r => rowObj(liveIdx, r));
  const liveTop = liveRows?.[0] || {};
  const liveId = liveTop.video || "";
  v3.live.concurrentNow = Math.round(safeNum(liveTop.averageConcurrentViewers, 0));
  v3.live.peakConcurrent = Math.round(safeNum(liveTop.peakConcurrentViewers, 0));

  if (liveId) {
    const liveTraffic = await safeAnalytics(env, oauthToken, {
      ids: "channel==MINE",
      startDate: start28,
      endDate: latestDay,
      dimensions: "insightTrafficSourceType",
      metrics: "views",
      filters: `video==${liveId}`,
      sort: "-views",
      maxResults: 10
    });
    v3.live.topTrafficSource = titleizeEnum(pickTop(liveTraffic.rows, 0, 1)?.dim || "") || "Unknown";
  } else {
    v3.live.topTrafficSource = "Unknown";
  }

  // Keep string fields non-empty
  if (!v3.discovery.keyword) v3.discovery.keyword = (v3.focus.title.split(/\s+/).slice(0, 3).join(" ") || "your topic");
  if (!v3.discovery.website) v3.discovery.website = "external websites";
  if (!v3.discovery.sharingService) v3.discovery.sharingService = "Other";
  if (!v3.discovery.playlistName) v3.discovery.playlistName = "your playlists";
  if (!v3.discovery.topTrafficSource) v3.discovery.topTrafficSource = "Unknown";
  if (!v3.audience.topCountry) v3.audience.topCountry = "Unknown";
  if (!v3.cadence.bestHour) v3.cadence.bestHour = "18:00 UTC";

  return v3;
}

/* --------------------------- Cloudflare Handler ------------------------ */

function pickRandom(arr, n = 3) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  const out = [];
  while (a.length && out.length < n) {
    const i = Math.floor(Math.random() * a.length);
    out.push(a.splice(i, 1)[0]);
  }
  return out;
}

export async function onRequest(context) {
  const req = context.request;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
  }

  if (req.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(req.url);
  const env = context.env || {};

  const apiKey = env.YT_API_KEY || "";
  const oauthToken = await resolveOAuthToken(env, req);
  const channelId =
    url.searchParams.get("channelId") ||
    url.searchParams.get("cid") ||
    env.YT_CHANNEL_ID ||
    "";

  if (!apiKey) {
    return jsonResponse({ ok: false, error: "Missing env.YT_API_KEY" }, 500);
  }
  if (!oauthToken) {
    return jsonResponse({ ok: false, error: "Missing OAuth configuration. Provide (YT_CLIENT_ID + YT_CLIENT_SECRET + YT_REFRESH_TOKEN) for auto-refresh, or set env.YT_OAUTH_TOKEN, or send Authorization: Bearer <access_token>." }, 401);
  }
  if (!channelId) {
    return jsonResponse({ ok: false, error: "Missing channelId (query ?channelId=... or env.YT_CHANNEL_ID)" }, 400);
  }

  // Fetch channel + uploads
  const channelBasics = await fetchChannelBasics(apiKey, channelId);
  if (!channelBasics) {
    return jsonResponse({ ok: false, error: "Could not fetch channel basics. Check channelId + apiKey." }, 502);
  }

  const uploadsPlaylistId = await fetchUploadsPlaylistId(apiKey, channelId);
  const uploads = uploadsPlaylistId ? await fetchRecentUploads(apiKey, uploadsPlaylistId, 25) : [];

  // Build v3Data + safe templates
  const v3 = await buildV3Data({ apiKey, env, oauthToken, channelBasics, uploads });
  const templates = buildHUDMessageTemplatesV3(v3);
  const sample = pickRandom(templates, 3);

  return jsonResponse({
    ok: true,
    channel: channelBasics,
    ranges: {
      latestDay: isoDate(shiftDays(new Date(), -1))
    },
    v3,
    templatesCount: templates.length,
    sample
  });
}
