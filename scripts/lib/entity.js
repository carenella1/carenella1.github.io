// Single source of truth for the canonical Person entity block used across
// the site's schema.org graphs. Imported by scripts/sync-schema.js (which
// normalizes existing pages) and scripts/lib/template.js (which renders new
// ones), so the two can never drift apart the way hand-edited inline copies
// did before.
const PERSON_ID = "https://carenella1.github.io/#chase-arenella";
const WEBSITE_ID = "https://carenella1.github.io/#website";

const CANONICAL_SAMEAS = [
  "https://github.com/Carenella1",
  "https://aiproductivityguide.substack.com/",
  "https://x.com/ChaseAIHub",
  "https://www.linkedin.com/in/chase-arenella/",
];

const CANONICAL_IMAGE =
  "https://carenella1.github.io/assets/images/chase-arenella-athletic-lifestyle-portrait-01.jpg";

// Deliberately does NOT include the full legal name ("Chase Scott Arenella")
// or additionalName:"Scott" — those fields fed Google's AI Overview a ready
// "full name is X" answer for the plain "Chase Arenella" query. The full-name
// association is intentionally confined to identity.html and
// chase-scott-arenella.html only, which target that exact-name query on
// their own via visible content, not via this shared, site-wide node.
function personNode() {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: "Chase Arenella",
    alternateName: ["ChaseOfSpadez"],
    givenName: "Chase",
    familyName: "Arenella",
    url: "https://carenella1.github.io/",
    image: CANONICAL_IMAGE,
    sameAs: CANONICAL_SAMEAS.slice(),
    jobTitle: "AI-Augmented Leadership Strategist",
    description:
      "Chase Arenella is a systems thinker and AI-augmented leadership strategist focused on search architecture, agile systems design, and AI-integrated productivity.",
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: "https://carenella1.github.io/",
    name: "Chase Arenella — Professional Hub",
    publisher: { "@id": PERSON_ID },
    inLanguage: "en-US",
  };
}

module.exports = {
  PERSON_ID,
  WEBSITE_ID,
  CANONICAL_SAMEAS,
  CANONICAL_IMAGE,
  personNode,
  websiteNode,
};
