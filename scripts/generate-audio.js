// Best-effort pipeline stage (continue-on-error in the workflow — see
// docs/content-pipeline-setup.md). Turns the article body into narration
// audio, reused for both the slideshow video's soundtrack and the podcast
// episode. Chunks at OpenAI TTS's 4096-character input limit, then joins the
// chunks with ffmpeg (robust for same-codec MP3 segments — avoids fragile
// raw-byte concatenation).
//
// Usage:
//   node scripts/generate-audio.js            # real run, needs OPENAI_API_KEY + ffmpeg
//   node scripts/generate-audio.js --dry-run  # prints chunk plan, calls no APIs
//   MOCK_TTS=1 node scripts/generate-audio.js # writes short silent placeholder
//                                              # chunks instead of calling the API,
//                                              # for exercising the concat step
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { recordStatus } = require("./lib/pipeline-status");
const execFileP = promisify(execFile);

const DRY_RUN = process.argv.includes("--dry-run");
const RUNNER_TEMP = process.env.RUNNER_TEMP || require("os").tmpdir();
const MAX_CHUNK_CHARS = 4000; // stay under OpenAI TTS's 4096-char hard limit
const TTS_VOICE = process.env.TTS_VOICE || "onyx";
const TTS_MODEL = process.env.TTS_MODEL || "tts-1";

function chunkText(text, maxChars) {
  const paragraphs = text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/);
  const chunks = [];
  let current = "";
  for (const para of paragraphs) {
    if ((current + " " + para).trim().length > maxChars) {
      if (current.trim()) chunks.push(current.trim());
      if (para.length > maxChars) {
        // A single "paragraph" longer than the limit (shouldn't happen at
        // this word count, but split defensively on sentence boundaries).
        let rest = para;
        while (rest.length > maxChars) {
          let cut = rest.lastIndexOf(". ", maxChars);
          if (cut <= 0) cut = maxChars;
          chunks.push(rest.slice(0, cut + 1).trim());
          rest = rest.slice(cut + 1);
        }
        current = rest;
      } else {
        current = para;
      }
    } else {
      current = (current + " " + para).trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function fetchTtsChunk(apiKey, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: "mp3" });
    const req = https.request(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI TTS returned ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 500)}`));
          } else {
            resolve(Buffer.concat(chunks));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Generates ~1s of silence via ffmpeg's anullsrc, for local/dry testing of
// the concat step without spending real API calls.
async function writeMockChunk(outPath) {
  await execFileP("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "anullsrc=r=24000:cl=mono",
    "-t", "1",
    "-q:a", "9",
    outPath,
  ]);
}

async function concatMp3s(chunkPaths, outPath) {
  const listFile = path.join(RUNNER_TEMP, "audio-concat-list.txt");
  const listContent = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listFile, listContent);
  await execFileP("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
}

async function main() {
  const articlePath = path.join(RUNNER_TEMP, "pipeline-article.json");
  if (!fs.existsSync(articlePath)) {
    throw new Error(`${articlePath} not found — run generate-article.js first`);
  }
  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const chunks = chunkText(article.bodyText, MAX_CHUNK_CHARS);
  console.log(`Splitting narration into ${chunks.length} chunk(s) (max ${MAX_CHUNK_CHARS} chars each).`);

  if (DRY_RUN) {
    chunks.forEach((c, i) => console.log(`  chunk ${i + 1}: ${c.length} chars`));
    return;
  }

  const useMock = process.env.MOCK_TTS === "1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!useMock && !apiKey) throw new Error("OPENAI_API_KEY is not set");

  const workDir = path.join(RUNNER_TEMP, "audio-chunks");
  fs.mkdirSync(workDir, { recursive: true });
  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = path.join(workDir, `chunk-${String(i).padStart(3, "0")}.mp3`);
    if (useMock) {
      await writeMockChunk(chunkPath);
    } else {
      const audioBuffer = await fetchTtsChunk(apiKey, chunks[i]);
      fs.writeFileSync(chunkPath, audioBuffer);
    }
    chunkPaths.push(chunkPath);
    console.log(`  chunk ${i + 1}/${chunks.length} done`);
  }

  fs.mkdirSync("assets/audio", { recursive: true });
  const outPath = path.join("assets", "audio", `${article.slug}.mp3`);
  await concatMp3s(chunkPaths, outPath);
  console.log(`Wrote ${outPath}`);

  const stat = fs.statSync(outPath);
  fs.writeFileSync(
    path.join(RUNNER_TEMP, "pipeline-audio.json"),
    JSON.stringify({ audioPath: outPath, audioUrl: `/assets/audio/${article.slug}.mp3`, bytes: stat.size }, null, 2)
  );
  recordStatus("audio", true);
}

main().catch((e) => {
  console.error("generate-audio.js failed:", e.message);
  recordStatus("audio", false, e.message);
  process.exit(1);
});
