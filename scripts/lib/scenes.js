// Scene images: generated pictures made for one video, so videos stop
// recycling the same handful of photos. Scenes show places, objects and
// settings only, never people (the site adds no new likenesses).
//
// Files land in assets/images/generated/ with brand names
// (chase-arenella-<name>-<n>.jpg) and are shown on the video's watch page and
// listed in the video sitemap, so each one can rank in image search too.
const fs = require("fs");
const path = require("path");
const { callClaude, generateImage } = require("./api");

const DIR = "generated";
const STYLE =
  "Cinematic editorial photograph, moody deep navy and teal lighting with warm amber accents, shallow depth of field, " +
  "realistic, high detail. Absolutely no people, no human figures, no faces, no hands, no silhouettes. " +
  "No text, letters, numbers, logos or watermarks anywhere in the image.";

const SCENES_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: { type: "string" },
      description: "One visual scene description per image, each 15-30 words",
    },
  },
  required: ["scenes"],
  additionalProperties: false,
};

// Prompt text shared with the Shorts script prompt, so both describe scenes
// the same way.
const SCENE_RULES = `Each scene is a 15-30 word description of a single photograph that fits the idea at that point: a place, objects, or a setting (a whiteboard covered in sticky notes, an empty war room at night, a paused game on a monitor). No people, faces, hands or silhouettes. No readable text, screens with words, logos or brands. Vary the settings; don't repeat a scene.`;

async function writeScenes({ title, text, count }) {
  const { scenes } = await callClaude(
    `Describe ${count} photographs to illustrate a narrated video of this essay, in the order they'll appear.

TITLE: ${title}
TEXT:
${text}

${SCENE_RULES}`,
    SCENES_SCHEMA
  );
  if (scenes.length < count) throw new Error(`asked for ${count} scenes, got ${scenes.length}`);
  return scenes.slice(0, count);
}

// Generates one image per scene. Returns [{ file, alt }] with `file` relative
// to assets/images, ready for the video renderers.
async function renderScenes(scenes, { name, size }) {
  fs.mkdirSync(path.join("assets", "images", DIR), { recursive: true });
  const out = [];
  for (const [i, scene] of scenes.entries()) {
    const file = `${DIR}/chase-arenella-${name}-${i + 1}.jpg`;
    fs.writeFileSync(path.join("assets", "images", file), await generateImage(`${scene}\n\n${STYLE}`, size));
    out.push({ file, alt: `${scene.replace(/\.$/, "")} (Chase Arenella)` });
  }
  return out;
}

module.exports = { SCENE_RULES, writeScenes, renderScenes };
