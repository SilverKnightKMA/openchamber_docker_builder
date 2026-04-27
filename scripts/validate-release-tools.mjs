#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const manifestPath = process.argv[2] ?? "tools/release-tools.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const allowedFormats = new Set(["sha256sum", "yq-checksums", "github-asset-digest"]);

if (!manifest.policy?.requireUpstreamChecksum) {
  throw new Error("release tool policy must require upstream checksums");
}
if (manifest.policy?.allowDownloadAndHash) {
  throw new Error("release tool policy must not allow download-and-hash fallback");
}

for (const tool of manifest.tools ?? []) {
  if (!tool.name || !tool.repo || !tool.version || !tool.asset || !tool.sha256) {
    throw new Error(`release tool entry is missing required fields: ${JSON.stringify(tool)}`);
  }
  if (!allowedFormats.has(tool.checksumFormat)) {
    throw new Error(`${tool.name} uses unsupported checksum format ${tool.checksumFormat}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(tool.sha256)) {
    throw new Error(`${tool.name} sha256 must be a 64-character hex string`);
  }
  if (tool.checksumFormat === "github-asset-digest") {
    if (tool.checksumAsset !== null) {
      throw new Error(`${tool.name} must set checksumAsset to null when using github-asset-digest`);
    }
    continue;
  }
  if (typeof tool.checksumAsset !== "string" || tool.checksumAsset.length === 0) {
    throw new Error(`${tool.name} must declare a checksum asset for ${tool.checksumFormat}`);
  }
}

console.log(`release tool manifest valid: ${manifest.tools.length} tools`);
