# Magical Editor E2E Tests

Comprehensive end-to-end test suite for Obsidian Magical Editor, using Playwright and the obsidian-e2e-toolkit.

## Overview

This directory contains test suites:

1. **`modal.spec.ts`** - Modal editor functional tests (primary focus)
2. **`magical-editor.spec.ts`** - Harness-based virtual editor tests
3. **`live-editor.spec.ts`** - External reference from MFDI project (documentation only)

### Why Three Test Files?

- **modal.spec.ts** is the **recommended production test** - directly tests the ModalEditor against minimal-modal-opener plugin
- **magical-editor.spec.ts** tests the harness plugin in virtual mode only
- **live-editor.spec.ts** demonstrates advanced patterns from the [mobile-first-daily-interface](https://github.com/tmg-publish/mobile-first-daily-interface) plugin, showing how to validate complex editor interactions

## Running Tests

### All tests
```bash
pnpm test:e2e
```

### Modal tests only (recommended)
```bash
pnpm playwright test e2e/modal.spec.ts
```

### Harness tests (virtual mode only)
```bash
pnpm playwright test e2e/magical-editor.spec.ts
```

### With UI (helpful for debugging)
```bash
pnpm playwright test e2e/modal.spec.ts --ui
```

### With headed browser
```bash
pnpm playwright test e2e/modal.spec.ts --headed
```

## modal.spec.ts - Detailed Walkthrough

### Architecture

The modal tests are designed with **helper functions** that mirror patterns from `live-editor.spec.ts`:

- **`getHostEditorContent(obsidian)`** - Fetch current host editor text via `page.evaluate()`
- **`setHostEditorContent(obsidian, text)`** - Programmatically set host editor for test setup
- **`getModalEditorContent(obsidian)`** - Fetch modal editor text
- **`isModalVisible(page)`** - Check if modal is currently shown
- **`isHostEditorVisible(page)`** - Verify host editor is not blanked
- **`openMagicalModal(obsidian, page)`** - Open the modal with proper wait
- **`closeModalWithEscape(page)`** - Close modal with keyboard

### Test Cases

#### 1. **モーダルエディタが正常に開く**
- Verifies modal appears without errors
- Checks host editor is still visible (critical for detecting blank-view regression)

#### 2. **モーダルで初期コンテンツが表示される**
- Opens a file with known content
- Confirms modal shows the same content
- Validates the editor initialization

#### 3. **モーダルで fill を使ってテキスト入力できる**
- Uses Playwright `fill()` / `type()` to add text in modal
- Verifies typing works as expected
- Simulates user keyboard interaction

#### 4. **モーダル編集が onChange で ホストエディタに同期される**
- Most critical test for editor behavior
- Types in modal and checks host editor updates
- Uses `expect.poll()` for async validation with retry
- **Detects:** onChange callback wiring, state synchronization bugs

#### 5. **Escape キーでモーダルが閉じる**
- Verifies keyboard-based modal dismissal
- Confirms clean shutdown

#### 6. **モーダル編集後に Escape で閉じると、ホストエディタが復元される**
- Checks host editor visibility before/after modal
- **Detects:** DOM tree corruption, CSS display issues

#### 7. **コンテンツが vault ファイルに永続化される**
- Full end-to-end: modal edit → sync → file save → disk verification
- Validates the entire data flow

#### 8. **複数回 modal を開閉できる（no resource leak）**
- Opens/closes modal 3 times with edits
- Verifies no memory leak or DOM corruption
- Final state check ensures host still works
- **Detects:** Cleanup bugs, dangling event listeners

## Key Design Patterns

### 1. Helper Functions
Each helper abstracts a common test operation:
```typescript
async function getHostEditorContent(obsidian: any): Promise<string> {
  return obsidian.page.evaluate(() => {
    const editor = (window as any).app.workspace.activeEditor?.editor;
    return editor?.getValue() ?? "";
  });
}
```

Benefits:
- DRY - reusable across tests
- Single point of change if API shifts
- Clear intent in test code

### 2. Poll Pattern
For async operations, use `expect.poll()` instead of fixed `waitForTimeout()`:
```typescript
await expect.poll(
  () => getHostEditorContent(obsidian),
  { timeout: 5000 }
).toBe(expectedContent);
```

This:
- **Retries** if the assertion fails partway through the timeout
- **Detects** timing issues early
- **Avoids** false passes from random delays

### 3. State Visibility Checks
Always validate that the UI hasn't regressed:
```typescript
const hostVisible = await isHostEditorVisible(page);
expect(hostVisible).toBe(true);  // Host should NOT be blanked
```

This specifically catches the regression where file modals blank the host view.

## Reference: live-editor.spec.ts

The file `live-editor.spec.ts` is included as documentation and reference only. It demonstrates:

1. **Advanced evaluation patterns** - complex state inspection via `page.evaluate()`
2. **Multicursor testing** - creating and verifying multiple selection ranges
3. **Scope isolation** - verifying hotkey scopes don't cross boundaries
4. **Persistence** - validating draft auto-save and recovery

These patterns are production-ready and can be adopted into `modal.spec.ts` if needed for future enhancements.

## Debugging Failed Tests

### Test fails with "Modal not found"
- Check minimal-modal-opener plugin is installed and working
- Run: `pnpm playwright test e2e/modal.spec.ts --ui` and visually inspect
- Verify the modal DOM matches expected selectors (`.magical-editor-modal`)

### Test fails with "Host editor blanked"
- Indicates MirrorEditor leaf lifecycle issue (the fix from Phase 3)
- Check that `createHiddenLeaf()` is being called, not `hostLeaf` reuse
- See `src/MirrorEditor.ts` for leaf management

### Text not syncing between modal and host
- Check `ModalEditor` is passing `onChange` callback correctly
- Verify host editor ref in constructor is correct
- Use `--headed` mode to see if onChange fires

### Resource leak (repeated open/close fails)
- Check that leaves are being properly detached in `destroy()`
- Verify DOM cleanup in `BaseEditor.destroy()`
- Check event listeners are being unbound

## CI/CD Integration

Tests run on every PR. Required:
- ✅ All tests pass
- ✅ No memory leaks (monitored via repeated open/close)
- ✅ No console errors from plugin

Run locally before pushing:
```bash
pnpm test:e2e
```

## Contributing New Tests

When adding a new test:

1. **Extract a helper** - if repeated, add to the helper section
2. **Use poll pattern** - for async operations, never use bare `waitForTimeout()`
3. **Document intent** - add a JSDoc comment explaining what the test validates
4. **Validate UI state** - check host visibility, no console errors
5. **Clean up** - ensure modal closes and host is restored

Example:
```typescript
test("新しい機能をテストする", async ({ obsidian, page }) => {
  // Setup
  const testFile = "test.md";
  await obsidian.save(testFile, "initial");
  await obsidian.open(testFile);

  // Action
  await openMagicalModal(obsidian, page);
  const modal = page.locator(".magical-editor-modal");
  const editor = modal.locator(".cm-content");
  await editor.type("something");

  // Assert
  await expect.poll(() => getHostEditorContent(obsidian)).toBe("initialsomething");

  // Cleanup
  await closeModalWithEscape(page);
  await expect.poll(() => isModalVisible(page)).toBe(false);
});
```

## Known Issues

### ℹ️ magical-editor.spec.ts scope
- `magical-editor.spec.ts` intentionally covers only virtual mode
- File-editor behavior is validated through `modal.spec.ts`

### ⚠️ modal.spec.ts - Resource cleanup
- If tests run 10+ times rapidly, occasional "focus lost" errors may occur
- Usually resolves with a fresh test run
- Monitor the resource leak test (#8) for regression

## Future Enhancements

1. **Add virtual editor tests** - test FakeEditor modal mode
2. **Add permission tests** - test readonly mode
3. **Add hotkey tests** - validate keyboard shortcuts
4. **Add visual regression tests** - screenshot comparison for CSS changes
5. **Add performance tests** - measure modal open/close latency

## See Also

- [Playwright Documentation](https://playwright.dev)
- [obsidian-e2e-toolkit API](../myfile/e2e-API.md)
- [MirrorEditor Implementation](../src/MirrorEditor.ts)
- [ModalEditor Implementation](../src/ModalEditor.ts)
