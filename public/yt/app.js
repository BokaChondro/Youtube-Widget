const ranges = [
  { key: "48h", label: "48H" },
  { key: "7d", label: "7D" },
  { key: "28d", label: "28D" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "ALL" },
];

let currentRange = "28d";

function fmt(n) {
  return Intl.NumberFormat().format(Number(n || 0));
}

function nowStamp() {
  return new Date().toLocaleString();
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

function setActive(range) {
  document.querySelectorAll(".pill").forEach((p) =>
    p.classList.toggle("active", p.dataset.range === range)
  );
}

function renderPills() {
  const el = document.getElementById("rangePills");
  el.innerHTML = "";
  ranges.forEach((r) => {
    const b = document.createElement("div");
    b.className = "pill";
    b.textContent = r.label;
    b.dataset.range = r.key;
    b.onclick = async () => {
      currentRange = r.key;
      setActive(r.key);
      await loadRangeStuff();
    };
    el.appendChild(b);
  });
}

async function loadChannel() {
  const ch = await fetchJSON("/api/yt-channel");
  document.getElementById("subs").textContent = fmt(ch.subscribers);
}

async function loadSubs28() {
  const s = await fetchJSON("/api/yt-summary?range=28d");
  const net = Number(s.netSubscribers || 0);
  document.getElementById("subs28").textContent =
    (net >= 0 ? "+" : "") + fmt(net) + " in last 28 days";
}

function renderTop10(items) {
  const el = document.getElementById("top10");
  el.innerHTML = "";

  const header = document.createElement("div");
  header.className = "rowItem hdr";
  header.innerHTML = `
    <div>#</div>
    <div>Video</div>
    <div>Views</div>
    <div>Avg % viewed</div>
    <div>Likes</div>
  `;
  el.appendChild(header);

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "rowItem";
    row.innerHTML = `
      <div class="cell badge">#${it.rank}</div>
      <div class="cell title" title="${it.title || ""}">${it.title || it.videoId}</div>
      <div class="cell">${fmt(it.views)}</div>
      <div class="cell">${(it.averageViewPercentage ?? 0).toFixed(1)}%</div>
      <div class="cell">${fmt(it.likes)}</div>
    `;
    el.appendChild(row);
  });
}

function renderTop48h(items) {
  const el = document.getElementById("top48h");
  el.innerHTML = "";
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "listItem";
    row.innerHTML = `
      <div class="title" title="${it.title || ""}">${it.title || it.videoId}</div>
      <div class="cell">${fmt(it.views)}</div>
    `;
    el.appendChild(row);
  });
}

// --- COMMENTS (Improved UI) ---
function timeAgo(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderComments(items) {
  const el = document.getElementById("comments");
  el.innerHTML = "";

  if (!items || items.length === 0) {
    el.innerHTML = `<div class="muted">No recent comments found.</div>`;
    return;
  }

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "commentCard";

    const safeText = escapeHtml(it.text || "");
    const videoUrl = it.videoId ? `https://www.youtube.com/watch?v=${it.videoId}` : "";

    row.innerHTML = `
      <div class="commentTop">
        <div class="commentAuthor">${escapeHtml(it.author || "Unknown")}</div>
        <div class="commentMeta">${it.publishedAt ? timeAgo(it.publishedAt) : ""}</div>
      </div>
      <div class="commentText">${safeText}</div>
      ${
        videoUrl
          ? `<a class="commentLink" href="${videoUrl}" target="_blank" rel="noopener">View video →</a>`
          : ""
      }
    `;

    el.appendChild(row);
  });
}

async function loadRangeStuff() {
  // summary
  const s = await fetchJSON(`/api/yt-summary?range=${currentRange}`);
  document.getElementById("views").textContent = fmt(s.views);
  document.getElementById("watch").textContent = fmt(s.watchTimeHours);
  document.getElementById("rangeLabel").textContent = `${s.startDate} → ${s.endDate}`;

  // top10
  const t = await fetchJSON(`/api/yt-top10?range=${currentRange}`);
  renderTop10(t.items || []);

  document.getElementById("updated").textContent = `Updated: ${nowStamp()}`;
}

async function loadFixedStuff() {
  const top48 = await fetchJSON("/api/yt-top48h");
  renderTop48h(top48.items || []);

  const com = await fetchJSON("/api/yt-comments?limit=6");
  renderComments(com.items || []);

  document.getElementById("updated").textContent = `Updated: ${nowStamp()}`;
}

(async function init() {
  renderPills();
  setActive("28d");

  await loadChannel();
  await loadSubs28();

  await loadRangeStuff();
  await loadFixedStuff();
})();
