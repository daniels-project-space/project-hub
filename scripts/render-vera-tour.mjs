#!/usr/bin/env node

/**
 * Produces a cinematic Vera walkthrough from an owner-authorized photo set.
 *
 * Default mode validates the source pack only. `--render` is intentionally
 * required before any billable LTX request is sent.
 *
 * Usage:
 *   LTX_API_KEY=... node scripts/render-vera-tour.mjs --verify
 *   LTX_API_KEY=... node scripts/render-vera-tour.mjs --render
 *   LTX_API_KEY=... node scripts/render-vera-tour.mjs --render \
 *     --source-dir /secure/approved-property-photos \
 *     --output public/videos/vera/my-property-tour.mp4
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const hasFlag = (flag) => argumentsList.includes(flag);
const valueAfter = (flag, fallback) => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback;
};

const sourceDirectory = resolve(root, valueAfter("--source-dir", "public/images/vera"));
const outputPath = resolve(root, valueAfter("--output", "public/videos/vera/aster-house-tour.mp4"));
const workDirectory = resolve(root, ".vera-tour-work");
const shouldRender = hasFlag("--render");
const shouldVerify = hasFlag("--verify") || !shouldRender;
const apiKey = process.env.LTX_API_KEY;

const scenes = [
  {
    file: "coast-house.png",
    label: "arrival",
    prompt:
      "Slow, unhurried cinematic dolly toward this exact coastal house at golden hour. Keep the existing architecture, landscaping, coastline, water, and furniture unchanged. Let the pool surface and grasses move subtly in a light sea breeze; soft natural sunlight shifts across the stone. No people, no text, no new buildings, no abrupt camera movement.",
  },
  {
    file: "living-room.png",
    label: "living",
    prompt:
      "A refined, steady camera glide through this exact limestone living room toward the sea view. Preserve the interior layout, furniture, material palette, and horizon precisely. Add only believable daylight, a gentle curtain movement, and small water reflections. No people, no text, no added objects, no distortion.",
  },
  {
    file: "primary-suite.png",
    label: "suite",
    prompt:
      "A calm, elegant forward push into this exact primary suite at blue hour. Preserve the bed, joinery, lighting, window framing, and coastal view. Let the ambient lamp glow, distant water, and sheer fabric move almost imperceptibly. No people, no text, no changed architecture, no sudden motion.",
  },
];

const apiBase = "https://api.ltx.io";
const model = process.env.LTX_VERA_MODEL ?? "ltx-2-5-pro";
const resolution = process.env.LTX_VERA_RESOLUTION ?? "1920x1080";
const duration = Number(process.env.LTX_VERA_DURATION ?? 8);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function jsonRequest(path, init = {}) {
  assert(apiKey, "LTX_API_KEY is required only when you pass --render.");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.text();
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`LTX returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) {
    const message = parsed?.error?.message ?? parsed?.message ?? "Unknown provider error";
    throw new Error(`LTX ${init.method ?? "GET"} ${path} failed (${response.status}): ${message}`);
  }
  return parsed;
}

function mediaType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function uploadSource(path) {
  const ticket = await jsonRequest("/v1/upload", { method: "POST" });
  assert(ticket?.upload_url && ticket?.storage_uri, "LTX did not return a usable upload ticket.");
  const bytes = await readFile(path);
  const response = await fetch(ticket.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mediaType(path), ...(ticket.required_headers ?? {}) },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Uploading ${basename(path)} to LTX failed (${response.status}).`);
  return ticket.storage_uri;
}

async function submitScene(scene, imageUri) {
  const accepted = await jsonRequest("/v2/image-to-video", {
    method: "POST",
    body: JSON.stringify({
      image_uri: imageUri,
      prompt: scene.prompt,
      model,
      duration,
      resolution,
      fps: 24,
      generate_audio: false,
    }),
  });
  assert(typeof accepted?.id === "string", `LTX did not return a job ID for ${scene.label}.`);
  return accepted.id;
}

async function waitForScene(scene, jobId) {
  const maximumPolls = 96;
  for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
    if (attempt) await sleep(5000);
    const status = await jsonRequest(`/v2/image-to-video/${jobId}`);
    if (status?.status === "completed" && typeof status?.result?.video_url === "string") return status.result.video_url;
    if (status?.status === "failed") {
      throw new Error(`LTX failed ${scene.label}: ${status?.error?.message ?? "Unknown render failure"}`);
    }
    process.stdout.write(`Waiting for ${scene.label} (${status?.status ?? "unknown"})…\n`);
  }
  throw new Error(`LTX timed out while rendering ${scene.label}.`);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download generated clip (${response.status}).`);
  await pipeline(response.body, createWriteStream(destination));
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`))));
  });
}

function capture(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.once("error", rejectRun);
    child.once("exit", (code) => (code === 0 ? resolveRun(output) : rejectRun(new Error(`${command} exited with ${code}: ${error.trim()}`))));
  });
}

async function stitch(clips) {
  await mkdir(dirname(outputPath), { recursive: true });
  const transition = 0.75;
  const activeDuration = duration - 1;
  const secondStart = activeDuration * 2 - transition * 2;
  const filter = [
    `[0:v]trim=duration=${activeDuration},setpts=PTS-STARTPTS,fps=24,format=yuv420p[v0]`,
    `[1:v]trim=duration=${activeDuration},setpts=PTS-STARTPTS,fps=24,format=yuv420p[v1]`,
    `[2:v]trim=duration=${activeDuration},setpts=PTS-STARTPTS,fps=24,format=yuv420p[v2]`,
    `[v0][v1]xfade=transition=fade:duration=${transition}:offset=${activeDuration - transition}[v01]`,
    `[v01][v2]xfade=transition=fade:duration=${transition}:offset=${secondStart}[video]`,
  ].join(";");
  await run("ffmpeg", [
    "-y",
    "-i", clips[0],
    "-i", clips[1],
    "-i", clips[2],
    "-filter_complex", filter,
    "-map", "[video]",
    "-an",
    "-movflags", "+faststart",
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "slow",
    outputPath,
  ]);
}

async function verifyOutput() {
  const infoPath = join(workDirectory, "ffprobe.json");
  const report = JSON.parse(await capture("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration,size",
    "-of", "json",
    outputPath,
  ]));
  const output = await stat(outputPath);
  const stream = report.streams?.[0];
  const renderedDuration = Number(report.format?.duration);
  assert(output.size > 1_000_000, "Stitched output is unexpectedly small.");
  assert(stream?.codec_name === "h264", "Stitched output must be H.264 for web playback.");
  assert(stream?.width === 1920 && stream?.height === 1080, "Stitched output must stay at the requested 1920×1080 geometry.");
  assert(Number.isFinite(renderedDuration) && renderedDuration >= duration * scenes.length - 5, "Stitched output duration is shorter than the planned visual tour.");
  await writeFile(infoPath, JSON.stringify({ output: outputPath, bytes: output.size, duration: renderedDuration, stream, completedAt: new Date().toISOString() }, null, 2));
}

async function main() {
  const sourcePaths = scenes.map((scene) => ({ ...scene, path: join(sourceDirectory, scene.file) }));
  for (const scene of sourcePaths) {
    assert(existsSync(scene.path), `Missing approved source image: ${scene.path}`);
    const info = await stat(scene.path);
    assert(info.size > 100_000, `Source image is unexpectedly small: ${scene.path}`);
  }

  process.stdout.write(`Vera source pack verified: ${sourcePaths.map((scene) => scene.file).join(", ")}\n`);
  process.stdout.write(`Render profile: ${model} · ${resolution} · ${duration}s per scene · silent\n`);
  process.stdout.write(`Output: ${outputPath}\n`);

  if (shouldVerify) return;
  assert(apiKey, "LTX_API_KEY is required only when you pass --render.");

  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
  const clips = [];
  const manifest = [];
  for (const scene of sourcePaths) {
    process.stdout.write(`Uploading approved ${scene.label} source…\n`);
    const imageUri = await uploadSource(scene.path);
    const jobId = await submitScene(scene, imageUri);
    process.stdout.write(`LTX accepted ${scene.label}: ${jobId}\n`);
    const videoUrl = await waitForScene(scene, jobId);
    const clipPath = join(workDirectory, `${scene.label}.mp4`);
    await download(videoUrl, clipPath);
    clips.push(clipPath);
    manifest.push({ scene: scene.label, jobId, source: basename(scene.path), receivedAt: new Date().toISOString() });
  }
  await stitch(clips);
  await verifyOutput();
  await writeFile(join(workDirectory, "render-manifest.json"), JSON.stringify({ model, resolution, duration, scenes: manifest }, null, 2));
  process.stdout.write(`Verified stitched Vera tour: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Vera LTX render failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
