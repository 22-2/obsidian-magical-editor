import {
  App,
  Editor,
  MarkdownView,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

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
export class FileEditor {
  public readonly view: MarkdownView;

  private constructor(
    private readonly app: App,
    private readonly leaf: WorkspaceLeaf,
    view: MarkdownView,
  ) {
    this.view = view;
  }

  static async create(
    app: App,
    leaf: WorkspaceLeaf,
    options: FileEditorOptions,
  ): Promise<FileEditor> {
    await leaf.openFile(options.file, { state: { mode: "source" } });
    const view = leaf.view as MarkdownView;

    const instance = new FileEditor(app, leaf, view);
    instance._suppressSaves();
    instance._applyStyles();

    if (options.initialContent !== undefined) {
      view.editor.setValue(options.initialContent);
    }

    if (options.onChange) {
      // onChange is wired by MagicalEditor via workspace event (needs EventRef lifecycle)
      // so we expose it here for MagicalEditor to register.
    }

    if (options.sourceEditor) {
      setTimeout(() => {
        view.editor.setCursor(options.sourceEditor!.getCursor());
      }, 0);
    }

    instance._registerMousedownHandler();
    return instance;
  }

  get editor(): Editor {
    return this.view.editor;
  }

  private _suppressSaves(): void {
    this.view.save = async () => {};
    this.view.requestSave = async () => {};
    this.view.saveTitle = async () => {};
  }

  private _applyStyles(): void {
    this.view.headerEl?.setCssStyles?.({ visibility: "hidden" });
    this.view.editor.cm.contentDOM.setCssStyles({
      paddingTop: "var(--editor-padding-top)",
      paddingBottom: "var(--editor-padding-bottom)",
    });
  }

  private _registerMousedownHandler(): void {
    this.view.containerEl
      .find(".cm-sizer")
      .addEventListener("mousedown", (e: MouseEvent) => {
        const editor = this.view.editor;
        const pos = editor.posAtMouse(e);
        setTimeout(() => {
          if (pos) editor.setSelection(pos, pos);
          editor.focus();
        });
      });
  }

  destroy(): void {
    // MarkdownView lifecycle is managed by the leaf; nothing to explicitly destroy here.
  }
}
