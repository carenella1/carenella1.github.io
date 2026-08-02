// ONE-TIME utility — not part of the recurring content pipeline. Seeds
// content/articles-index.json from the 9 pre-existing articles so
// generate-article.js has prior-context and duplicate-detection baselines
// from day one. Safe to re-run (idempotent, always derives fresh from the
// HTML files), but not invoked by any workflow.
//
// Run: node scripts/seed-articles-index.js
const fs = require("fs");
const path = require("path");

// Pillar assignment taken directly from articles.html's own card groupings
// (the site's one maintained, complete listing) rather than guessed.
const ARTICLES = [
  { slug: "01-who-is-chase-arenella", pillar: "identity-brand-foundation" },
  { slug: "02-nba-leadership", pillar: "sports-leadership" },
  { slug: "03-gaming-focus", pillar: "gaming-strategy" },
  { slug: "04-esports-leadership", pillar: "gaming-strategy" },
  { slug: "05-gaming-leadership-skills", pillar: "gaming-strategy" },
  { slug: "06-systems-thinking-modern-leadership", pillar: "systems-thinking" },
  { slug: "07-ai-augmented-leadership", pillar: "ai-augmented-leadership" },
  { slug: "08-ai-augmented-leadership-operating-system", pillar: "ai-augmented-leadership" },
  { slug: "09-decision-loops-under-pressure", pillar: "ai-augmented-leadership" },
];

const BOILERPLATE_SNIPPETS = [
  "Chase Arenella — AI Productivity & Leadership Systems",
  "Entity reference: Chase Arenella (Person) • ChaseOfSpadez (Creative identity layer)",
  "This framework reflects the broader work of Chase Arenella in AI-augmented leadership and search architecture, where systems clarity and execution discipline create compounding results.",
];

function stripHtml(html) {
  let text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  for (const snippet of BOILERPLATE_SNIPPETS) {
    text = text.split(snippet).join(" ");
  }
  return text.replace(/\s+/g, " ").trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&ldquo;|&#8220;/g, "“")
    .replace(/&rdquo;|&#8221;/g, "”")
    .replace(/&quot;/g, '"');
}

function extractTagValue(html, re) {
  const m = html.match(re);
  return m ? decodeEntities((m[1] || m[2] || "").trim()) : "";
}

function extract({ slug, pillar }) {
  const file = path.join("articles", `${slug}.html`);
  const html = fs.readFileSync(file, "utf8");

  const rawTitle = extractTagValue(html, /<title>([\s\S]*?)<\/title>/i);
  const title = rawTitle.replace(/\s*[—-]\s*Chase Arenella\s*$/i, "").trim();

  const summary = extractTagValue(
    html,
    /name="description"\s+content="([^"]*)"|content="([^"]*)"\s+name="description"/i
  );

  const publishedISO =
    extractTagValue(
      html,
      /property="article:published_time"\s+content="([^"]*)"|content="([^"]*)"\s+property="article:published_time"/i
    ) || null;

  // Body = everything after the last </nav> (drops <head> and the nav links)
  // up to the last <footer> (drops the sitewide footer). Works for both the
  // "header/container" skeleton and the older bare-nav skeleton.
  const afterNav = html.split(/<\/nav>/i).slice(1).join("</nav>");
  const lastFooterIdx = afterNav.toLowerCase().lastIndexOf("<footer>");
  const bodySrc = lastFooterIdx >= 0 ? afterNav.slice(0, lastFooterIdx) : afterNav;
  const bodyText = stripHtml(bodySrc);

  return { slug, title, summary, bodyText, publishedISO, pillar };
}

const entries = ARTICLES.map(extract);
fs.mkdirSync("content", { recursive: true });
fs.writeFileSync("content/articles-index.json", JSON.stringify(entries, null, 2) + "\n");
for (const e of entries) {
  console.log(
    `${e.slug} :: "${e.title}" :: ${e.bodyText.length} chars body :: pillar=${e.pillar} :: published=${e.publishedISO}`
  );
}
console.log(`\nWrote content/articles-index.json (${entries.length} entries).`);
