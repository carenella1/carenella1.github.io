// Rewrites the Person node inside every page's ld+json block(s) to a single
// canonical identity, and merges/removes duplicate Person blocks on the same
// page (e.g. about.html previously shipped two conflicting graphs).
//
// Run: node scripts/sync-schema.js
const fs = require("fs");
const path = require("path");
const { PERSON_ID, personNode } = require("./lib/entity");

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p === "maintenance" || p.startsWith("maintenance" + path.sep)) continue;
      walk(p, acc);
    } else if (entry.name.endsWith(".html")) {
      acc.push(p);
    }
  }
  return acc;
}

function isPersonNode(node) {
  return node && node["@id"] === PERSON_ID && node["@type"] === "Person";
}

function nodeKey(node) {
  return `${node["@type"]}::${node["@id"] || JSON.stringify(node).slice(0, 80)}`;
}

function processFile(file) {
  let html = fs.readFileSync(file, "utf8");
  const scriptRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

  const blocks = [];
  let m;
  while ((m = scriptRe.exec(html))) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch (e) {
      console.log(`SKIP (invalid JSON): ${file}`);
      return;
    }
    blocks.push({ full: m[0], inner: m[1], parsed, hasPerson: false });
  }

  for (const b of blocks) {
    const graph = Array.isArray(b.parsed["@graph"]) ? b.parsed["@graph"] : [b.parsed];
    b.hasPerson = graph.some(isPersonNode);
  }

  const personBlocks = blocks.filter((b) => b.hasPerson);
  if (personBlocks.length === 0) return; // page carries no entity schema, leave alone

  const primary = personBlocks[0];
  const primaryGraph = Array.isArray(primary.parsed["@graph"])
    ? primary.parsed["@graph"]
    : [primary.parsed];

  const seenKeys = new Set(primaryGraph.map(nodeKey));

  // Merge unique nodes from any duplicate Person blocks into the primary graph.
  for (const dup of personBlocks.slice(1)) {
    const dupGraph = Array.isArray(dup.parsed["@graph"]) ? dup.parsed["@graph"] : [dup.parsed];
    for (const node of dupGraph) {
      const key = nodeKey(node);
      if (!seenKeys.has(key)) {
        primaryGraph.push(node);
        seenKeys.add(key);
      }
    }
  }

  // Normalize the canonical Person node — replace it wholesale with the
  // shared personNode() rather than patching individual fields, so stale
  // fields (e.g. a previously-included additionalName/alternateName) are
  // dropped, not just left stranded when entity.js's shape changes.
  const personIndex = primaryGraph.findIndex(isPersonNode);
  primaryGraph[personIndex] = personNode();

  const primaryObj = Array.isArray(primary.parsed["@graph"])
    ? { "@context": primary.parsed["@context"] || "https://schema.org", "@graph": primaryGraph }
    : primaryGraph[0];

  const newInner = "\n" + JSON.stringify(primaryObj, null, 2) + "\n";
  const newFull = `<script type="application/ld+json">${newInner}</script>`;

  html = html.replace(primary.full, newFull);

  // Remove the duplicate script tags entirely (their content is now merged above).
  for (const dup of personBlocks.slice(1)) {
    html = html.replace(dup.full, "");
  }

  fs.writeFileSync(file, html);
  console.log(
    `SYNCED: ${file}${personBlocks.length > 1 ? `  (merged ${personBlocks.length} blocks)` : ""}`
  );
}

const files = walk(".", []);
for (const f of files) processFile(f);
console.log(`Done. Scanned ${files.length} HTML files.`);
