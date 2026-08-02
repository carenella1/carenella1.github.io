// Best-effort pipeline stage (continue-on-error in the workflow). Uploads
// the slideshow video built by build-video.js to YouTube. Auth/upload logic
// lives in scripts/lib/youtube.js so it can be reused by
// fix-existing-videos.js without duplicating it.
//
// Usage:
//   node scripts/upload-youtube.js            # real run, needs YT_* secrets + a built video
//   node scripts/upload-youtube.js --dry-run  # prints the metadata that would be uploaded
const fs = require("fs");
const path = require("path");
const { recordStatus } = require("./lib/pipeline-status");
const { getAccessToken, uploadVideo } = require("./lib/youtube");

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();

async function main() {
  const articlePath = path.join(RUNNER_TEMP, "pipeline-article.json");
  const videoPath = path.join(RUNNER_TEMP, "pipeline-video.json");
  if (!fs.existsSync(articlePath)) throw new Error(`${articlePath} not found — run generate-article.js first`);
  if (!fs.existsSync(videoPath)) throw new Error(`${videoPath} not found — run build-video.js first`);

  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const video = JSON.parse(fs.readFileSync(videoPath, "utf8"));

  const metadata = {
    snippet: {
      title: `${article.title} — Chase Arenella`.slice(0, 100),
      description: `${article.title}\n\nFull article: ${article.url}\n\nBy Chase Arenella — AI-augmented leadership, agile systems thinking, and gaming strategy.`,
      tags: ["Chase Arenella", "AI-augmented leadership", "agile systems", article.pillar],
      categoryId: "27", // Education
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };

  console.log("Video metadata:", JSON.stringify(metadata, null, 2));

  if (DRY_RUN) {
    console.log("--dry-run: not uploading.");
    return;
  }

  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN must all be set");
  }

  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
  const result = await uploadVideo({ accessToken, videoPath: video.videoPath, metadata });

  console.log(`Uploaded: https://www.youtube.com/watch?v=${result.id}`);

  fs.writeFileSync(
    path.join(RUNNER_TEMP, "pipeline-youtube.json"),
    JSON.stringify({ videoId: result.id }, null, 2)
  );
  recordStatus("youtube", true, `https://www.youtube.com/watch?v=${result.id}`);
}

main().catch((e) => {
  console.error("upload-youtube.js failed:", e.message);
  recordStatus("youtube", false, e.message);
  process.exit(1);
});
