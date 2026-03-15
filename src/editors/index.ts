import { App, Editor, MarkdownView, ViewState, ViewStateResult, WorkspaceLeaf } from "obsidian";
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
  if (options.file) {
    // --- File mode ---
    const leafToMount = FileEditor.createFakeLeaf(sourceLeaf);
    await leafToMount.openFile(options.file);
    const impl = new FileEditor(leafToMount.view as MarkdownView);

    if (options.initialContent !== undefined) {
      impl.editor.setValue(options.initialContent);
    }

    return { impl, leafToMount };
  } else {
    // --- Virtual mode ---
    const leafToMount = VirtualEditor.createFakeLeaf(sourceLeaf);
    const view = createEmbeddableMarkdownEditor(
      app,
      leafToMount.containerEl,
      {
        value: options.initialContent ?? "",
        placeholder: options.placeholder,
        onChange: () => {
          options.onChange?.(getContent());
        },
        // onBlur: () => {
        //   // Reserved for future active-editor sync if needed
        // },
        onEscape: () => {
          options.onEscape?.();
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
export function createFakeLeaf(leaf: WorkspaceLeaf): WorkspaceLeaf {
  const fakeLeaf = Object.create(leaf);
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

  return fakeLeaf as WorkspaceLeaf;
}

export function createHiddenLeaf(app: App): WorkspaceLeaf {
  const leaf = app.workspace.getLeaf(true);
  leaf.containerEl.setCssStyles({display: "none"});
  return leaf;
}
