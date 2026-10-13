import fs from "node:fs";
import { BAT_PATH } from "./profile-cards.mjs";

// Static README art (header, divider, terminal, footer). Run once after edits:
//   node .github/scripts/build-assets.mjs
const OUT = new URL("../../assets/", import.meta.url);
const GOLD = "#f5c518";
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONO = `'Cascadia Code', 'Fira Code', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Deterministic pseudo-random so regenerating gives the same skyline.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function skyline(W, base, minH, maxH, centerLow, fill, windows) {
  let x = -10, d = `M-10,${base}`, win = "";
  while (x < W + 10) {
    const bw = 34 + Math.floor(rnd() * 56);
    const dist = Math.abs(x + bw / 2 - W / 2) / (W / 2);
    const cap = centerLow ? minH + (maxH - minH) * Math.min(1, dist * 1.25) : maxH;
    const h = minH * 0.6 + rnd() * (cap - minH * 0.6);
    const top = base - h;
    d += `V${top.toFixed(1)}`;
    if (rnd() < 0.22) { // spire / antenna
      const mx = x + bw / 2;
      d += `H${mx - 3}V${top - 14}H${mx - 1}V${top - 30}H${mx + 1}V${top - 14}H${mx + 3}V${top}`;
    } else if (rnd() < 0.25) { // stepped roof
      d += `H${x + 8}V${top - 10}H${x + bw - 8}V${top}`;
    }
    d += `H${x + bw}`;
    if (windows) {
      for (let wy = top + 10; wy < base - 8; wy += 13)
        for (let wx = x + 7; wx < x + bw - 8; wx += 11) {
          const r = rnd();
          if (r < 0.1) {
            const twinkle = r < 0.03
              ? `<animate attributeName="opacity" values="0.85;0.85;0.1;0.85" keyTimes="0;0.6;0.7;1" dur="${(5 + rnd() * 8).toFixed(1)}s" begin="-${(rnd() * 6).toFixed(1)}s" repeatCount="indefinite"/>`
              : "";
            win += `<rect x="${wx}" y="${wy.toFixed(1)}" width="4" height="6" fill="${GOLD}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}">${twinkle}</rect>`;
          }
        }
    }
    x += bw + (rnd() < 0.3 ? 4 : 0);
  }
  d += `V${base + 200}H-10Z`;
  return `<path d="${d}" fill="${fill}"/>${win}`;
}

const batAt = (x, y, w, fill, { attrs = "", children = "" } = {}) =>
  `<path d="${BAT_PATH}" transform="translate(${x} ${y}) scale(${w / 200})" fill="${fill}"${attrs}>${children}</path>`;
const PULSE = { children: `<animate attributeName="opacity" values="1;0.6;1" dur="3s" repeatCount="indefinite"/>` };

// ---------------------------------------------------------------- header
{
  const W = 1200, H = 360;
  const lines = [
    "Building REST APIs with ASP.NET Core",
    "Shipping Angular & React front-ends",
    "Crafting cross-platform apps in Flutter",
    "CSE undergrad @ AIUB, Dhaka",
  ];
  // Each line gets 4s: type for 1.9s, hold until 3.4s, erase by 3.9s.
  const cy = 232, charW = 12.04, slice = 4, dur = slice * lines.length;
  const kt = [0, 1.9, 3.4, 3.9].map((t) => +(t / dur).toFixed(4)).concat(1).join(";");
  const clips = [], typed = [];
  lines.forEach((l, i) => {
    const text = `> ${l}`;
    const w = Math.ceil(text.length * charW) + 2, x0 = Math.round((W - w) / 2), begin = `${i * slice}s`;
    // Base values show line 0 in full, so a renderer without SMIL still gets a complete frame.
    clips.push(`<clipPath id="c${i}"><rect x="${x0}" y="${cy - 22}" height="30" width="${i === 0 ? w : 0}"><animate attributeName="width" values="0;${w};${w};0;0" keyTimes="${kt}" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></rect></clipPath>`);
    typed.push(`<text x="${x0}" y="${cy}" clip-path="url(#c${i})" class="mono">${esc(text)}</text>
<rect x="${x0}" y="${cy - 18}" width="10" height="22" fill="${GOLD}" opacity="0"><animate attributeName="x" values="${x0};${x0 + w + 2};${x0 + w + 2};${x0};${x0}" keyTimes="${kt}" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="opacity" values="0.85;0" keyTimes="0;${+(slice / dur).toFixed(4)}" calcMode="discrete" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></rect>`);
  });

  let stars = "";
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * 190, r = rnd() < 0.15 ? 1.4 : 0.8;
    const tw = rnd() < 0.3 ? `<animate attributeName="opacity" values="0.7;0.15;0.7" dur="${(2 + rnd() * 4).toFixed(1)}s" begin="-${(rnd() * 4).toFixed(1)}s" repeatCount="indefinite"/>` : "";
    stars += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r}" fill="#fff" opacity="${(0.25 + rnd() * 0.45).toFixed(2)}">${tw}</circle>`;
  }

  // Bat-signal: projected disc high on the right, beam from a searchlight behind the skyline.
  const sx = 1072, sy = 84, lx = 1010, ly = 372;
  const flyers = [
    { y: 70, w: 26, dur: 17, begin: -3 },
    { y: 120, w: 18, dur: 23, begin: -14 },
    { y: 46, w: 14, dur: 29, begin: -8 },
  ].map((b, i) => `<g opacity="0.9" transform="translate(${[300, 640, 180][i]} ${b.y})"><animateTransform attributeName="transform" type="translate" values="${W + 40} ${b.y};${W / 2} ${b.y + 18};-80 ${b.y - 6}" dur="${b.dur}s" begin="${b.begin}s" repeatCount="indefinite"/>
  <g transform="translate(${-b.w / 2} 0)"><g><animateTransform attributeName="transform" type="scale" values="1 1;1 0.45;1 1" dur="0.5s" repeatCount="indefinite"/>${batAt(0, 0, b.w, "#2b303a")}</g></g></g>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ahasan Ullah: .NET developer, Angular and React, Flutter, machine learning">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030406"/><stop offset="0.6" stop-color="#0b0e15"/><stop offset="1" stop-color="#171b24"/></linearGradient>
  <radialGradient id="halo" cx="${sx / W}" cy="${sy / H}" r="0.42"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.22"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
  <radialGradient id="disc" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.7" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
  <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.32"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.04"/></linearGradient>
  <linearGradient id="nameFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9bec7"/></linearGradient>
  <linearGradient id="rule" x1="0" x2="1"><stop offset="0" stop-color="${GOLD}" stop-opacity="0"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></linearGradient>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="nameGlow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="10"/></filter>
  <pattern id="rain" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
    <line x1="10" y1="0" x2="10" y2="14" stroke="#9fb3c8" stroke-width="1"/><line x1="40" y1="28" x2="40" y2="40" stroke="#9fb3c8" stroke-width="1"/>
    <animateTransform attributeName="patternTransform" type="translate" additive="sum" values="0 0;0 60" dur="0.6s" repeatCount="indefinite"/>
  </pattern>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  ${clips.join("\n  ")}
</defs>
<style>
  .name { font: 800 58px ${SANS}; letter-spacing: 8px; }
  .role { font: 600 15px ${SANS}; fill: #c9ccd1; letter-spacing: 3.2px; }
  .mono { font: 500 20px ${MONO}; fill: ${GOLD}; }
</style>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <g>
    <animateTransform attributeName="transform" type="rotate" values="0 ${lx} ${ly};-3 ${lx} ${ly};1.5 ${lx} ${ly};0 ${lx} ${ly}" dur="12s" repeatCount="indefinite"/>
    <path d="M${lx - 9},${ly} L${sx - 64},${sy + 8} A64,50 0 0 1 ${sx + 64},${sy - 8} L${lx + 9},${ly} Z" fill="url(#beam)"/>
    <ellipse cx="${sx}" cy="${sy}" rx="66" ry="52" fill="url(#disc)" opacity="0.95"><animate attributeName="opacity" values="0.95;0.8;0.95;0.9;0.95" dur="5s" repeatCount="indefinite"/></ellipse>
    ${batAt(sx - 51, sy - 27, 102, "#08090c")}
  </g>
  ${flyers.join("\n  ")}
  <g opacity="0.55">${skyline(W, H, 70, 150, true, "#11141b", false)}</g>
  ${skyline(W, H + 4, 48, 118, true, "#05060a", true)}
  <rect width="${W}" height="${H}" fill="url(#rain)" opacity="0.13"/>
  <rect width="${W}" height="${H}" fill="#dfe8ff" opacity="0"><animate attributeName="opacity" values="0;0;0.22;0;0.12;0;0" keyTimes="0;0.8;0.81;0.83;0.85;0.88;1" dur="11s" repeatCount="indefinite"/></rect>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#262a31"/>
<text x="600" y="118" text-anchor="middle" class="name" fill="${GOLD}" opacity="0.28" filter="url(#nameGlow)">AHASAN ULLAH</text>
<text x="600" y="118" text-anchor="middle" class="name" fill="url(#nameFill)">AHASAN ULLAH</text>
<rect x="440" y="140" width="320" height="2" fill="url(#rule)"/>
${batAt(586, 133, 28, GOLD)}
<text x="600" y="176" text-anchor="middle" class="role">.NET DEVELOPER  ·  ANGULAR &amp; REACT  ·  FLUTTER  ·  MACHINE LEARNING</text>
${typed.join("\n")}
</svg>
`;
  fs.writeFileSync(new URL("header.svg", OUT), svg);
}

// ---------------------------------------------------------------- divider
fs.writeFileSync(new URL("divider.svg", OUT), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="28" viewBox="0 0 1200 28" aria-hidden="true">
<defs>
  <linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.9"/></linearGradient>
  <linearGradient id="r" x1="1" x2="0"><stop offset="0" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.9"/></linearGradient>
</defs>
<rect x="80" y="13" width="470" height="2" rx="1" fill="url(#l)"/>
<rect x="650" y="13" width="470" height="2" rx="1" fill="url(#r)"/>
${batAt(570, 3, 60, GOLD, PULSE)}
</svg>
`);

// ---------------------------------------------------------------- batcomputer terminal (about card)
{
  const W = 560, H = 380;
  const rows = [
    ["cmd", "whoami"],
    ["out", "Ahasan Ullah — CSE undergrad @ AIUB, Dhaka"],
    ["cmd", "cat utility-belt.txt"],
    ["out", "C# · ASP.NET Core · Angular · React · Node"],
    ["out", "Python · PyTorch · MongoDB · MySQL · Flutter"],
    ["cmd", "./current-mission --status"],
    ["out", "BanglaCXR: chest X-ray → Bangla reports"],
    ["cmd", "echo $MOTTO"],
    ["out", "Learning through mistakes."],
  ];
  const dur = 18, step = 0.055;
  const body = rows.map(([kind, t], i) => {
    const y = 92 + i * 28;
    const at = (0.02 + i * step).toFixed(3);
    // Base opacity 1: complete when animation is off; when on, lines print in order each loop.
    const anim = `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${at};${(+at + 0.01).toFixed(3)};0.94;1" dur="${dur}s" repeatCount="indefinite"/>`;
    return kind === "cmd"
      ? `<g>${anim}<text x="28" y="${y}" class="t" fill="${GOLD}">❯</text><text x="48" y="${y}" class="t" fill="#f2f2f2">${esc(t)}</text></g>`
      : `<g>${anim}<text x="48" y="${y}" class="t" fill="#9aa1ab">${esc(t)}</text></g>`;
  }).join("\n");
  const lastY = 92 + rows.length * 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Batcomputer terminal: whoami, tech stack, current mission and motto">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13151a"/><stop offset="1" stop-color="#08090b"/></linearGradient>
  <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#fff" opacity="0.025"/></pattern>
  <linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.06"/></linearGradient>
  <clipPath id="c"><rect width="${W}" height="${H}" rx="14"/></clipPath>
</defs>
<style>.t { font: 500 14.5px ${MONO}; } .h { font: 700 11px ${SANS}; letter-spacing: 2.5px; fill: #8b9099; }</style>
<g clip-path="url(#c)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="40" fill="#0c0d10"/>
  <line x1="0" y1="40.5" x2="${W}" y2="40.5" stroke="#262a31"/>
  <circle cx="24" cy="20" r="5.5" fill="${GOLD}"/><circle cx="42" cy="20" r="5.5" fill="#3a3f48"/><circle cx="60" cy="20" r="5.5" fill="#3a3f48"/>
  <text x="${W / 2}" y="24" text-anchor="middle" class="h">BATCOMPUTER — ~/ahasan</text>
  ${batAt(W - 190, H - 120, 170, GOLD, { attrs: ` opacity="0.05"` })}
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
  <rect x="0" y="-80" width="${W}" height="80" fill="url(#sweep)"><animate attributeName="y" values="-80;${H}" dur="5s" repeatCount="indefinite"/></rect>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#262a31"/>
${body}
<text x="28" y="${lastY}" class="t" fill="${GOLD}">❯</text>
<rect x="48" y="${lastY - 13}" width="9" height="17" fill="${GOLD}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1s" repeatCount="indefinite"/></rect>
</svg>
`;
  fs.writeFileSync(new URL("batcomputer.svg", OUT), svg);
}

// ---------------------------------------------------------------- footer
{
  const W = 1200, H = 170;
  seed = 99;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="It's not who I am underneath, but what I do that defines me.">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030406"/><stop offset="1" stop-color="#141821"/></linearGradient>
  <radialGradient id="halo" cx="0.5" cy="0.2" r="0.5"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.14"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
  <clipPath id="c"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#c)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <g opacity="0.5">${skyline(W, H, 30, 70, false, "#11141b", false)}</g>
  ${skyline(W, H + 2, 20, 55, false, "#05060a", true)}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#262a31"/>
${batAt(578, 18, 44, GOLD, PULSE)}
<text x="600" y="78" text-anchor="middle" style="font: italic 500 19px ${SANS}; fill: #e6e7ea">“It's not who I am underneath, but what I do that defines me.”</text>
<text x="600" y="102" text-anchor="middle" style="font: 600 11px ${SANS}; letter-spacing: 3px; fill: #8b9099">THANKS FOR VISITING · SEE YOU IN GOTHAM</text>
</svg>
`;
  fs.writeFileSync(new URL("footer.svg", OUT), svg);
}
console.log("assets written");
