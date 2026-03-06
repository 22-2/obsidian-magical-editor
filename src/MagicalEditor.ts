import {
    App,
    Editor,
    EventRef,
    MarkdownView,
    Scope,
    TFile,
    Workspace,
    WorkspaceLeaf
} from "obsidian";
import { createInternalEditor, InternalEditor } from "./editors";
import { EmbeddableMarkdownEditor } from "./editors/internal/magical-embeddable-editor";

interface WorkspaceWithActiveEditor extends Workspace {
  _activeEditor: MarkdownView | EmbeddableMarkdownEditor | null;
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

  /** Custom placeholder for the editor (virtual mode only). */
  placeholder?: string;
  parentScope?: Scope;
}

/**
 * Wraps an Obsidian MarkdownView inside a WorkspaceLeaf for embedding in a Modal or ItemView.
 *
 * - **File mode** (`options.file`): Opens a real file; enables CodeBlockProcessors and full rendering.
 *   Internally backed by `FileEditor`.
 * - **Virtual mode**: In-memory editor with no physical file.
 *   Internally backed by `VirtualEditor`.
 *
 * Saves are suppressed in both modes.
 */
export class MagicalEditor {
  public view!: MarkdownView | EmbeddableMarkdownEditor;

  private _impl!: InternalEditor;
  private onChangeRef: EventRef | null = null;
  private fakeLeaf: WorkspaceLeaf | null = null;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: MarkdownView | EmbeddableMarkdownEditor | null = null;
  private uninstaller: (() => void) | null = null;

  private constructor(
    private readonly app: App,
    private readonly sourceLeaf: WorkspaceLeaf,
    private readonly options: MagicalEditorOptions,
  ) {
  }

  /** Creates and initializes a `MagicalEditor`. Must be awaited. */
  static async create(
    app: App,
    leaf: WorkspaceLeaf,
    options: MagicalEditorOptions = {},
  ): Promise<MagicalEditor> {
    const me = new MagicalEditor(app, leaf, options);
    if (leaf.view.getViewType() !== "markdown") {
      console.warn("not markdown view provided");
    }
    await me._init();
    return me;
  }

  private async _init(): Promise<void> {
    this.fakeLeaf = await this._createFakeLeaf(this.sourceLeaf);

    this._impl = await createInternalEditor(
      this.app,
      this.fakeLeaf,
      this.sourceLeaf,
      this.options,
      () => this.getContent(),
    );
    this.view = this._impl.view;

    if (this.options.file && this.options.onChange) {
      this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
        if (editor === (this.view as MarkdownView).editor) {
          this.options.onChange!(editor.getValue());
        }
      });
    }

    this._enableActiveEditorSync();
    this._registerMousedownHandler();

    window.setTimeout(() => this.editor.focus());
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Gets the underlying Obsidian Editor. */
  get editor(): Editor {
    return this._impl.editor;
  }

  /** Returns the current editor content. */
  getContent(): string {
    return this.editor.getValue();
  }

  /** Replaces the editor content. */
  setContent(content: string): void {
    this.editor.setValue(content);
  }

  loadToDom(el: HTMLElement): void {
    el.empty();
    el.appendChild(this.view.containerEl);
  }

  /** Focuses the editor. */
  focus(): void {
    this.editor.focus();
  }

  destroy(): void {
    if (this.uninstaller) {
      this.uninstaller();
      this.uninstaller = null;
    }
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

    this._impl.destroy();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Registers `_activeEditor` sync so `editorCallback` commands target this editor when focused.
   * Saves the previous `_activeEditor` and restores it on `destroy()`.
   */
  private _enableActiveEditorSync(): void {
    const ws = this.app.workspace as WorkspaceWithActiveEditor;
    this.prevActiveEditor = ws._activeEditor ?? null;

    const handler = () => { ws._activeEditor = this.view; };
    this.focusinHandler = handler;
    this.view.containerEl.addEventListener("focusin", handler);
    handler(); // Apply immediately before first focusin
  }

  /**
   * Creates a fake leaf that renders into a detached `div` instead of the real leaf's container.
   * Prevents crashes by not modifying the original leaf.
   */
  private async _createFakeLeaf(leaf: WorkspaceLeaf): Promise<WorkspaceLeaf> {
    const fakeLeaf = this.app.workspace.createLeafInParent(this.app.workspace.rootSplit, 0);
    fakeLeaf.containerEl.setCssStyles({ display: "none" });

    // fakeLeaf.setViewState = async (state: ViewState, result: ViewStateResult) => {
    //     if (state.type === "markdown") {
    //       state.type = leaf.view.getViewType() || "markdown";
    //     }
    //     leaf.setViewState(state, result || { history: false });
    //   }
    // if (this.options.file) {
    //   await fakeLeaf.openFile(this.options.file);
    // }
    return fakeLeaf;
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
}
