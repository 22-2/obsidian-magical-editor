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

export interface MagicalEditorWrapperOptions {
  /**
   * If provided, the editor opens this real file via `leaf.openFile()`.
   * This enables MarkdownCodeBlockProcessors and the full rendering pipeline.
   * When omitted, a virtual (in-memory) file is used instead.
   */
  file?: TFile;

  /**
   * Initial content to display in the editor.
   * - If `file` is set: overrides the on-disk file content shown in the editor.
   * - If `file` is not set: used as the starting content for the virtual editor.
   * Defaults to `""` when omitted.
   */
  initialContent?: string;

  /** Called every time the editor content changes. */
  onChange?: (content: string) => void;

  /**
   * If provided, the editor's initial cursor position will be copied
   * from this editor's current cursor.
   */
  sourceEditor?: Editor;

  /**
   * When `true` (default), automatically registers `_activeEditor` sync so that
   * `editorCallback` commands (duplicate-line, move-line, etc.) target this editor
   * whenever it is focused. Set to `false` only if you need to manage
   * `_activeEditor` manually (e.g., you host multiple editors and want fine-
   * grained control over which one is active).
   * @default true
   */
  syncActiveEditor?: boolean;
}

/**
 * Wraps an Obsidian MarkdownView inside a WorkspaceLeaf,
 * providing a clean API for embedding an editor into a Modal or ItemView.
 *
 * Supports two modes:
 * - **File mode** (`options.file` provided): Opens a real file via `leaf.openFile()`.
 *   This enables MarkdownCodeBlockProcessors and all Obsidian rendering features.
 * - **Virtual mode** (no `options.file`): Creates an in-memory editor with no
 *   physical file. Useful for scratch editors or editors not tied to vault files.
 *
 * Save operations are suppressed in both modes to prevent unintended vault writes.
 *
 * @example File mode
 * ```ts
 * const wrapper = await MagicalEditorWrapper.create(leaf, app, {
 *   file: tfile,
 *   initialContent: "override content",
 *   onChange: (content) => console.log(content),
 * });
 * containerEl.appendChild(wrapper.view.containerEl);
 * ```
 *
 * @example Virtual mode
 * ```ts
 * const wrapper = await MagicalEditorWrapper.create(leaf, app, {
 *   initialContent: "# Hello",
 *   onChange: (content) => console.log(content),
 * });
 * containerEl.appendChild(wrapper.view.containerEl);
 * ```
 */
export class MagicalEditorWrapper {
  /** The underlying MarkdownView. Use this to access the editor and containerEl. */
  public view!: MarkdownView;

  private onChangeRef: EventRef | null = null;
  private leaf: WorkspaceLeaf;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: any = null;

  private constructor(
    private readonly app: App,
    leaf: WorkspaceLeaf,
  ) {
    this.leaf = this.__createFakeLeaf(leaf);
  }

  /**
   * Creates and initializes a `MagicalEditorWrapper`.
   * Must be awaited before using the wrapper.
   */
  static async create(
    app: App,
    leaf: WorkspaceLeaf,
    options: MagicalEditorWrapperOptions = {},
  ): Promise<MagicalEditorWrapper> {
    const wrapper = new MagicalEditorWrapper(app, leaf);
    await wrapper._init(options);
    return wrapper;
  }

  private async _init(options: MagicalEditorWrapperOptions): Promise<void> {
    if (options.file) {
      // --- File mode ---
      // Let Obsidian create the MarkdownView via its own pipeline.
      // This activates CodeBlockProcessors, metadataCache, etc.
      invariant(this.leaf !== null, "Leaf must be provided for file mode");
      await this.leaf.openFile(options.file, { state: { mode: "source" } });
      this.view = this.leaf.view as MarkdownView;
    } else {
      // --- Virtual mode ---
      // Manually create a MarkdownView. No real file is involved.
      const view = new MarkdownView(this.leaf);
      this.leaf.view = view;
      this.view = view;

      // Attach a virtual stub file to prevent Obsidian from trying to sync
      view.file = {
        path: "magical-editor-virtual.md",
        name: "magical-editor-virtual.md",
        basename: "magical-editor-virtual",
        extension: "md",
        vault: this.app.vault,
        parent: null,
        stat: { ctime: 0, mtime: 0, size: 0 },
      } as never;

      // Preserve the original setViewData before nooping it
      const originalSetViewData = view.setViewData.bind(view);
      // @ts-expect-error – private alias
      view.__setViewData__ = originalSetViewData;
      view.setViewData = async () => {};

      // @ts-expect-error
      view.__setViewData__(options.initialContent ?? "", true);
    }

    this._suppressSaves();

    // Hide the view header (tab title bar) — not needed inside modals/panes
    this.view.headerEl?.setCssStyles?.({ visibility: "hidden" });
    this.view.editor.cm.contentDOM.setCssStyles({
      paddingTop: "var(--editor-padding-top)",
      paddingBottom: "var(--editor-padding-bottom)",
    });

    // If file mode + content override, replace the editor content
    if (options.file && options.initialContent !== undefined) {
      this.view.editor.setValue(options.initialContent);
    }

    // onChange listener via Obsidian's workspace event (reliable, not dropped on reinit)
    if (options.onChange) {
      this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
        if (editor === this.view.editor) {
          options.onChange!(this.view.editor.getValue());
        }
      });
    }

    // Restore cursor from a source editor
    if (options.sourceEditor) {
      setTimeout(() => {
        const cursor = options.sourceEditor!.getCursor();
        this.view.editor.setCursor(cursor);
      }, 0);
    }

    this.view.containerEl
      .find(".cm-sizer")
      .addEventListener("mousedown", (e: MouseEvent) => {
        const editor = this.view.editor;
        const pos = editor.posAtMouse?.(e);
        setTimeout(() => {
          if (pos) {
            editor.setCursor(pos);
            editor.setSelection?.(pos, pos);
          }
          editor.focus();
        });
      });

    // Automatically register _activeEditor sync unless explicitly disabled
    if (options.syncActiveEditor !== false) {
      this.enableActiveEditorSync();
    }
  }

  /** Returns the current content of the editor. */
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
   * Registers `_activeEditor` sync so that `editorCallback` commands
   * (duplicate-line, move-line, etc.) always target this editor while focused.
   *
   * Called automatically during initialization unless `syncActiveEditor: false`
   * is passed in the options. You can also call it manually if you need to
   * re-enable syncing after calling `destroy()`.
   *
   * - Saves the current `_activeEditor` and restores it on `destroy()`.
   * - Immediately sets `_activeEditor` to this view.
   * - Adds a `focusin` listener that re-sets it whenever the editor regains focus.
   */
  enableActiveEditorSync(): void {
    const ws = this.app.workspace as WorkspaceWithActiveEditor;
    this.prevActiveEditor = ws._activeEditor ?? null;

    const handler = () => {
      ws._activeEditor = this.view;
    };
    this.focusinHandler = handler;
    this.view.containerEl.addEventListener("focusin", handler);

    // Set immediately so commands work before the first focusin fires
    handler();
  }

  destroy(): void {
    if (this.onChangeRef) {
      this.app.workspace.offref(this.onChangeRef);
      this.onChangeRef = null;
    }

    if (this.focusinHandler) {
      this.view.containerEl.removeEventListener("focusin", this.focusinHandler);
      this.focusinHandler = null;
      // Restore the editor that was active before this wrapper took over
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

  private __createFakeLeaf(leaf: WorkspaceLeaf) {
    // --- The Magic ---
    // We create a "fake" leaf object to trick the MarkdownView constructor.
    // The goal is to make it render inside our `containerEl` instead of the
    // leaf's main container. This avoids modifying the real leaf,
    // preventing crashes and instability.
    const fakeLeaf = {
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
    return fakeLeaf;
  }
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
