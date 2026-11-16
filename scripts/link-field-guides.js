// Links each essay to the chasearenella.com field guides built on it.
//
// The field guide publishes guides.json: every guide with the essay on this
// site it builds on. This script groups those by essay and writes an "In the
// field guide" box into each essay between FIELD_GUIDE_START/END markers,
// adding the markers above "Explore Related Ideas" (or the footer) the first
// time. Deep links with the guide's title as anchor text help each guide rank
// on its own, which a sitewide link to the guide's home page doesn't.
//
// Idempotent and best-effort: if guides.json can't be fetched, nothing changes.
//
// Run: node scripts/link-field-guides.js
//      GUIDES_JSON=../chasearenella-com/guides.json node scripts/link-field-guides.js  (local file)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE_URL = "https://carenella1.github.io";
const GUIDES_URL = "https://chasearenella.com/guides.json";
const START = "<!-- FIELD_GUIDE_START -->";
const END = "<!-- FIELD_GUIDE_END -->";
const MARKERS = new RegExp(`${START}[\\s\\S]*?${END}`);

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function loadGuides() {
  if (process.env.GUIDES_JSON) return JSON.parse(fs.readFileSync(process.env.GUIDES_JSON, "utf8"));
  const res = await fetch(GUIDES_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderBox(guides) {
  if (!guides.length) return `${START}\n${END}`;
  const items = guides
    .map((g) => `<li><a href="${escapeHtml(g.url)}">${escapeHtml(g.title)}</a></li>`)
    .join("\n");
  return `${START}
<div class="callout field-guide-callout">
<p style="margin:0 0 8px 0;"><strong>In the field guide:</strong> quick reference pages on the ideas in this essay, from Chase Arenella's field guide.</p>
<ul style="margin:0;">
${items}
</ul>
</div>
${END}`;
}

function withBox(html, box) {
  // Match the file's line endings (CRLF on a Windows checkout) so reruns are no-ops.
  if (html.includes("\r\n")) box = box.replace(/\n/g, "\r\n");
  if (MARKERS.test(html)) return html.replace(MARKERS, box);
  for (const anchor of [/<h2[^>]*>Explore Related Ideas<\/h2>/, /<div class="footer">/, /<footer\b/]) {
    const m = html.match(anchor);
    if (m) {
      const lineStart = html.lastIndexOf("\n", m.index) + 1;
      const indent = html.slice(lineStart, m.index).match(/^\s*/)[0];
      return `${html.slice(0, lineStart)}${indent}${box}\n${html.slice(lineStart)}`;
    }
  }
  return null;
}

// Every page that has (or should have) a box: essays named in guides.json,
// plus any page already carrying markers, so a box empties if its guides go.
function targetFiles(byFile) {
  const files = new Set(byFile.keys());
  const scan = [ROOT, path.join(ROOT, "articles")];
  for (const dir of scan) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".html")) continue;
      const rel = path.relative(ROOT, path.join(dir, f)).split(path.sep).join("/");
      if (fs.readFileSync(path.join(ROOT, rel), "utf8").includes(START)) files.add(rel);
    }
  }
  return [...files].sort();
}

async function main() {
  let guides;
  try {
    guides = await loadGuides();
  } catch (e) {
    console.warn(`Could not load the field guide index (${e.message}); leaving essays unchanged.`);
    return;
  }

  const byFile = new Map();
  for (const g of guides) {
    if (!g.essay || !g.essay.startsWith(`${SITE_URL}/`)) continue;
    const rel = g.essay.slice(SITE_URL.length + 1);
    if (!/^[\w./-]+\.html$/.test(rel) || !fs.existsSync(path.join(ROOT, rel))) continue;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(g);
  }

  let changed = 0;
  for (const rel of targetFiles(byFile)) {
    const file = path.join(ROOT, rel);
    const html = fs.readFileSync(file, "utf8");
    const list = (byFile.get(rel) || []).slice().sort((a, b) => a.title.localeCompare(b.title));
    const next = withBox(html, renderBox(list));
    if (next === null) {
      console.warn(`${rel}: no place to put the field guide box; skipped.`);
      continue;
    }
    if (next !== html) {
      fs.writeFileSync(file, next);
      changed++;
      console.log(`${rel}: ${list.length} guide link(s)`);
    }
  }
  console.log(`Field guide links: ${guides.length} guides, ${byFile.size} essays, ${changed} file(s) updated.`);
}

main();
