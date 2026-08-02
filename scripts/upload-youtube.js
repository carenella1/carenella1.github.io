// Best-effort pipeline stage (continue-on-error in the workflow). Uploads
// the slideshow video built by build-video.js to YouTube via a hand-rolled
// OAuth refresh + resumable-upload flow (no googleapis SDK — the video files
// here are small enough that single-shot upload, with one retry, is
// sufficient; see docs/content-pipeline-setup.md for the one-time OAuth
// setup this depends on).
//
// Usage:
//   node scripts/upload-youtube.js            # real run, needs YT_* secrets + a built video
//   node scripts/upload-youtube.js --dry-run  # prints the metadata that would be uploaded
const fs = require("fs");
const path = require("path");
const https = require("https");
const { recordStatus } = require("./lib/pipeline-status");

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const payload = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }).toString();
  const res = await httpsRequest(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) },
    },
    payload
  );
  if (res.status !== 200) throw new Error(`Token refresh failed (${res.status}): ${res.body.slice(0, 300)}`);
  return JSON.parse(res.body).access_token;
}

async function initResumableUpload(accessToken, metadata, videoBytes) {
  const payload = JSON.stringify(metadata);
  const res = await httpsRequest(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": Buffer.byteLength(payload),
        "X-Upload-Content-Length": String(videoBytes),
        "X-Upload-Content-Type": "video/mp4",
      },
    },
    payload
  );
  if (res.status !== 200 || !res.headers.location) {
    throw new Error(`Resumable session init failed (${res.status}): ${res.body.slice(0, 300)}`);
  }
  return res.headers.location;
}

function putVideoBytes(uploadUrl, videoPath, videoBytes) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(videoBytes) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Upload PUT failed (${res.statusCode}): ${body.slice(0, 300)}`));
          }
        });
      }
    );
    req.on("error", reject);
    fs.createReadStream(videoPath).pipe(req);
  });
}

async function uploadWithRetry(uploadUrl, videoPath, videoBytes) {
  try {
    return await putVideoBytes(uploadUrl, videoPath, videoBytes);
  } catch (e) {
    console.warn(`First upload attempt failed (${e.message}), retrying once...`);
    return await putVideoBytes(uploadUrl, videoPath, videoBytes);
  }
}

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
  const videoBytes = fs.statSync(video.videoPath).size;
  const uploadUrl = await initResumableUpload(accessToken, metadata, videoBytes);
  const result = await uploadWithRetry(uploadUrl, video.videoPath, videoBytes);

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
