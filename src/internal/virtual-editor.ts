import {
    App,
    Editor,
    Scope,
    WorkspaceLeaf
} from "obsidian";
import {
    createEmbeddableMarkdownEditor,
    EmbeddableMarkdownEditor
} from "./markdown-editor";

export interface VirtualEditorOptions {
  initialContent?: string;
  onChange?: (content: string) => void;
  sourceEditor?: Editor;
  placeholder?: string;
  parentScope?: Scope;
}

/**
 * Internal helper that handles **virtual mode** for `MagicalEditor`.
 *
 * Creates an in-memory `EmbeddableMarkdownEditor` with no physical file.
 */
export class VirtualEditor {
  constructor(public readonly view: EmbeddableMarkdownEditor) {
    this._applyStyles();
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
    if (this.view.activeCM?.contentDOM) {
      this.view.activeCM.contentDOM.setCssStyles({
        paddingTop: "var(--editor-padding-top)",
        paddingBottom: "var(--editor-padding-bottom)",
      });
    }
  }

  destroy(): void {
    this.view.destroy();
  }
}
