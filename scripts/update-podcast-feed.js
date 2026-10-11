// Best-effort pipeline stage (continue-on-error in the workflow). Only
// requires the audio file to exist — runs independently of whether the
// video/YouTube stages succeeded. Rebuilds podcast.xml (self-hosted RSS +
// iTunes namespace feed) and patches the already-written article page with
// (a) PodcastEpisode + VideoObject schema nodes and (b) the visible
// "Watch & Listen" section via the MEDIA_SECTION marker in lib/template.js.
//
// Usage:
//   node scripts/update-podcast-feed.js            # real run
//   node scripts/update-podcast-feed.js --dry-run  # prints the plan, writes nothing
const fs = require("fs");
const path = require("path");
const { recordStatus } = require("./lib/pipeline-status");
const { renderMediaSection, injectMediaSection, buildMediaSchemaNodes, replaceMediaSchema } = require("./lib/template");
const { collectEpisodes, buildFeed } = require("./lib/podcast-feed");

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const PODCAST_PATH = "podcast.xml";

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

  // Patch the article page first: the feed is rebuilt from the pages'
  // PodcastEpisode schema, so this episode has to be on its page before then.
  const articleFile = path.join("articles", `${article.slug}.html`);
  let html = fs.readFileSync(articleFile, "utf8");
  const mediaNodes = buildMediaSchemaNodes({
    articleUrl: article.url,
    title: article.title,
    description: article.metaDescription,
    audioUrl: audio.audioUrl,
    durationSeconds,
    videoId,
    publishedISO: article.publishedISO,
    uploadDate: videoId ? new Date().toISOString() : undefined,
  });
  const patched = replaceMediaSchema(html, mediaNodes);
  if (patched) html = patched;
  else console.warn("Could not find the Article schema block — media schema patch skipped.");
  const mediaHtml = renderMediaSection({
    videoId,
    title: article.title,
    audioUrl: audio.audioUrl,
    watchUrl: videoId ? `/videos/${article.slug}.html` : null,
  });
  html = injectMediaSection(html, mediaHtml);
  fs.writeFileSync(articleFile, html);
  console.log(`Patched ${articleFile} with podcast/video schema + visible media section.`);

  const episodes = collectEpisodes();
  fs.writeFileSync(PODCAST_PATH, buildFeed(episodes));
  console.log(`Rebuilt ${PODCAST_PATH} (${episodes.length} episodes).`);

  recordStatus("podcast", true);
}

main().catch((e) => {
  console.error("update-podcast-feed.js failed:", e.message);
  recordStatus("podcast", false, e.message);
  process.exit(1);
});
