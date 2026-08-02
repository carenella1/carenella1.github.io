// Isolated diagnostic — verifies the YT_CLIENT_ID/YT_CLIENT_SECRET/
// YT_REFRESH_TOKEN secrets actually work, WITHOUT running the content
// pipeline, consuming a topic from the queue, or uploading a real video.
//
// It reuses the exact same two calls upload-youtube.js makes (refresh token,
// then initiate a resumable upload session) but stops right after Google
// confirms the session — it never PUTs any video bytes, so no video is ever
// created and nothing needs cleanup. An abandoned session just expires on
// Google's side on its own.
//
// Usage: run via the "Test YouTube Auth" workflow (workflow_dispatch), or
// locally with YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN set.
const https = require("https");

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
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) } },
    payload
  );
  if (res.status !== 200) throw new Error(`Token refresh failed (${res.status}): ${res.body}`);
  return JSON.parse(res.body).access_token;
}

async function initResumableUpload(accessToken) {
  const metadata = {
    snippet: { title: "Auth test — safe to ignore", categoryId: "27" },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  };
  const payload = JSON.stringify(metadata);
  const res = await httpsRequest(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": Buffer.byteLength(payload),
        "X-Upload-Content-Length": "1", // deliberately tiny — we never send bytes
        "X-Upload-Content-Type": "video/mp4",
      },
    },
    payload
  );
  return res;
}

async function main() {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN must all be set");
  }

  console.log("Step 1: refreshing access token...");
  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
  console.log("  OK — refresh token is valid, got an access token.");

  console.log("Step 2: initiating a resumable upload session (no video bytes will be sent)...");
  const res = await initResumableUpload(accessToken);
  if (res.status !== 200 || !res.headers.location) {
    throw new Error(`Resumable session init failed (${res.status}): ${res.body.slice(0, 500)}`);
  }
  console.log("  OK — Google accepted the upload session (never completed, no video created).");
  console.log("\nSuccess: these credentials are valid and ready for real uploads.");
}

main().catch((e) => {
  console.error("\ntest-youtube-auth.js FAILED:", e.message);
  process.exit(1);
});
