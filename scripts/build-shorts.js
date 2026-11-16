// Makes and uploads YouTube Shorts for essays and field guides that don't
// have one yet (see scripts/lib/shorts.js), recording each in
// content/shorts.json the moment its upload succeeds, so a later failure
// never loses an upload and a re-run never duplicates one.
//
// Run scripts/build-video-pages.js afterwards to add their watch pages.
//
// Usage:
//   node scripts/build-shorts.js --limit 4          # YouTube's daily quota allows ~6 uploads
//   node scripts/build-shorts.js --dry-run          # list what would be made
//   node scripts/build-shorts.js --preview <dir>    # make the next one, save the mp4 and
//                                                   # three frames to <dir>, upload nothing
const fs = require("fs");
const path = require("path");
const { getAccessToken, uploadVideo } = require("./lib/youtube");
const shorts = require("./lib/shorts");
const { renderScenes } = require("./lib/scenes");

const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const LIMIT = Number(opt("--limit", 4));
const PREVIEW_DIR = opt("--preview", null);

async function make(source, workDir) {
  console.log(`\n[${source.key}] writing script`);
  const script = await shorts.writeScript(source);
  console.log(`[${source.key}] "${script.title}"\n  ${script.narration}`);
  const audioPath = await shorts.narrate(script.narration, path.join(workDir, "narration.mp3"));
  let scenes;
  try {
    scenes = await renderScenes(script.scenes, { name: `short-${source.key}`, size: "1024x1536" });
  } catch (e) {
    // A Short with recycled images beats no Short.
    console.warn(`[${source.key}] scene images failed (${e.message}); using the image pool`);
    const rotation = JSON.parse(fs.readFileSync("content/image-rotation.json", "utf8"));
    scenes = shorts.pickImages(rotation, source.pillar, source.key).map((file) => ({ file, alt: null }));
  }
  const images = scenes.map((s) => s.file);
  console.log(`[${source.key}] rendering with ${images.join(", ")}`);
  const video = await shorts.renderShort({ script, images, audioPath, outPath: path.join(workDir, `${source.key}.mp4`), workDir });
  console.log(`[${source.key}] ${video.durationSeconds.toFixed(1)}s`);
  return { script, video, scenes: scenes.filter((s) => s.alt) };
}

async function savePreview(source, { script, video, scenes }) {
  const { execFile } = require("child_process");
  const run = require("util").promisify(execFile);
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  fs.copyFileSync(video.outPath, path.join(PREVIEW_DIR, "short.mp4"));
  for (const s of scenes) fs.copyFileSync(path.join("assets", "images", s.file), path.join(PREVIEW_DIR, path.basename(s.file)));
  for (const [i, t] of [1, video.durationSeconds / 2, video.durationSeconds - 2].entries()) {
    await run("ffmpeg", ["-y", "-ss", t.toFixed(2), "-i", video.outPath, "-frames:v", "1", path.join(PREVIEW_DIR, `frame-${i + 1}.png`)]);
  }
  fs.writeFileSync(path.join(PREVIEW_DIR, "script.json"), JSON.stringify({ source, script, scenes, metadata: shorts.buildShortMetadata(source, script) }, null, 2));
  console.log(`Preview written to ${PREVIEW_DIR}`);
}

async function main() {
  const done = new Set(shorts.readShorts().map((s) => s.key));
  const pending = (await shorts.loadSources()).filter((s) => !done.has(s.key));
  const batch = pending.slice(0, PREVIEW_DIR ? 1 : LIMIT);
  console.log(`${pending.length} Short(s) not made yet; this run: ${batch.map((s) => s.key).join(", ") || "none"}`);
  if (DRY_RUN || batch.length === 0) return;

  let accessToken = null;
  if (!PREVIEW_DIR) {
    const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
    if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
      throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN must all be set");
    }
    accessToken = await getAccessToken({ clientId: YT_CLIENT_ID, clientSecret: YT_CLIENT_SECRET, refreshToken: YT_REFRESH_TOKEN });
  }

  let failures = 0;
  for (const source of batch) {
    try {
      const made = await make(source, path.join(RUNNER_TEMP, "shorts", source.key));
      if (PREVIEW_DIR) {
        await savePreview(source, made);
        continue;
      }
      const result = await uploadVideo({
        accessToken,
        videoPath: made.video.outPath,
        metadata: shorts.buildShortMetadata(source, made.script),
      });
      console.log(`[${source.key}] uploaded: https://www.youtube.com/shorts/${result.id}`);
      const list = shorts.readShorts();
      list.push({
        key: source.key,
        videoId: result.id,
        title: made.script.title,
        hook: made.script.hook,
        captions: made.script.captions,
        description: made.script.description,
        sourceUrl: source.url,
        sourceKind: source.kind,
        images: made.scenes,
        durationSeconds: Math.round(made.video.durationSeconds),
        uploadDate: new Date().toISOString(),
      });
      shorts.writeShorts(list);
    } catch (e) {
      failures++;
      console.error(`[${source.key}] failed: ${e.message}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} of ${batch.length} Short(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("build-shorts.js failed:", e.message);
  process.exit(1);
});
