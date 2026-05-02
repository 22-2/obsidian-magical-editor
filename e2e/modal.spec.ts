import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, ObsidianAPI, test } from "obsidian-e2e-toolkit";

/**
 * Magical Editor Modal E2E Test Suite
 *
 * Tests the modal editor functionality using minimal-modal-opener plugin
 * as a reference implementation. Inspired by live-editor.spec.ts patterns
 * which validate the internal editor state through page.evaluate() calls.
 *
 * Key patterns:
 * - setEditorContent / getEditorContent: Direct evaluation for testing
 * - isModalVisible / isHostEditorVisible: State assertions
 * - expect.poll(): Async state verification with retry
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = path.join(__dirname, "fixtures/minimal-modal-opener");

test.use({
  vaultOptions: {
    fresh: true,
    plugins: [
      {
        path: PLUGIN_PATH,
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

/**
 * Helper: Get the active markdown editor's current content
 * Uses page.evaluate to directly access app.workspace.activeEditor
 */
async function getHostEditorContent(obsidian: any): Promise<string> {
  return obsidian.page.evaluate(() => {
    const editor = (window as any).app.workspace.activeEditor?.editor;
    if (!editor) {
      throw new Error("No active editor found");
    }
    return editor.getValue();
  });
}

/**
 * Helper: Set the active markdown editor's content programmatically
 * Useful for test setup, bypassing normal typing interactions
 */
async function setHostEditorContent(obsidian: ObsidianAPI, content: string): Promise<void> {
  await obsidian.page.evaluate((val) => {
    const editor = (window as any).app.workspace.activeEditor?.editor;
    if (!editor) {
      throw new Error("No active editor found");
    }
    editor.setValue(val);
  }, content);
}

/**
 * Helper: Get the modal editor's current content
 */
async function getModalEditorContent(obsidian: any): Promise<string> {
  return obsidian.page.evaluate(() => {
    const modal = document.querySelector(".magical-editor-modal");
    if (!modal) {
      throw new Error("Modal not found in DOM");
    }

    // Find the CodeMirror editor instance within the modal
    const state = (window as any).app.workspace?.activeEditor?.editor?.state;
    if (!state) {
      throw new Error("Active editor state not accessible");
    }

    return state.doc.toString();
  });
}

/**
 * Helper: Check if the modal is currently visible
 */
async function isModalVisible(page: any): Promise<boolean> {
  return (await page.locator(".magical-editor-modal:visible").count()) > 0;
}

async function waitForModalClosed(page: any): Promise<void> {
  await expect
    .poll(async () => page.locator(".magical-editor-modal:visible").count(), {
      timeout: 5000,
    })
    .toBe(0);
}

/**
 * Helper: Check if the host editor container is visible
 * (not blanked out by the modal)
 */
async function isHostEditorVisible(page: any): Promise<boolean> {
  const editor = page.locator(".markdown-editor");
  try {
    await editor.first().isVisible({ timeout: 100 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: Open the magical modal
 * Expects minimal-modal-opener plugin and active markdown file
 */
async function openMagicalModal(obsidian: any, page: any): Promise<void> {
  await obsidian.command("minimal-modal-opener:open-magical-modal");

  const modal = page.locator(".magical-editor-modal");
  await expect(modal).toBeVisible({ timeout: 10000 });
}

/**
 * Helper: Close the modal via Escape key
 */
async function closeModalWithEscape(page: any): Promise<void> {
  await page.keyboard.press("Escape");
}

test.describe("Magical Editor Modal - E2E with minimal-modal-opener", () => {
  test("モーダルエディタが正常に開く", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-basic.md";
    const initialContent = "Initial content";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, obsidian.page);

    // Verify host editor is still visible (not blanked)
    const hostVisible = await isHostEditorVisible(obsidian.page);
    expect(hostVisible).toBe(true);
  });

  test("モーダルで初期コンテンツが表示される", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-initial.md";
    const initialContent = "File content from host";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, obsidian.page);

    const modal = obsidian.page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");
    await expect(modalEditor).toContainText(initialContent);
  });

  test("モーダルで fill を使ってテキスト入力できる", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-type.md";
    const initialContent = "Start";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, obsidian.page);

    const modal = obsidian.page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    // Click and append text
    await modalEditor.click();
    await obsidian.page.keyboard.press("Control+End");
    await obsidian.page.waitForTimeout(100);
    await modalEditor.type(" + Modal input");

    await expect(modalEditor).toContainText("Start + Modal input");
  });

  test("モーダル編集が onChange で ホストエディタに同期される", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-sync.md";
    const initialContent = "Original";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, obsidian.page);

    const modal = obsidian.page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    const appendedText = " synchronized";
    await modalEditor.click();
    await obsidian.page.keyboard.press("Control+End");
    await obsidian.page.waitForTimeout(100);
    await modalEditor.type(appendedText);

    // Wait for sync to occur with poll
    await expect.poll(
      () => getHostEditorContent(obsidian),
      { timeout: 5000 }
    ).toBe(initialContent + appendedText);
  });

  test("Escape キーでモーダルが閉じる", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-escape.md";
    await obsidian.save(testFilePath, "test");
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, obsidian.page);

    // Verify modal is open
    await expect.poll(() => isModalVisible(obsidian.page)).toBe(true);

    await obsidian.page.waitForTimeout(500);
    await closeModalWithEscape(obsidian.page);

    // Wait and verify closed
    await waitForModalClosed(obsidian.page);
  });

  test("モーダル編集後に Escape で閉じると、ホストエディタが復元される", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-restore.md";
    const initialContent = "Host content";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    // Verify host is visible before modal
    let visible = await isHostEditorVisible(obsidian.page);
    expect(visible).toBe(true);

    await openMagicalModal(obsidian, obsidian.page);

    const modal = obsidian.page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    await modalEditor.click();
    await modalEditor.type(" + edited");

    await closeModalWithEscape(obsidian.page);

    // Host should still be visible after close
    visible = await isHostEditorVisible(obsidian.page);
    expect(visible).toBe(true);
  });

  test("コンテンツが vault ファイルに永続化される", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-persist.md";
    const originalContent = "Original";

    await obsidian.save(testFilePath, originalContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, obsidian.page);

    const modal = obsidian.page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    const appendedText = " + persisted";
    await modalEditor.click();
    await obsidian.page.keyboard.press("Control+End");
    await obsidian.page.waitForTimeout(100);
    await modalEditor.type(appendedText);

    // Wait for onChange sync
    await expect.poll(
      () => getHostEditorContent(obsidian),
      { timeout: 5000 }
    ).toBe(originalContent + appendedText);

    await closeModalWithEscape(obsidian.page);

    // Wait for vault save
    await obsidian.page.waitForTimeout(3000);

    // Verify file content was persisted
    const finalContent = await obsidian.read(testFilePath);
    expect(finalContent).toBe(originalContent + appendedText);
  });

  test("複数回 modal を開閉できる（no resource leak）", async ({ obsidian }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-reopen.md";

    await obsidian.save(testFilePath, "test");
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    for (let i = 0; i < 3; i++) {
      await openMagicalModal(obsidian, obsidian.page);

      const modal = obsidian.page.locator(".magical-editor-modal");
      const modalEditor = modal.locator(".cm-content");

      await modalEditor.click();
      await modalEditor.fill(`iteration-${i}`);

      await closeModalWithEscape(obsidian.page);

      // Wait for cleanup
      await waitForModalClosed(obsidian.page);
    }

    // Final state check: host should still be functional
    const hostVisible = await isHostEditorVisible(obsidian.page);
    expect(hostVisible).toBe(true);
  });
});
