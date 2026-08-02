// Best-effort pipeline stage (continue-on-error in the workflow). Only
// requires the audio file to exist — runs independently of whether the
// video/YouTube stages succeeded. Maintains podcast.xml (self-hosted RSS +
// iTunes namespace feed) and patches the already-written article page with
// (a) a PodcastEpisode/AudioObject schema node and (b) the visible
// "Watch & Listen" section via the MEDIA_SECTION marker in lib/template.js.
//
// Usage:
//   node scripts/update-podcast-feed.js            # real run
//   node scripts/update-podcast-feed.js --dry-run  # prints the plan, writes nothing
const fs = require("fs");
const path = require("path");
const { recordStatus } = require("./lib/pipeline-status");
const { renderMediaSection, injectMediaSection } = require("./lib/template");
const entity = require("./lib/entity");

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const SITE_URL = "https://carenella1.github.io";
const PODCAST_PATH = "podcast.xml";

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildChannelHeader() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>Chase Arenella — AI-Augmented Leadership &amp; Systems Thinking</title>
<link>${SITE_URL}/</link>
<language>en-us</language>
<description>Audio companion to the articles at carenella1.github.io — AI-augmented leadership, agile systems thinking, and gaming strategy, read by Chase Arenella.</description>
<itunes:author>Chase Arenella</itunes:author>
<itunes:image href="${entity.CANONICAL_IMAGE}"/>
<itunes:category text="Business"/>
<itunes:explicit>false</itunes:explicit>
</channel>
</rss>
`;
}

function buildItem({ title, url, audioUrl, bytes, publishedISO, description, durationSeconds }) {
  const pubDate = new Date(publishedISO).toUTCString();
  return `<item>
<title>${escapeXml(title)}</title>
<link>${url}</link>
<guid isPermaLink="false">${url}#podcast</guid>
<pubDate>${pubDate}</pubDate>
<description><![CDATA[${description}]]></description>
<enclosure url="${SITE_URL}${audioUrl}" length="${bytes}" type="audio/mpeg"/>
<itunes:duration>${Math.round(durationSeconds || 0)}</itunes:duration>
</item>
`;
}

function appendItemToFeed(xml, itemXml) {
  if (xml.includes(itemXml.split("\n")[0])) return xml; // defensive: avoid duplicate on re-run
  return xml.replace("</channel>", `${itemXml}</channel>`);
}

function patchArticleSchema(html, { audioUrl, bytes, durationSeconds, videoId, articleUrl, title }) {
  const scriptRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = scriptRe.exec(html))) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch (e) {
      continue;
    }
    const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    const hasArticle = graph.some((n) => n["@type"] === "Article");
    if (!hasArticle) continue;

    const episodeNode = {
      "@type": "PodcastEpisode",
      "@id": `${articleUrl}#podcast`,
      url: `${SITE_URL}${audioUrl}`,
      name: title,
      datePublished: new Date().toISOString(),
      associatedMedia: {
        "@type": "AudioObject",
        contentUrl: `${SITE_URL}${audioUrl}`,
        encodingFormat: "audio/mpeg",
        duration: `PT${Math.round(durationSeconds || 0)}S`,
      },
      partOfSeries: { "@type": "PodcastSeries", name: "Chase Arenella — AI-Augmented Leadership & Systems Thinking" },
    };
    if (videoId) {
      episodeNode.video = {
        "@type": "VideoObject",
        contentUrl: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        name: title,
        uploadDate: new Date().toISOString(),
      };
    }

    if (!graph.some((n) => n["@type"] === "PodcastEpisode")) graph.push(episodeNode);

    const newInner = "\n" + JSON.stringify(parsed, null, 2) + "\n";
    return html.replace(m[0], `<script type="application/ld+json">${newInner}</script>`);
  }
  console.warn("Could not find the Article schema node to attach a PodcastEpisode to — schema patch skipped.");
  return html;
}

async function main() {
  const articlePath = path.join(RUNNER_TEMP, "pipeline-article.json");
  const audioPath = path.join(RUNNER_TEMP, "pipeline-audio.json");
  if (!fs.existsSync(articlePath)) throw new Error(`${articlePath} not found — run generate-article.js first`);
  if (!fs.existsSync(audioPath)) {
    console.log("No pipeline-audio.json found — audio stage did not succeed this cycle, skipping podcast episode.");
    recordStatus("podcast", false, "no audio available");
    return;
  }

  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const audio = JSON.parse(fs.readFileSync(audioPath, "utf8"));
  const videoInfoPath = path.join(RUNNER_TEMP, "pipeline-video.json");
  const youtubeInfoPath = path.join(RUNNER_TEMP, "pipeline-youtube.json");
  const durationSeconds = fs.existsSync(videoInfoPath)
    ? JSON.parse(fs.readFileSync(videoInfoPath, "utf8")).durationSeconds
    : 0;
  const videoId = fs.existsSync(youtubeInfoPath) ? JSON.parse(fs.readFileSync(youtubeInfoPath, "utf8")).videoId : null;

  console.log(`Podcast episode for "${article.title}" (${audio.bytes} bytes, videoId=${videoId || "none"})`);

  if (DRY_RUN) {
    console.log("--dry-run: not writing podcast.xml or patching the article file.");
    return;
  }

  let feed = fs.existsSync(PODCAST_PATH) ? fs.readFileSync(PODCAST_PATH, "utf8") : buildChannelHeader();
  const itemXml = buildItem({
    title: article.title,
    url: article.url,
    audioUrl: audio.audioUrl,
    bytes: audio.bytes,
    publishedISO: article.publishedISO,
    description: article.title,
    durationSeconds,
  });
  feed = appendItemToFeed(feed, itemXml);
  fs.writeFileSync(PODCAST_PATH, feed);
  console.log(`Updated ${PODCAST_PATH}`);

  const articleFile = path.join("articles", `${article.slug}.html`);
  let html = fs.readFileSync(articleFile, "utf8");
  html = patchArticleSchema(html, {
    audioUrl: audio.audioUrl,
    bytes: audio.bytes,
    durationSeconds,
    videoId,
    articleUrl: article.url,
    title: article.title,
  });
  const mediaHtml = renderMediaSection({ videoId, title: article.title, audioUrl: audio.audioUrl });
  html = injectMediaSection(html, mediaHtml);
  fs.writeFileSync(articleFile, html);
  console.log(`Patched ${articleFile} with podcast schema + visible media section.`);

  recordStatus("podcast", true);
}

main().catch((e) => {
  console.error("update-podcast-feed.js failed:", e.message);
  recordStatus("podcast", false, e.message);
  process.exit(1);
});
