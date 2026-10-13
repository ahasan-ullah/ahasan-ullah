// Builds the README stat cards from live GitHub data.
// Runs in GitHub Actions (see .github/workflows/profile.yml) and writes SVGs to OUT_DIR.
// Zero dependencies: Node 20+ only.
//
//   GITHUB_TOKEN=... GITHUB_USER=ahasan-ullah node .github/scripts/profile-cards.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Notebook "code size" is mostly embedded outputs, so it would swamp real source code.
const EXCLUDED_LANGUAGES = new Set(["Jupyter Notebook"]);
const TOP_LANGUAGES = 6;

const THEMES = {
  dark: {
    surface: "#0d1117", border: "#30363d", grid: "#21262d", track: "#21262d",
    text: "#e6edf3", text2: "#9198a1", muted: "#6e7681",
    mark: "#9085e9", accent: "#ec4899",
  },
  light: {
    surface: "#ffffff", border: "#d1d9e0", grid: "#eaeef2", track: "#eceaf9",
    text: "#1f2328", text2: "#59636e", muted: "#818b98",
    mark: "#6250d6", accent: "#db2777",
  },
};

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;

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

const isoDay = (d) => d.toISOString().slice(0, 10);

export function summarize(data, today = new Date()) {
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

  // Last 52 full-or-partial weeks, Sunday-aligned like GitHub's calendar.
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 51 * 7);
  const weeks = Array.from({ length: 52 }, (_, w) => {
    const s = new Date(start); s.setUTCDate(s.getUTCDate() + w * 7);
    return { start: isoDay(s), count: 0 };
  });
  for (const d of days) {
    const w = Math.floor((Date.parse(d.date) - start.getTime()) / (7 * 864e5));
    if (w >= 0 && w < 52) weeks[w].count += d.count;
  }
  const lastYear = weeks.reduce((s, w) => s + w.count, 0);
  const recent = days.filter((d) => d.date >= weeks[0].start);
  const activeDays = recent.filter((d) => d.count > 0).length;
  const bestDay = days.reduce((m, d) => Math.max(m, d.count), 0);

  const langs = data.languages.filter((l) => !EXCLUDED_LANGUAGES.has(l.name)).sort((a, b) => b.size - a.size);
  const langTotal = langs.reduce((s, l) => s + l.size, 0) || 1;
  const top = langs.slice(0, TOP_LANGUAGES).map((l) => ({ name: l.name, pct: (l.size / langTotal) * 100 }));
  const rest = langs.slice(TOP_LANGUAGES).reduce((s, l) => s + l.size, 0);
  if (rest > 0) top.push({ name: "Other", pct: (rest / langTotal) * 100 });

  return { ...data, total, longest, current, weeks, lastYear, activeDays, bestDay, topLanguages: top, sinceYear: new Date(data.createdAt).getUTCFullYear() };
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

function frame(t, w, h, title, body, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<style>
  text { font-family: ${FONT}; fill: ${t.text}; }
  .title { font-size: 15px; font-weight: 600; }
  .sub { font-size: 12px; fill: ${t.text2}; }
  .label { font-size: 12px; fill: ${t.text2}; }
  .axis { font-size: 11px; fill: ${t.muted}; }
  .value { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.surface}" stroke="${t.border}"/>
${body}
</svg>`;
}

// ---------------------------------------------------------------- cards

export function statsCard(s, t) {
  const W = 495, H = 200;
  const tiles = [
    ["Current streak", `${fmt(s.current)} ${s.current === 1 ? "day" : "days"}`],
    ["Longest streak", `${fmt(s.longest)} days`],
    [`Commits in ${new Date().getUTCFullYear()}`, fmt(s.commitsThisYear)],
    ["Active days (12 mo)", fmt(s.activeDays)],
    ["Public repos", fmt(s.repos)],
    ["Most in one day", fmt(s.bestDay)],
  ];
  const gx = 238, colW = 128, rowH = 46, gy = 66;
  const tileSvg = tiles.map(([label, value], i) => {
    const x = gx + (i % 2) * colW, y = gy + Math.floor(i / 2) * rowH;
    return `<g>
  <text x="${x}" y="${y}" class="label">${esc(label)}</text>
  <text x="${x}" y="${y + 21}" style="font-size:18px;font-weight:600;font-variant-numeric:tabular-nums">${esc(value)}</text>
</g>`;
  }).join("\n");

  const body = `
<text x="24" y="36" class="title">GitHub overview</text>
<g>
  <text x="24" y="104" style="font-size:52px;font-weight:600;letter-spacing:-1px">${fmt(s.total)}</text>
  <text x="24" y="128" class="sub">contributions since ${s.sinceYear}</text>
  <text x="24" y="152" class="axis">${fmt(s.lastYear)} in the last 12 months</text>
</g>
<line x1="${gx - 22}" y1="54" x2="${gx - 22}" y2="${H - 24}" stroke="${t.grid}"/>
${tileSvg}`;
  return frame(t, W, H, "GitHub overview", body,
    `${s.total} contributions since ${s.sinceYear}; current streak ${s.current} days; longest streak ${s.longest} days; ${s.commitsThisYear} commits this year; ${s.activeDays} active days in the last 12 months; ${s.repos} public repositories; best day ${s.bestDay} contributions.`);
}

export function languagesCard(s, t) {
  const W = 495, H = 200;
  const rows = s.topLanguages;
  const top = 58, rowH = Math.min(22, (H - top - 16) / Math.max(rows.length, 1));
  const labelW = 92, valueW = 44, barX = 24 + labelW, barMax = W - 24 - valueW - barX;
  const maxPct = Math.max(...rows.map((r) => r.pct), 1);
  const body = rows.map((r, i) => {
    const y = top + i * rowH, bh = 10, by = y + (rowH - bh) / 2;
    const w = Math.max(3, (r.pct / maxPct) * barMax);
    const pct = r.pct >= 10 ? r.pct.toFixed(0) : r.pct.toFixed(1);
    return `<text x="24" y="${by + bh - 1}" class="label">${esc(r.name)}</text>
<path d="${barPath(barX, by, w, bh)}" fill="${r.name === "Other" ? t.muted : t.mark}"/>
<text x="${barX + w + 8}" y="${by + bh - 1}" class="value">${pct}%</text>`;
  }).join("\n");
  return frame(t, W, H, "Most used languages",
    `<text x="24" y="36" class="title">Most used languages</text>
<text x="${W - 24}" y="36" class="axis" text-anchor="end">by code size · ${s.repos} public repos</text>
${body}`,
    rows.map((r) => `${r.name} ${r.pct.toFixed(1)}%`).join(", "));
}

export function activityCard(s, t) {
  const W = 990, H = 250;
  const L = 52, R = 24, T = 66, B = 34;
  const plotW = W - L - R, plotH = H - T - B;
  const n = s.weeks.length, slot = plotW / n, gap = 2, bw = Math.min(24, slot - gap);
  const max = Math.max(...s.weeks.map((w) => w.count), 1);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((v) => max / v <= 4) ?? Math.ceil(max / 4);
  const yMax = Math.ceil(max / step) * step;
  const y = (v) => T + plotH - (v / yMax) * plotH;

  let grid = "";
  for (let v = 0; v <= yMax; v += step)
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${t.grid}"/>
<text x="${L - 10}" y="${y(v) + 4}" class="axis" text-anchor="end">${fmt(v)}</text>\n`;

  const peak = s.weeks.reduce((a, w, i) => (w.count > s.weeks[a].count ? i : a), 0);
  let bars = "", months = "", lastMonth = -1;
  s.weeks.forEach((w, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const d = columnPath(x, y(w.count), bw, T + plotH - y(w.count));
    const color = i === n - 1 ? t.accent : t.mark;
    if (d) bars += `<path d="${d}" fill="${color}"><title>Week of ${w.start}: ${w.count} contributions</title></path>\n`;
    const m = new Date(w.start + "T00:00:00Z");
    const mid = new Date(m); mid.setUTCDate(mid.getUTCDate() + 3);
    if (mid.getUTCMonth() !== lastMonth) {
      if (lastMonth !== -1 || mid.getUTCDate() <= 10) months += `<text x="${x}" y="${H - 12}" class="axis">${MONTHS[mid.getUTCMonth()]}</text>\n`;
      lastMonth = mid.getUTCMonth();
    }
  });

  const px = L + peak * slot + slot / 2;
  const peakLabel = s.weeks[peak].count > 0
    ? `<text x="${Math.min(Math.max(px, L + 40), W - R - 40)}" y="${y(s.weeks[peak].count) - 8}" class="value" text-anchor="middle">${fmt(s.weeks[peak].count)}</text>`
    : "";

  return frame(t, W, H, "Contributions per week",
    `<text x="24" y="36" class="title">Contributions per week</text>
<text x="24" y="54" class="sub">${fmt(s.lastYear)} contributions in the last 52 weeks · busiest week: ${fmt(s.weeks[peak].count)}</text>
<g>
  <rect x="${W - R - 70}" y="27" width="10" height="10" rx="2" fill="${t.accent}"/>
  <text x="${W - R}" y="36" class="axis" text-anchor="end">this week</text>
</g>
${grid}${bars}${peakLabel}
${months}`,
    `Weekly contributions over the last 52 weeks, ${s.lastYear} in total. Busiest week ${s.weeks[peak].start} with ${s.weeks[peak].count}.`);
}

// ---------------------------------------------------------------- main

export async function writeCards(summary, outDir) {
  await mkdir(outDir, { recursive: true });
  for (const [mode, t] of Object.entries(THEMES)) {
    await writeFile(join(outDir, `stats-${mode}.svg`), statsCard(summary, t));
    await writeFile(join(outDir, `languages-${mode}.svg`), languagesCard(summary, t));
    await writeFile(join(outDir, `activity-${mode}.svg`), activityCard(summary, t));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITHUB_TOKEN;
  const login = process.env.GITHUB_USER;
  if (!token || !login) throw new Error("GITHUB_TOKEN and GITHUB_USER are required");
  const summary = summarize(await fetchData(token, login));
  await writeCards(summary, process.env.OUT_DIR ?? "dist");
  console.log(`cards written: ${summary.total} contributions, streak ${summary.current}/${summary.longest}, ${summary.topLanguages.length} languages`);
}
