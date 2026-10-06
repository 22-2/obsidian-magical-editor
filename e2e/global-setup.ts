import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildFixturePlugin(fixtureName: string) {
  const fixtureDir = path.join(__dirname, "fixtures", fixtureName);

  await build({
    entryPoints: [path.join(fixtureDir, "main.src.js")],
    outfile: path.join(fixtureDir, "main.js"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
    logLevel: "debug",
  });
}

// Electron 44 no longer downloads its binary in a postinstall script, so the
// toolkit's preflight check fails on a fresh install. Download it up front.
function ensureElectronBinary() {
  const require = createRequire(import.meta.url);
  const installScript = require.resolve("electron/install.js");
  const result = spawnSync(process.execPath, [installScript], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to install the Electron binary (exit code ${result.status})`);
  }
}

export default async function globalSetup() {
  ensureElectronBinary();
  await buildFixturePlugin("magical-editor-harness");
  await buildFixturePlugin("minimal-modal-opener");
}
