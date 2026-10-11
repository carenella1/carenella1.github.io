// Read-only helpers for pulling structured data back out of the site's
// generated pages, shared by the scripts that rebuild derived files (podcast
// feed, video pages, video sitemap) from the pages themselves.
const fs = require("fs");
const path = require("path");

// Returns the first ld+json @graph on the page, or [] if none parses.
function readGraph(html) {
  const scriptRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = scriptRe.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed["@graph"])) return parsed["@graph"];
    } catch (e) {
      // not this block
    }
  }
  return [];
}

function durationSeconds(iso) {
  const m = /^PT(\d+)S$/.exec(iso || "");
  return m ? Number(m[1]) : 0;
}

function videoIdFromEmbedUrl(url) {
  const m = /\/embed\/([A-Za-z0-9_-]{11})/.exec(url || "");
  return m ? m[1] : null;
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Section headings and thesis line of a generated article page.
function readArticleOutline(html) {
  const headings = [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)]
    .map((m) => stripTags(m[1]))
    .filter((h) => h && h !== "Explore Related Ideas");
  const thesisMatch = /<strong>Thesis:<\/strong>([\s\S]*?)<\/p>/.exec(html);
  return { headings, thesis: thesisMatch ? stripTags(thesisMatch[1]) : null };
}

// Everything the video pages need about one article page that has a video,
// or null if it has none.
function readArticleVideo(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const graph = readGraph(html);
  const article = graph.find((n) => n["@type"] === "Article");
  const video = graph.find((n) => n["@type"] === "VideoObject");
  if (!article || !video) return null;
  const videoId = videoIdFromEmbedUrl(video.embedUrl);
  if (!videoId) return null;

  const { headings, thesis } = readArticleOutline(html);

  return {
    slug: path.basename(filePath, ".html"),
    title: article.headline,
    articleUrl: article.mainEntityOfPage,
    description: article.description || article.headline,
    thesis,
    headings,
    videoId,
    uploadDate: video.uploadDate || article.datePublished,
    durationSeconds: durationSeconds(video.duration),
  };
}

module.exports = { readGraph, durationSeconds, videoIdFromEmbedUrl, stripTags, readArticleOutline, readArticleVideo };
