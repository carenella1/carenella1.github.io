// ONE-TIME utility — not part of the recurring content pipeline. Rebuilds
// the slideshow video for a hardcoded list of already-published articles
// (using the corrected zoom math in scripts/lib/video.js), deletes the old
// YouTube video, uploads the corrected one, and patches the article's HTML
// (schema + visible Watch link) to point at the new video ID.
//
// This does a real delete + new upload — the video gets a NEW YouTube video
// ID/URL (unlike Studio's manual "Replace video" feature, which keeps the
// same ID but isn't exposed by the API). Both existing videos here have
// negligible view counts, so losing the old ID costs nothing in practice.
//
// Usage: node scripts/fix-existing-videos.js
//   (needs ffmpeg/ffprobe on PATH and YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN set)
const fs = require("fs");
const path = require("path");
const { renderSlideshow } = require("./lib/video");
const { getAccessToken, deleteVideo, uploadVideo } = require("./lib/youtube");

const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const SITE_URL = "https://carenella1.github.io";

// The specific videos being fixed — found via `grep -o 'watch?v=...'` on
// each article file before this script existed.
const FIXES = [
  { slug: "11-signal-vs-noise-what-ai-should-and-shouldn-t", oldVideoId: "jDbjnR2IPZE" },
  { slug: "12-why-chaseofspadez-strengthens-the-brand-of-it", oldVideoId: "Cx2Wisai9YE" },
];

function pickSlideshowImages(rotation, pillar, count) {
  const pool = rotation.pools[pillar];
  if (!pool || pool.length === 0) throw new Error(`No image pool for pillar: ${pillar}`);
  const n = Math.min(count, pool.length);
  const start = rotation.slideshowIndex[pillar] % pool.length;
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(pool[(start + i) % pool.length]);
  rotation.slideshowIndex[pillar] = (start + n) % pool.length;
  return picked;
}

async function fixOne({ slug, oldVideoId }, { accessToken, rotation }) {
  console.log(`\n=== Fixing ${slug} (old video: ${oldVideoId}) ===`);

  const index = JSON.parse(fs.readFileSync("content/articles-index.json", "utf8"));
  const entry = index.find((a) => a.slug === slug);
  if (!entry) throw new Error(`No articles-index.json entry for slug ${slug}`);

  const audioPath = path.join("assets", "audio", `${slug}.mp3`);
  if (!fs.existsSync(audioPath)) throw new Error(`Missing committed audio file: ${audioPath}`);

  const images = pickSlideshowImages(rotation, entry.pillar, 5);
  console.log(`Slideshow images: ${images.join(", ")}`);

  const outPath = path.join(RUNNER_TEMP, "video-fix", `${slug}.mp4`);
  const { durationSeconds } = await renderSlideshow({
    images,
    audioPath,
    outPath,
    titleText: `${entry.title} — Chase Arenella`,
  });
  console.log(`Rebuilt video: ${outPath} (${durationSeconds.toFixed(1)}s)`);

  console.log(`Deleting old video ${oldVideoId}...`);
  await deleteVideo(accessToken, oldVideoId);

  const articleUrl = `${SITE_URL}/articles/${slug}.html`;
  const metadata = {
    snippet: {
      title: `${entry.title} — Chase Arenella`.slice(0, 100),
      description: `${entry.title}\n\nFull article: ${articleUrl}\n\nBy Chase Arenella — AI-augmented leadership, agile systems thinking, and gaming strategy.`,
      tags: ["Chase Arenella", "AI-augmented leadership", "agile systems", entry.pillar],
      categoryId: "27",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
  console.log("Uploading corrected video...");
  const result = await uploadVideo({ accessToken, videoPath: outPath, metadata });
  console.log(`New video: https://www.youtube.com/watch?v=${result.id}`);

  const articleFile = path.join("articles", `${slug}.html`);
  let html = fs.readFileSync(articleFile, "utf8");
  const occurrences = html.split(oldVideoId).length - 1;
  html = html.split(oldVideoId).join(result.id);
  fs.writeFileSync(articleFile, html);
  console.log(`Patched ${occurrences} occurrence(s) of the old video ID in ${articleFile}`);

  return { slug, oldVideoId, newVideoId: result.id };
}

async function main() {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN must all be set");
  }
  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
  const rotation = JSON.parse(fs.readFileSync("content/image-rotation.json", "utf8"));

  const results = [];
  for (const fix of FIXES) {
    results.push(await fixOne(fix, { accessToken, rotation }));
  }

  // Persist rotation state only after all fixes succeeded.
  fs.writeFileSync("content/image-rotation.json", JSON.stringify(rotation, null, 2) + "\n");

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.slug}: ${r.oldVideoId} -> ${r.newVideoId}`);
  }
}

main().catch((e) => {
  console.error("fix-existing-videos.js failed:", e.message);
  process.exit(1);
});
