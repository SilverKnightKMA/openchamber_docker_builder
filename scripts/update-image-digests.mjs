#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const args = process.argv.slice(2);
const checkMode = args.includes("--check");
const positionalArgs = args.filter((arg) => arg !== "--check");
const dockerfilePath = positionalArgs[0] ?? "Dockerfile";

const ALLOWLIST = new Set([
  "oven/bun",
  "cloudflare/cloudflared",
  "ghcr.io/astral-sh/uv",
  "golang",
]);

const TARGET_OS = "linux";
const TARGET_ARCH = "amd64";
const IMAGE_REFERENCE_PATTERN = /(?<full>(?<image>[A-Za-z0-9./:_-]+):(?<tag>[A-Za-z0-9_][A-Za-z0-9._-]{0,127})@(?<digest>sha256:[a-f0-9]{64}))/g;

function usage() {
  console.error("Usage: node scripts/update-image-digests.mjs [Dockerfile] [--check]");
}

function normalizeDigest(digest) {
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`Invalid digest: ${digest}`);
  }
  return digest.toLowerCase();
}

function isAllowedImage(image) {
  return ALLOWLIST.has(image);
}

async function inspectRawManifest(reference) {
  try {
    const { stdout } = await execFile(
      "docker",
      ["buildx", "imagetools", "inspect", "--raw", reference],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("docker CLI not found; install Docker with buildx support to resolve image digests");
    }
    const stderr = error.stderr?.trim();
    throw new Error(
      `Failed to inspect ${reference}${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

function childMatchesPlatform(manifest) {
  return manifest?.platform?.os === TARGET_OS && manifest?.platform?.architecture === TARGET_ARCH;
}

function extractDigestFromSingleManifest(document, reference) {
  const mediaType = document?.mediaType;
  if (
    mediaType !== "application/vnd.docker.distribution.manifest.v2+json" &&
    mediaType !== "application/vnd.oci.image.manifest.v1+json"
  ) {
    throw new Error(`Unsupported single-manifest media type for ${reference}: ${mediaType ?? "unknown"}`);
  }

  throw new Error(
    `${reference} resolved to a single-platform manifest; require a manifest list/index with an explicit ${TARGET_OS}/${TARGET_ARCH} child digest`,
  );
}

function extractDigestFromIndex(document, reference) {
  const manifests = document?.manifests;
  if (!Array.isArray(manifests)) {
    throw new Error(`Image index for ${reference} does not include manifests[]`);
  }

  const matches = manifests.filter(childMatchesPlatform);
  if (matches.length === 0) {
    throw new Error(`Image ${reference} is missing ${TARGET_OS}/${TARGET_ARCH} manifest`);
  }
  if (matches.length > 1) {
    throw new Error(`Image ${reference} has multiple ${TARGET_OS}/${TARGET_ARCH} manifests`);
  }

  const digest = matches[0]?.digest;
  if (!digest) {
    throw new Error(`Image ${reference} has ${TARGET_OS}/${TARGET_ARCH} manifest without digest`);
  }

  return normalizeDigest(digest);
}

function resolveDigestFromDocument(document, reference) {
  const mediaType = document?.mediaType;
  if (
    mediaType === "application/vnd.oci.image.index.v1+json" ||
    mediaType === "application/vnd.docker.distribution.manifest.list.v2+json"
  ) {
    return extractDigestFromIndex(document, reference);
  }

  return extractDigestFromSingleManifest(document, reference);
}

async function resolveDigest(image, tag) {
  const reference = `${image}:${tag}`;
  const document = await inspectRawManifest(reference);
  return resolveDigestFromDocument(document, reference);
}

function collectAllowlistedReferences(text) {
  const matches = [];
  for (const match of text.matchAll(IMAGE_REFERENCE_PATTERN)) {
    const { full, image, tag, digest } = match.groups ?? {};
    if (!full || !image || !tag || !digest) continue;
    if (!isAllowedImage(image)) continue;

    matches.push({
      full,
      image,
      tag,
      digest: normalizeDigest(digest),
    });
  }
  return matches;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    process.exit(0);
  }

  if (positionalArgs.length > 1) {
    usage();
    throw new Error("Expected at most one positional Dockerfile path argument");
  }

  const originalText = await readFile(dockerfilePath, "utf8");
  const references = collectAllowlistedReferences(originalText);

  if (references.length === 0) {
    console.log(`No allowlisted tag+digest references found in ${dockerfilePath}`);
    return;
  }

  const digestCache = new Map();
  let updatedText = originalText;
  const changes = [];

  for (const reference of references) {
    const cacheKey = `${reference.image}:${reference.tag}`;
    let resolvedDigest = digestCache.get(cacheKey);
    if (!resolvedDigest) {
      resolvedDigest = await resolveDigest(reference.image, reference.tag);
      digestCache.set(cacheKey, resolvedDigest);
    }

    if (resolvedDigest === reference.digest) continue;

    const nextReference = `${reference.image}:${reference.tag}@${resolvedDigest}`;
    updatedText = updatedText.replaceAll(reference.full, nextReference);
    changes.push({
      from: reference.full,
      to: nextReference,
    });
  }

  if (changes.length === 0) {
    console.log(`Image digests already up to date in ${dockerfilePath}`);
    return;
  }

  if (checkMode) {
    console.error(`Image digests need updates in ${dockerfilePath}:`);
    for (const change of changes) {
      console.error(`- ${change.from} -> ${change.to}`);
    }
    process.exitCode = 1;
    return;
  }

  await writeFile(dockerfilePath, updatedText);
  console.log(`Updated ${changes.length} image digest reference(s) in ${dockerfilePath}`);
}

await main();
