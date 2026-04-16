import { Editor, MarkdownView } from "obsidian";
import { EditorImplementation } from "./index";

export class MirrorEditorAdapter implements EditorImplementation {
  constructor(public readonly view: MarkdownView) {
    this.suppressSaves();
    this.view.headerEl.setCssStyles({ visibility: "hidden" });
    this.view.leaf.containerEl.setCssStyles({ height: "100%" });
  }

  get editor(): Editor {
    return this.view.editor;
  }

  destroy(): void {}

  private suppressSaves(): void {
    this.view.save = async () => {};
    this.view.requestSave = async () => {};
    this.view.saveTitle = async () => {};
  }
}
