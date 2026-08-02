// Best-effort pipeline stage (continue-on-error in the workflow). Builds a
// simple Ken-Burns-style image slideshow, muxed with the narration audio
// already produced by generate-audio.js, and writes the result ONLY to
// $RUNNER_TEMP (never committed to the repo — uploaded to YouTube by
// upload-youtube.js and then discarded).
//
// The actual video-rendering logic lives in scripts/lib/video.js so it can
// be reused by scripts/fix-existing-videos.js without duplicating it.
//
// Usage:
//   node scripts/build-video.js            # real run, needs ffmpeg/ffprobe on PATH
//   node scripts/build-video.js --dry-run  # prints the plan, runs no ffmpeg commands
const fs = require("fs");
const path = require("path");
const { recordStatus } = require("./lib/pipeline-status");
const { renderSlideshow } = require("./lib/video");

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const IMAGES_PER_VIDEO = 5;

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

async function main() {
  const articlePath = path.join(RUNNER_TEMP, "pipeline-article.json");
  const audioPath = path.join(RUNNER_TEMP, "pipeline-audio.json");
  if (!fs.existsSync(articlePath)) throw new Error(`${articlePath} not found — run generate-article.js first`);
  if (!fs.existsSync(audioPath)) throw new Error(`${audioPath} not found — run generate-audio.js first (video reuses its narration)`);

  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const audio = JSON.parse(fs.readFileSync(audioPath, "utf8"));
  const rotation = JSON.parse(fs.readFileSync("content/image-rotation.json", "utf8"));

  const images = pickSlideshowImages(rotation, article.pillar, IMAGES_PER_VIDEO);
  console.log(`Slideshow images (${images.length}): ${images.join(", ")}`);

  if (DRY_RUN) {
    console.log("--dry-run: not invoking ffmpeg/ffprobe, not persisting rotation state.");
    return;
  }

  console.log("Running ffmpeg...");
  const outPath = path.join(RUNNER_TEMP, "video", `${article.slug}.mp4`);
  const { durationSeconds } = await renderSlideshow({
    images,
    audioPath: audio.audioPath,
    outPath,
    titleText: `${article.title} — Chase Arenella`,
  });
  console.log(`Wrote ${outPath} (narration ${durationSeconds.toFixed(1)}s)`);

  // Only persist rotation state after a successful build, so a failed run
  // doesn't burn images out of the rotation for nothing.
  fs.writeFileSync("content/image-rotation.json", JSON.stringify(rotation, null, 2) + "\n");

  fs.writeFileSync(
    path.join(RUNNER_TEMP, "pipeline-video.json"),
    JSON.stringify({ videoPath: outPath, images, durationSeconds }, null, 2)
  );
  recordStatus("video", true);
}

main().catch((e) => {
  console.error("build-video.js failed:", e.message);
  recordStatus("video", false, e.message);
  process.exit(1);
});
