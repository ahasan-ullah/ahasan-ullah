// Builds the README stat cards from live GitHub data, in the profile's Batman theme.
// Runs in GitHub Actions (see .github/workflows/profile.yml) and writes SVGs to OUT_DIR.
// Zero dependencies: Node 20+ only.
//
//   GITHUB_TOKEN=... GITHUB_USER=ahasan-ullah node .github/scripts/profile-cards.mjs
//   node .github/scripts/profile-cards.mjs --frame-snake snk/snake.svg dist/snake.svg
//
// Every animation here only adds motion on top of a complete picture: a renderer that
// doesn't play SVG animation (image proxies, previews) still shows the full card.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Notebook "code size" is mostly embedded outputs, so it would swamp real source code.
const EXCLUDED_LANGUAGES = new Set(["Jupyter Notebook"]);
const TOP_LANGUAGES = 6;

const T = {
  bg1: "#13151a", bg2: "#08090b", border: "#262a31", grid: "#1d2026", track: "#1a1d23",
  text: "#f2f2f2", text2: "#a1a6ad", muted: "#6b7078",
  gold: "#f5c518", goldDim: "#5c6068", now: "#ffffff",
};

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;

// Bat emblem in a 200x100 box.
export const BAT_PATH =
  "M100,28L104,28L108,16L110,30C122,34 128,24 126,14C150,20 178,26 196,46C178,44 168,52 166,64C156,56 144,58 140,68C130,62 112,66 100,84" +
  "C88,66 70,62 60,68C56,58 44,56 34,64C32,52 22,44 4,46C22,26 50,20 74,14C72,24 78,34 90,30L92,16L96,28Z";

// ---------------------------------------------------------------- data

async function graphql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "profile-cards" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

const PROFILE_QUERY = `
query ($login: String!) {
  user(login: $login) {
    name login createdAt
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
      }
    }
  }
}`;

const YEAR_QUERY = `
query ($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

export async function fetchData(token, login) {
  const { user } = await graphql(token, PROFILE_QUERY, { login });
  const now = new Date();
  const days = [];
  let commitsThisYear = 0;
  // contributionsCollection spans at most one year, so walk the account year by year.
  for (let year = new Date(user.createdAt).getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = new Date(Date.UTC(year, 0, 1)).toISOString();
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59)).toISOString();
    const { user: u } = await graphql(token, YEAR_QUERY, { login, from, to });
    const c = u.contributionsCollection;
    if (year === now.getUTCFullYear()) commitsThisYear = c.totalCommitContributions;
    for (const w of c.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
  }

  const sizes = new Map();
  for (const repo of user.repositories.nodes)
    for (const e of repo.languages.edges) sizes.set(e.node.name, (sizes.get(e.node.name) ?? 0) + e.size);

  return {
    login: user.login,
    name: user.name ?? user.login,
    createdAt: user.createdAt,
    repos: user.repositories.totalCount,
    commitsThisYear,
    days,
    languages: [...sizes].map(([name, size]) => ({ name, size })),
  };
}

// ---------------------------------------------------------------- metrics

const DAY = 864e5;
const isoDay = (d) => d.toISOString().slice(0, 10);

export function summarize(data, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayIso = isoDay(today);
  const days = [...new Map(data.days.map((d) => [d.date, d.count]))]
    .map(([date, count]) => ({ date, count }))
    .filter((d) => d.date <= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));

  const total = days.reduce((s, d) => s + d.count, 0);

  let longest = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; longest = Math.max(longest, run); }

  // A streak survives until the end of today, so an empty "today" doesn't break it yet.
  let i = days.length - 1;
  if (i >= 0 && days[i].date === todayIso && days[i].count === 0) i--;
  let current = 0;
  for (; i >= 0 && days[i].count > 0; i--) current++;

  // Same window as the calendar on the GitHub profile: from the Sunday on or before
  // one year ago through today, so "last year" totals match what GitHub shows.
  const yearAgo = new Date(today); yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const start = new Date(yearAgo.getTime() - yearAgo.getUTCDay() * DAY);
  const nWeeks = Math.floor((today - start) / (7 * DAY)) + 1;
  const weeks = Array.from({ length: nWeeks }, (_, w) => ({ start: isoDay(new Date(start.getTime() + w * 7 * DAY)), count: 0 }));
  const recent = days.filter((d) => d.date >= weeks[0].start);
  for (const d of recent) weeks[Math.floor((Date.parse(d.date) - start) / (7 * DAY))].count += d.count;
  const lastYear = recent.reduce((s, d) => s + d.count, 0);
  const activeDays = recent.filter((d) => d.count > 0).length;
  const bestDay = days.reduce((m, d) => Math.max(m, d.count), 0);
  // One cell per day of the last year, positioned like GitHub's calendar (week column, weekday row).
  const calendar = recent.map((d) => ({ ...d, week: Math.floor((Date.parse(d.date) - start) / (7 * DAY)), weekday: new Date(d.date).getUTCDay() }));

  const langs = data.languages.filter((l) => !EXCLUDED_LANGUAGES.has(l.name)).sort((a, b) => b.size - a.size);
  const langTotal = langs.reduce((s, l) => s + l.size, 0) || 1;
  const top = langs.slice(0, TOP_LANGUAGES).map((l) => ({ name: l.name, pct: (l.size / langTotal) * 100 }));
  const rest = langs.slice(TOP_LANGUAGES).reduce((s, l) => s + l.size, 0);
  if (rest > 0) top.push({ name: "Other", pct: (rest / langTotal) * 100 });

  return {
    ...data, total, longest, current, weeks, calendar, lastYear, activeDays, bestDay,
    topLanguages: top, sinceYear: new Date(data.createdAt).getUTCFullYear(), year: today.getUTCFullYear(),
  };
}

// ---------------------------------------------------------------- rendering helpers

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}K` : n.toLocaleString("en-US"));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Column/bar with a 4px rounded data-end and a square baseline.
function columnPath(x, yTop, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  const yb = yTop + h;
  return `M${x},${yb}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yb}Z`;
}
function barPath(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  r = Math.min(r, h / 2, w);
  const xe = x + w;
  return `M${x},${y}H${xe - r}Q${xe},${y} ${xe},${y + r}V${y + h - r}Q${xe},${y + h} ${xe - r},${y + h}H${x}Z`;
}

const bat = (x, y, w, fill, children = "") =>
  `<path d="${BAT_PATH}" transform="translate(${x} ${y}) scale(${w / 200})" fill="${fill}">${children}</path>`;

// Card shell: gradient body, bat-signal haze, a light sweep that crosses now and then,
// and a title with a softly pulsing bat emblem.
function frame(w, h, title, body, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.bg1}"/><stop offset="1" stop-color="${T.bg2}"/></linearGradient>
  <radialGradient id="haze" cx="1" cy="0" r="0.9"><stop offset="0" stop-color="${T.gold}" stop-opacity="0.09"/><stop offset="1" stop-color="${T.gold}" stop-opacity="0"/></radialGradient>
  <linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="${T.gold}" stop-opacity="0"/><stop offset="0.5" stop-color="${T.gold}" stop-opacity="0.8"/><stop offset="1" stop-color="${T.gold}" stop-opacity="0"/></linearGradient>
  <clipPath id="card"><rect width="${w}" height="${h}" rx="14"/></clipPath>
</defs>
<style>
  text { font-family: ${FONT}; fill: ${T.text}; }
  .title { font-size: 13px; font-weight: 700; letter-spacing: 2.2px; }
  .sub { font-size: 12px; fill: ${T.text2}; }
  .label { font-size: 10.5px; font-weight: 600; letter-spacing: 1.2px; fill: ${T.text2}; }
  .axis { font-size: 11px; fill: ${T.muted}; }
  .value { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
<g clip-path="url(#card)">
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#haze)"/>
  <rect x="-260" y="-40" width="160" height="${h + 80}" fill="url(#sheen)" transform="skewX(-18)">
    <animate attributeName="x" values="-260;-260;${w + 260}" keyTimes="0;0.7;1" dur="9s" repeatCount="indefinite"/>
  </rect>
  <rect x="0" y="0" width="${w}" height="2" fill="url(#edge)" opacity="0.7">
    <animate attributeName="opacity" values="0.7;0.25;0.7" dur="4s" repeatCount="indefinite"/>
  </rect>
</g>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="none" stroke="${T.border}"/>
${bat(24, 23, 30, T.gold, `<animate attributeName="opacity" values="1;0.55;1" dur="3s" repeatCount="indefinite"/>`)}
<text x="62" y="36" class="title">${esc(title.toUpperCase())}</text>
${body}
</svg>`;
}

// ---------------------------------------------------------------- cards

export function statsCard(s) {
  const W = 495, H = 210;
  const tiles = [
    ["CURRENT STREAK", `${fmt(s.current)} ${s.current === 1 ? "day" : "days"}`],
    ["LONGEST STREAK", `${fmt(s.longest)} days`],
    [`COMMITS IN ${s.year}`, fmt(s.commitsThisYear)],
    ["ACTIVE DAYS (1 YR)", fmt(s.activeDays)],
    ["PUBLIC REPOS", fmt(s.repos)],
    ["MOST IN ONE DAY", fmt(s.bestDay)],
  ];
  const gx = 244, colW = 128, rowH = 48, gy = 74;
  const tileSvg = tiles.map(([label, value], i) => {
    const x = gx + (i % 2) * colW, y = gy + Math.floor(i / 2) * rowH;
    return `<text x="${x}" y="${y}" class="label">${esc(label)}</text>
<text x="${x}" y="${y + 22}" style="font-size:19px;font-weight:700;font-variant-numeric:tabular-nums">${esc(value)}</text>`;
  }).join("\n");

  const body = `
<defs><filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="7"/></filter></defs>
<text x="24" y="114" style="font-size:56px;font-weight:800;letter-spacing:-1px;fill:${T.gold}" filter="url(#glow)" opacity="0.35">${fmt(s.total)}</text>
<text x="24" y="114" style="font-size:56px;font-weight:800;letter-spacing:-1px">${fmt(s.total)}</text>
<rect x="26" y="128" width="36" height="3" rx="1.5" fill="${T.gold}"/>
<text x="24" y="154" class="sub">contributions since ${s.sinceYear}</text>
<text x="24" y="174" class="axis">${fmt(s.lastYear)} in the last year</text>
<line x1="${gx - 24}" y1="58" x2="${gx - 24}" y2="${H - 24}" stroke="${T.grid}"/>
${tileSvg}`;
  return frame(W, H, "Batcomputer", body,
    `${s.total} contributions since ${s.sinceYear}; ${s.lastYear} in the last year; current streak ${s.current} days; longest streak ${s.longest} days; ${s.commitsThisYear} commits in ${s.year}; ${s.activeDays} active days in the last year; ${s.repos} public repositories; best day ${s.bestDay} contributions.`);
}

export function languagesCard(s) {
  const W = 495, H = 210;
  const rows = s.topLanguages;
  const top = 60, rowH = Math.min(20, (H - top - 18) / Math.max(rows.length, 1));
  const labelW = 92, valueW = 46, barX = 24 + labelW, barMax = W - 24 - valueW - barX;
  const maxPct = Math.max(...rows.map((r) => r.pct), 1);
  const body = rows.map((r, i) => {
    const y = top + i * rowH, bh = 8, by = y + (rowH - bh) / 2;
    const w = Math.max(3, (r.pct / maxPct) * barMax);
    const pct = r.pct >= 10 ? r.pct.toFixed(0) : r.pct.toFixed(1);
    return `<text x="24" y="${by + bh}" style="font-size:12px;fill:${T.text2}">${esc(r.name)}</text>
<rect x="${barX}" y="${by}" width="${barMax}" height="${bh}" rx="4" fill="${T.track}"/>
<path d="${barPath(barX, by, w, bh)}" fill="${r.name === "Other" ? T.goldDim : T.gold}"/>
<text x="${barX + w + 8}" y="${by + bh}" class="value">${pct}%</text>`;
  }).join("\n");
  return frame(W, H, "Arsenal",
    `<text x="${W - 24}" y="36" class="axis" text-anchor="end">languages by code size · ${s.repos} repos</text>
${body}`,
    rows.map((r) => `${r.name} ${r.pct.toFixed(1)}%`).join(", "));
}

export function activityCard(s) {
  const W = 990, H = 260;
  const L = 52, R = 24, Tp = 74, B = 34;
  const plotW = W - L - R, plotH = H - Tp - B;
  const n = s.weeks.length, slot = plotW / n, bw = Math.min(24, slot - 2);
  const max = Math.max(...s.weeks.map((w) => w.count), 1);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((v) => max / v <= 4) ?? Math.ceil(max / 4);
  const yMax = Math.ceil(max / step) * step;
  const y = (v) => Tp + plotH - (v / yMax) * plotH;

  let grid = "";
  for (let v = 0; v <= yMax; v += step)
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${T.grid}"/>
<text x="${L - 10}" y="${y(v) + 4}" class="axis" text-anchor="end">${fmt(v)}</text>\n`;

  const peak = s.weeks.reduce((a, w, i) => (w.count > s.weeks[a].count ? i : a), 0);
  let bars = "", months = "", lastMonth = -1;
  s.weeks.forEach((w, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const d = columnPath(x, y(w.count), bw, Tp + plotH - y(w.count));
    if (d) bars += `<path d="${d}" fill="${i === n - 1 ? T.now : T.gold}"><title>Week of ${w.start}: ${w.count} contributions</title></path>\n`;
    const mid = new Date(Date.parse(w.start) + 3 * DAY);
    if (mid.getUTCMonth() !== lastMonth) {
      if (lastMonth !== -1 || mid.getUTCDate() <= 10) months += `<text x="${x}" y="${H - 12}" class="axis">${MONTHS[mid.getUTCMonth()]}</text>\n`;
      lastMonth = mid.getUTCMonth();
    }
  });

  // The current week pulses like a beacon; it's fully drawn when animation is off.
  const last = s.weeks[n - 1];
  const lx = L + (n - 1) * slot + slot / 2;
  const beacon = last.count > 0
    ? `<circle cx="${lx}" cy="${y(last.count) - 9}" r="3.5" fill="${T.now}"/>
<circle cx="${lx}" cy="${y(last.count) - 9}" r="3.5" fill="none" stroke="${T.now}" stroke-width="1.5" opacity="0">
  <animate attributeName="r" values="3.5;11" dur="2s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0.8;0" dur="2s" repeatCount="indefinite"/>
</circle>`
    : "";

  const px = L + peak * slot + slot / 2;
  const peakLabel = s.weeks[peak].count > 0 && peak !== n - 1
    ? `<text x="${Math.min(Math.max(px, L + 40), W - R - 40)}" y="${y(s.weeks[peak].count) - 8}" class="value" text-anchor="middle">${fmt(s.weeks[peak].count)}</text>`
    : "";

  return frame(W, H, "Night patrol log",
    `<text x="24" y="58" class="sub">${fmt(s.lastYear)} contributions in the last year · busiest week: ${fmt(s.weeks[peak].count)}</text>
<rect x="${W - R - 74}" y="27" width="10" height="10" rx="2" fill="${T.now}"/>
<text x="${W - R}" y="36" class="axis" text-anchor="end">this week</text>
${grid}${bars}${peakLabel}
${beacon}
${months}`,
    `Weekly contributions over the last year, ${s.lastYear} in total. Busiest week ${s.weeks[peak].start} with ${s.weeks[peak].count}.`);
}

// Stable pseudo-random in [0, 1) from a string, so lit windows and stars stay put between runs.
function hash01(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// The contribution calendar as a city at night: one building per day, height and roof
// glow by contributions, back rows (Sunday) to front rows (Saturday) in oblique projection.
export function skylineCard(s) {
  const W = 1200, H = 420;
  const PX = 19, BW = 14, RDX = 8, RDY = 7, FDX = 6, FDY = 5; // column pitch, width, row step, roof depth
  const n = s.weeks.length;
  const cityW = n * PX + 6 * RDX + BW;
  const x0 = Math.round((W - cityW) / 2), y0 = H - 74;
  const max = Math.max(1, ...s.calendar.map((d) => d.count));
  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
  const heightOf = (c) => (c === 0 ? 2 : 7 + Math.sqrt(c / max) * 122);
  const ROOF = ["#1f232b", "#5a4500", "#8a6a00", "#c99a00", T.gold];
  const pos = (d) => {
    const depth = 6 - d.weekday;
    return { X: x0 + d.week * PX + depth * RDX, Y: y0 - depth * RDY };
  };

  // Sky: stars, a far skyline, and the bat-signal with its beam.
  let stars = "";
  for (let i = 0; i < 90; i++) {
    const x = hash01(`sx${i}`) * W, y = 70 + hash01(`sy${i}`) * 170, r = hash01(`sr${i}`) < 0.15 ? 1.3 : 0.75;
    const tw = hash01(`st${i}`) < 0.25
      ? `<animate attributeName="opacity" values="0.7;0.15;0.7" dur="${(2.5 + hash01(`sd${i}`) * 4).toFixed(1)}s" begin="-${(hash01(`sb${i}`) * 4).toFixed(1)}s" repeatCount="indefinite"/>`
      : "";
    stars += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r}" fill="#fff" opacity="${(0.2 + hash01(`so${i}`) * 0.45).toFixed(2)}">${tw}</circle>`;
  }
  let far = `M0,${y0 - 40}`;
  for (let x = 0; x < W; ) {
    const bw = 18 + Math.floor(hash01(`fw${x}`) * 34), h = 14 + hash01(`fh${x}`) * 62;
    far += `V${(y0 - 40 - h).toFixed(0)}H${x + bw}`;
    x += bw;
  }
  far += `V${H}H0Z`;
  const sx = 1086, sy = 104, lx = 1010, ly = H;
  const signal = `<radialGradient id="sigHalo" cx="${sx / W}" cy="${sy / H}" r="0.3"><stop offset="0" stop-color="${T.gold}" stop-opacity="0.2"/><stop offset="1" stop-color="${T.gold}" stop-opacity="0"/></radialGradient>
<radialGradient id="sigDisc" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.7" stop-color="${T.gold}"/><stop offset="1" stop-color="${T.gold}" stop-opacity="0"/></radialGradient>
<linearGradient id="sigBeam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${T.gold}" stop-opacity="0.22"/><stop offset="1" stop-color="${T.gold}" stop-opacity="0.03"/></linearGradient>`;

  // Buildings: back rows first, then left to right, so nearer buildings cover farther ones.
  const cells = [...s.calendar].sort((a, b) => a.weekday - b.weekday || a.week - b.week);
  let city = "";
  for (const d of cells) {
    const { X, Y } = pos(d), h = heightOf(d.count), top = Y - h, lv = level(d.count);
    city += `<rect x="${X}" y="${top.toFixed(1)}" width="${BW}" height="${h.toFixed(1)}" fill="#171a21"/>`;
    city += `<path d="M${X + BW},${top.toFixed(1)}l${FDX},-${FDY}V${Y - FDY}l-${FDX},${FDY}Z" fill="#0e1014"/>`;
    city += `<path d="M${X},${top.toFixed(1)}h${BW}l${FDX},-${FDY}h-${BW}Z" fill="${ROOF[lv]}"/>`;
    if (h >= 16) {
      let lit = "", twinkle = "";
      for (let wy = top + 5, r = 0; wy < Y - 6; wy += 6, r++)
        for (let c = 0; c < 2; c++) {
          const k = hash01(`${d.date}:${r}:${c}`);
          if (k < 0.16 + lv * 0.16) {
            const wx = X + 3 + c * 5;
            if (k < 0.03) twinkle += `<rect x="${wx}" y="${wy.toFixed(1)}" width="3" height="3" fill="#ffd75e"><animate attributeName="opacity" values="1;1;0.15;1" keyTimes="0;0.7;0.8;1" dur="${(4 + k * 200).toFixed(1)}s" repeatCount="indefinite"/></rect>`;
            else lit += `M${wx},${wy.toFixed(1)}h3v3h-3Z`;
          }
        }
      if (lit) city += `<path d="${lit}" fill="#ffd75e" opacity="${(0.55 + lv * 0.1).toFixed(2)}"/>`;
      city += twinkle;
    }
  }

  // Ground plane under the whole grid.
  const gx = x0 - 10, gy = y0 + 6, gw = n * PX + 6;
  const ground = `<path d="M${gx},${gy}h${gw + 12}l${6 * RDX + FDX + 6},-${6 * RDY + FDY + 6}h-${gw + 12}Z" fill="#0b0d10" stroke="#1d2026"/>`;

  // Best day: a pulsing glow on its roof and a callout.
  const bp = pos(best(s)), bh = heightOf(best(s).count);
  const bx = bp.X + BW / 2 + FDX / 2, by = bp.Y - bh - FDY;
  const label = `BEST DAY · ${best(s).count} · ${MONTHS[new Date(best(s).date).getUTCMonth()]} ${new Date(best(s).date).getUTCDate()}`;
  const lw = label.length * 6.6 + 20, lxp = Math.min(Math.max(bx - lw / 2, 16), W - lw - 16), lyp = by - 46;
  const callout = best(s).count > 0
    ? `<ellipse cx="${bx}" cy="${by}" rx="16" ry="7" fill="${T.gold}" opacity="0.35" filter="url(#blur)"><animate attributeName="opacity" values="0.35;0.75;0.35" dur="2.4s" repeatCount="indefinite"/></ellipse>
<line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${lyp + 22}" stroke="${T.gold}" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"/>
<rect x="${lxp}" y="${lyp}" width="${lw}" height="22" rx="11" fill="#0b0c0f" stroke="${T.gold}" stroke-opacity="0.7"/>
<text x="${lxp + lw / 2}" y="${lyp + 15}" text-anchor="middle" style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;fill:${T.gold}">${label}</text>`
    : "";

  let months = "", lastMonth = -1;
  s.weeks.forEach((w, i) => {
    const mid = new Date(Date.parse(w.start) + 3 * DAY);
    if (mid.getUTCMonth() !== lastMonth) {
      if (lastMonth !== -1 || mid.getUTCDate() <= 10) months += `<text x="${x0 + i * PX}" y="${y0 + 26}" class="axis">${MONTHS[mid.getUTCMonth()]}</text>`;
      lastMonth = mid.getUTCMonth();
    }
  });

  const legend = ROOF.map((c, i) => `<path d="M${W - 146 + i * 17},${H - 15}h12l5,-5h-12Z" fill="${c}"/>`).join("");
  const first = s.weeks[0].start, fmtDate = (iso) => `${MONTHS[new Date(iso).getUTCMonth()]} ${new Date(iso).getUTCFullYear()}`;

  return frame(W, H, "Gotham skyline of commits",
    `<defs>${signal}
  <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bg2}" stop-opacity="0"/><stop offset="1" stop-color="${T.bg2}" stop-opacity="0.9"/></linearGradient>
  <linearGradient id="mist" x1="0" x2="1"><stop offset="0" stop-color="#9fb3c8" stop-opacity="0"/><stop offset="0.5" stop-color="#9fb3c8" stop-opacity="0.07"/><stop offset="1" stop-color="#9fb3c8" stop-opacity="0"/></linearGradient>
  <filter id="blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"/></filter>
</defs>
<text x="${W - 24}" y="36" class="axis" text-anchor="end">${fmtDate(first)} – ${fmtDate(isoDay(new Date()))} · one building per day</text>
<text x="24" y="60" class="sub">${fmt(s.lastYear)} contributions in the last year · taller buildings and brighter rooftops mean busier days</text>
${stars}
<rect width="${W}" height="${H}" fill="url(#sigHalo)"/>
<g>
  <animateTransform attributeName="transform" type="rotate" values="0 ${lx} ${ly};-4 ${lx} ${ly};2 ${lx} ${ly};0 ${lx} ${ly}" dur="12s" repeatCount="indefinite"/>
  <path d="M${lx - 8},${ly} L${sx - 46},${sy + 6} A46,36 0 0 1 ${sx + 46},${sy - 6} L${lx + 8},${ly} Z" fill="url(#sigBeam)"/>
  <ellipse cx="${sx}" cy="${sy}" rx="48" ry="38" fill="url(#sigDisc)"><animate attributeName="opacity" values="1;0.82;1" dur="5s" repeatCount="indefinite"/></ellipse>
  ${bat(sx - 37, sy - 20, 74, "#08090c")}
</g>
<path d="${far}" fill="#0c0e12" opacity="0.75"/>
${ground}
${city}
<rect x="0" y="${y0 - 70}" width="${W}" height="${H - y0 + 70}" fill="url(#fog)"/>
<rect x="-400" y="${y0 - 40}" width="900" height="60" fill="url(#mist)"><animate attributeName="x" values="-400;${W};-400" dur="40s" repeatCount="indefinite"/></rect>
${callout}
${months}
<text x="24" y="${H - 14}" class="axis">${fmt(s.activeDays)} active days · longest streak ${fmt(s.longest)} days · current streak ${fmt(s.current)} ${s.current === 1 ? "day" : "days"}</text>
<text x="${W - 152}" y="${H - 14}" class="axis" text-anchor="end">quiet</text>${legend}<text x="${W - 24}" y="${H - 14}" class="axis" text-anchor="end">busy</text>`,
    `Contribution calendar for the last year drawn as a city, one building per day. ${s.lastYear} contributions; busiest day ${best(s).date} with ${best(s).count}.`);
}
const best = (s) => s.calendar.reduce((a, d) => (d.count > a.count ? d : a), s.calendar[0]);

// Platane/snk leaves the SVG background transparent; give it the same dark card as the rest.
// snk runs as a Docker action, so its output is root-owned: read it and write a new file.
export async function frameSnake(src, dest) {
  const svg = await readFile(src, "utf8");
  const vb = svg.match(/viewBox="([-\d.\s]+)"/)?.[1].trim().split(/\s+/).map(Number);
  if (!vb) throw new Error(`no viewBox in ${src}`);
  const [x, y, w, h] = vb;
  const pad = 8;
  const panel = `<rect x="${x - pad}" y="${y - pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" rx="14" fill="${T.bg2}" stroke="${T.border}"/>`;
  const out = svg
    .replace(/viewBox="[^"]*"/, `viewBox="${x - pad} ${y - pad} ${w + 2 * pad} ${h + 2 * pad}"`)
    .replace(/(<svg[^>]*?\s)width="[\d.]+"/, `$1width="${w + 2 * pad}"`)
    .replace(/(<svg[^>]*?\s)height="[\d.]+"/, `$1height="${h + 2 * pad}"`)
    .replace(/(<svg[^>]*>)/, `$1${panel}`);
  await writeFile(dest, out);
}

// ---------------------------------------------------------------- main

export async function writeCards(summary, outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "stats.svg"), statsCard(summary));
  await writeFile(join(outDir, "languages.svg"), languagesCard(summary));
  await writeFile(join(outDir, "activity.svg"), activityCard(summary));
  await writeFile(join(outDir, "skyline.svg"), skylineCard(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--frame-snake") {
    await frameSnake(process.argv[3], process.argv[4]);
  } else {
    const token = process.env.GITHUB_TOKEN;
    const login = process.env.GITHUB_USER;
    if (!token || !login) throw new Error("GITHUB_TOKEN and GITHUB_USER are required");
    const summary = summarize(await fetchData(token, login));
    await writeCards(summary, process.env.OUT_DIR ?? "dist");
    console.log(`cards written: ${summary.total} contributions, ${summary.lastYear} last year, streak ${summary.current}/${summary.longest}`);
  }
}
