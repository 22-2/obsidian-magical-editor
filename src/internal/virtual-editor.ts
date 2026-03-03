import {
  App,
  Editor,
  WorkspaceLeaf,
} from "obsidian";
import {
  createEmbeddableMarkdownEditor,
  EmbeddableMarkdownEditor,
} from "./markdown-editor";

export interface VirtualEditorOptions {
  initialContent?: string;
  onChange?: (content: string) => void;
  sourceEditor?: Editor;
  placeholder?: string;
}

/**
 * Internal helper that handles **virtual mode** for `MagicalEditor`.
 *
 * Creates an in-memory `EmbeddableMarkdownEditor` with no physical file.
 */
export class VirtualEditor {
  public readonly view: EmbeddableMarkdownEditor;

  private constructor(view: EmbeddableMarkdownEditor) {
    this.view = view;
  }

  static create(
    app: App,
    leaf: WorkspaceLeaf,
    options: VirtualEditorOptions,
    getContent: () => string,
  ): VirtualEditor {
    const view = createEmbeddableMarkdownEditor(
      app,
      leaf.containerEl,
      {
        value: options.initialContent ?? "",
        placeholder: options.placeholder,
        onChange: () => {
          options.onChange?.(getContent());
        },
        onBlur: () => {
          // Reserved for future active-editor sync if needed
        },
      },
      leaf,
    );

    const instance = new VirtualEditor(view);

    instance._applyStyles();

    if (options.sourceEditor) {
      setTimeout(() => {
        view.editor.setCursor(options.sourceEditor!.getCursor());
      }, 0);
    }

    return instance;
  }

  get editor(): Editor {
    return this.view.editor;
  }

  private _applyStyles(): void {
    this.view.containerEl.setCssStyles({
      height: "100%",
      width: "100%",
      display: "flex",
      flexDirection: "column",
    });
    this.view.activeCM.contentDOM.setCssStyles({
      paddingTop: "var(--editor-padding-top)",
      paddingBottom: "var(--editor-padding-bottom)",
    });
  }

  destroy(): void {
    this.view.destroy();
  }
}
