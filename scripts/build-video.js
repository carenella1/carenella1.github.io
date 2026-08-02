// Best-effort pipeline stage (continue-on-error in the workflow). Builds a
// simple Ken-Burns-style image slideshow, muxed with the narration audio
// already produced by generate-audio.js, and writes the result ONLY to
// $RUNNER_TEMP (never committed to the repo — uploaded to YouTube by
// upload-youtube.js and then discarded).
//
// Usage:
//   node scripts/build-video.js            # real run, needs ffmpeg/ffprobe on PATH
//   node scripts/build-video.js --dry-run  # prints the plan, runs no ffmpeg commands
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { recordStatus } = require("./lib/pipeline-status");
const execFileP = promisify(execFile);

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const IMAGES_PER_VIDEO = 5;
const FPS = 25;

async function getAudioDuration(audioPath) {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  return parseFloat(stdout.trim());
}

async function resolveFont() {
  try {
    const { stdout } = await execFileP("fc-match", ["-f", "%{file}", "DejaVu Sans Bold"]);
    const p = stdout.trim();
    if (p && fs.existsSync(p)) return p;
  } catch (e) {
    // fc-match unavailable or no match — fall through to known-install-path guesses.
  }
  const fallbacks = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  return fallbacks.find((p) => fs.existsSync(p)) || null;
}

function escapeDrawtext(text) {
  // The text value is wrapped in single quotes (see buildFilterComplex), and
  // ffmpeg's filter-string quoting protects every special character
  // (including ':') once inside single quotes — the ONLY thing that needs
  // handling is a literal single quote itself, via the standard
  // close-quote / escaped-quote / reopen-quote sequence: '\''
  return String(text).replace(/'/g, "'\\''");
}

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

function buildFilterComplex({ imageCount, perImageDuration, fontPath, titleText }) {
  const zoomFrames = Math.max(1, Math.round(perImageDuration * FPS));
  const perStream = [];
  for (let i = 0; i < imageCount; i++) {
    perStream.push(
      `[${i}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
        `zoompan=z='min(zoom+0.0015,1.4)':d=${zoomFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${FPS},setsar=1[v${i}]`
    );
  }
  const concatInputs = Array.from({ length: imageCount }, (_, i) => `[v${i}]`).join("");
  let graph = perStream.join(";\n") + `;\n${concatInputs}concat=n=${imageCount}:v=1:a=0[vconcat]`;

  if (fontPath) {
    const safeText = escapeDrawtext(titleText);
    graph += `;\n[vconcat]drawtext=fontfile='${fontPath}':text='${safeText}':x=40:y=h-th-40:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=12[vout]`;
  } else {
    graph += `;\n[vconcat]null[vout]`;
  }
  return graph;
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

  const duration = await getAudioDuration(audio.audioPath);
  const perImageDuration = duration / images.length;
  console.log(`Narration duration: ${duration.toFixed(1)}s -> ${perImageDuration.toFixed(1)}s/image`);

  const fontPath = await resolveFont();
  if (!fontPath) console.warn("No DejaVu font found — video will render without a title overlay.");

  const imageInputArgs = [];
  for (const img of images) {
    imageInputArgs.push("-loop", "1", "-t", String(perImageDuration), "-i", path.join("assets", "images", img));
  }

  const filterComplex = buildFilterComplex({
    imageCount: images.length,
    perImageDuration,
    fontPath,
    titleText: `${article.title} — Chase Arenella`,
  });

  const videoDir = path.join(RUNNER_TEMP, "video");
  fs.mkdirSync(videoDir, { recursive: true });
  const outPath = path.join(videoDir, `${article.slug}.mp4`);

  const audioInputIndex = images.length; // narration is the last -i argument
  const args = [
    "-y",
    ...imageInputArgs,
    "-i", audio.audioPath,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", `${audioInputIndex}:a`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    outPath,
  ];

  console.log("Running ffmpeg...");
  await execFileP("ffmpeg", args, { maxBuffer: 1024 * 1024 * 20 });
  console.log(`Wrote ${outPath}`);

  // Only persist rotation state after a successful build, so a failed run
  // doesn't burn images out of the rotation for nothing.
  fs.writeFileSync("content/image-rotation.json", JSON.stringify(rotation, null, 2) + "\n");

  fs.writeFileSync(
    path.join(RUNNER_TEMP, "pipeline-video.json"),
    JSON.stringify({ videoPath: outPath, images, durationSeconds: duration }, null, 2)
  );
  recordStatus("video", true);
}

main().catch((e) => {
  console.error("build-video.js failed:", e.message);
  recordStatus("video", false, e.message);
  process.exit(1);
});
