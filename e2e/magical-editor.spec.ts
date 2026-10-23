
import path from "node:path";
import { expect, ObsidianAPI, test } from "obsidian-e2e-toolkit";
import { fileURLToPath } from "url";
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

async function openHarnessModal(obsidian: any, page: any, mode: "file" | "virtual") {
  await obsidian.command(`magical-editor-harness:open-${mode}-modal`);

  const root = page.locator(`.magical-editor-harness-modal.mode-${mode}`);
  const editor = root.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 10000 });
  return { root, editor };
}

for (const mode of ["file", "virtual"] as const) {
  test(`${mode} modal: placeholder 表示中も入力・再設定・モード切替できる`, async ({ obsidian }) => {
    await obsidian.waitReady();
    await obsidian.waitForPluginEnabled("magical-editor-harness");
    const { root, editor } = await openHarnessModal(obsidian, obsidian.page, mode);
    const hint = root.locator(".cm-placeholder .magical-editor-placeholder");
    await expect(hint).toBeVisible();

    // Exercise keyboard input while the widget exists; fill() replaces contenteditable DOM
    // and would miss regressions in cursor placement and CodeMirror's input handling.
    await editor.click();
    await editor.pressSequentially("typed with placeholder");
    await expect(editor).toContainText("typed with placeholder");
    await expect(hint).toHaveCount(0);
    await editor.press("ControlOrMeta+a");
    await editor.press("Backspace");
    await expect(hint).toBeVisible();

    await obsidian.page.evaluate(() => {
      const wrapper = window.app.plugins.plugins["magical-editor-harness"].activeModal.editor;
      wrapper.setPlaceholder("Updated hint", "Read-only hint");
      window.app.workspace.updateOptions();
    });
    await expect(hint).toHaveText("Updated hint");

    await obsidian.command("editor:toggle-source");
    await expect(hint).toHaveText("Updated hint");
    const offset = await obsidian.page.evaluate(() => {
      const wrapper = window.app.plugins.plugins["magical-editor-harness"].activeModal.editor;
      const cm = wrapper.editor.cm;
      const caret = cm.coordsAtPos(0);
      const rect = cm.dom.querySelector(".magical-editor-placeholder").getBoundingClientRect();
      return { x: Math.abs(rect.left - caret.left), y: Math.abs(rect.top - caret.top) };
    });
    expect(offset.x).toBeLessThan(2);
    expect(offset.y).toBeLessThan(2);

    await obsidian.page.evaluate(() => {
      window.app.plugins.plugins["magical-editor-harness"].activeModal.editor.setReadOnly(true);
      window.app.workspace.updateOptions();
    });
    await expect(hint).toHaveText("Read-only hint");
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await editor.pressSequentially("blocked");
    await expect(hint).toBeVisible();

    await obsidian.page.evaluate(() => {
      window.app.plugins.plugins["magical-editor-harness"].activeModal.editor.setReadOnly(false);
    });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.click();
    await editor.pressSequentially("editable again");
    await expect(editor).toContainText("editable again");
    await expect(hint).toHaveCount(0);
  });
}

test("read-only editor: テキストを選択でき、編集モードに戻すと入力できる", async ({ obsidian }) => {
  await obsidian.waitReady();
  await obsidian.waitForPluginEnabled("magical-editor-harness");
  const { editor } = await openHarnessModal(obsidian, obsidian.page, "virtual");

  await obsidian.page.evaluate(() => {
    const wrapper = window.app.plugins.plugins["magical-editor-harness"].activeModal.editor;
    wrapper.setContent("first line\nselectable line\nlast line");
    wrapper.setReadOnly(true);
  });
  await expect(editor).toHaveAttribute("contenteditable", "false");

  // Obsidian disables text selection (user-select: none) outside contenteditable="true",
  // so a read-only editor must opt back in or the text cannot be selected or copied.
  await editor.locator(".cm-line", { hasText: "selectable line" }).click({ clickCount: 3 });
  const selected = await obsidian.page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toContain("selectable line");

  // Still read-only: typing must not change the document.
  await editor.press("Backspace");
  await expect(editor).toContainText("selectable line");

  await obsidian.page.evaluate(() => {
    window.app.plugins.plugins["magical-editor-harness"].activeModal.editor.setReadOnly(false);
  });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await editor.pressSequentially("typed");
  await expect(editor).toContainText("typed");
});

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
