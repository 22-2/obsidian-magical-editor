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
import { FileEditor } from "./internal/file-editor";
import { EmbeddableMarkdownEditor } from "./internal/markdown-editor";
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

  private _impl!: FileEditor | VirtualEditor;
  private isVirtual = false;
  private onChangeRef: EventRef | null = null;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: MarkdownView | EmbeddableMarkdownEditor | null = null;

  private constructor(
    private readonly app: App,
    private readonly hostLeaf: WorkspaceLeaf,
  ) {}

  /** Creates and initializes a `MagicalEditor`. Must be awaited. */
  static async create(
    app: App,
    hostLeaf: WorkspaceLeaf,
    options: MagicalEditorOptions = {},
  ): Promise<MagicalEditor> {
    const me = new MagicalEditor(app, hostLeaf);
    await me._init(options);
    return me;
  }

  private async _init(options: MagicalEditorOptions): Promise<void> {
    if (options.file) {
      // --- File mode ---
      const impl = await FileEditor.create(this.app, {
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
    } else {
      // --- Virtual mode ---
      const impl = VirtualEditor.create(
        this.app,
        this.hostLeaf,
        {
          initialContent: options.initialContent,
          onChange: options.onChange,
          sourceEditor: options.sourceEditor,
          placeholder: options.placeholder,
          parentScope: options.parentScope || (this.hostLeaf.view as any)?.scope || this.app.scope,
        },
        () => this.getContent(),
      );
      this._impl = impl;
      this.view = impl.view;
      this.isVirtual = true;
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

  /** Focuses the editor. */
  focus(): void {
    this.editor.focus();
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
