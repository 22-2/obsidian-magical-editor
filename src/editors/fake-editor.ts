import { Editor } from "obsidian";
import { EditorImplementation } from "./index";
import { EmbeddableMarkdownEditor } from "./internal/magical-embeddable-editor";

export class FakeEditorAdapter implements EditorImplementation {
  constructor(public readonly view: EmbeddableMarkdownEditor) {
    this.applyStyles();
  }

  get editor(): Editor {
    return this.view.editor;
  }

  destroy(): void {
    this.view.destroy();
  }

  private applyStyles(): void {
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
}
