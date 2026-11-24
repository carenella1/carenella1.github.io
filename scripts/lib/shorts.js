// YouTube Shorts: one ~45-second vertical video per essay on this site and
// per guide on chasearenella.com. Used by scripts/build-shorts.js.
//
// Each Short is generated end to end, nothing recorded: Claude condenses the
// source into a script plus three scene descriptions, OpenAI generates those
// scenes as images (lib/scenes.js) and narrates the script (same voice as the
// long-form videos), and ffmpeg renders it all with on-screen captions.
//
// Privacy rules (same as the rest of the site): the script may only use the
// name "Chase Arenella" (or ChaseOfSpadez), never the full legal name, never
// LinkedIn, never anything about legal matters. BLOCKED enforces it.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getAudioDuration, resolveFont } = require("./video");
const { callClaude, textToSpeech } = require("./api");
const { SCENE_RULES } = require("./scenes");
const execFileP = promisify(execFile);

const SITE_URL = "https://carenella1.github.io";
const GUIDE_SITE = "https://chasearenella.com";
const SHORTS_FILE = "content/shorts.json";
const W = 1080;
const H = 1920;
const FPS = 25;
const MAX_SECONDS = 58; // Shorts are up to 60s; leave a margin
const MAX_TEMPO = 1.15; // speed narration up at most this much to fit
const IMAGES_PER_SHORT = 3;
const PHOTO_TOP = 470;
const BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const BLOCKED = [
  { re: /\bscott\b/i, why: "the full legal name" },
  { re: /linkedin/i, why: "a LinkedIn reference" },
  { re: /expunge|arrest|lawsuit|criminal|conviction/i, why: "a legal-matter reference" },
];

// Scenes must show places and objects only (see lib/scenes.js).
const PEOPLE = /\b(person|people|man|woman|men|women|face|faces|hands?|silhouettes?|crowd|team members?)\b/i;

const GUIDE_PILLAR = "systems-thinking"; // image pool for guides with no linked essay

function readShorts() {
  return fs.existsSync(SHORTS_FILE) ? JSON.parse(fs.readFileSync(SHORTS_FILE, "utf8")) : [];
}

function writeShorts(list) {
  fs.writeFileSync(SHORTS_FILE, JSON.stringify(list, null, 2) + "\n");
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Every Short that could exist: essays (newest first) and guides, interleaved
// so consecutive uploads alternate between the two.
async function loadSources() {
  const index = JSON.parse(fs.readFileSync("content/articles-index.json", "utf8"));
  const pillarByUrl = {};
  const articles = index
    .slice()
    .reverse()
    .map((a) => {
      const url = `${SITE_URL}/articles/${a.slug}.html`;
      pillarByUrl[url] = a.pillar;
      return { key: `article-${a.slug}`, kind: "essay", title: a.title, url, pillar: a.pillar, text: a.bodyText || a.summary };
    });

  let guides = [];
  try {
    const res = await fetch(`${GUIDE_SITE}/guides.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    guides = (await res.json()).map((g) => ({
      key: `guide-${new URL(g.url).pathname.replace(/\//g, "")}`,
      kind: "guide",
      title: g.title,
      url: g.url,
      pillar: pillarByUrl[g.essay] || GUIDE_PILLAR,
      text: null, // fetched lazily, only for guides that get built
    }));
  } catch (e) {
    console.warn(`Could not load the field guide index (${e.message}); essays only this run.`);
  }

  const out = [];
  for (let i = 0; i < Math.max(articles.length, guides.length); i++) {
    if (articles[i]) out.push(articles[i]);
    if (guides[i]) out.push(guides[i]);
  }
  return out;
}

async function sourceText(source) {
  if (source.text) return source.text;
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`fetching ${source.url}: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<article class="guide">([\s\S]*?)<\/article>/);
  return stripTags(m ? m[1] : html);
}

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "YouTube title without the author's name, at most 60 characters" },
    hook: { type: "string", description: "On-screen headline, at most 44 characters" },
    narration: { type: "string", description: "Voiceover script, 95 to 125 words" },
    captions: {
      type: "array",
      items: { type: "string" },
      description: "4 to 6 on-screen key points in narration order, each at most 40 characters",
    },
    description: { type: "string", description: "1-2 sentence YouTube description, at most 220 characters" },
    scenes: {
      type: "array",
      items: { type: "string" },
      description: "3 photograph descriptions, one per third of the narration, each 15-30 words",
    },
  },
  required: ["title", "hook", "narration", "captions", "description", "scenes"],
  additionalProperties: false,
};

function scriptPrompt(source, text, correction) {
  return `Write a YouTube Short (about 45 seconds, vertical, narrated by a text-to-speech voice) that condenses this ${source.kind} by Chase Arenella into one useful idea.

${source.kind.toUpperCase()} TITLE: ${source.title}
${source.kind.toUpperCase()} TEXT:
${text}

Rules:
- Teach the single most useful idea in the source, concretely. Open with a hook sentence that states a tension or a surprising claim; no greetings, no "in this video".
- Narration: 95 to 125 words, short spoken sentences, plain words a voice reads well. No lists read aloud, no URLs, no hashtags, no emoji.
- End the narration with one sentence pointing to the full ${source.kind === "guide" ? "guide" : "essay"} linked below.
- Use only ideas in the source. Don't invent facts, numbers, or personal details about Chase Arenella. Refer to the author only as "Chase Arenella", and only if needed.
- Never mention legal matters or LinkedIn.
- title: a specific, searchable title for the idea (not clickbait), at most 60 characters, without the author's name.
- hook: the on-screen headline, at most 44 characters.
- captions: 4 to 6 short on-screen key points that follow the narration's order, each at most 40 characters.
- description: 1-2 sentences, at most 220 characters.
- scenes: exactly 3 photographs to show behind the captions, one per third of the narration. ${SCENE_RULES}${correction ? `\n\nYour previous attempt was rejected: ${correction}. Fix that.` : ""}`;
}

function checkScript(s) {
  const all = [s.title, s.hook, s.narration, s.description, ...s.captions, ...s.scenes].join("\n");
  // Name the exact word that tripped a check: a bare "it contains people"
  // left Claude guessing, and a poker guide's "hand of cards" failed 3/3.
  for (const { re, why } of BLOCKED) {
    const m = all.match(re);
    if (m) return `it contains ${why} ("${m[0]}"); leave that word out`;
  }
  const words = s.narration.split(/\s+/).filter(Boolean).length;
  if (words < 85 || words > 135) return `the narration is ${words} words; it must be 95 to 125`;
  if (s.captions.length < 4 || s.captions.length > 6) return `it has ${s.captions.length} captions; it needs 4 to 6`;
  if (s.scenes.length !== IMAGES_PER_SHORT) return `it has ${s.scenes.length} scenes; it needs exactly ${IMAGES_PER_SHORT}`;
  const person = s.scenes.join(" ").match(PEOPLE);
  if (person) {
    return `a scene uses the word "${person[0]}"; scenes must show only places and objects, and must not use that word in any sense (not even "a hand of cards")`;
  }
  if (s.captions.some((c) => c.length > 48)) return "a caption is over 40 characters";
  if (s.hook.length > 52) return "the hook is over 44 characters";
  if (s.title.length > 70) return "the title is over 60 characters";
  return null;
}

async function writeScript(source) {
  const text = await sourceText(source);
  let correction = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const s = await callClaude(scriptPrompt(source, text, correction), SCRIPT_SCHEMA);
    correction = checkScript(s);
    if (!correction) return s;
    console.warn(`  script attempt ${attempt} rejected: ${correction}`);
  }
  throw new Error(`no acceptable script after 3 attempts (${correction})`);
}

async function narrate(text, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, await textToSpeech(text));
  return outPath;
}

// Fallback when scene generation fails: a stable slice of the pillar's image
// pool, chosen by the source key, so Shorts don't advance (or conflict over)
// the long-form videos' rotation.
function pickImages(rotation, pillar, key) {
  const pool = rotation.pools[pillar] || rotation.pools[GUIDE_PILLAR];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: Math.min(IMAGES_PER_SHORT, pool.length) }, (_, i) => pool[(h + i) % pool.length]);
}

function wrap(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// Text goes through textfile= (one file per line, each centered on its own),
// so no titles ever need ffmpeg filter escaping.
function textLines({ workDir, name, text, maxChars, size, color, y, lineGap, enable, fontPath }) {
  return wrap(text, maxChars).map((line, i) => {
    const file = path.join(workDir, `${name}-${i}.txt`);
    fs.writeFileSync(file, line);
    const when = enable ? `:enable='${enable}'` : "";
    return `drawtext=fontfile='${fontPath}':textfile='${file}':expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=${y + i * (size + lineGap)}${when}`;
  });
}

async function renderShort({ script, images, audioPath, outPath, workDir }) {
  const fontPath = fs.existsSync(BOLD_FONT) ? BOLD_FONT : await resolveFont();
  if (!fontPath) throw new Error("No DejaVu font found; install fonts-dejavu-core");
  const audioSeconds = await getAudioDuration(audioPath);
  const tempo = audioSeconds > MAX_SECONDS ? audioSeconds / MAX_SECONDS : 1;
  if (tempo > MAX_TEMPO) throw new Error(`narration is ${audioSeconds.toFixed(1)}s; too long for a Short`);
  const seconds = audioSeconds / tempo;
  const framesPer = Math.ceil((seconds * FPS) / images.length) + FPS;
  const zoomStep = (0.08 / framesPer).toFixed(8);

  const streams = images.map(
    (_, i) =>
      `[${i}:v]split=2[bg${i}][fg${i}];` +
      `[bg${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=30,eq=brightness=-0.12,setsar=1[bgb${i}];` +
      `[fg${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgf${i}];` +
      // Top of the photo starts just under the headline band, so faces
      // (usually in a portrait's upper third) sit clear of both text bands.
      `[bgb${i}][fgf${i}]overlay=(W-w)/2:${PHOTO_TOP},` +
      `zoompan=z='min(zoom+${zoomStep},1.08)':d=${framesPer}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1[v${i}]`
  );
  const concat = `${images.map((_, i) => `[v${i}]`).join("")}concat=n=${images.length}:v=1:a=0[slides]`;

  fs.mkdirSync(workDir, { recursive: true });
  const common = { workDir, fontPath, lineGap: 14 };
  const slot = (seconds - 0.4) / script.captions.length;
  const overlays = [
    `drawbox=x=0:y=0:w=iw:h=${PHOTO_TOP}:color=black@0.45:t=fill`,
    `drawbox=x=0:y=1240:w=iw:h=680:color=black@0.55:t=fill`,
    ...textLines({ ...common, name: "brand", text: "CHASE ARENELLA", maxChars: 40, size: 42, color: "0x8cc1e8", y: 120 }),
    ...textLines({ ...common, name: "hook", text: script.hook, maxChars: 22, size: 70, color: "white", y: 220 }),
    ...script.captions.flatMap((c, i) =>
      textLines({
        ...common,
        name: `cap${i}`,
        text: c,
        maxChars: 24,
        size: 60,
        color: "0xf7f5f0",
        y: 1340,
        enable: `between(t,${(0.4 + i * slot).toFixed(2)},${(0.4 + (i + 1) * slot).toFixed(2)})`,
      })
    ),
    ...textLines({ ...common, name: "site", text: "carenella1.github.io", maxChars: 40, size: 36, color: "0xa9b8c6", y: 1780 }),
  ];
  const graph = `${streams.join(";\n")};\n${concat};\n[slides]${overlays.join(",")}[vout]`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const args = [
    "-y",
    ...images.flatMap((img) => ["-i", path.join("assets", "images", img)]),
    "-i", audioPath,
    "-filter_complex", graph,
    "-map", "[vout]",
    "-map", `${images.length}:a`,
    ...(tempo > 1 ? ["-af", `atempo=${tempo.toFixed(4)}`] : []),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    "-shortest",
    outPath,
  ];
  await execFileP("ffmpeg", args, { maxBuffer: 1024 * 1024 * 50 });
  return { outPath, durationSeconds: await getAudioDuration(outPath) };
}

function buildShortMetadata(source, script) {
  const what = source.kind === "guide" ? "Full guide" : "Full essay";
  const description = [
    script.description,
    "",
    `${what}: ${source.url}`,
    "",
    `Website: ${SITE_URL}/`,
    `Field guide: ${GUIDE_SITE}/`,
    `All videos: ${SITE_URL}/videos.html`,
    "",
    "#Shorts #ChaseArenella #Leadership",
  ].join("\n");
  return {
    snippet: {
      // Name first, as on the long-form videos.
      title: `Chase Arenella: ${script.title} #Shorts`.slice(0, 100),
      description: description.replace(/[<>]/g, "").slice(0, 4900),
      tags: ["Chase Arenella", "ChaseOfSpadez", "Shorts", "leadership", "systems thinking", "decision making"],
      categoryId: "27", // Education
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
}

module.exports = {
  SHORTS_FILE,
  readShorts,
  writeShorts,
  loadSources,
  writeScript,
  narrate,
  pickImages,
  renderShort,
  buildShortMetadata,
};
