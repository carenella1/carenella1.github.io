// Shared YouTube Data API helpers — hand-rolled over https, no SDK. Used by
// upload-youtube.js (the recurring pipeline) and fix-existing-videos.js (a
// one-time repair script), so the auth/upload/delete logic only exists once.
const fs = require("fs");
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

// Convenience wrapper: init + upload in one call. Returns the created video resource.
async function uploadVideo({ accessToken, videoPath, metadata }) {
  const videoBytes = fs.statSync(videoPath).size;
  const uploadUrl = await initResumableUpload(accessToken, metadata, videoBytes);
  return uploadWithRetry(uploadUrl, videoPath, videoBytes);
}

// DELETE https://www.googleapis.com/youtube/v3/videos?id={videoId} — a
// successful delete returns 204 No Content.
async function deleteVideo(accessToken, videoId) {
  const res = await httpsRequest(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status !== 204) {
    throw new Error(`Delete failed for video ${videoId} (${res.status}): ${res.body.slice(0, 300)}`);
  }
}

module.exports = {
  httpsRequest,
  getAccessToken,
  initResumableUpload,
  putVideoBytes,
  uploadWithRetry,
  uploadVideo,
  deleteVideo,
};
