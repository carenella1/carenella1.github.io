// Renders the dedicated video watch pages (/videos/<slug>.html) and the
// /videos.html hub. Pure functions — scripts/build-video-pages.js does the
// file I/O.
//
// Why separate pages: since late 2023 Google only indexes a video on a page
// where the video is the main content. On an article page the article is the
// main content, so those embeds don't earn video results. A short page led
// by the player, titled with the name first, does — and gives each video a
// second slot in the Videos tab alongside its youtube.com watch page.
//
// Deliberately no full transcript: it would duplicate the article page's
// text, and Google could then fold the watch page into the article as a
// duplicate instead of indexing it.
const entity = require("./entity");
const { escapeHtml, renderNav, renderFooter } = require("./template");

const SITE_URL = "https://carenella1.github.io";
const HUB_URL = `${SITE_URL}/videos.html`;

function watchUrl(slug) {
  return `${SITE_URL}/videos/${slug}.html`;
}

function pageTitle(v) {
  return `Chase Arenella — ${v.title} (Video)`;
}

function videoNode(v) {
  return {
    "@type": "VideoObject",
    "@id": `${watchUrl(v.slug)}#video`,
    name: `Chase Arenella — ${v.title}`,
    description: v.description,
    thumbnailUrl: [`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`],
    uploadDate: v.uploadDate,
    duration: `PT${Math.round(v.durationSeconds || 0)}S`,
    contentUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
    embedUrl: `https://www.youtube.com/embed/${v.videoId}`,
    author: { "@id": entity.PERSON_ID },
    mainEntityOfPage: watchUrl(v.slug),
  };
}

function page({ title, description, canonical, ogImage, ogType, graph, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1" name="viewport"/>
<title>${escapeHtml(title)}</title>
<meta content="${escapeHtml(description)}" name="description"/>
<link href="${canonical}" rel="canonical"/>
<meta content="index,follow,max-image-preview:large,max-video-preview:-1" name="robots"/>
<meta content="${escapeHtml(title)}" property="og:title"/>
<meta content="${escapeHtml(description)}" property="og:description"/>
<meta content="${ogType}" property="og:type"/>
<meta content="${canonical}" property="og:url"/>
<meta content="${ogImage}" property="og:image"/>
<link rel="stylesheet" href="/assets/site.css"/>
<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)}
</script>
</head>
<body>
${renderNav()}
<div class="container">
${body}
</div>
${renderFooter(new Date().getUTCFullYear())}
</body>
</html>
`;
}

function renderWatchPage(v, allVideos) {
  const url = watchUrl(v.slug);
  const title = pageTitle(v);
  const id = encodeURIComponent(v.videoId);
  const minutes = Math.max(1, Math.round((v.durationSeconds || 0) / 60));

  const graph = [
    entity.personNode(),
    entity.websiteNode(),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: title,
      description: v.description,
      isPartOf: { "@id": entity.WEBSITE_ID },
      about: { "@id": entity.PERSON_ID },
      mainEntity: { "@id": `${url}#video` },
      breadcrumb: { "@id": `${url}#breadcrumbs` },
      inLanguage: "en-US",
    },
    videoNode(v),
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumbs`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Videos", item: HUB_URL },
        { "@type": "ListItem", position: 3, name: v.title, item: url },
      ],
    },
  ];

  const keyPoints = v.headings.length
    ? `<h2>In this video</h2>\n<ul>\n${v.headings.map((h) => `<li>${escapeHtml(h)}</li>`).join("\n")}\n</ul>\n`
    : "";
  const thesis = v.thesis
    ? `<div class="callout">\n<p style="margin:0;"><strong>Thesis:</strong> ${escapeHtml(v.thesis)}</p>\n</div>\n`
    : "";
  const more = allVideos
    .filter((o) => o.slug !== v.slug)
    .slice(0, 6)
    .map((o) => `<li><a href="/videos/${o.slug}.html">Chase Arenella — ${escapeHtml(o.title)}</a></li>`)
    .join("\n");

  const body = `<h1>Chase Arenella — ${escapeHtml(v.title)}</h1>
<div class="video-embed"><iframe src="https://www.youtube.com/embed/${id}" title="${escapeHtml(
    `Chase Arenella — ${v.title}`
  )}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
<p class="subhead" style="margin-top:14px;">${escapeHtml(v.description)}</p>
<p style="color:var(--muted);font-size:14px;">A ${minutes}-minute video by Chase Arenella • <a href="https://www.youtube.com/watch?v=${id}" rel="noopener">Watch on YouTube</a> • <a href="${v.articleUrl.replace(SITE_URL, "")}">Read the full article</a></p>
${thesis}${keyPoints}<h2>More videos from Chase Arenella</h2>
<ul>
${more}
<li><a href="/videos.html">All videos</a></li>
</ul>`;

  return page({
    title,
    description: v.description,
    canonical: url,
    ogImage: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    ogType: "video.other",
    graph,
    body,
  });
}

function renderHub(videos) {
  const title = "Chase Arenella — Videos";
  const description =
    "Videos by Chase Arenella on AI-augmented leadership, systems thinking, decision-making, and what gaming and sports teach about leading teams.";
  const graph = [
    entity.personNode(),
    entity.websiteNode(),
    {
      "@type": "CollectionPage",
      "@id": `${HUB_URL}#webpage`,
      url: HUB_URL,
      name: title,
      description,
      isPartOf: { "@id": entity.WEBSITE_ID },
      about: { "@id": entity.PERSON_ID },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: videos.map((v, i) => ({ "@type": "ListItem", position: i + 1, url: watchUrl(v.slug) })),
      },
    },
  ];
  const cards = videos
    .map(
      (v) => `<div class="card">
<a href="/videos/${v.slug}.html"><img src="https://i.ytimg.com/vi/${encodeURIComponent(
        v.videoId
      )}/hqdefault.jpg" alt="${escapeHtml(`Chase Arenella — ${v.title}`)} (video thumbnail)" width="480" height="360" loading="lazy" style="width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px;"/></a>
<h3><a href="/videos/${v.slug}.html">${escapeHtml(v.title)}</a></h3>
<p>${escapeHtml(v.description)}</p>
</div>`
    )
    .join("\n");
  const body = `<h1>Chase Arenella — Videos</h1>
<div class="subhead">${escapeHtml(description)} Also on <a href="https://www.youtube.com/@ChaseOfSpadez" rel="noopener">YouTube</a>.</div>
<div class="grid">
${cards}
</div>`;
  return page({
    title,
    description,
    canonical: HUB_URL,
    ogImage: entity.CANONICAL_IMAGE,
    ogType: "website",
    graph,
    body,
  });
}

module.exports = { renderWatchPage, renderHub, watchUrl, pageTitle, HUB_URL };
