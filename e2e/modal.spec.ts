import { expect, test } from "obsidian-e2e-toolkit";
import path from "node:path";
import { App } from "obsidian"

const PLUGIN_PATH = path.resolve("myfile/minimal-modal-opener");

test.use({
  vaultOptions: {
    plugins: [
      {
        path: PLUGIN_PATH,
      },
    ],
  },
});

test.describe("Magical Editor E2E with minimal-modal-opener", () => {
  test("Open modal and edit content", async ({ obsidian, page }) => {
    await obsidian.waitReady();

    // 1. Create a dummy file and open it
    const testFilePath = "test-file.md";
    const initialContent = "Original Content";
    await obsidian.save(testFilePath, initialContent);
    await obsidian.open(testFilePath);
    await obsidian.waitReady();

    // Ensure the file is open and content is correct
    await obsidian.expectContent(initialContent);

    // 2. Open the modal via command
    // minimal-modal-opener registers "open-magical-modal"
    await obsidian.command("minimal-modal-opener:open-magical-modal");

    // 3. Wait for the modal to appear
    const modal = obsidian.page.locator(".magical-editor-modal-content");
    await expect(modal).toBeVisible();

    // 4. Verify the editor inside the modal has the correct initial content
    // MagicalEditor uses .cm-content for the editor
    const modalEditor = modal.locator(".cm-content");
    await expect(modalEditor).toContainText(initialContent);

    // 5. Edit content in the modal
    const addedText = "\nAdded from Modal";
    await modalEditor.click();
    await obsidian.page.keyboard.press("Control+End");
    await obsidian.page.waitForTimeout(100);
    await obsidian.page.keyboard.type(addedText);

    // 6. Verify that the change is synced to the host editor (onChange)
    const value = await obsidian.page.evaluate(() => (window as any).app.workspace.activeEditor?.editor?.getValue());
    expect(value).toBe(initialContent + addedText);

    // 7. Close the modal
    await obsidian.page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();

    await obsidian.page.waitForTimeout(3000)
    // 8. Final verification of the vault file
    const finalContent = await obsidian.read(testFilePath);
    expect(finalContent).toBe(initialContent + addedText);
  });
});
