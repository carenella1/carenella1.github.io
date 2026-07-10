const fs = require("fs");
const path = require("path");

function pad(n){ return String(n).padStart(2,"0"); }

const now = new Date();
const year = now.getUTCFullYear();
const month = pad(now.getUTCMonth()+1);
const slug = `${year}-${month}`;
const iso = now.toISOString().replace(/\.\d{3}Z$/,"Z");

const maintenanceDir = path.join("maintenance", slug);
fs.mkdirSync(maintenanceDir, { recursive:true });

const pageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>PBSA Maintenance Refresh — ${slug}</title>
<meta name="description" content="Automated maintenance refresh for Chase Arenella PBSA."/>
<link rel="canonical" href="https://carenella1.github.io/maintenance/${slug}/"/>
<meta name="robots" content="noindex,follow"/>
<link rel="stylesheet" href="/assets/site.css"/>
</head>
<body>
<div class="container">
<h1>PBSA Maintenance Refresh — ${slug}</h1>
<p>This page is automatically generated to maintain crawl continuity and system integrity.</p>
<p><strong>Generated:</strong> ${iso}</p>

<h2>Primary Sections</h2>
<ul>
<li><a href="/">Home</a></li>
<li><a href="/leadership.html">AI Leadership</a></li>
<li><a href="/articles.html">Articles</a></li>
<li><a href="/projects.html">Projects</a></li>
<li><a href="/media.html">Media</a></li>
<li><a href="/identity.html">Identity</a></li>
</ul>

<footer style="margin-top:40px;">
<p><strong>Chase Arenella</strong> — AI-Augmented Leadership • Agile Systems • Gaming Strategy</p>
</footer>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(maintenanceDir,"index.html"),pageHTML);

// Update maintenance index
const archivePath = path.join("maintenance","index.html");
let archiveContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>PBSA Maintenance Archive</title>
<link rel="canonical" href="https://carenella1.github.io/maintenance/"/>
<meta name="robots" content="index,follow"/>
<link rel="stylesheet" href="/assets/site.css"/>
</head>
<body>
<div class="container">
<h1>PBSA Maintenance Archive</h1>
<ul>`;

if (fs.existsSync(archivePath)) {
  const existing = fs.readFileSync(archivePath,"utf8");
  const match = existing.match(/<ul>([\s\S]*)<\/ul>/);
  if(match){ archiveContent += match[1]; }
}

if (!archiveContent.includes(slug)) {
  archiveContent += `\n<li><a href="/maintenance/${slug}/">${slug}</a></li>\n`;
}

archiveContent += `</ul>
</div>
</body>
</html>`;

fs.writeFileSync(archivePath,archiveContent);

// Update homepage timestamp block
const homePath = "index.html";
if (fs.existsSync(homePath)) {
  let home = fs.readFileSync(homePath,"utf8");
  const updatedBlock = `<!-- PBSA_LAST_UPDATED_START -->
<div style="margin-bottom:18px; font-size:14px; color:#666;">
  Last automated maintenance refresh: ${iso}
</div>
<!-- PBSA_LAST_UPDATED_END -->`;
  home = home.replace(/<!-- PBSA_LAST_UPDATED_START -->[\s\S]*?<!-- PBSA_LAST_UPDATED_END -->/,updatedBlock);
  fs.writeFileSync(homePath,home);
}

console.log("PBSA Monthly Maintenance Completed:",slug);
