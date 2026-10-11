// Re-renders the media section and media schema of every article page that
// already has a podcast episode, using the current lib/template.js output,
// then rebuilds podcast.xml from the pages. Idempotent — safe to re-run
// whenever the media section markup or schema shape changes.
//
// Usage:
//   node scripts/refresh-article-media.js            # rewrite pages + feed
//   node scripts/refresh-article-media.js --dry-run  # list what would change
const fs = require("fs");
const path = require("path");
const {
  renderMediaSection,
  injectMediaSection,
  buildMediaSchemaNodes,
  replaceMediaSchema,
} = require("./lib/template");
const { collectEpisodes, buildFeed } = require("./lib/podcast-feed");

const DRY_RUN = process.argv.includes("--dry-run");
const SITE_URL = "https://carenella1.github.io";

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

function videoIdFrom(node) {
  const m = node && /\/embed\/([A-Za-z0-9_-]{11})/.exec(node.embedUrl || "");
  return m ? m[1] : null;
}

let changed = 0;
for (const file of fs.readdirSync("articles").sort()) {
  if (!file.endsWith(".html")) continue;
  const filePath = path.join("articles", file);
  const html = fs.readFileSync(filePath, "utf8");
  const graph = readGraph(html);
  const article = graph.find((n) => n["@type"] === "Article");
  const episode = graph.find((n) => n["@type"] === "PodcastEpisode");
  if (!article || !episode) continue;

  const topLevelVideo = graph.find((n) => n["@type"] === "VideoObject");
  const video = topLevelVideo || (episode.video && episode.video.embedUrl ? episode.video : null);
  const videoId = videoIdFrom(video);
  const audioUrl = episode.associatedMedia.contentUrl.replace(SITE_URL, "");
  const durationSeconds = Number((/^PT(\d+)S$/.exec(episode.associatedMedia.duration || "") || [])[1] || 0);

  const mediaNodes = buildMediaSchemaNodes({
    articleUrl: article.mainEntityOfPage,
    title: article.headline,
    description: article.description,
    audioUrl,
    durationSeconds,
    videoId,
    publishedISO: article.datePublished,
    uploadDate: video && video.uploadDate,
  });

  let out = replaceMediaSchema(html, mediaNodes);
  if (!out) {
    console.warn(`SKIP ${file}: no Article schema block`);
    continue;
  }
  out = injectMediaSection(out, renderMediaSection({ videoId, title: article.headline, audioUrl }));

  if (out !== html) {
    changed++;
    console.log(`${DRY_RUN ? "WOULD UPDATE" : "UPDATED"} ${file} (video=${videoId || "none"}, ${durationSeconds}s)`);
    if (!DRY_RUN) fs.writeFileSync(filePath, out);
  }
}

const episodes = collectEpisodes();
if (!DRY_RUN) fs.writeFileSync("podcast.xml", buildFeed(episodes));
console.log(`${changed} article page(s) changed; podcast.xml ${DRY_RUN ? "would have" : "now has"} ${episodes.length} episodes.`);
