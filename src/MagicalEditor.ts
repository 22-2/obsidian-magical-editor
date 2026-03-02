import {
  App,
  Editor,
  EventRef,
  MarkdownView,
  TFile,
  ViewState,
  ViewStateResult,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";

interface WorkspaceWithActiveEditor extends Workspace {
  _activeEditor: any;
}

export interface MagicalEditorOptions {
  /** Real file to open via `leaf.openFile()`. Enables CodeBlockProcessors and full rendering. Omit for virtual mode. */
  file?: TFile;

  /**
   * Initial editor content.
   * - File mode: overrides on-disk content.
   * - Virtual mode: starting content (defaults to `""`).
   */
  initialContent?: string;

  /** Called on every content change. */
  onChange?: (content: string) => void;

  /** If provided, copies cursor position from this editor on init. */
  sourceEditor?: Editor;
}

/**
 * Wraps an Obsidian MarkdownView inside a WorkspaceLeaf for embedding in a Modal or ItemView.
 *
 * - **File mode** (`options.file`): Opens a real file; enables CodeBlockProcessors and full rendering.
 * - **Virtual mode**: In-memory editor with no physical file.
 *
 * Saves are suppressed in both modes.
 */
export class MagicalEditor {
  public view!: MarkdownView;

  private onChangeRef: EventRef | null = null;
  private leaf: WorkspaceLeaf;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: any = null;

  private constructor(
    private readonly app: App,
    leaf: WorkspaceLeaf,
  ) {
    this.leaf = this._createFakeLeaf(leaf);
  }

  /** Creates and initializes a `MagicalEditor`. Must be awaited. */
  static async create(
    app: App,
    leaf: WorkspaceLeaf,
    options: MagicalEditorOptions = {},
  ): Promise<MagicalEditor> {
    const editor = new MagicalEditor(app, leaf);
    await editor._init(options);
    return editor;
  }

  private async _init(options: MagicalEditorOptions): Promise<void> {
    if (options.file) {
      invariant(this.leaf !== null, "Leaf must be provided for file mode");
      await this.leaf.openFile(options.file, { state: { mode: "source" } });
      this.view = this.leaf.view as MarkdownView;
    } else {
      this._initVirtualView(options.initialContent ?? "");
    }

    this._suppressSaves();
    this._applyStyles();

    if (options.file && options.initialContent !== undefined) {
      this.view.editor.setValue(options.initialContent);
    }

    if (options.onChange) {
      this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
        if (editor === this.view.editor) {
          options.onChange!(this.view.editor.getValue());
        }
      });
    }

    if (options.sourceEditor) {
      setTimeout(() => {
        this.view.editor.setCursor(options.sourceEditor!.getCursor());
      }, 0);
    }

    this._registerMousedownHandler();
    this.enableActiveEditorSync();
    window.setTimeout(() => this.view.editor.focus());
  }

  private _initVirtualView(initialContent: string): void {
    const view = new MarkdownView(this.leaf);
    this.leaf.view = view;
    this.view = view;

    // Attach a stub file to prevent Obsidian from trying to sync
    view.file = {
      path: "magical-editor-virtual.md",
      name: "magical-editor-virtual.md",
      basename: "magical-editor-virtual",
      extension: "md",
      vault: this.app.vault,
      parent: null,
      stat: { ctime: 0, mtime: 0, size: 0 },
    } as never;

    const originalSetViewData = view.setViewData.bind(view);
    // @ts-expect-error – private alias
    view.__setViewData__ = originalSetViewData;
    view.setViewData = async () => {};

    // @ts-expect-error
    view.__setViewData__(initialContent, true);
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
        const pos = editor.posAtMouse?.(e);
        setTimeout(() => {
          if (pos) editor.setSelection?.(pos, pos);
          editor.focus();
        });
      });
  }

  /** Returns the current editor content. */
  getContent(): string {
    return this.view.editor.getValue();
  }

  /** Replaces the editor content. */
  setContent(content: string): void {
    this.view.editor.setValue(content);
  }

  /** Focuses the editor. */
  focus(): void {
    this.view.editor.focus();
  }

  /**
   * Registers `_activeEditor` sync so `editorCallback` commands target this editor when focused.
   * Saves the previous `_activeEditor` and restores it on `destroy()`.
   */
  enableActiveEditorSync(): void {
    const ws = this.app.workspace as WorkspaceWithActiveEditor;
    this.prevActiveEditor = ws._activeEditor ?? null;

    const handler = () => { ws._activeEditor = this.view; };
    this.focusinHandler = handler;
    this.view.containerEl.addEventListener("focusin", handler);
    handler(); // Apply immediately before first focusin
  }

  destroy(): void {
    if (this.onChangeRef) {
      this.app.workspace.offref(this.onChangeRef);
      this.onChangeRef = null;
    }

    if (this.focusinHandler) {
      this.view.containerEl.removeEventListener("focusin", this.focusinHandler);
      this.focusinHandler = null;
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor =
        this.prevActiveEditor ?? null;
      this.prevActiveEditor = null;
    }
  }

  private _suppressSaves(): void {
    this.view.save = async () => {};
    this.view.requestSave = async () => {};
    this.view.saveTitle = async () => {};
  }

  /**
   * Creates a fake leaf that renders into a detached `div` instead of the real leaf's container.
   * Prevents crashes by not modifying the original leaf.
   */
  private _createFakeLeaf(leaf: WorkspaceLeaf): WorkspaceLeaf {
    return {
      ...leaf,
      containerEl: createEl("div"),
      setViewState: async (state: ViewState, result: ViewStateResult) => {
        if (state.type === "markdown") {
          state.type = leaf.view.getViewType() || "markdown";
        }
        leaf.setViewState(state, result || { history: false });
      },
      __FAKE_LEAF__: true,
    } as unknown as WorkspaceLeaf;
  }
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
