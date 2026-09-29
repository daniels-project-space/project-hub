#!/usr/bin/env node

/** Verify the owner-approved Vera tour source pack before an Engine handoff. */

import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const scenes = [
  {
    file: "coast-house.png",
    label: "arrival",
    prompt: "Slow, unhurried cinematic dolly toward this exact coastal house at golden hour. Keep the existing architecture, landscaping, coastline, water, and furniture unchanged. Let the pool surface and grasses move subtly in a light sea breeze; soft natural sunlight shifts across the stone. No people, no text, no new buildings, no abrupt camera movement.",
  },
  {
    file: "living-room.png",
    label: "living",
    prompt: "A refined, steady camera glide through this exact limestone living room toward the sea view. Preserve the interior layout, furniture, material palette, and horizon precisely. Add only believable daylight, a gentle curtain movement, and small water reflections. No people, no text, no added objects, no distortion.",
  },
  {
    file: "primary-suite.png",
    label: "suite",
    prompt: "A calm, elegant forward push into this exact primary suite at blue hour. Preserve the bed, joinery, lighting, window framing, and coastal view. Let the ambient lamp glow, distant water, and sheer fabric move almost imperceptibly. No people, no text, no changed architecture, no sudden motion.",
  },
];

function sourceDirectory() {
  let source = "public/images/vera";
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--verify") continue;
    if (argument === "--source-dir") {
      const value = argumentsList[++index];
      if (!value || value.startsWith("--")) throw new Error("--source-dir requires a directory.");
      source = value;
      continue;
    }
    if (argument === "--render" || argument === "--output") {
      throw new Error("Direct Vera LTX rendering is retired. Submit the tour through Render Engine for verified Vera R2 delivery.");
    }
    throw new Error(`Unsupported Vera tour option: ${argument}`);
  }
  return resolve(root, source);
}

async function main() {
  const directory = sourceDirectory();
  for (const scene of scenes) {
    const path = join(directory, scene.file);
    const info = await stat(path);
    if (!info.isFile() || info.size <= 100_000) {
      throw new Error(`Source image is missing or unexpectedly small: ${path}`);
    }
  }
  process.stdout.write(`Vera source pack verified: ${scenes.map((scene) => scene.file).join(", ")}\n`);
}

main().catch((error) => {
  process.stderr.write(`Vera tour verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
