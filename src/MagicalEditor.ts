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
import { createEmbeddableMarkdownEditor, EmbeddableMarkdownEditor } from "./internal/markdown-editor";

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

  /** Custom placeholder for the editor. */
  placeholder?: string;
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
  public view!: MarkdownView | EmbeddableMarkdownEditor;

  private isVirtual = false;
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
      this.isVirtual = false;
    } else {
      this._initVirtualView(options);
      this.isVirtual = true;
    }

    this._suppressSaves();
    this._applyStyles();

    if (options.file && options.initialContent !== undefined) {
      this.editor.setValue(options.initialContent);
    }

    if (options.onChange) {
      if (!this.isVirtual) {
        this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
          if (editor === (this.view as MarkdownView).editor) {
            options.onChange!(editor.getValue());
          }
        });
      } else {
        // EmbeddableMarkdownEditor handles onChange via options
        // We set it during _initVirtualView
      }
    }

    if (options.sourceEditor) {
      setTimeout(() => {
        this.editor.setCursor(options.sourceEditor!.getCursor());
      }, 0);
    }

    if (!this.isVirtual) {
      this._registerMousedownHandler();
    }
    
    this.enableActiveEditorSync();
    window.setTimeout(() => this.editor.focus());
  }

  private _initVirtualView(options: MagicalEditorOptions): void {
    // We use the leaf's containerEl as the parent for the embeddable editor
    // because ModalEditor will append this leaf's containerEl to its own area.
    this.view = createEmbeddableMarkdownEditor(this.app, this.leaf.containerEl, {
      value: options.initialContent ?? "",
      placeholder: options.placeholder,
      onChange: () => {
        if (options.onChange) {
          options.onChange(this.getContent());
        }
      },
      onBlur: () => {
        // Sync with Obsidian's active editor logic if needed
      }
    }, this.leaf);
  }

  private _applyStyles(): void {
    if (!this.isVirtual) {
      const view = this.view as MarkdownView;
      view.headerEl?.setCssStyles?.({ visibility: "hidden" });
      view.editor.cm.contentDOM.setCssStyles({
        paddingTop: "var(--editor-padding-top)",
        paddingBottom: "var(--editor-padding-bottom)",
      });
    } else {
      // Embeddable editor styles
      const embed = this.view as EmbeddableMarkdownEditor;
      embed.containerEl.setCssStyles({
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
      });
      embed.activeCM.contentDOM.setCssStyles({
        paddingTop: "var(--editor-padding-top)",
        paddingBottom: "var(--editor-padding-bottom)",
      });
    }
  }

  private _registerMousedownHandler(): void {
    if (this.isVirtual) return;
    const view = this.view as MarkdownView;
    view.containerEl
      .find(".cm-sizer")
      .addEventListener("mousedown", (e: MouseEvent) => {
        const editor = view.editor;
        const pos = editor.posAtMouse?.(e);
        setTimeout(() => {
          if (pos) editor.setSelection?.(pos, pos);
          editor.focus();
        });
      });
  }

  /** Gets the underlying Obsidian Editor. */
  get editor(): Editor {
    return (this.view as any).editor;
  }

  /** Returns the current editor content. */
  getContent(): string {
    return this.editor.getValue();
  }

  /** Replaces the editor content. */
  setContent(content: string): void {
    this.editor.setValue(content);
  }

  /** Focuses the editor. */
  focus(): void {
    this.editor.focus();
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
      if (this.view instanceof EmbeddableMarkdownEditor) {
        this.view.containerEl.removeEventListener("focusin", this.focusinHandler);
      } else {
        (this.view as MarkdownView).containerEl.removeEventListener("focusin", this.focusinHandler);
      }
      this.focusinHandler = null;
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor =
        this.prevActiveEditor ?? null;
      this.prevActiveEditor = null;
    }

    if (this.isVirtual) {
      (this.view as EmbeddableMarkdownEditor).destroy();
    }
  }

  private _suppressSaves(): void {
    if (!this.isVirtual) {
      const view = this.view as MarkdownView;
      view.save = async () => {};
      view.requestSave = async () => {};
      view.saveTitle = async () => {};
    }
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
