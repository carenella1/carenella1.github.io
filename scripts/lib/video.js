// Shared slideshow-video building logic — used by both build-video.js (the
// recurring monthly pipeline) and fix-existing-videos.js (a one-time repair
// script). Keeping this in one place means the zoom/crop fix only has to be
// correct once, not duplicated and risk drifting between the two callers.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const FPS = 25;
const MAX_ZOOM = 1.12; // subtle drift, not a dramatic push-in

async function getAudioDuration(audioPath) {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  return parseFloat(stdout.trim());
}

async function resolveFont() {
  try {
    const { stdout } = await execFileP("fc-match", ["-f", "%{file}", "DejaVu Sans Bold"]);
    const p = stdout.trim();
    if (p && fs.existsSync(p)) return p;
  } catch (e) {
    // fc-match unavailable or no match — fall through to known-install-path guesses.
  }
  const fallbacks = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  return fallbacks.find((p) => fs.existsSync(p)) || null;
}

function escapeDrawtext(text) {
  // The text value is wrapped in single quotes (see buildFilterComplex), and
  // ffmpeg's filter-string quoting protects every special character
  // (including ':') once inside single quotes — the ONLY thing that needs
  // handling is a literal single quote itself, via the standard
  // close-quote / escaped-quote / reopen-quote sequence: '\''
  return String(text).replace(/'/g, "'\\''");
}

function buildFilterComplex({ imageCount, perImageDuration, fontPath, titleText }) {
  const zoomFrames = Math.max(1, Math.round(perImageDuration * FPS));
  // Scale the per-frame increment to the image's actual on-screen duration so
  // the zoom animates smoothly across the FULL segment and lands on MAX_ZOOM
  // right at the end — not hit a fixed cap early and then sit there for the
  // rest of a long (~30s) segment, which is what produced a "stuck zoomed
  // in" look on long per-image durations.
  const zoomIncrement = (MAX_ZOOM - 1) / zoomFrames;
  const perStream = [];
  for (let i = 0; i < imageCount; i++) {
    // Most source photos aren't 16:9 — many are portrait (e.g. 1024x1536).
    // A plain "scale+crop to fill" hard-crops those down to a narrow center
    // slice blown up to fill the frame (the actual cause of the "zoomed into
    // a tiny detail" look — independent of the zoompan animation below).
    // Fix: split into a blurred, cropped-to-fill BACKGROUND layer and a
    // full, uncropped, fit-within-frame FOREGROUND layer, composite them,
    // then apply the Ken Burns zoom to the composited (already 1920x1080)
    // result. No part of the original image is ever lost.
    perStream.push(
      `[${i}:v]split=2[bg${i}][fg${i}];` +
        `[bg${i}]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=20,setsar=1[bgblur${i}];` +
        `[fg${i}]scale=1920:1080:force_original_aspect_ratio=decrease,setsar=1[fgfit${i}];` +
        `[bgblur${i}][fgfit${i}]overlay=(W-w)/2:(H-h)/2,` +
        `zoompan=z='min(zoom+${zoomIncrement.toFixed(8)},${MAX_ZOOM})':d=${zoomFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${FPS},setsar=1[v${i}]`
    );
  }
  const concatInputs = Array.from({ length: imageCount }, (_, i) => `[v${i}]`).join("");
  let graph = perStream.join(";\n") + `;\n${concatInputs}concat=n=${imageCount}:v=1:a=0[vconcat]`;

  if (fontPath) {
    const safeText = escapeDrawtext(titleText);
    graph += `;\n[vconcat]drawtext=fontfile='${fontPath}':text='${safeText}':x=40:y=h-th-40:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=12[vout]`;
  } else {
    graph += `;\n[vconcat]null[vout]`;
  }
  return graph;
}

// High-level: build a full slideshow mp4 from a list of image paths + a
// narration audio file. Returns { outPath, durationSeconds }.
async function renderSlideshow({ images, audioPath, outPath, titleText }) {
  const duration = await getAudioDuration(audioPath);
  const perImageDuration = duration / images.length;

  const fontPath = await resolveFont();
  if (!fontPath) console.warn("No DejaVu font found — video will render without a title overlay.");

  const imageInputArgs = [];
  for (const img of images) {
    imageInputArgs.push("-loop", "1", "-t", String(perImageDuration), "-i", path.join("assets", "images", img));
  }

  const filterComplex = buildFilterComplex({
    imageCount: images.length,
    perImageDuration,
    fontPath,
    titleText,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const audioInputIndex = images.length; // narration is the last -i argument
  const args = [
    "-y",
    ...imageInputArgs,
    "-i", audioPath,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", `${audioInputIndex}:a`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    outPath,
  ];

  await execFileP("ffmpeg", args, { maxBuffer: 1024 * 1024 * 20 });
  return { outPath, durationSeconds: duration };
}

module.exports = { FPS, MAX_ZOOM, getAudioDuration, resolveFont, escapeDrawtext, buildFilterComplex, renderSlideshow };
