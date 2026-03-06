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
  fakeLeaf: WorkspaceLeaf,
  sourceLeaf: WorkspaceLeaf,
  options: MagicalEditorOptions,
  getContent: () => string,
): Promise<InternalEditor> {
  const sourceView = sourceLeaf.view as MarkdownView;
  const sourceEditor = sourceView.editor;

  if (options.file) {
    // --- File mode ---
    await fakeLeaf.openFile(options.file, { state: { mode: "source" } });

    const impl = new FileEditor(fakeLeaf.view as MarkdownView);

    if (options.initialContent !== undefined) {
      impl.editor.setValue(options.initialContent);
    }

    return impl;
  } else {
    // --- Virtual mode ---

    const view = createEmbeddableMarkdownEditor(
      app,
      fakeLeaf.containerEl,
      {
        value: options.initialContent ?? "",
        placeholder: options.placeholder,
        onChange: () => {
          options.onChange?.(getContent());
        },
        onBlur: () => {
          // Reserved for future active-editor sync if needed
        },
        parentScope: options.parentScope || (sourceLeaf.view as any)?.scope || app.scope,
      },
      fakeLeaf,
    );

    const impl = new VirtualEditor(view);
    return impl;
  }
}
