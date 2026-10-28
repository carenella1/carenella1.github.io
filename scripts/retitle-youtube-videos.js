// Brings every site video's YouTube title, description and tags up to the
// current format from lib/youtube-metadata.js — mainly the name-first title
// ("Chase Arenella — <title>"), which matches a name search more strongly
// than the old "<title> — Chase Arenella". Videos already in the current
// format are left alone, so re-running is safe.
//
// Needs a refresh token with the youtube.force-ssl scope (the upload-only
// token can't edit videos) — see scripts/one-time-get-youtube-refresh-token.js.
//
// Usage:
//   node scripts/retitle-youtube-videos.js           # dry run: show planned changes
//   node scripts/retitle-youtube-videos.js --apply   # actually update YouTube
const fs = require("fs");
const path = require("path");
const { getAccessToken, getVideoSnippets, updateVideoSnippet } = require("./lib/youtube");
const { buildMetadata } = require("./lib/youtube-metadata");
const { readArticleVideo } = require("./lib/page-schema");

const APPLY = process.argv.includes("--apply");

function sameTags(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

async function main() {
  const index = JSON.parse(fs.readFileSync("content/articles-index.json", "utf8"));
  const pillarBySlug = Object.fromEntries(index.map((a) => [a.slug, a.pillar]));
  const videos = fs
    .readdirSync("articles")
    .filter((f) => f.endsWith(".html"))
    .map((f) => readArticleVideo(path.join("articles", f)))
    .filter(Boolean);
  console.log(`${videos.length} videos on the site.`);

  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN must all be set");
  }
  const accessToken = await getAccessToken({
    clientId: YT_CLIENT_ID,
    clientSecret: YT_CLIENT_SECRET,
    refreshToken: YT_REFRESH_TOKEN,
  });
  const current = await getVideoSnippets(
    accessToken,
    videos.map((v) => v.videoId)
  );

  let planned = 0;
  let updated = 0;
  for (const v of videos) {
    const snippet = current[v.videoId];
    if (!snippet) {
      console.warn(`SKIP ${v.slug}: video ${v.videoId} not found on YouTube (deleted or private?)`);
      continue;
    }
    const target = buildMetadata({
      title: v.title,
      url: v.articleUrl,
      metaDescription: v.description,
      thesis: v.thesis,
      headings: v.headings,
      pillar: pillarBySlug[v.slug],
    }).snippet;

    const changes = [];
    if (snippet.title !== target.title) changes.push(`title: "${snippet.title}" -> "${target.title}"`);
    if (snippet.description !== target.description) changes.push("description: rewritten");
    if (!sameTags(snippet.tags, target.tags)) changes.push(`tags: ${(target.tags || []).join(", ")}`);
    if (!changes.length) {
      console.log(`OK   ${v.videoId} ${snippet.title}`);
      continue;
    }

    planned++;
    console.log(`${APPLY ? "EDIT" : "PLAN"} ${v.videoId}\n       ${changes.join("\n       ")}`);
    if (!APPLY) continue;

    // Keep YouTube's own category if the video has one; the rest comes from
    // the current metadata format.
    await updateVideoSnippet(accessToken, v.videoId, {
      ...target,
      categoryId: snippet.categoryId || target.categoryId,
    });
    updated++;
  }

  console.log(
    APPLY
      ? `\nUpdated ${updated} of ${planned} video(s) needing changes.`
      : `\nDry run: ${planned} video(s) would change. Re-run with --apply to update YouTube.`
  );
}

main().catch((e) => {
  console.error("retitle-youtube-videos.js failed:", e.message);
  process.exit(1);
});
