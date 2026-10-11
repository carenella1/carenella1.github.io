// Rebuilds everything derived from the site's videos, from the VideoObject
// schema on the article pages:
//   - videos/<slug>.html   one watch page per video (lib/video-pages.js)
//   - videos.html          the hub listing them
//   - video-sitemap.xml    points Google at the watch pages
//   - sitemap.xml          gains a <url> for the hub and each watch page
// Idempotent; the content pipeline runs it after update-podcast-feed.js.
//
// Run: node scripts/build-video-pages.js
const fs = require("fs");
const path = require("path");
const { readArticleVideo } = require("./lib/page-schema");
const { renderWatchPage, renderHub, watchUrl, HUB_URL } = require("./lib/video-pages");
const { upsertSitemapUrl } = require("./lib/sitemap");

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  fs.writeFileSync(file, content);
  return true;
}

function buildVideoSitemap(videos) {
  const entries = videos.map(
    (v) => `  <url>
    <loc>${escapeXml(watchUrl(v.slug))}</loc>
    <video:video>
      <video:thumbnail_loc>https://i.ytimg.com/vi/${escapeXml(v.videoId)}/hqdefault.jpg</video:thumbnail_loc>
      <video:title>${escapeXml(`Chase Arenella — ${v.title}`)}</video:title>
      <video:description>${escapeXml(v.description)}</video:description>
      <video:player_loc>https://www.youtube.com/embed/${escapeXml(v.videoId)}</video:player_loc>${
        v.durationSeconds ? `\n      <video:duration>${Math.round(v.durationSeconds)}</video:duration>` : ""
      }
      <video:publication_date>${escapeXml(v.uploadDate)}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
      <video:uploader info="https://carenella1.github.io/">Chase Arenella</video:uploader>
    </video:video>
  </url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries.join("\n")}
</urlset>
`;
}

// Adds/updates <url> entries for the hub and watch pages in sitemap.xml.
function updateMainSitemap(videos) {
  let xml = fs.readFileSync("sitemap.xml", "utf8");
  xml = upsertSitemapUrl(xml, {
    loc: HUB_URL,
    lastmod: videos.length ? videos[0].uploadDate.slice(0, 10) : null,
    priority: "0.9",
  });
  for (const v of videos) {
    xml = upsertSitemapUrl(xml, { loc: watchUrl(v.slug), lastmod: v.uploadDate.slice(0, 10) });
  }
  return writeIfChanged("sitemap.xml", xml);
}

const videos = fs
  .readdirSync("articles")
  .filter((f) => f.endsWith(".html"))
  .map((f) => readArticleVideo(path.join("articles", f)))
  .filter(Boolean)
  .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

fs.mkdirSync("videos", { recursive: true });
let changed = 0;
for (const v of videos) {
  if (writeIfChanged(path.join("videos", `${v.slug}.html`), renderWatchPage(v, videos))) changed++;
}
// Remove watch pages whose video no longer exists on any article.
const live = new Set(videos.map((v) => `${v.slug}.html`));
for (const f of fs.readdirSync("videos")) {
  if (f.endsWith(".html") && !live.has(f)) {
    fs.unlinkSync(path.join("videos", f));
    changed++;
  }
}
if (writeIfChanged("videos.html", renderHub(videos))) changed++;
if (writeIfChanged("video-sitemap.xml", buildVideoSitemap(videos))) changed++;
if (updateMainSitemap(videos)) changed++;

console.log(`${videos.length} videos; ${changed} file(s) written or removed.`);
