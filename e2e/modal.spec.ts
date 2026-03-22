import { expect, test } from "obsidian-e2e-toolkit";
import path from "node:path";

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

const PLUGIN_PATH = path.resolve("myfile/minimal-modal-opener");

test.use({
  vaultOptions: {
    fresh: true,
    plugins: [
      {
        path: PLUGIN_PATH,
      },
    ],
  },
});

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
async function setHostEditorContent(obsidian: any, content: string): Promise<void> {
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
  const modal = page.locator(".magical-editor-modal");
  try {
    await modal.first().isVisible({ timeout: 100 });
    return true;
  } catch {
    return false;
  }
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
  test("モーダルエディタが正常に開く", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-basic.md";
    const initialContent = "Initial content";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, page);

    // Verify host editor is still visible (not blanked)
    const hostVisible = await isHostEditorVisible(page);
    expect(hostVisible).toBe(true);
  });

  test("モーダルで初期コンテンツが表示される", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-initial.md";
    const initialContent = "File content from host";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, page);

    const modal = page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");
    await expect(modalEditor).toContainText(initialContent);
  });

  test("モーダルで fill を使ってテキスト入力できる", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-type.md";
    const initialContent = "Start";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, page);

    const modal = page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    // Click and append text
    await modalEditor.click();
    await page.keyboard.press("Control+End");
    await page.waitForTimeout(100);
    await modalEditor.type(" + Modal input");

    await expect(modalEditor).toContainText("Start + Modal input");
  });

  test("モーダル編集が onChange で ホストエディタに同期される", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-sync.md";
    const initialContent = "Original";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, page);

    const modal = page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    const appendedText = " synchronized";
    await modalEditor.click();
    await page.keyboard.press("Control+End");
    await page.waitForTimeout(100);
    await modalEditor.type(appendedText);

    // Wait for sync to occur with poll
    await expect.poll(
      () => getHostEditorContent(obsidian),
      { timeout: 5000 }
    ).toBe(initialContent + appendedText);
  });

  test("Escape キーでモーダルが閉じる", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-escape.md";
    await obsidian.save(testFilePath, "test");
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, page);

    // Verify modal is open
    await expect.poll(() => isModalVisible(page)).toBe(true);

    await closeModalWithEscape(page);

    // Wait and verify closed
    await expect.poll(
      () => isModalVisible(page),
      { timeout: 3000 }
    ).toBe(false);
  });

  test("モーダル編集後に Escape で閉じると、ホストエディタが復元される", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-restore.md";
    const initialContent = "Host content";

    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    // Verify host is visible before modal
    let visible = await isHostEditorVisible(page);
    expect(visible).toBe(true);

    await openMagicalModal(obsidian, page);

    const modal = page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    await modalEditor.click();
    await modalEditor.type(" + edited");

    await closeModalWithEscape(page);

    // Host should still be visible after close
    visible = await isHostEditorVisible(page);
    expect(visible).toBe(true);
  });

  test("コンテンツが vault ファイルに永続化される", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-persist.md";
    const originalContent = "Original";

    await obsidian.save(testFilePath, originalContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    await openMagicalModal(obsidian, page);

    const modal = page.locator(".magical-editor-modal");
    const modalEditor = modal.locator(".cm-content");

    const appendedText = " + persisted";
    await modalEditor.click();
    await page.keyboard.press("Control+End");
    await page.waitForTimeout(100);
    await modalEditor.type(appendedText);

    // Wait for onChange sync
    await expect.poll(
      () => getHostEditorContent(obsidian),
      { timeout: 5000 }
    ).toBe(originalContent + appendedText);

    await closeModalWithEscape(page);

    // Wait for vault save
    await page.waitForTimeout(500);

    // Verify file content was persisted
    const finalContent = await obsidian.read(testFilePath);
    expect(finalContent).toBe(originalContent + appendedText);
  });

  test("複数回 modal を開閉できる（no resource leak）", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    const testFilePath = "test-modal-reopen.md";

    await obsidian.save(testFilePath, "test");
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    for (let i = 0; i < 3; i++) {
      await openMagicalModal(obsidian, page);

      const modal = page.locator(".magical-editor-modal");
      const modalEditor = modal.locator(".cm-content");

      await modalEditor.click();
      await modalEditor.type(`iteration-${i}`);
      await page.waitForTimeout(100);

      await closeModalWithEscape(page);

      // Wait for cleanup
      await expect.poll(() => isModalVisible(page)).toBe(false);
      await page.waitForTimeout(200);
    }

    // Final state check: host should still be functional
    const hostVisible = await isHostEditorVisible(page);
    expect(hostVisible).toBe(true);
  });
});
