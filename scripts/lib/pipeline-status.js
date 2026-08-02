// Shared status-tracking for the best-effort pipeline stages (audio, video,
// youtube upload, podcast feed). generate-article.js is the only hard gate
// and doesn't use this — if it fails, the workflow stops before any of these
// run at all. Each other stage records its own outcome here so
// build-pr-body.js can write an honest PR description instead of silently
// omitting a failed stage.
const fs = require("fs");
const path = require("path");

function statusPath() {
  const dir = process.env.RUNNER_TEMP || require("os").tmpdir();
  return path.join(dir, "pipeline-status.json");
}

function readStatus() {
  const p = statusPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return {};
  }
}

function recordStatus(stage, ok, detail) {
  const status = readStatus();
  status[stage] = { ok, detail: detail || null, at: new Date().toISOString() };
  fs.writeFileSync(statusPath(), JSON.stringify(status, null, 2) + "\n");
}

module.exports = { readStatus, recordStatus };
