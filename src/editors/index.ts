import { App, Editor, MarkdownView, WorkspaceLeaf } from "obsidian";
import { MagicalEditorOptions } from "../MagicalEditor";
import { FileEditor } from "./file-editor";
import { createEmbeddableMarkdownEditor, EmbeddableMarkdownEditor } from "./internal/magical-embeddable-editor";
import { VirtualEditor } from "./virtual-editor";

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
    const view = createEmbeddableMarkdownEditor(
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

let isToggleSourcePatched = false;

/**
 * Patches the core "editor:toggle-source" command to manually check for and toggle
 * Virtual editors (EmbeddableMarkdownEditor), which fail the internal `instanceof MarkdownView` type check.
 */
export function patchToggleSourceCommand(app: App) {
  if (isToggleSourcePatched) return;
  isToggleSourcePatched = true;

  const commands = (app as any).commands?.commands;
  if (!commands) return;

  const toggleSourceCmd = commands["editor:toggle-source"];
  if (!toggleSourceCmd || !toggleSourceCmd.checkCallback) return;

  const originalCheckCallback = toggleSourceCmd.checkCallback;

  toggleSourceCmd.checkCallback = (checking: boolean) => {
    const ws = app.workspace as any;
    const activeEditor = ws._activeEditor;

    // Intercept if the active editor is our Virtual Editor (v-markdown)
    if (activeEditor && typeof activeEditor.getViewType === "function" && activeEditor.getViewType() === "v-markdown") {
        if (!checking) {
            if (activeEditor.editMode && typeof activeEditor.editMode.toggleSource === "function") {
                activeEditor.editMode.toggleSource();
            }
        }
        return true;
    }

    // Default processing for File Editor and standard Obsidian views
    return originalCheckCallback.call(toggleSourceCmd, checking);
  };
}
