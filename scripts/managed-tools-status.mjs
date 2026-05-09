#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const userHome = process.env.HOME ?? homedir();
const managedToolsPath = process.argv[2] ?? "tools/managed-tools.json";

function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(installed, expected) {
  const current = parseVersion(installed);
  const wanted = parseVersion(expected);
  if (!current || !wanted) return "unparseable";
  for (let index = 0; index < wanted.length; index += 1) {
    if (current[index] < wanted[index]) return "lower";
    if (current[index] > wanted[index]) return "higher";
  }
  return "equal";
}

function actionForState(state) {
  if (state === "missing") return "install";
  if (state === "equal") return "skip";
  if (state === "lower") return "upgrade";
  return "warn_skip";
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function expandPath(path) {
  return path.replaceAll("{USER_HOME}", userHome);
}

function versionFromOutput(output) {
  return output.match(/\bv?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/)?.[1] ?? "unparseable";
}

function commandVersion(path, args = ["--version"]) {
  if (!existsSync(path)) return null;
  const result = spawnSync(path, args, { encoding: "utf8" });
  if (result.status !== 0) return "unparseable";
  return versionFromOutput(`${result.stdout} ${result.stderr}`);
}

function row(family, type, name, desired, actual, path, source) {
  const state = actual === null ? "missing" : desired === "present" && actual !== "unparseable" ? "equal" : compareVersions(actual, desired);
  return { family, type, name, desired, actual: actual ?? "-", path, state, action: actionForState(state), source };
}

async function npmRows(config) {
  const source = config.groups.npm.packageJson;
  const pkg = await loadJson(source);
  const prefix = expandPath(process.env.OPENCHAMBER_MANAGED_NPM_PREFIX ?? config.groups.npm.installPrefix);
  const rows = [];
  for (const [name, desired] of Object.entries(pkg.dependencies ?? {})) {
    const path = join(prefix, "node_modules", name, "package.json");
    const actual = existsSync(path) ? (await loadJson(path)).version ?? "unparseable" : null;
    rows.push(row("npm", "package", name, desired, actual, path, source));
  }
  return rows;
}

async function goRows(config) {
  const toolchainManifest = await loadJson(config.groups.go.toolchainManifest);
  const goMod = await readFile(config.groups.go.goMod, "utf8");
  const toolchainDir = expandPath(process.env.OPENCHAMBER_MANAGED_GO_TOOLCHAIN_DIR ?? config.groups.go.toolchainInstallPath);
  const gobin = expandPath(process.env.OPENCHAMBER_MANAGED_GO_BIN ?? config.groups.go.gobin);
  const goBinary = join(toolchainDir, "bin", "go");
  const goActualRaw = existsSync(goBinary) ? spawnSync(goBinary, ["version"], { encoding: "utf8" }) : null;
  const goActual = goActualRaw === null ? null : goActualRaw.status === 0 ? goActualRaw.stdout.trim().split(/\s+/).find((part) => part.startsWith("go"))?.slice(2) ?? "unparseable" : "unparseable";
  const rows = [row("go", "toolchain", "go", toolchainManifest.version, goActual, goBinary, config.groups.go.toolchainManifest)];
  const managedTools = [
    { name: "gopls", module: "golang.org/x/tools/gopls" },
    { name: "shfmt", module: "mvdan.cc/sh/v3" },
  ];
  for (const tool of managedTools) {
    const desired = goMod.match(new RegExp(`${tool.module.replaceAll("/", "\\/")}\\s+v([^\\s]+)`))?.[1] ?? "unparseable";
    rows.push(row("go", "tool", tool.name, desired, goBuildInfoVersion(goBinary, join(gobin, tool.name), tool.module), join(gobin, tool.name), config.groups.go.goMod));
  }
  return rows;
}

function goBuildInfoVersion(goBinary, path, module) {
  if (!existsSync(path)) return null;
  if (!existsSync(goBinary)) return "unparseable";
  const result = spawnSync(goBinary, ["version", "-m", path], { encoding: "utf8" });
  if (result.status !== 0) return "unparseable";
  for (const line of result.stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if ((parts[0] === "mod" || parts[0] === "dep") && parts[1] === module) return parts[2]?.replace(/^v/, "") ?? "unparseable";
  }
  return "unparseable";
}

async function releaseRows(config) {
  const source = config.groups.releaseBinaries.manifest;
  const manifest = await loadJson(source);
  const installDir = expandPath(process.env.OPENCHAMBER_MANAGED_RELEASE_BIN_DIR ?? config.groups.releaseBinaries.installDir);
  return (manifest.tools ?? []).map((tool) => row("release-binaries", "binary", tool.name, tool.version, commandVersion(join(installDir, tool.name)), join(installDir, tool.name), source));
}

async function rustupRows(config) {
  const source = config.groups.rustup.rustupManifest;
  const manifest = await loadJson(source);
  const cargoHome = expandPath(process.env.CARGO_HOME ?? config.groups.rustup.cargoHome);
  const cargoBin = join(cargoHome, "bin");
  const desired = manifest.version;
  return [
    row("rustup", "bootstrap", "rustup", manifest.rustupVersion ?? "present", rustupStateActual(join(cargoBin, "rustup"), manifest), join(cargoBin, "rustup"), source),
    row("rustup", "toolchain", manifest.toolchain, desired, commandVersion(join(cargoBin, "rustc")), join(cargoBin, "rustc"), source),
    row("rustup", "tool", "cargo", desired, commandVersion(join(cargoBin, "cargo")), join(cargoBin, "cargo"), source),
  ];
}

function rustupStateActual(path, manifest) {
  const actual = commandVersion(path);
  if (actual === null || manifest.rustupVersion) return actual;
  return actual === "unparseable" ? "unparseable" : "present";
}

function printRows(rows) {
  console.log("family\ttype\tname\tdesired\tactual\tpath\tstate\taction\tsource");
  for (const item of rows) console.log(`${item.family}\t${item.type}\t${item.name}\t${item.desired}\t${item.actual}\t${item.path}\t${item.state}\t${item.action}\t${item.source}`);
}

function printSummary(rows) {
  const counts = rows.reduce((all, item) => ({ ...all, [item.state]: (all[item.state] ?? 0) + 1 }), {});
  console.log(`[managed-tools] families=4 rows=${rows.length} missing=${counts.missing ?? 0} equal=${counts.equal ?? 0} lower=${counts.lower ?? 0} higher=${counts.higher ?? 0} unparseable=${counts.unparseable ?? 0}`);
}

async function main() {
  const config = await loadJson(managedToolsPath);
  const rows = [...(await npmRows(config)), ...(await goRows(config)), ...(await releaseRows(config)), ...(await rustupRows(config))];
  printRows(rows);
  printSummary(rows);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
