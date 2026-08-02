// Read-only diagnostic — fetches a video's actual stored title/description
// from the YouTube Data API (no side effects) so we can see the real stored
// value instead of guessing from a UI screenshot.
//
// Usage: VIDEO_ID=xxxx node scripts/check-youtube-video.js
const https = require("https");

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
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

async function main() {
  const videoId = process.env.VIDEO_ID;
  if (!videoId) throw new Error("Set VIDEO_ID");
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;

  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
  const res = await httpsRequest(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`,
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status !== 200) throw new Error(`API call failed (${res.status}): ${res.body}`);
  const data = JSON.parse(res.body);
  const video = data.items && data.items[0];
  if (!video) throw new Error("No video found with that ID");

  console.log("=== TITLE ===");
  console.log(JSON.stringify(video.snippet.title));
  console.log("length:", video.snippet.title.length);
  console.log("\n=== DESCRIPTION (raw, exact stored value) ===");
  console.log(JSON.stringify(video.snippet.description));
  console.log("length:", video.snippet.description.length);
}

main().catch((e) => {
  console.error("check-youtube-video.js failed:", e.message);
  process.exit(1);
});
