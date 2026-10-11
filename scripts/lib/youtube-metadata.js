// Builds the YouTube snippet/status for an article's video. Shared by
// upload-youtube.js (monthly pipeline) and backfill-videos.js.
const SITE_URL = "https://carenella1.github.io";

const PILLAR_TAGS = {
  "ai-augmented-leadership": ["AI-augmented leadership", "AI leadership", "AI for managers", "leadership systems"],
  "systems-thinking": ["systems thinking", "team operating systems", "decision making", "leadership systems"],
  "gaming-strategy": ["gaming strategy", "esports leadership", "competitive gaming", "leadership lessons"],
  "sports-leadership": ["sports leadership", "basketball leadership", "team performance", "leadership lessons"],
  creative: ["creative identity", "personal brand", "AI art", "ChaseOfSpadez"],
  "identity-brand-foundation": ["personal brand", "automation", "systems thinking", "leadership systems"],
};

// YouTube rejects "<" and ">" anywhere in a description, and the thesis may
// carry inline markup from the article template.
function plain(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
}

// Description and tags are what YouTube (and Google's video results) index,
// so they carry the article's actual content plus the name and profile links,
// not just a title and a link.
function buildMetadata(article) {
  const lines = [plain(article.metaDescription || article.title), ""];
  if (article.thesis) lines.push(plain(article.thesis), "");
  if (article.headings && article.headings.length) {
    lines.push("In this video:", ...article.headings.map((h) => `• ${plain(h)}`), "");
  }
  lines.push(
    `Read the full article: ${article.url}`,
    `Podcast (audio edition): ${SITE_URL}/podcast.xml`,
    "",
    "About Chase Arenella: Chase Arenella writes about AI-augmented leadership, agile systems thinking, and what competitive gaming and sports teach about leading teams.",
    "",
    `Website: ${SITE_URL}/`,
    `All articles: ${SITE_URL}/articles.html`,
    "LinkedIn: https://www.linkedin.com/in/chase-arenella/",
    "Substack: https://aiproductivityguide.substack.com/",
    "X: https://x.com/ChaseAIHub",
    "",
    "#ChaseArenella #Leadership #SystemsThinking"
  );

  const tags = [];
  let tagChars = 0;
  for (const tag of ["Chase Arenella", "ChaseOfSpadez", ...(PILLAR_TAGS[article.pillar] || []), "leadership", "agile"]) {
    // YouTube caps tags at 500 characters total (multi-word tags count their quotes).
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + 1;
    if (tags.includes(tag) || tagChars + cost > 480) continue;
    tags.push(tag);
    tagChars += cost;
  }

  return {
    snippet: {
      // Name first: for a name search, a title that starts with the exact
      // name is a stronger match than one that ends with it.
      title: `Chase Arenella — ${article.title}`.slice(0, 100),
      description: lines.join("\n").slice(0, 4900),
      tags,
      categoryId: "27", // Education
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
}

module.exports = { buildMetadata };
