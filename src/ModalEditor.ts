/// <reference types="obsidian" />
import {
  App,
  Editor,
  Modal,
  TFile,
  Workspace,
  WorkspaceLeaf,
  MarkdownView,
} from "obsidian";
import type {} from 'obsidian-typings';

export interface ModalEditorOptions {
  /** Initial content of the editor. Default: "" */
  initialContent?: string;
  /**
   * If provided, the editor opens this real file via `leaf.openFile()`,
   * which enables MarkdownCodeBlockProcessors and other rendering features.
   * `initialContent` (if also set) will override the file's on-disk content.
   */
  file?: TFile;
  /** Modal width CSS value. Default: "80vw" */
  width?: string;
  /** Modal height CSS value. Default: "85vh" */
  height?: string;
  /** Called whenever the editor content changes. */
  onChange?: (content: string) => void;
  /** Called when the modal is closed, with the final content. */
  onClose?: (content: string) => void;
  /** Extra CSS class to add to the modal's contentEl. */
  contentClass?: string;
  /** If provided, sets the initial cursor position to match this editor's cursor. */
  sourceEditor?: Editor;
}

export interface WorkspaceWithActiveEditor extends Workspace {
  _activeEditor: any;
}

/**
 * A ready-to-use Modal that embeds a full Obsidian Markdown editor.
 * No ItemView or file setup required.
 *
 * @example
 * ```ts
 * new ModalEditor(this.app, {
 *   initialContent: node.content,
 *   onChange: (content) => { node.content = content; },
 *   onClose: (content) => { saveNode(node.id, content); },
 * }).open();
 * ```
 */
export class ModalEditor extends Modal {
  private hiddenLeaf: WorkspaceLeaf | null = null;
  private prevActiveEditor: any = null;
  public markdownView!: MarkdownView;

  constructor(app: App, private options: ModalEditorOptions = {}) {
    super(app);
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("magical-editor-modal-content");
    if (this.options.contentClass) {
      contentEl.addClass(this.options.contentClass);
    }
    modalEl.setCssStyles({
      width: this.options.width ?? "80vw",
      height: this.options.height ?? "85vh",
    });

    this.prevActiveEditor = (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor;

    // 1. Create a real hidden leaf, like modal-opener
    this.hiddenLeaf = this.app.workspace.createLeafInParent(
      this.app.workspace.rootSplit,
      0
    );
    
    // @ts-expect-error
    (this.hiddenLeaf.containerEl as HTMLElement).setCssStyles({
      display: "none",
    });

    let view: MarkdownView;

    if (this.options.file) {
      // --- File mode: let Obsidian create the view via openFile() ---
      // This runs the full rendering pipeline (CodeBlockProcessors, etc.)
      await this.hiddenLeaf.openFile(this.options.file, { state: { mode: "source" } });
      view = this.hiddenLeaf.view as MarkdownView;

      // Suppress save operations on the view Obsidian created
      view.save = async () => {};
      view.requestSave = async () => {};
      // @ts-expect-error
      view.saveTitle = async () => {};

      // If an override content was supplied, replace the on-disk content in the editor
      if (this.options.initialContent !== undefined) {
        view.editor.setValue(this.options.initialContent);
      }
    } else {
      // --- Virtual mode: manually create a MarkdownView ---
      view = new MarkdownView(this.hiddenLeaf);
      this.hiddenLeaf.view = view;

      view.save = async () => {};
      view.requestSave = async () => {};
      // @ts-expect-error
      view.saveTitle = async () => {};

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
      // @ts-expect-error
      view.__setViewData__ = originalSetViewData;
      view.setViewData = async () => {};
      // @ts-expect-error
      view.__setViewData__(this.options.initialContent ?? "", true);
    }

    this.markdownView = view;
    // @ts-expect-error
    (view.headerEl as HTMLElement).setCssStyles({ visibility: "hidden" });

    const editorArea = contentEl.createDiv({ cls: "magical-editor-modal-editor-area" });
    editorArea.appendChild(view.containerEl);

    // Active editor focus handling (same as modal-opener)
    const setActiveEditor = () => {
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor = view;
    };
    editorArea.addEventListener("focusin", setActiveEditor);
    setActiveEditor();

    // Background click → focus editor
    contentEl.addEventListener("mousedown", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target === contentEl || target === editorArea) {
        const editor = view.editor;
        // @ts-expect-error
        const pos = editor.posAtMouse?.(e);
        setTimeout(() => {
          if (pos) { editor.setCursor(pos); editor.setSelection?.(pos, pos); }
          editor.focus();
        }, 0);
      }
    });

    // onChange listener
    if (this.options.onChange) {
      this.app.workspace.on("editor-change", (editor) => {
        if (editor === view.editor) {
          this.options.onChange?.(view.editor.getValue());
        }
      });
    }

    // Restore cursor position from sourceEditor
    if (this.options.sourceEditor) {
      setTimeout(() => {
        const cursor = this.options.sourceEditor!.getCursor();
        view.editor.setCursor(cursor);
      }, 0);
    }

    setTimeout(() => { view.editor.focus(); }, 0);
  }

  /** Returns the current content of the editor. */
  getContent(): string {
    return this.markdownView?.editor.getValue() ?? "";
  }

  /** Programmatically sets the editor content. */
  setContent(content: string): this {
    // @ts-expect-error
    this.markdownView?.__setViewData__?.(content, true) ?? this.markdownView?.setViewData(content, true);
    return this;
  }

  onClose() {
    const finalContent = this.getContent();
    this.options.onClose?.(finalContent);

    this.contentEl.empty();

    if (this.hiddenLeaf) {
      this.hiddenLeaf.detach();
      this.hiddenLeaf = null;
    }

    (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor = this.prevActiveEditor ?? null;
    this.prevActiveEditor = null;
  }
}
