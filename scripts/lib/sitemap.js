// Adds or replaces a single <url> entry in sitemap.xml's text, leaving every
// other entry untouched. Shared by the scripts that generate pages.
function upsertSitemapUrl(xml, { loc, lastmod, changefreq = "monthly", priority = "0.8" }) {
  const entry =
    `<url>\n    <loc>${loc}</loc>\n` +
    (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "") +
    `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  const escaped = loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`<url>\\s*<loc>${escaped}</loc>[\\s\\S]*?</url>`);
  return existing.test(xml) ? xml.replace(existing, () => entry) : xml.replace("</urlset>", `  ${entry}\n</urlset>`);
}

module.exports = { upsertSitemapUrl };
