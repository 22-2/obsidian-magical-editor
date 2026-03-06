import {
    Editor,
    Scope,
    WorkspaceLeaf
} from "obsidian";
import { createFakeLeaf, InternalEditor } from "./index";
import {
    EmbeddableMarkdownEditor
} from "./internal/magical-embeddable-editor";

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
export class VirtualEditor implements InternalEditor {
  constructor(public readonly view: EmbeddableMarkdownEditor) {
    this._applyStyles();
  }

  static createFakeLeaf(leaf: WorkspaceLeaf): WorkspaceLeaf {
    return createFakeLeaf(leaf);
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
