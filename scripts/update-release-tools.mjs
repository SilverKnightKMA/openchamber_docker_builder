#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const manifestPath = process.argv[2] ?? "tools/release-tools.json";

const hashOrder = [
  "CRC32",
  "MD4",
  "MD5",
  "SHA1",
  "TIGER",
  "TTH",
  "BTIH",
  "ED2K",
  "AICH",
  "WHIRLPOOL",
  "RIPEMD-160",
  "GOST94",
  "GOST94-CRYPTOPRO",
  "HAS-160",
  "GOST12-256",
  "GOST12-512",
  "SHA-224",
  "SHA-256",
  "SHA-384",
  "SHA-512",
  "EDON-R256",
  "EDON-R512",
  "SHA3-224",
  "SHA3-256",
  "SHA3-384",
  "SHA3-512",
  "CRC32C",
  "SNEFRU-128",
  "SNEFRU-256",
  "BLAKE2S",
  "BLAKE2B",
];

const sha256Index = hashOrder.indexOf("SHA-256") + 2;

async function fetchText(url) {
  const headers = { "User-Agent": "openchamber-release-tools-updater" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;

  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function actionlintAsset(version) {
  const versionNoV = version.replace(/^v/, "");
  return `actionlint_${versionNoV}_linux_amd64.tar.gz`;
}

function actionlintChecksumAsset(version) {
  const versionNoV = version.replace(/^v/, "");
  return `actionlint_${versionNoV}_checksums.txt`;
}

function expectedAsset(tool, version) {
  if (tool.name === "actionlint") return actionlintAsset(version);
  return tool.asset;
}

function expectedChecksumAsset(tool, version) {
  if (tool.checksumFormat === "github-asset-digest") return null;
  if (tool.name === "actionlint") return actionlintChecksumAsset(version);
  return tool.checksumAsset;
}

function parseChecksum(tool, checksumText, asset) {
  const line = checksumText.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${asset} `) || entry.trim().endsWith(` ${asset}`));
  if (!line) {
    throw new Error(`Checksum for ${tool.name} asset ${asset} not found`);
  }

  const parts = line.trim().split(/\s+/);
  if (tool.checksumFormat === "sha256sum") {
    return parts[0];
  }
  if (tool.checksumFormat === "yq-checksums") {
    const sha256 = parts[sha256Index];
    if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error(`Unable to parse yq SHA-256 checksum for ${asset}`);
    }
    return sha256;
  }
  if (tool.checksumFormat === "github-asset-digest") {
    throw new Error("github-asset-digest checksums are read from release asset metadata");
  }
  throw new Error(`Unsupported checksum format: ${tool.checksumFormat}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.policy?.requireUpstreamChecksum || manifest.policy?.allowDownloadAndHash) {
  throw new Error("release-tools policy must require upstream checksums and disable download-and-hash fallback");
}

let changed = false;
for (const tool of manifest.tools) {
  const release = await fetchJson(`https://api.github.com/repos/${tool.repo}/releases/latest`);
  const latestVersion = release.tag_name;
  if (latestVersion === tool.version) continue;

  const asset = expectedAsset(tool, latestVersion);
  const checksumAsset = expectedChecksumAsset(tool, latestVersion);
  const assetEntry = release.assets.find((entry) => entry.name === asset);
  if (!assetEntry) throw new Error(`${tool.name} release ${latestVersion} is missing asset ${asset}`);

  tool.version = latestVersion;
  tool.asset = asset;
  tool.checksumAsset = checksumAsset;
  if (tool.checksumFormat === "github-asset-digest") {
    if (!assetEntry.digest?.startsWith("sha256:")) {
      throw new Error(`${tool.name} release ${latestVersion} asset ${asset} is missing GitHub SHA-256 digest metadata`);
    }
    tool.sha256 = assetEntry.digest.slice("sha256:".length);
  } else {
    const checksumEntry = release.assets.find((entry) => entry.name === checksumAsset);
    if (!checksumEntry) throw new Error(`${tool.name} release ${latestVersion} is missing checksum asset ${checksumAsset}`);
    const checksumText = await fetchText(checksumEntry.browser_download_url);
    tool.sha256 = parseChecksum(tool, checksumText, asset);
  }
  changed = true;
}

if (changed) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("release tool manifest updated");
} else {
  console.log("release tool manifest already up to date");
}
