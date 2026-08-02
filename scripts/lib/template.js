// Renders a full article HTML page from structured content, cloned from the
// site's real article skeleton (articles/07-ai-augmented-leadership.html /
// articles/09-decision-loops-under-pressure.html) rather than the older,
// inconsistent skeleton used by some earlier articles.
//
// Pure function: no file I/O here. scripts/generate-article.js decides where
// to write the result.
const entity = require("./entity");

const SITE_URL = "https://carenella1.github.io";

const NAV_LINKS = [
  ["/index.html", "Home"],
  ["/about.html", "About"],
  ["/press.html", "Press/Bio"],
  ["/work.html", "Work"],
  ["/projects.html", "Projects"],
  ["/leadership.html", "AI Leadership"],
  ["/gaming.html", "Gaming"],
  ["/articles.html", "Articles"],
  ["/media.html", "Media"],
  ["/creative.html", "Creative"],
  ["/maintenance.html", "Maintenance"],
  ["/contact.html", "Contact"],
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Defense-in-depth for LLM-generated inline markup: allow only strong/em/a/br,
// strip everything else (escaped rather than dropped, so malformed input is
// visible/harmless instead of silently vanishing), and only allow http(s)/
// relative hrefs (blocks javascript: and similar schemes).
function sanitizeInline(html) {
  if (!html) return "";
  html = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  return html.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (full, slash, tag) => {
    const lower = tag.toLowerCase();
    if (!["strong", "em", "a", "br"].includes(lower)) {
      return full.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    if (lower === "a") {
      if (slash) return "</a>";
      const hrefMatch = full.match(/href\s*=\s*"([^"]*)"/i);
      let href = hrefMatch ? hrefMatch[1] : "#";
      if (!/^(https?:\/\/|\/)/i.test(href)) href = "#";
      const rel = /^https?:\/\//i.test(href) ? ' rel="noopener"' : "";
      return `<a href="${href}"${rel}>`;
    }
    if (lower === "br") return "<br>";
    return slash ? `</${lower}>` : `<${lower}>`;
  });
}

function renderNav() {
  const links = NAV_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join("\n");
  return `<header>\n<nav>\n${links}\n</nav>\n</header>`;
}

function renderSection(section) {
  let html = `<h2>${escapeHtml(section.heading)}</h2>\n`;
  for (const p of section.paragraphs || []) {
    html += `<p>${sanitizeInline(p)}</p>\n`;
  }
  if (section.list) {
    const tag = section.list.type === "ol" ? "ol" : "ul";
    const items = section.list.items.map((i) => `<li>${sanitizeInline(i)}</li>`).join("\n");
    html += `<${tag}>\n${items}\n</${tag}>\n`;
  }
  if (section.callout) {
    html += `<div class="callout">\n<p style="margin:0;">${sanitizeInline(section.callout)}</p>\n</div>\n`;
  }
  return html.trim();
}

function renderArticle({
  slug,
  title,
  metaDescription,
  ogDescription,
  heroImage,
  heroAlt,
  introParagraph,
  subhead,
  thesisCallout,
  sections,
  relatedLinks,
  publishedISO,
}) {
  const url = `${SITE_URL}/articles/${slug}.html`;
  const heroImageUrl = `${SITE_URL}/assets/images/${heroImage}`;
  const safeTitle = escapeHtml(title);
  const pageTitle = `${safeTitle} — Chase Arenella`;
  const now = new Date();

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      entity.personNode(),
      {
        "@type": "ImageObject",
        "@id": `${heroImageUrl}#image`,
        contentUrl: heroImageUrl,
        name: `Chase Arenella — ${title}`,
        creator: { "@id": entity.PERSON_ID },
      },
      entity.websiteNode(),
      {
        "@type": "Article",
        "@id": `${url}#article`,
        mainEntityOfPage: url,
        headline: title,
        description: metaDescription,
        image: heroImageUrl,
        datePublished: publishedISO,
        dateModified: publishedISO,
        author: { "@id": entity.PERSON_ID },
        publisher: { "@id": entity.WEBSITE_ID },
      },
    ],
  };

  const sectionsHtml = (sections || []).map(renderSection).join("\n");
  const relatedHtml = (relatedLinks || [])
    .map((l) => `<li><a href="${l.href}">${escapeHtml(l.label)}</a></li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1" name="viewport"/>
<title>${pageTitle}</title>
<meta content="${escapeHtml(metaDescription)}" name="description"/>
<link href="${url}" rel="canonical"/>
<meta content="index,follow,max-image-preview:large" name="robots"/>
<meta content="${pageTitle}" property="og:title"/>
<meta content="${escapeHtml(ogDescription || metaDescription)}" property="og:description"/>
<meta content="article" property="og:type"/>
<meta content="${url}" property="og:url"/>
<meta content="${heroImageUrl}" property="og:image"/>
<meta content="${publishedISO}" property="article:published_time"/>
<meta content="${publishedISO}" property="article:modified_time"/>
  <link rel="stylesheet" href="/assets/site.css"/>

  <!-- Auto-generated: Unified Entity Schema -->
  <script type="application/ld+json">
${JSON.stringify(graph, null, 2)}
</script>
</head>
<body>
${renderNav()}
<div class="container">
<h1>${safeTitle}</h1>

<p>${sanitizeInline(introParagraph)}</p>

<div class="subhead">${sanitizeInline(subhead)}</div>
<div class="hero">
<img alt="${escapeHtml(heroAlt)}" src="/assets/images/${heroImage}"/ width="1200" height="800" loading="lazy">
</div>
<div class="callout">
<p style="margin:0;"><strong>Thesis:</strong> ${sanitizeInline(thesisCallout)}</p>
</div>
<!-- MEDIA_SECTION_START -->
<!-- MEDIA_SECTION_END -->
${sectionsHtml}
<h2>Explore Related Ideas</h2>
<ul>
${relatedHtml}
</ul>
</div>
<div class="footer">
<div><strong>Chase Arenella</strong> — AI Productivity &amp; Leadership Systems</div>
<div class="foot-entity">Entity reference: Chase Arenella (Person) • ChaseOfSpadez (Creative identity layer)</div>
</div>


<footer><p><strong>Chase Arenella</strong> — AI-Augmented Leadership • Agile Systems • Gaming Strategy</p>
<p style="margin-top:8px;">
<a href="/press.html">Official Biography of Chase Arenella</a> •
<a href="/identity.html">Identity / Name Variants</a> •
  <a href="/leadership.html">AI-Augmented Leadership</a> •
  <a href="/articles.html">Articles</a> •
  <a href="/media.html">Media</a> •
  <a href="/contact.html">Contact</a> •
  <a href="https://aiproductivityguide.substack.com/" rel="noopener">AI Productivity Lab (Substack)</a>
</p>
<p style="margin-top:8px;">© ${now.getFullYear()} Chase Arenella • <a href="https://carenella1.github.io/">https://carenella1.github.io/</a></p>
</footer>
</body>
</html>
`;
}

// Renders the visible "Watch & Listen" block. Built separately from
// renderArticle because the video/podcast URLs don't exist yet at article-
// generation time (they're produced by later, best-effort pipeline stages).
// scripts/update-podcast-feed.js patches an already-written article file by
// replacing the MEDIA_SECTION_START/END marker pair with this output —
// same "patch a marker comment" pattern index.html already uses for its
// PBSA_LAST_UPDATED timestamp block.
function renderMediaSection({ videoId, title, audioUrl }) {
  if (!videoId && !audioUrl) return "";
  let html = '<div class="callout media-callout">\n';
  if (videoId) {
    html += `<p style="margin:0 0 10px 0;"><strong>Watch:</strong> <a href="https://www.youtube.com/watch?v=${encodeURIComponent(
      videoId
    )}" rel="noopener">${escapeHtml(title)} (video)</a></p>\n`;
  }
  if (audioUrl) {
    html += `<p style="margin:0 0 10px 0;"><strong>Listen:</strong></p>\n<audio controls preload="none" src="${audioUrl}">Your browser does not support inline audio. <a href="${audioUrl}">Download the episode</a>.</audio>\n`;
  }
  html += "</div>";
  return html;
}

function injectMediaSection(html, mediaHtml) {
  return html.replace(
    /<!-- MEDIA_SECTION_START -->[\s\S]*?<!-- MEDIA_SECTION_END -->/,
    `<!-- MEDIA_SECTION_START -->\n${mediaHtml}\n<!-- MEDIA_SECTION_END -->`
  );
}

module.exports = {
  renderArticle,
  renderMediaSection,
  injectMediaSection,
  sanitizeInline,
  escapeHtml,
  NAV_LINKS,
};
