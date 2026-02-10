const ranges = [
  { key: "48h", label: "48H" },
  { key: "7d", label: "7D" },
  { key: "28d", label: "28D" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "ALL" },
];

function fmt(n) { return Intl.NumberFormat().format(n); }

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

function setActive(range) {
  document.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.range === range));
}

async function loadChannel() {
  const ch = await fetchJSON("/api/yt-channel");
  document.getElementById("subs").textContent = fmt(ch.subscribers);
}

async function loadSubs28() {
  const s = await fetchJSON("/api/yt-summary?range=28d");
  const net = s.netSubscribers;
  document.getElementById("subs28").textContent = (net >= 0 ? "+" : "") + fmt(net) + " in last 28 days";
}

async function loadSummary(range) {
  const s = await fetchJSON(`/api/yt-summary?range=${range}`);
  document.getElementById("views").textContent = fmt(s.views);
  document.getElementById("watch").textContent = fmt(s.watchTimeHours);
}

function renderPills() {
  const el = document.getElementById("rangePills");
  el.innerHTML = "";
  ranges.forEach(r => {
    const b = document.createElement("div");
    b.className = "pill";
    b.textContent = r.label;
    b.dataset.range = r.key;
    b.onclick = async () => {
      setActive(r.key);
      await loadSummary(r.key);
    };
    el.appendChild(b);
  });
}

(async function init() {
  renderPills();
  setActive("28d");
  await loadChannel();
  await loadSubs28();
  await loadSummary("28d");
})();
