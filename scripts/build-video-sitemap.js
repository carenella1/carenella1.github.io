// Rebuilds video-sitemap.xml from the VideoObject schema nodes on the
// article pages (written by update-podcast-feed.js / refresh-article-media.js).
// Tells Google which page each YouTube video is embedded on, so the article
// page itself — not just the youtube.com watch page — can show as a video
// result. Idempotent; run after any stage that changes article media.
//
// Run: node scripts/build-video-sitemap.js
const fs = require("fs");
const path = require("path");

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readGraph(html) {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]);
    return Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [];
  } catch (e) {
    return [];
  }
}

const entries = [];
for (const file of fs.readdirSync("articles").sort()) {
  if (!file.endsWith(".html")) continue;
  const graph = readGraph(fs.readFileSync(path.join("articles", file), "utf8"));
  const video = graph.find((n) => n["@type"] === "VideoObject");
  if (!video) continue;
  const seconds = Number((/^PT(\d+)S$/.exec(video.duration || "") || [])[1] || 0);
  entries.push(`  <url>
    <loc>${escapeXml(video.mainEntityOfPage)}</loc>
    <video:video>
      <video:thumbnail_loc>${escapeXml(video.thumbnailUrl)}</video:thumbnail_loc>
      <video:title>${escapeXml(video.name)}</video:title>
      <video:description>${escapeXml(video.description)}</video:description>
      <video:player_loc>${escapeXml(video.embedUrl)}</video:player_loc>${seconds ? `
      <video:duration>${seconds}</video:duration>` : ""}
      <video:publication_date>${escapeXml(video.uploadDate)}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
      <video:uploader info="https://carenella1.github.io/">Chase Arenella</video:uploader>
    </video:video>
  </url>`);
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries.join("\n")}
</urlset>
`;
fs.writeFileSync("video-sitemap.xml", xml);
console.log(`Wrote video-sitemap.xml (${entries.length} videos).`);
