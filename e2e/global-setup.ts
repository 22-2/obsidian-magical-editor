import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const fixtureDir = path.join(__dirname, "fixtures", "magical-editor-harness");

  await build({
    entryPoints: [path.join(fixtureDir, "main.src.js")],
    outfile: path.join(fixtureDir, "main.js"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "nodenext",
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
    logLevel: "info",
  });
}
