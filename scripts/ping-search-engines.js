const fs = require("fs");
const https = require("https");

const HOST = "carenella1.github.io";
const SITE_URL = `https://${HOST}`;
const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;
const INDEXNOW_KEY = "3354c20631c74b5ea9893b065f90b6b8";
const KEY_LOCATION = `${SITE_URL}/${INDEXNOW_KEY}.txt`;

function extractSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
}

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const xml = fs.readFileSync("sitemap.xml", "utf8");
  const urls = extractSitemapUrls(xml);
  console.log(`Found ${urls.length} URLs in sitemap.xml`);

  // Bing still supports the classic sitemap ping endpoint.
  // Google discontinued its equivalent in June 2023 — no replacement ping exists;
  // Google discovery relies on robots.txt -> sitemap.xml -> Search Console instead.
  try {
    const bingPing = await get(
      `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`
    );
    console.log("Bing sitemap ping:", bingPing.status);
  } catch (e) {
    console.log("Bing sitemap ping failed:", e.message);
  }

  // IndexNow fans out to every participating engine (Bing, Yandex, Seznam.cz, Naver).
  // Google does not participate in IndexNow.
  try {
    const indexNow = await postJson("https://api.indexnow.org/indexnow", {
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: urls,
    });
    console.log("IndexNow submission:", indexNow.status, indexNow.body.slice(0, 200));
  } catch (e) {
    console.log("IndexNow submission failed:", e.message);
  }
}

main();
