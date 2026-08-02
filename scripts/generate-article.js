// The one hard gate in the monthly content pipeline. If this script exits
// non-zero, nothing downstream runs and nothing is committed — no thin or
// duplicate content ever ships.
//
// Usage:
//   node scripts/generate-article.js            # real run, needs ANTHROPIC_API_KEY
//   node scripts/generate-article.js --dry-run  # prints the draft, writes nothing
//   MOCK_LLM=1 node scripts/generate-article.js --dry-run   # no API key needed, for
//                                                            # exercising the rest of
//                                                            # the pipeline's logic
const fs = require("fs");
const path = require("path");
const https = require("https");
const entity = require("./lib/entity");
const { renderArticle } = require("./lib/template");

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();

const WORD_COUNT_FLOOR = 350; // matches the site's actual established article length (54-567 words, avg ~250)
const SIMILARITY_THRESHOLD = 0.38; // max pairwise 5-shingle Jaccard vs any prior article
const SHINGLE_SIZE = 5;

const PILLAR_PAGES = {
  "ai-augmented-leadership": "/leadership.html",
  "systems-thinking": "/leadership.html",
  "gaming-strategy": "/gaming.html",
  "sports-leadership": "/gaming.html",
  "identity-brand-foundation": "/identity.html",
  creative: "/creative.html",
};

const BRAND_BIO = `Chase Arenella is a systems thinker and AI-augmented leadership strategist focused on search architecture, agile systems design, and AI-integrated productivity. His writing blends AI-augmented leadership, agile systems thinking, and strategic cognition drawn from competitive gaming and sports. Voice: direct, structured, practical — short declarative sentences, occasional bolded key terms, no filler, no hype, no em-dash overuse. Every article ends by linking to related pillar pages and sibling articles.`;

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function shingles(text, k) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= words.length; i++) {
    set.add(words.slice(i, i + k).join(" "));
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function maxSimilarity(bodyText, priorArticles) {
  const newShingles = shingles(bodyText, SHINGLE_SIZE);
  let max = 0;
  let against = null;
  for (const prior of priorArticles) {
    const priorShingles = shingles(prior.bodyText || "", SHINGLE_SIZE);
    const sim = jaccard(newShingles, priorShingles);
    if (sim > max) {
      max = sim;
      against = prior.slug;
    }
  }
  return { max, against };
}

function flattenBodyText(draft) {
  const parts = [draft.subhead, draft.thesisCallout];
  for (const s of draft.sections || []) {
    parts.push(s.heading);
    parts.push(...(s.paragraphs || []));
    if (s.list) parts.push(...s.list.items);
    if (s.callout) parts.push(s.callout);
  }
  return parts.join(" ").replace(/<[^>]+>/g, " ");
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .reduce((acc, word) => (acc.length + word.length + 1 <= 45 ? (acc ? `${acc}-${word}` : word) : acc), "");
}

function httpsPostJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      url,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function buildPrompt({ topic, priorArticles, correction }) {
  const recentContext = priorArticles
    .slice(-5)
    .map((a) => `- "${a.title}" (${a.pillar}): ${a.summary}`)
    .join("\n");
  const availableSlugs = priorArticles.map((a) => `/articles/${a.slug}.html — "${a.title}"`).join("\n");
  const pillarPage = PILLAR_PAGES[topic.pillar] || "/articles.html";

  return `You are writing a new article for Chase Arenella's personal site in his established voice.

BRAND VOICE / BIO:
${BRAND_BIO}

TOPIC TO WRITE ABOUT:
Pillar: ${topic.pillar}
Angle: ${topic.angle}

RECENT ARTICLES (do not repeat these angles or reuse their phrasing/structure):
${recentContext}

ARTICLES YOU MAY LINK TO IN "relatedLinks" (use real slugs only, 2-4 of them, prefer ones matching or adjacent to this topic's pillar):
${availableSlugs}
Also always allowed: ${pillarPage} (the pillar page for this topic)

CONSTRAINTS:
- Total body word count across all section paragraphs, lists, and callouts: 500-750 words (this matches the site's actual established article length — its most recent, richest articles run 330-570 words; do not pad beyond this).
- 4-6 sections, each with an <h2>-style heading and 1-2 paragraphs; at most 2 sections may include a bulleted/numbered list; at most 1 section may include an extra mid-article "callout" (a short pull-quote style insight).
- One separate top-level "thesisCallout": a single punchy 1-2 sentence thesis statement.
- One separate top-level "introParagraph": 1 sentence that references the pillar page ${pillarPage} using an <a href="${pillarPage}">...</a> link.
- One separate top-level "subhead": a 1-sentence expanded restatement of the thesis.
- "heroAlt": a short descriptive alt-text string for the hero image (no HTML).
- "relatedLinks": 2-4 objects {href, label} using ONLY the real slugs/pillar page listed above — never invent a URL.
- Inline HTML in paragraphs/list items/callouts is limited to <strong>, <em>, <a href="...">, <br> — no other tags.
- Do not mention "expunged", legal matters, or anything outside the established brand topics.
${correction ? `\nIMPORTANT CORRECTION FROM A PREVIOUS ATTEMPT: ${correction}\n` : ""}

Respond with ONLY a single valid JSON object (no markdown code fences, no commentary before or after) matching exactly this shape:
{
  "title": "string",
  "metaDescription": "string, under 160 characters",
  "ogDescription": "string, under 200 characters",
  "heroAlt": "string",
  "introParagraph": "string with one allowed inline link",
  "subhead": "string",
  "thesisCallout": "string",
  "sections": [
    { "heading": "string", "paragraphs": ["string", "..."], "list": { "type": "ul", "items": ["string", "..."] }, "callout": "string (optional)" }
  ],
  "relatedLinks": [ { "href": "string", "label": "string" } ]
}`;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await httpsPostJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    {
      model: "claude-sonnet-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    }
  );
  if (res.status !== 200) {
    throw new Error(`Anthropic API returned ${res.status}: ${res.body.slice(0, 500)}`);
  }
  const parsed = JSON.parse(res.body);
  // Don't assume content[0] is text — the model may emit a "thinking" block
  // before its text block. Scan every block and concatenate the text ones.
  const textBlocks = (parsed.content || []).filter((b) => b.type === "text").map((b) => b.text);
  const text = textBlocks.join("\n");
  if (!text) {
    const blockTypes = (parsed.content || []).map((b) => b.type).join(", ") || "none";
    throw new Error(
      `Anthropic response had no text content. stop_reason=${parsed.stop_reason}, block types=[${blockTypes}]. Raw body (truncated): ${res.body.slice(0, 800)}`
    );
  }
  return text;
}

function mockDraft(topic) {
  const pillarPage = PILLAR_PAGES[topic.pillar] || "/articles.html";
  const para = (n) =>
    `This is mock paragraph ${n} for the topic "${topic.angle}". `.repeat(12).trim();
  return JSON.stringify({
    title: `Mock Draft: ${topic.angle.slice(0, 60)}`,
    metaDescription: "A mock description for local testing.",
    ogDescription: "A mock OG description for local testing.",
    heroAlt: "Chase Arenella mock hero alt text",
    introParagraph: `This expands on ideas from the <a href="${pillarPage}">pillar page</a>.`,
    subhead: "A mock one-sentence expanded thesis for local testing.",
    thesisCallout: "This is a mock thesis statement for local testing purposes only.",
    sections: [
      { heading: "Mock Section One", paragraphs: [para(1), para(2)], list: { type: "ul", items: ["Mock item A", "Mock item B", "Mock item C"] } },
      { heading: "Mock Section Two", paragraphs: [para(3)], callout: "A mock mid-article callout." },
      { heading: "Mock Section Three", paragraphs: [para(4), para(5)] },
      { heading: "Mock Section Four", paragraphs: [para(6)] },
    ],
    relatedLinks: [{ href: pillarPage, label: "Pillar page" }],
  });
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

function pickNextSlugNumber(priorArticles) {
  let max = 0;
  for (const a of priorArticles) {
    const m = a.slug.match(/^(\d+)-/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(2, "0");
}

function pickHeroImage(rotation, pillar) {
  const pool = rotation.pools[pillar];
  if (!pool || pool.length === 0) throw new Error(`No image pool for pillar: ${pillar}`);
  const idx = rotation.heroIndex[pillar] % pool.length;
  rotation.heroIndex[pillar] = idx + 1;
  return pool[idx];
}

// articles.html's ItemList/CollectionPage/BreadcrumbList/WebSite nodes live in
// whichever of its (possibly multiple) <script type="application/ld+json">
// blocks actually contains an ItemList — parsing and mutating that node
// directly is far more robust than regex-matching nested JSON structure by
// hand, and mirrors the same parse-mutate-reserialize approach already used
// in scripts/sync-schema.js.
function updateItemListSchema(html, { url, title }) {
  const scriptRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = scriptRe.exec(html))) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch (e) {
      continue;
    }
    const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    const itemList = graph.find((n) => n["@type"] === "ItemList");
    if (!itemList) continue;

    const nextPosition = itemList.itemListElement.length + 1;
    itemList.itemListElement.push({
      "@type": "ListItem",
      position: nextPosition,
      url,
      name: title,
    });
    itemList.numberOfItems = nextPosition;

    const newInner = "\n" + JSON.stringify(parsed, null, 2) + "\n";
    return html.replace(m[0], `<script type="application/ld+json">${newInner}</script>`);
  }
  throw new Error("Could not find an ItemList node in any ld+json block in articles.html");
}

// Matches the literal, unescaped "&" actually used in articles.html's real
// heading markup (confirmed via direct grep) — NOT the HTML-escaped "&amp;"
// these headings render as. A mismatch here makes the string search silently
// fail and skip the visible-card insertion (caught when the first
// ampersand-containing pillar — "creative" — actually got exercised).
const PILLAR_CARD_HEADINGS = {
  "ai-augmented-leadership": "AI-Augmented Leadership",
  "systems-thinking": "Systems Thinking & Modern Leadership",
  "gaming-strategy": "Gaming Strategy & Performance Psychology",
  "sports-leadership": "Sports Leadership & Decision Models",
  "identity-brand-foundation": "Identity & Personal Brand Foundation",
  creative: "Creative & Visual Identity",
};

function insertIntoPillarCard(html, { url, title, pillar }) {
  const heading = PILLAR_CARD_HEADINGS[pillar];
  if (!heading) return html; // unknown pillar: skip visible-card insertion, JSON listing is still updated

  const headingMarker = `class="cluster-title">${heading}</h2>`;
  const headingIdx = html.indexOf(headingMarker);
  if (headingIdx === -1) {
    console.warn(`Pillar card heading not found for "${pillar}" (looked for "${heading}") — skipping visible-card insertion.`);
    return html;
  }
  const closingUlIdx = html.indexOf("</ul>", headingIdx);
  if (closingUlIdx === -1) return html;

  const relativeUrl = url.replace("https://carenella1.github.io", "");
  const newLi = `  <li><a href="${relativeUrl}">${title.replace(/&/g, "&amp;")}</a></li>\n`;
  return html.slice(0, closingUlIdx) + newLi + html.slice(closingUlIdx);
}

function updateArticlesHtml(articlesHtmlPath, { url, title, pillar }) {
  let html = fs.readFileSync(articlesHtmlPath, "utf8");
  html = updateItemListSchema(html, { url, title });
  html = insertIntoPillarCard(html, { url, title, pillar });
  return html;
}

async function main() {
  const topicsPath = "content/topics.json";
  const indexPath = "content/articles-index.json";
  const rotationPath = "content/image-rotation.json";
  const sitemapPath = "sitemap.xml";
  const articlesHtmlPath = "articles.html";

  const topics = readJson(topicsPath, []);
  const priorArticles = readJson(indexPath, []);
  const rotation = readJson(rotationPath, { pools: {}, heroIndex: {}, slideshowIndex: {} });

  const topic = topics.find((t) => t.used === null);
  if (!topic) {
    console.error("No unused topics remain in content/topics.json — add more before the next cycle.");
    process.exit(1);
  }

  let draft = null;
  let correction = null;
  const useMock = process.env.MOCK_LLM === "1";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildPrompt({ topic, priorArticles, correction });
    const rawText = useMock ? mockDraft(topic) : await callAnthropic(prompt);
    let candidate;
    try {
      candidate = extractJson(rawText);
    } catch (e) {
      console.error(`Attempt ${attempt}: model output was not valid JSON: ${e.message}`);
      correction = "Your previous response was not valid JSON. Respond with ONLY the JSON object, nothing else.";
      continue;
    }

    const bodyText = flattenBodyText(candidate);
    const words = wordCount(bodyText);
    const { max: similarity, against } = maxSimilarity(bodyText, priorArticles);

    console.log(`Attempt ${attempt}: ${words} words, max similarity ${similarity.toFixed(3)} (vs ${against || "none"})`);

    if (words < WORD_COUNT_FLOOR) {
      correction = `Your previous draft was only ${words} words, below the ${WORD_COUNT_FLOOR}-word floor. Expand each section with more concrete detail.`;
      continue;
    }
    if (similarity > SIMILARITY_THRESHOLD) {
      correction = `Your previous draft was too similar (similarity ${similarity.toFixed(2)}) to the existing article "${against}". Take a clearly different structural angle and avoid reusing its phrasing.`;
      continue;
    }

    draft = { ...candidate, bodyText, pillar: topic.pillar };
    break;
  }

  if (!draft) {
    console.error("Failed to produce a passing draft after 2 attempts. No content published this cycle.");
    process.exit(1);
  }

  const heroImage = pickHeroImage(rotation, topic.pillar);
  const nn = pickNextSlugNumber(priorArticles);
  const slug = `${nn}-${slugify(draft.title)}`;
  const publishedISO = new Date().toISOString();
  const url = `https://carenella1.github.io/articles/${slug}.html`;

  console.log(`\nDraft accepted: "${draft.title}" -> articles/${slug}.html`);
  console.log(`Hero image: ${heroImage}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: not writing any files.");
    console.log(JSON.stringify({ slug, title: draft.title, wordCount: wordCount(draft.bodyText) }, null, 2));
    return;
  }

  const html = renderArticle({
    slug,
    title: draft.title,
    metaDescription: draft.metaDescription,
    ogDescription: draft.ogDescription,
    heroImage,
    heroAlt: draft.heroAlt,
    introParagraph: draft.introParagraph,
    subhead: draft.subhead,
    thesisCallout: draft.thesisCallout,
    sections: draft.sections,
    relatedLinks: draft.relatedLinks,
    publishedISO,
  });

  fs.mkdirSync("articles", { recursive: true });
  fs.writeFileSync(path.join("articles", `${slug}.html`), html);

  fs.writeFileSync(articlesHtmlPath, updateArticlesHtml(articlesHtmlPath, { url, title: draft.title, pillar: topic.pillar }));

  let sitemap = fs.readFileSync(sitemapPath, "utf8");
  const sitemapEntry = `\n  <url>\n    <loc>${url}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n    <lastmod>${publishedISO.slice(0, 10)}</lastmod>\n  </url>\n`;
  sitemap = sitemap.replace(/<\/urlset>/, `${sitemapEntry}</urlset>`);
  fs.writeFileSync(sitemapPath, sitemap);

  priorArticles.push({
    slug,
    title: draft.title,
    summary: draft.metaDescription,
    bodyText: draft.bodyText,
    publishedISO,
    pillar: topic.pillar,
  });
  writeJson(indexPath, priorArticles);

  topic.used = publishedISO;
  writeJson(topicsPath, topics);
  writeJson(rotationPath, rotation);

  fs.mkdirSync(RUNNER_TEMP, { recursive: true });
  fs.writeFileSync(
    path.join(RUNNER_TEMP, "pipeline-article.json"),
    JSON.stringify(
      {
        slug,
        title: draft.title,
        url,
        bodyText: draft.bodyText,
        metaDescription: draft.metaDescription,
        heroImage,
        pillar: topic.pillar,
        publishedISO,
      },
      null,
      2
    )
  );

  console.log("\nWrote article, updated articles.html, sitemap.xml, articles-index.json, topics.json.");
}

main().catch((e) => {
  console.error("generate-article.js failed:", e);
  process.exit(1);
});
