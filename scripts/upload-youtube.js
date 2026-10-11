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
const SITE_URL = "https://carenella1.github.io";

const PILLAR_TAGS = {
  "ai-augmented-leadership": ["AI-augmented leadership", "AI leadership", "AI for managers", "leadership systems"],
  "systems-thinking": ["systems thinking", "team operating systems", "decision making", "leadership systems"],
  "gaming-strategy": ["gaming strategy", "esports leadership", "competitive gaming", "leadership lessons"],
  "sports-leadership": ["sports leadership", "basketball leadership", "team performance", "leadership lessons"],
  creative: ["creative identity", "personal brand", "AI art", "ChaseOfSpadez"],
  "identity-brand-foundation": ["personal brand", "automation", "systems thinking", "leadership systems"],
};

// YouTube rejects "<" and ">" anywhere in a description, and the thesis may
// carry inline markup from the article template.
function plain(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
}

// Description and tags are what YouTube (and Google's video results) index,
// so they carry the article's actual content plus the name and profile links,
// not just a title and a link.
function buildMetadata(article) {
  const lines = [plain(article.metaDescription || article.title), ""];
  if (article.thesis) lines.push(plain(article.thesis), "");
  if (article.headings && article.headings.length) {
    lines.push("In this video:", ...article.headings.map((h) => `• ${plain(h)}`), "");
  }
  lines.push(
    `Read the full article: ${article.url}`,
    `Podcast (audio edition): ${SITE_URL}/podcast.xml`,
    "",
    "About Chase Arenella: Chase Arenella writes about AI-augmented leadership, agile systems thinking, and what competitive gaming and sports teach about leading teams.",
    "",
    `Website: ${SITE_URL}/`,
    `All articles: ${SITE_URL}/articles.html`,
    "LinkedIn: https://www.linkedin.com/in/chase-arenella/",
    "Substack: https://aiproductivityguide.substack.com/",
    "X: https://x.com/ChaseAIHub",
    "",
    "#ChaseArenella #Leadership #SystemsThinking"
  );

  const tags = [];
  let tagChars = 0;
  for (const tag of ["Chase Arenella", "ChaseOfSpadez", ...(PILLAR_TAGS[article.pillar] || []), "leadership", "agile"]) {
    // YouTube caps tags at 500 characters total (multi-word tags count their quotes).
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + 1;
    if (tags.includes(tag) || tagChars + cost > 480) continue;
    tags.push(tag);
    tagChars += cost;
  }

  return {
    snippet: {
      title: `${article.title} — Chase Arenella`.slice(0, 100),
      description: lines.join("\n").slice(0, 4900),
      tags,
      categoryId: "27", // Education
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
}

async function main() {
  const articlePath = path.join(RUNNER_TEMP, "pipeline-article.json");
  const videoPath = path.join(RUNNER_TEMP, "pipeline-video.json");
  if (!fs.existsSync(articlePath)) throw new Error(`${articlePath} not found — run generate-article.js first`);
  if (!fs.existsSync(videoPath)) throw new Error(`${videoPath} not found — run build-video.js first`);

  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const video = JSON.parse(fs.readFileSync(videoPath, "utf8"));

  const metadata = buildMetadata(article);

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
