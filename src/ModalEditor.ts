/// <reference types="obsidian" />
import {
  App,
  Editor,
  EventRef,
  Modal,
  Workspace,
  WorkspaceLeaf,
  MarkdownView,
} from "obsidian";
import { MagicalEditorWrapper, TInlineView } from "./MagicalEditorWrapper";
import type {} from 'obsidian-typings';

export interface ModalEditorOptions {
  /** Initial content of the editor. Default: "" */
  initialContent?: string;
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

    // 2. Create the markdown view on the leaf
    const view = new MarkdownView(this.hiddenLeaf);
    this.hiddenLeaf.view = view;
    this.markdownView = view;

    // 3. Disable saving to prevent sync with physical files
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

    const editorArea = contentEl.createDiv({ cls: "magical-editor-modal-editor-area" });
    editorArea.appendChild(view.containerEl);

    // 4. Mimic modal-opener's active editor focus handling
    const setActiveEditor = () => {
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor = view;
    };
    editorArea.addEventListener("focusin", setActiveEditor);
    setActiveEditor();

    // 5. Background click on modal should focus the editor
    contentEl.addEventListener("mousedown", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target === contentEl || target === editorArea) {
        const editor = view.editor;
        // @ts-expect-error
        const pos = editor.posAtMouse?.(e);
        setTimeout(() => {
          if (pos) {
            editor.setCursor(pos);
            editor.setSelection?.(pos, pos);
          }
          editor.focus();
        }, 0);
      }
    });

    // 6. Set content and initial focus
    const initialContent = this.options.initialContent ?? "";
    await view.setState({ file: view.file, mode: "source" }, { history: false });
    // @ts-expect-error
    view.__setViewData__?.(initialContent, true) ?? view.setViewData(initialContent, true);

    if (this.options.onChange) {
      this.app.workspace.on("editor-change", (editor) => {
        if (editor === view.editor) {
          this.options.onChange?.(view.editor.getValue());
        }
      });
    }

    if (this.options.sourceEditor) {
      setTimeout(() => {
        const cursor = this.options.sourceEditor!.getCursor();
        view.editor.setCursor(cursor);
      }, 0);
    }
    
    setTimeout(() => {
      view.editor.focus();
    }, 0);
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
