// Builds podcast.xml from the article pages themselves rather than appending
// to the existing feed. Every article page that carries a PodcastEpisode
// schema node (written by update-podcast-feed.js) becomes one <item>, so the
// feed can't drift out of sync with the site, and re-running is a no-op.
const fs = require("fs");
const path = require("path");
const { readGraph, durationSeconds } = require("./page-schema");

const SITE_URL = "https://carenella1.github.io";
const FEED_URL = `${SITE_URL}/podcast.xml`;
const SHOW_TITLE = "Chase Arenella — AI-Augmented Leadership & Systems Thinking";
const SHOW_DESCRIPTION =
  "Short audio editions of Chase Arenella's articles on AI-augmented leadership, agile systems thinking, decision-making, and what competitive gaming and sports teach about leading teams.";
const COVER_IMAGE = `${SITE_URL}/assets/images/chase-arenella-podcast-cover.jpg`;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Returns one episode per article page with audio, newest first.
function collectEpisodes(articlesDir = "articles") {
  const episodes = [];
  for (const file of fs.readdirSync(articlesDir).sort()) {
    if (!file.endsWith(".html")) continue;
    const graph = readGraph(fs.readFileSync(path.join(articlesDir, file), "utf8"));
    const episode = graph.find((n) => n["@type"] === "PodcastEpisode");
    const article = graph.find((n) => n["@type"] === "Article");
    if (!episode || !article || !episode.associatedMedia) continue;

    const audioUrl = episode.associatedMedia.contentUrl;
    const localAudio = audioUrl.replace(SITE_URL + "/", "");
    if (!fs.existsSync(localAudio)) {
      console.warn(`Skipping ${file}: audio file ${localAudio} not found`);
      continue;
    }
    episodes.push({
      title: article.headline,
      url: article.mainEntityOfPage,
      description: article.description || article.headline,
      publishedISO: article.datePublished || episode.datePublished,
      audioUrl,
      bytes: fs.statSync(localAudio).size,
      durationSeconds: durationSeconds(episode.associatedMedia.duration),
    });
  }
  episodes.sort((a, b) => new Date(b.publishedISO) - new Date(a.publishedISO));
  return episodes;
}

function buildItem(ep) {
  return `<item>
<title>${escapeXml(ep.title)}</title>
<link>${ep.url}</link>
<guid isPermaLink="false">${ep.url}#podcast</guid>
<pubDate>${new Date(ep.publishedISO).toUTCString()}</pubDate>
<description><![CDATA[${ep.description} Read the full article: ${ep.url}]]></description>
<itunes:summary><![CDATA[${ep.description}]]></itunes:summary>
<itunes:author>Chase Arenella</itunes:author>
<itunes:episodeType>full</itunes:episodeType>
<itunes:explicit>false</itunes:explicit>
<enclosure url="${ep.audioUrl}" length="${ep.bytes}" type="audio/mpeg"/>
<itunes:duration>${Math.round(ep.durationSeconds || 0)}</itunes:duration>
</item>
`;
}

function buildFeed(episodes) {
  const lastBuild = episodes.length ? new Date(episodes[0].publishedISO).toUTCString() : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(SHOW_TITLE)}</title>
<link>${SITE_URL}/</link>
<atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>
<language>en-us</language>
<copyright>© ${new Date(lastBuild).getUTCFullYear()} Chase Arenella</copyright>
<lastBuildDate>${lastBuild}</lastBuildDate>
<description>${escapeXml(SHOW_DESCRIPTION)}</description>
<itunes:summary>${escapeXml(SHOW_DESCRIPTION)}</itunes:summary>
<itunes:author>Chase Arenella</itunes:author>
<itunes:owner><itunes:name>Chase Arenella</itunes:name></itunes:owner>
<itunes:type>episodic</itunes:type>
<itunes:image href="${COVER_IMAGE}"/>
<image>
<url>${COVER_IMAGE}</url>
<title>${escapeXml(SHOW_TITLE)}</title>
<link>${SITE_URL}/</link>
</image>
<itunes:category text="Business">
<itunes:category text="Management"/>
</itunes:category>
<itunes:category text="Technology"/>
<itunes:explicit>false</itunes:explicit>
${episodes.map(buildItem).join("")}</channel>
</rss>
`;
}

module.exports = { collectEpisodes, buildFeed, FEED_URL, COVER_IMAGE };
