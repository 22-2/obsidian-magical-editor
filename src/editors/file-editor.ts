import {
    Editor,
    MarkdownView,
    TFile
} from "obsidian";
import { InternalEditor } from "./index";

export interface FileEditorOptions {
  file: TFile;
  initialContent?: string;
  onChange?: (content: string) => void;
  sourceEditor?: Editor;
}

/**
 * Internal helper that handles **file mode** for `MagicalEditor`.
 *
 * Opens a real `TFile` via `leaf.openFile()`, giving access to
 * CodeBlockProcessors and the full Obsidian rendering pipeline.
 * Saves are suppressed so the file is never auto-saved.
 */
export class FileEditor implements InternalEditor {
  constructor(public readonly view: MarkdownView) {
    this._suppressSaves();
  }

  get editor(): Editor {
    return this.view.editor;
  }

  private _suppressSaves(): void {
    this.view.save = async () => {};
    this.view.requestSave = async () => {};
    this.view.saveTitle = async () => {};
  }

  destroy(): void {
    // MarkdownView lifecycle is managed by the leaf; nothing to explicitly destroy here.
  }
}
