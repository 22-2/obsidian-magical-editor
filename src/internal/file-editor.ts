import {
    App,
    Editor,
    MarkdownView,
    TFile,
    WorkspaceLeaf
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
  private constructor(
    public readonly leaf: WorkspaceLeaf,
    public readonly view: MarkdownView
  ) {}

  static async create(
    app: App,
    options: FileEditorOptions,
  ): Promise<FileEditor> {
    // Create a real leaf in a hidden part of the workspace
    const leaf = app.workspace.createLeafInParent(
      app.workspace.rootSplit,
      0
    );

    // Initial setup for the leaf's container
    leaf.containerEl.setCssStyles({
      display: "block",
      flex: "1 1 0",
      minHeight: "0",
    });

    await leaf.openFile(options.file, { state: { mode: "source" } });
    const view = leaf.view as MarkdownView;

    const instance = new FileEditor(leaf, view);
    instance._suppressSaves();
    instance._applyStyles();

    if (options.initialContent !== undefined) {
      view.editor.setValue(options.initialContent);
    }

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

  destroy(): void {
    // Detach the leaf when we're done
    this.leaf.detach();
  }
}
