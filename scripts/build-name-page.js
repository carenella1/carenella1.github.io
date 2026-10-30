// Generates chase-scott-arenella.html: the one page on the site that targets
// searches for the full name, rebuilt from the site's own content (latest
// videos + every article) so it stays substantive and fresh each month.
//
// Privacy rules for this page — keep them when editing:
//   - It is the ONLY page that uses the full name. No other page links to
//     it; Google finds it through sitemap.xml. Someone browsing the site
//     from a "Chase Arenella" search never lands here.
//   - Nothing that would show in a search result for the plain name ties the
//     two names together: the title and meta description use only the full
//     name, and the one sentence that does connect them is wrapped in
//     data-nosnippet, which keeps it out of Google's snippets and AI answers.
//   - No Person schema and no `about` link to the site's Person entity, so
//     Google's knowledge graph isn't handed the full name as an alias of
//     "Chase Arenella" (see the note in lib/entity.js).
//
// Run: node scripts/build-name-page.js
const fs = require("fs");
const path = require("path");
const { escapeHtml, renderNav, renderFooter } = require("./lib/template");
const { readArticleVideo } = require("./lib/page-schema");
const { upsertSitemapUrl } = require("./lib/sitemap");
const entity = require("./lib/entity");

const SITE_URL = "https://carenella1.github.io";
const FILE = "chase-scott-arenella.html";
const URL = `${SITE_URL}/${FILE}`;
const FULL_NAME = "Chase Scott Arenella";
const TITLE = `${FULL_NAME} — Leadership, Systems Thinking & AI`;
const DESCRIPTION = `${FULL_NAME} writes about AI-augmented leadership, systems thinking, and decision-making under pressure. Latest videos, articles, and projects.`;
const HERO_IMAGE = "chase-arenella-leadership-executive-01.jpg";

const PROFILES = [
  ["https://www.youtube.com/@ChaseOfSpadez", "YouTube"],
  ["https://aiproductivityguide.substack.com/", "Substack — AI Productivity Lab"],
  ["https://github.com/Carenella1", "GitHub"],
  ["https://x.com/ChaseAIHub", "X"],
];

function articleNumber(slug) {
  return Number(slug.split("-")[0]) || 0;
}

const articles = JSON.parse(fs.readFileSync("content/articles-index.json", "utf8"))
  .filter((a) => fs.existsSync(path.join("articles", `${a.slug}.html`)))
  .sort((a, b) => articleNumber(b.slug) - articleNumber(a.slug));

const videos = fs
  .readdirSync("articles")
  .filter((f) => f.endsWith(".html"))
  .map((f) => readArticleVideo(path.join("articles", f)))
  .filter(Boolean)
  .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

// "Last updated" follows the newest content, not the build time, so
// re-running without new content changes nothing.
const dates = [...articles.map((a) => a.publishedISO), ...videos.map((v) => v.uploadDate)].filter(Boolean).sort();
const lastModified = dates.length ? dates[dates.length - 1] : new Date().toISOString();
const lastModifiedLabel = new Date(lastModified).toLocaleDateString("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const videoCards = videos
  .slice(0, 6)
  .map(
    (v) => `<div class="card">
<a href="/videos/${v.slug}.html"><img src="https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/hqdefault.jpg" alt="${escapeHtml(
      v.title
    )} (video)" width="480" height="360" loading="lazy" style="width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px;"/></a>
<h3><a href="/videos/${v.slug}.html">${escapeHtml(v.title)}</a></h3>
</div>`
  )
  .join("\n");

const articleItems = articles
  .map(
    (a) =>
      `<li><a href="/articles/${a.slug}.html">${escapeHtml(a.title)}</a>${
        a.summary ? ` — ${escapeHtml(a.summary)}` : ""
      }</li>`
  )
  .join("\n");

const graph = [
  entity.websiteNode(),
  {
    "@type": "WebPage",
    "@id": `${URL}#webpage`,
    url: URL,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@id": entity.WEBSITE_ID },
    dateModified: lastModified,
    primaryImageOfPage: `${SITE_URL}/assets/images/${HERO_IMAGE}`,
    inLanguage: "en-US",
    mainEntity: {
      "@type": "ItemList",
      name: `Articles and videos — ${FULL_NAME}`,
      itemListElement: [
        ...videos.map((v) => `${SITE_URL}/videos/${v.slug}.html`),
        ...articles.map((a) => `${SITE_URL}/articles/${a.slug}.html`),
      ].map((url, i) => ({ "@type": "ListItem", position: i + 1, url })),
    },
  },
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(TITLE)}</title>
<meta name="description" content="${escapeHtml(DESCRIPTION)}"/>
<meta name="robots" content="index,follow,max-image-preview:large"/>
<link rel="canonical" href="${URL}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${escapeHtml(TITLE)}"/>
<meta property="og:description" content="${escapeHtml(DESCRIPTION)}"/>
<meta property="og:url" content="${URL}"/>
<meta property="og:image" content="${SITE_URL}/assets/images/${HERO_IMAGE}"/>
<link rel="stylesheet" href="/assets/site.css"/>
<!-- Generated by scripts/build-name-page.js — edit that, not this file. -->
<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)}
</script>
</head>
<body>
${renderNav()}
<div class="container">
<h1>${FULL_NAME}</h1>
<div class="subhead">Writing and videos on AI-augmented leadership, agile systems thinking, and what competitive gaming and sports teach about leading teams. <span data-nosnippet>He publishes this work under the name Chase Arenella.</span></div>
<img src="/assets/images/${HERO_IMAGE}" alt="${FULL_NAME} portrait" width="1024" height="1536" style="display:block;width:100%;height:360px;object-fit:cover;object-position:50% 20%;border-radius:var(--radius);margin-top:18px;"/>
<p style="color:var(--muted);font-size:14px;">Last updated ${lastModifiedLabel}.</p>

<h2>Latest videos</h2>
<div class="grid">
${videoCards}
</div>
<p><a href="/videos.html">All videos</a></p>

<h2>Articles</h2>
<ul>
${articleItems}
</ul>

<h2>Focus areas</h2>
<ul>
<li><a href="/leadership.html">AI-augmented leadership</a> — decision loops, feedback design, and keeping humans accountable for the calls that matter.</li>
<li><a href="/gaming.html">Gaming strategy</a> — what competitive play teaches about adapting under pressure.</li>
<li><a href="/projects.html">Projects</a> and the <a href="/chase-systems-lab/">Systems Lab</a> — automation and agentic-workflow experiments.</li>
</ul>

<h2>Profiles</h2>
<ul>
${PROFILES.map(([href, label]) => `<li><a href="${href}" rel="me noopener">${label}</a></li>`).join("\n")}
</ul>
</div>
${renderFooter(new Date(lastModified).getUTCFullYear())}
</body>
</html>
`;

let changed = 0;
if (!fs.existsSync(FILE) || fs.readFileSync(FILE, "utf8") !== html) {
  fs.writeFileSync(FILE, html);
  changed++;
}
const sitemap = fs.readFileSync("sitemap.xml", "utf8");
const updated = upsertSitemapUrl(sitemap, { loc: URL, lastmod: lastModified.slice(0, 10), priority: "0.9" });
if (updated !== sitemap) {
  fs.writeFileSync("sitemap.xml", updated);
  changed++;
}
console.log(`${FILE}: ${videos.length} videos, ${articles.length} articles; ${changed} file(s) written.`);
