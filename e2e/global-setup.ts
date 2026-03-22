import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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

export default async function globalSetup() {
  await buildFixturePlugin("magical-editor-harness");
  await buildFixturePlugin("minimal-modal-opener");
}
