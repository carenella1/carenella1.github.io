// ONE-TIME, LOCAL-ONLY helper — never run in CI, never commit its output.
// Walks through Google's OAuth consent flow for the YouTube Data API and
// prints a refresh token to store as the YT_REFRESH_TOKEN GitHub secret.
// See docs/content-pipeline-setup.md for the full setup this is one step of.
//
// Usage (run locally, in a terminal, on the machine you'll do the Google
// login from):
//   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node scripts/one-time-get-youtube-refresh-token.js
//
// Before running: in Google Cloud Console, under this OAuth client's
// "Authorized redirect URIs", add exactly: http://localhost:8080/oauth2callback
const http = require("http");
const https = require("https");
const { URL } = require("url");

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8080/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET environment variables first.");
  process.exit(1);
}

function exchangeCodeForTokens(code) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString();
    const req = https.request(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) reject(new Error(`Token exchange failed: ${body}`));
          else resolve(JSON.parse(body));
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // forces a refresh_token to be issued even on repeat runs
  }).toString();

console.log("\n1. Open this URL in a browser and sign in with the Google account that owns the YouTube channel:\n");
console.log(authUrl);
console.log("\n2. Approve access. You'll be redirected to localhost, which this script is now listening on...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("No authorization code in the redirect — check the URL and try again.");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Done — you can close this tab and return to the terminal.");
  server.close();

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      console.error(
        "\nNo refresh_token in the response. If you've authorized this app before, revoke its access at " +
          "https://myaccount.google.com/permissions and run this script again (Google only issues a " +
          "refresh_token on first consent, or when prompt=consent forces re-issue)."
      );
      process.exit(1);
    }
    console.log("\nSuccess. Store this as the YT_REFRESH_TOKEN GitHub secret:\n");
    console.log(tokens.refresh_token);
    console.log("\n(YT_CLIENT_ID and YT_CLIENT_SECRET are the same values you set as env vars for this script.)");
  } catch (e) {
    console.error("\nToken exchange failed:", e.message);
    process.exit(1);
  }
});

server.listen(8080);
