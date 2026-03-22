
import path from "node:path";
import { ObsidianAPI } from "obsidian-e2e-toolkit";
import { expect, test } from "obsidian-e2e-toolkit";
import { fileURLToPath } from "url"
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HARNESS_PATH = path.join(__dirname, "fixtures/magical-editor-harness");
const MODES = ["virtual"] as const;

test.use({
  vaultOptions: {
    fresh: true,
    plugins: [
      {
        path: HARNESS_PATH,
        symlink: true,
      },
    ],
  },
});

declare global {
    interface Window {
      app: any;
    }
}

async function openHarnessView(obsidian: ObsidianAPI, page: any, mode: (typeof MODES)[number]) {
  await obsidian.waitReady();
  await obsidian.waitForPluginEnabled("magical-editor-harness");
  await obsidian.command(`magical-editor-harness:open-${mode}-view`);
  await obsidian.waitForView(`magical-editor-harness-${mode}-view`);

  const root = page.locator(`.magical-editor-harness-view.mode-${mode}`);
  const editor = root.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 10000 });
  return { root, editor };
}

async function openHarnessModal(obsidian: any, page: any, mode: (typeof MODES)[number]) {
  await obsidian.command(`magical-editor-harness:open-${mode}-modal`);

  const root = page.locator(`.magical-editor-harness-modal.mode-${mode}`);
  const editor = root.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 10000 });
  return { root, editor };
}

for (const mode of MODES) {
  test.describe(`${mode} editor`, () => {
    test("placeholder が表示される", async ({ obsidian }) => {
      const { root } = await openHarnessView(obsidian, obsidian.page, mode);
      const placeholder = root.locator(".magical-editor-placeholder");

      await expect(placeholder).toBeVisible();
      await expect(placeholder).toHaveText("Virtual placeholder");
    });

    test("Playwright fill でテキスト入力できる", async ({ obsidian }) => {
      const { editor } = await openHarnessView(obsidian, obsidian.page, mode);
      const typed = `${mode}-typed-text`;

      await editor.click();
      await editor.fill(typed);

      await expect(editor).toContainText(typed);

      const currentValue = await obsidian.page.evaluate(() => {
        return window.app.workspace.activeEditor?.editor?.getValue?.() ?? "";
      });
      expect(currentValue).toContain(typed);
    });

    test("editor:toggle-source が sourceMode を切り替える", async ({ obsidian }) => {
      const { editor } = await openHarnessView(obsidian, obsidian.page, mode);

      await editor.click();

      const before = await obsidian.page.evaluate(() => {
        return !!window.app.workspace.activeEditor?.editMode?.sourceMode;
      });

      await obsidian.command("editor:toggle-source");
      await obsidian.page.waitForTimeout(100);

      const after = await obsidian.page.evaluate(() => {
        return !!window.app.workspace.activeEditor?.editMode?.sourceMode;
      });

      expect(after).toBe(!before);
    });

    test("モーダルエディタでも Playwright type で入力できる", async ({ obsidian }) => {
      await obsidian.waitReady();
      await obsidian.waitForPluginEnabled("magical-editor-harness");

      const { editor } = await openHarnessModal(obsidian, obsidian.page, mode);
      const typed = `${mode}-modal-text`;

      await editor.click();
      await editor.fill(typed);

      await expect(editor).toContainText(typed);
    });
  });
}
