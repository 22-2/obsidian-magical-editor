import { around } from "monkey-around";
import {
  App,
  Editor,
  MarkdownView,
  Workspace,
  WorkspaceLeaf,
  type Command,
} from "obsidian";
import { EmbeddableMarkdownEditor } from "./internal/magical-embeddable-editor";

/**
 * Internal Obsidian types not exposed in the official API
 */
type InternalWorkspace = Workspace & {
  _activeEditor: MarkdownView | EmbeddableMarkdownEditor | null;
  rootSplit?: Workspace["rootSplit"];
  createLeafInParent?: (parent: unknown, index: number) => WorkspaceLeaf;
};

interface InternalApp extends App {
  commands: {
    commands: Record<string, Command>;
  };
}

export interface EditorImplementation {
  readonly view: MarkdownView | EmbeddableMarkdownEditor;
  readonly editor: Editor;
  destroy(): void;
}

/**
 * Creates a "fake" WorkspaceLeaf that inherits from a real one but is
 * isolated from the main workspace tree. Useful for embedding editors
 * in modals or separate DOM elements.
 */
export function createFakeLeaf(app: App): WorkspaceLeaf {
  const prototypeLeaf =
    app.workspace.getMostRecentLeaf() ??
    app.workspace.activeLeaf ??
    app.workspace.getLeaf(true);
  const fakeLeaf = Object.create(prototypeLeaf);
  fakeLeaf.containerEl = createDiv();
  fakeLeaf.__FAKE_LEAF__ = true;

  // Shadow the 'view' property to capture the new view instance
  let _view: MarkdownView | undefined = undefined;
  Object.defineProperty(fakeLeaf, "view", {
    get: () => _view,
    set: (v) => {
      _view = v;
    },
    enumerable: true,
    configurable: true,
  });

  fakeLeaf.setViewState = async function (state: any, result: any) {
    if (this.view && typeof this.view.setState === "function") {
      await this.view.setState(state, result || { history: false });
    }
  };

  return fakeLeaf as WorkspaceLeaf;
}

export function createHiddenLeaf(app: App): WorkspaceLeaf {
  const workspace = app.workspace as InternalWorkspace;
  const leaf = workspace.rootSplit
    ? workspace.createLeafInParent(workspace.rootSplit, 0)
    : app.workspace.getLeaf(true);
  // Identify embedded editors before openFile() runs other plugins' view hooks.
  leaf.containerEl.dataset.embeddedEditor = "true";
  leaf.containerEl.setCssStyles({ display: "none" });
  return leaf;
}

let toggleSourceUninstaller: (() => void) | null = null;
let patchRefCount = 0;

/**
 * Patches the core "editor:toggle-source" command to manually check for and toggle
 * fake editors (EmbeddableMarkdownEditor), which fail the internal `instanceof MarkdownView` type check.
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
      return function (this: Command, checking: boolean) {
        if (!originalCheckCallback) return false;

        const ws = app.workspace as InternalWorkspace;
        const activeEditor = ws._activeEditor;

        // Intercept if the active editor is our fake editor (v-markdown)
        if (
          activeEditor &&
          typeof activeEditor.getViewType === "function" &&
          activeEditor.getViewType() === "v-markdown" &&
          "editMode" in activeEditor
        ) {
          const fakeEditor = activeEditor as EmbeddableMarkdownEditor;
          if (!checking) {
            if (
              fakeEditor.editMode &&
              typeof fakeEditor.editMode.toggleSource === "function"
            ) {
              fakeEditor.editMode.toggleSource();
            }
          }
          return true;
        }

        // Default processing for File Editor and standard Obsidian views
        return originalCheckCallback.call(this, checking);
      };
    },
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
