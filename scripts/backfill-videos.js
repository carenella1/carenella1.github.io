// Builds and uploads a video for article pages that already have narration
// audio (a PodcastEpisode) but no video — e.g. articles whose YouTube stage
// failed in the monthly pipeline. Reuses the existing narration, so it costs
// no TTS calls. Each article's page is patched as soon as its upload
// succeeds, so a later failure never loses an upload that already happened
// (and a re-run skips it instead of uploading a duplicate).
//
// Run scripts/build-video-pages.js afterwards to generate the watch pages.
//
// Usage:
//   node scripts/backfill-videos.js                  # all eligible, up to --limit
//   node scripts/backfill-videos.js --limit 3        # YouTube's daily quota allows ~6 uploads
//   node scripts/backfill-videos.js <slug> [<slug>]  # specific articles only
//   node scripts/backfill-videos.js --dry-run        # list what would be done
const fs = require("fs");
const path = require("path");
const { renderSlideshow, pickSlideshowImages } = require("./lib/video");
const { getAccessToken, uploadVideo } = require("./lib/youtube");
const { buildMetadata } = require("./lib/youtube-metadata");
const { readGraph, durationSeconds, readArticleOutline } = require("./lib/page-schema");
const { renderMediaSection, injectMediaSection, buildMediaSchemaNodes, replaceMediaSchema } = require("./lib/template");

const SITE_URL = "https://carenella1.github.io";
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const IMAGES_PER_VIDEO = 5;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 5;
const onlySlugs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");

function findCandidates() {
  const index = JSON.parse(fs.readFileSync("content/articles-index.json", "utf8"));
  const pillarBySlug = Object.fromEntries(index.map((a) => [a.slug, a.pillar]));
  const out = [];
  for (const file of fs.readdirSync("articles").sort()) {
    if (!file.endsWith(".html")) continue;
    const slug = path.basename(file, ".html");
    if (onlySlugs.length && !onlySlugs.includes(slug)) continue;
    const filePath = path.join("articles", file);
    const html = fs.readFileSync(filePath, "utf8");
    const graph = readGraph(html);
    const article = graph.find((n) => n["@type"] === "Article");
    const episode = graph.find((n) => n["@type"] === "PodcastEpisode");
    if (!article || !episode || graph.some((n) => n["@type"] === "VideoObject")) continue;
    const audioUrl = episode.associatedMedia.contentUrl.replace(SITE_URL, "");
    const audioPath = audioUrl.replace(/^\//, "");
    if (!fs.existsSync(audioPath)) {
      console.warn(`Skipping ${slug}: ${audioPath} not found`);
      continue;
    }
    const pillar = pillarBySlug[slug];
    if (!pillar) {
      console.warn(`Skipping ${slug}: no pillar in content/articles-index.json`);
      continue;
    }
    out.push({ slug, filePath, article, episode, audioUrl, audioPath, pillar, ...readArticleOutline(html) });
  }
  return out;
}

async function main() {
  const candidates = findCandidates().slice(0, LIMIT);
  console.log(`${candidates.length} article(s) to backfill: ${candidates.map((c) => c.slug).join(", ") || "none"}`);
  if (DRY_RUN || candidates.length === 0) return;

  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN must all be set");
  }
  const accessToken = await getAccessToken({
    clientId: YT_CLIENT_ID,
    clientSecret: YT_CLIENT_SECRET,
    refreshToken: YT_REFRESH_TOKEN,
  });

  let failures = 0;
  for (const c of candidates) {
    try {
      const rotation = JSON.parse(fs.readFileSync("content/image-rotation.json", "utf8"));
      const images = pickSlideshowImages(rotation, c.pillar, IMAGES_PER_VIDEO);
      const outPath = path.join(RUNNER_TEMP, "video", `${c.slug}.mp4`);
      console.log(`\n[${c.slug}] rendering with ${images.join(", ")}`);
      const { durationSeconds: seconds } = await renderSlideshow({
        images,
        audioPath: c.audioPath,
        outPath,
        titleText: `${c.article.headline} — Chase Arenella`,
      });
      fs.writeFileSync("content/image-rotation.json", JSON.stringify(rotation, null, 2) + "\n");

      const metadata = buildMetadata({
        title: c.article.headline,
        url: c.article.mainEntityOfPage,
        metaDescription: c.article.description,
        thesis: c.thesis,
        headings: c.headings,
        pillar: c.pillar,
      });
      const result = await uploadVideo({ accessToken, videoPath: outPath, metadata });
      console.log(`[${c.slug}] uploaded: https://www.youtube.com/watch?v=${result.id}`);

      // Patch the page right away — this is what marks the article as done.
      let html = fs.readFileSync(c.filePath, "utf8");
      const nodes = buildMediaSchemaNodes({
        articleUrl: c.article.mainEntityOfPage,
        title: c.article.headline,
        description: c.article.description,
        audioUrl: c.audioUrl,
        durationSeconds: seconds || durationSeconds(c.episode.associatedMedia.duration),
        videoId: result.id,
        publishedISO: c.article.datePublished,
        uploadDate: new Date().toISOString(),
      });
      html = replaceMediaSchema(html, nodes);
      if (!html) throw new Error(`uploaded ${result.id} but could not find the page's Article schema to patch`);
      html = injectMediaSection(
        html,
        renderMediaSection({
          videoId: result.id,
          title: c.article.headline,
          audioUrl: c.audioUrl,
          watchUrl: `/videos/${c.slug}.html`,
        })
      );
      fs.writeFileSync(c.filePath, html);
    } catch (e) {
      failures++;
      console.error(`[${c.slug}] failed: ${e.message}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} of ${candidates.length} backfill(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("backfill-videos.js failed:", e.message);
  process.exit(1);
});
