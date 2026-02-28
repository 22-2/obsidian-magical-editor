import {
  App,
  Editor,
  EventRef,
  MarkdownView,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

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

  private constructor(
    private readonly leaf: WorkspaceLeaf,
    private readonly app: App
  ) {}

  /**
   * Creates and initializes a `MagicalEditorWrapper`.
   * Must be awaited before using the wrapper.
   */
  static async create(
    leaf: WorkspaceLeaf,
    app: App,
    options: MagicalEditorWrapperOptions = {}
  ): Promise<MagicalEditorWrapper> {
    const wrapper = new MagicalEditorWrapper(leaf, app);
    await wrapper._init(options);
    return wrapper;
  }

  private async _init(options: MagicalEditorWrapperOptions): Promise<void> {
    if (options.file) {
      // --- File mode ---
      // Let Obsidian create the MarkdownView via its own pipeline.
      // This activates CodeBlockProcessors, metadataCache, etc.
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
      paddingBottom: "var(--editor-padding-bottom)"
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
   * Cleans up event listeners.
   * Call this when the host component (Modal, ItemView, etc.) is being destroyed.
   * Note: does NOT detach the leaf — the host is responsible for that.
   */
  destroy(): void {
    if (this.onChangeRef) {
      this.app.workspace.offref(this.onChangeRef);
      this.onChangeRef = null;
    }
  }

  private _suppressSaves(): void {
    this.view.save = async () => {};
    this.view.requestSave = async () => {};
    this.view.saveTitle = async () => {};
  }
}
