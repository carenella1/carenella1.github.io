// Reads pipeline-article.json + pipeline-status.json (written by the other
// stages) and prints a markdown PR body to stdout. Called from
// content-pipeline.yml as: gh pr create --body "$(node scripts/build-pr-body.js)"
//
// Deliberately honest about partial failures — a failed video/audio/podcast
// stage is called out explicitly rather than silently omitted, since this PR
// body is the only thing a human sees during the 72-hour veto window.
const fs = require("fs");
const path = require("path");
const { readStatus } = require("./lib/pipeline-status");

const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function stageLine(status, name, label) {
  const s = status[name];
  if (!s) return `- ${label}: did not run`;
  if (s.ok) return `- ${label}: ok${s.detail ? ` — ${s.detail}` : ""}`;
  return `- ${label}: **failed** — ${s.detail || "see workflow run logs"}`;
}

function main() {
  const articlePath = path.join(RUNNER_TEMP, "pipeline-article.json");
  if (!fs.existsSync(articlePath)) {
    console.log("No article was generated this cycle (generate-article.js exited before writing anything).");
    return;
  }
  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const status = readStatus();

  const lines = [];
  lines.push(`## Auto-generated content: "${article.title}"`);
  lines.push("");
  lines.push(`**Pillar:** ${article.pillar}  `);
  lines.push(`**Word count:** ~${wordCount(article.bodyText)}  `);
  lines.push(`**Article:** ${article.url}`);
  lines.push("");
  lines.push("### Stage results");
  lines.push(stageLine(status, "audio", "Narration audio"));
  lines.push(stageLine(status, "video", "Slideshow video"));
  lines.push(stageLine(status, "youtube", "YouTube upload"));
  lines.push(stageLine(status, "podcast", "Podcast feed + article media section"));
  lines.push("");
  lines.push(
    "---\n" +
      "This PR auto-merges in **72 hours** unless it's closed or labeled `hold` before then. " +
      "Review the article for accuracy and tone before it goes live."
  );

  console.log(lines.join("\n"));
}

main();
