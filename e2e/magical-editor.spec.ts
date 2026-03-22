import path from "node:path";
import { expect, test } from "obsidian-e2e-toolkit";

const HARNESS_PATH = path.resolve("e2e/fixtures/magical-editor-harness");
const MODES = ["file", "virtual"] as const;

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

async function openHarnessView(obsidian: any, page: any, mode: (typeof MODES)[number]) {
  await obsidian.waitReady();
  await obsidian.waitForPluginEnabled("magical-editor-harness");
  await obsidian.command(`magical-editor-harness:open-${mode}-view`);
  await obsidian.waitForViewType(`magical-editor-harness-${mode}-view`);

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
    test("placeholder が表示される", async ({ obsidian, page }) => {
      const { root } = await openHarnessView(obsidian, page, mode);
      const placeholder = root.locator(".magical-editor-placeholder");

      await expect(placeholder).toBeVisible();
      await expect(placeholder).toHaveText(
        mode === "file" ? "File placeholder" : "Virtual placeholder",
      );
    });

    test("Playwright type でテキスト入力できる", async ({ obsidian, page }) => {
      const { editor } = await openHarnessView(obsidian, page, mode);
      const typed = `${mode}-typed-text`;

      await editor.click();
      await editor.type(typed);

      await expect(editor).toContainText(typed);

      const currentValue = await page.evaluate(() => {
        return window.app.workspace.activeEditor?.editor?.getValue?.() ?? "";
      });
      expect(currentValue).toContain(typed);
    });

    test("editor:toggle-source が sourceMode を切り替える", async ({ obsidian, page }) => {
      const { editor } = await openHarnessView(obsidian, page, mode);

      await editor.click();

      const before = await page.evaluate(() => {
        return !!window.app.workspace.activeEditor?.editMode?.sourceMode;
      });

      await obsidian.command("editor:toggle-source");
      await page.waitForTimeout(100);

      const after = await page.evaluate(() => {
        return !!window.app.workspace.activeEditor?.editMode?.sourceMode;
      });

      expect(after).toBe(!before);
    });

    test("モーダルエディタでも Playwright type で入力できる", async ({ obsidian, page }) => {
      await obsidian.waitReady();
      await obsidian.waitForPluginEnabled("magical-editor-harness");

      const { editor } = await openHarnessModal(obsidian, page, mode);
      const typed = `${mode}-modal-text`;

      await editor.click();
      await editor.type(typed);

      await expect(editor).toContainText(typed);
    });
  });
}
