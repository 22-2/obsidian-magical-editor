import { App, Command, Editor, MarkdownView, Workspace, WorkspaceLeaf } from "obsidian";
import { around } from "monkey-around";
import { MagicalEditorOptions } from "../MagicalEditor";
import { FileEditor } from "./file-editor";
import { createEmbeddableMarkdownEditor, EmbeddableMarkdownEditor } from "./internal/magical-embeddable-editor";
import { VirtualEditor } from "./virtual-editor";

/**
 * Internal Obsidian types not exposed in the official API
 */
interface InternalWorkspace extends Workspace {
  _activeEditor: MarkdownView | EmbeddableMarkdownEditor | null;
}

interface InternalApp extends App {
  commands: {
    commands: Record<string, Command>;
  };
}

/**
 * Common interface for internal editor implementations (File vs Virtual).
 */
export interface InternalEditor {
  readonly view: MarkdownView | EmbeddableMarkdownEditor;
  readonly editor: Editor;
  destroy(): void;
}

/**
 * Factory for creating the appropriate InternalEditor based on options.
 */
export async function createInternalEditor(
  app: App,
  sourceLeaf: WorkspaceLeaf,
  options: MagicalEditorOptions,
  getContent: () => string,
): Promise<{ impl: InternalEditor; leafToMount: WorkspaceLeaf }> {
  patchToggleSourceCommand(app);
  if (options.file) {
    // --- File mode ---
    const leafToMount = FileEditor.createFakeLeaf(app);
    await leafToMount.openFile(options.file);
    const impl = new FileEditor(leafToMount.view as MarkdownView);

    if (options.initialContent !== undefined) {
      impl.editor.setValue(options.initialContent);
    }

    return { impl, leafToMount };
  } else {
    // --- Virtual mode ---
    const leafToMount = VirtualEditor.createFakeLeaf(app);
    const view = await createEmbeddableMarkdownEditor(
      app,
      leafToMount.containerEl,
      {
        ...options,
        value: options.initialContent ?? "",
        onChange: () => {
          options.onChange?.(getContent());
        },
        onEnter: (editor, mod, shift) => {
          return options.onEnter?.(editor, mod, shift) ?? false;
        },
        parentScope: options.parentScope || (sourceLeaf.view as MarkdownView)?.scope || app.scope,
      },
      leafToMount,
    );

    const impl = new VirtualEditor(view);
    return { impl, leafToMount };
  }
}

/**
 * Creates a "fake" WorkspaceLeaf that inherits from a real one but is
 * isolated from the main workspace tree. Useful for embedding editors
 * in modals or separate DOM elements.
 */
export function createFakeLeaf(app: App): WorkspaceLeaf {
  const fakeLeaf = Object.create(app.workspace.getMostRecentLeaf());
  fakeLeaf.containerEl = createDiv();
  fakeLeaf.__FAKE_LEAF__ = true;

  // Shadow the 'view' property to capture the new view instance
  let _view: MarkdownView | undefined = undefined;
  Object.defineProperty(fakeLeaf, "view", {
    get: () => _view,
    set: (v) => { _view = v; },
    enumerable: true,
    configurable: true,
  });

  fakeLeaf.setViewState = async function(state: any, result: any) {
    if (this.view && typeof this.view.setState === "function") {
      await this.view.setState(state, result || { history: false });
    }
  };

  return fakeLeaf as WorkspaceLeaf;
}

export function createHiddenLeaf(app: App): WorkspaceLeaf {
  const leaf = app.workspace.getLeaf(true);
  leaf.containerEl.setCssStyles({display: "none"});
  return leaf;
}

let toggleSourceUninstaller: (() => void) | null = null;
let patchRefCount = 0;

/**
 * Patches the core "editor:toggle-source" command to manually check for and toggle
 * Virtual editors (EmbeddableMarkdownEditor), which fail the internal `instanceof MarkdownView` type check.
 *
 * Uses reference counting so it's only patched once and unpatched when the last editor is destroyed.
 */
export function patchToggleSourceCommand(app: App): void {
  patchRefCount++;
  if (toggleSourceUninstaller) return;

  const commands = (app as InternalApp).commands?.commands;
  if (!commands) return;

  const toggleSourceCmd = commands["editor:toggle-source"];
  if (!toggleSourceCmd || !toggleSourceCmd.checkCallback) return;

  toggleSourceUninstaller = around(toggleSourceCmd, {
    checkCallback: (originalCheckCallback) => {
      return function(this: Command, checking: boolean) {
        if (!originalCheckCallback) return false;

        const ws = app.workspace as InternalWorkspace;
        const activeEditor = ws._activeEditor;

        // Intercept if the active editor is our Virtual Editor (v-markdown)
        if (
          activeEditor &&
          typeof activeEditor.getViewType === "function" &&
          activeEditor.getViewType() === "v-markdown" &&
          "editMode" in activeEditor
        ) {
          const virtualEditor = activeEditor as EmbeddableMarkdownEditor;
          if (!checking) {
            if (virtualEditor.editMode && typeof virtualEditor.editMode.toggleSource === "function") {
              virtualEditor.editMode.toggleSource();
            }
          }
          return true;
        }

        // Default processing for File Editor and standard Obsidian views
        return originalCheckCallback.call(this, checking);
      };
    }
  });
}

/**
 * Unpatches the "editor:toggle-source" command if it was previously patched and refcount reaches zero.
 */
export function unpatchToggleSourceCommand(force: boolean = false): void {
  if (force) {
    patchRefCount = 0;
  } else if (patchRefCount > 0) {
    patchRefCount--;
  }

  if (patchRefCount === 0 && toggleSourceUninstaller) {
    toggleSourceUninstaller();
    toggleSourceUninstaller = null;
  }
}
