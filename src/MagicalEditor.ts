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
import { around } from "monkey-around";
import { EmbeddableMarkdownEditor } from "./internal/markdown-editor";
import { FileEditor } from "./internal/file-editor";
import { VirtualEditor } from "./internal/virtual-editor";

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

  /** If provided, copies cursor position from this editor on init. */
  sourceEditor?: Editor;

  /** Custom placeholder for the editor (virtual mode only). */
  placeholder?: string;
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

  private _impl!: FileEditor | VirtualEditor;
  private isVirtual = false;
  private onChangeRef: EventRef | null = null;
  private leaf: WorkspaceLeaf;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: MarkdownView | EmbeddableMarkdownEditor | null = null;
  private uninstaller: (() => void) | null = null;

  private constructor(
    private readonly app: App,
    private readonly hostLeaf: WorkspaceLeaf,
  ) {
    this.leaf = this._createFakeLeaf(hostLeaf);
  }

  /** Creates and initializes a `MagicalEditor`. Must be awaited. */
  static async create(
    app: App,
    leaf: WorkspaceLeaf,
    options: MagicalEditorOptions = {},
  ): Promise<MagicalEditor> {
    const me = new MagicalEditor(app, leaf);
    await me._init(options);
    return me;
  }

  private async _init(options: MagicalEditorOptions): Promise<void> {
    if (options.file) {
      // --- File mode ---
      const impl = await FileEditor.create(this.app, this.leaf, {
        file: options.file,
        initialContent: options.initialContent,
        sourceEditor: options.sourceEditor,
      });
      this._impl = impl;
      this.view = impl.view;
      this.isVirtual = false;

      if (options.onChange) {
        this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
          if (editor === (this.view as MarkdownView).editor) {
            options.onChange!(editor.getValue());
          }
        });
      }

      // Populate `hostLeaf.view.editor` so Obsidian internals can find it.
      if (this.hostLeaf.view) {
        (this.hostLeaf.view as any).editor = this.editor;
      }
    } else {
      // --- Virtual mode ---
      const impl = VirtualEditor.create(
        this.app,
        this.leaf,
        {
          initialContent: options.initialContent,
          onChange: options.onChange,
          sourceEditor: options.sourceEditor,
          placeholder: options.placeholder,
        },
        () => this.getContent(),
      );
      this._impl = impl;
      this.view = impl.view;
      this.isVirtual = true;
    }

    this.enableActiveEditorSync();
    this._patchWorkspace();

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

  private _patchWorkspace(): void {
    const self = this;
    this.uninstaller = around(this.app.workspace, {
      getActiveViewOfType: (next) => function (this: Workspace, type) {
        if (self.app.workspace.activeLeaf === self.hostLeaf || self.app.workspace.activeLeaf === self.leaf) {
          if ((type as any).VIEW_TYPE === "markdown" || type === (MarkdownView as any)) {
            return self.view as any;
          }
        }
        return next.apply(this, [type]);
      },
      getActiveFile: (next) => function (this: Workspace) {
        if (self.app.workspace.activeLeaf === self.hostLeaf || self.app.workspace.activeLeaf === self.leaf) {
          return (self.view as any).file || next.apply(this);
        }
        return next.apply(this);
      }
    });
  }

  /**
   * Creates a fake leaf that renders into a detached `div` instead of the real leaf's container.
   * Prevents crashes by not modifying the original leaf.
   */
  private _createFakeLeaf(leaf: WorkspaceLeaf): WorkspaceLeaf {
    const self = this;
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
      get view() {
        return self.view;
      },
    } as unknown as WorkspaceLeaf;
  }
}
