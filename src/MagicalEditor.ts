import {
    App,
    Editor,
    EventRef,
    MarkdownView,
    Scope,
    TFile,
    ViewState,
    ViewStateResult,
    Workspace,
    WorkspaceLeaf
} from "obsidian";
import { createInternalEditor, InternalEditor } from "./editors";
import { FileEditor } from "./editors/file-editor";
import { VirtualEditor } from "./editors/virtual-editor";
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

  /** Custom placeholder for the editor. */
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
  private leafToMount!: WorkspaceLeaf;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: MarkdownView | EmbeddableMarkdownEditor | null = null;
  private uninstaller: (() => void) | null = null;
  private placeholderEl: HTMLElement | null = null;

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
    await me._init();
    return me;
  }

  private async _init(): Promise<void> {
    const { impl, leafToMount } = await createInternalEditor(
      this.app,
      this.sourceLeaf,
      this.options,
      () => this.getContent(),
    );
    this._impl = impl;
    this.leafToMount = leafToMount;
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
    this._applyStyles();
    this._initPlaceholder();
    window.setTimeout(() => {
      this.editor.focus();
      if (this.sourceLeaf.view.getViewType() === "markdown") {
        this.editor.setCursor((this.sourceLeaf.view as MarkdownView).editor.getCursor());
      }
    });
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
    el.appendChild(this.leafToMount.containerEl);
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

    this.view.containerEl.detach();
    this._impl.destroy();
    if (this.placeholderEl) {
      this.placeholderEl.remove();
      this.placeholderEl = null;
    }
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

  private _applyStyles(): void {
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

  private _initPlaceholder(): void {
    if (!this.options.placeholder) return;

    // Use absolute positioning within the containerEl
    this.view.containerEl.setCssStyles({ position: "relative" });

    this.placeholderEl = this.view.containerEl.createDiv({
      cls: "magical-editor-placeholder",
      text: this.options.placeholder,
    });

    this.placeholderEl.setCssStyles({
      position: "absolute",
      top: "var(--size-2-1)",
      left: "var(--size-2-1)",
      pointerEvents: "none",
      color: "var(--text-muted)",
      opacity: "0.5",
      userSelect: "none",
      fontSize: "var(--font-text-size)",
      zIndex: "10",
      whiteSpace: "pre-wrap",
      width: "calc(100% - var(--size-4-10))",
    });

    this._updatePlaceholderVisibility();

    // Monitor changes
    // 1. Higher-level workspace events for file mode and general changes
    this.app.workspace.on("editor-change", () => {
      this._updatePlaceholderVisibility();
    });

    // 2. Direct DOM input events for fast/virtual updates without relying on CM extensions
    // this.editor.cm.contentDOM.addEventListener("input", () => {
    //   this._updatePlaceholderVisibility();
    // });

    // 3. Fallback for programmatic changes
    // const self = this;
    // const originalSetValue = this.editor.setValue.bind(this.editor);
    // this.editor.setValue = function(content: string) {
    //   originalSetValue(content);
    //   self._updatePlaceholderVisibility();
    // };
  }

  private _updatePlaceholderVisibility(): void {
    if (!this.placeholderEl) return;
    const content = this.getContent();
    this.placeholderEl.style.display = content.trim() === "" ? "block" : "none";
  }
}
