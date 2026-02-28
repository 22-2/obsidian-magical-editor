/// <reference types="obsidian" />
import {
  App,
  Editor,
  Modal,
  TFile,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { MagicalEditorWrapper } from "./MagicalEditorWrapper";

export interface ModalEditorOptions {
  /** Initial content of the editor. Default: `""` */
  initialContent?: string;

  /**
   * If provided, the editor opens this real file via `leaf.openFile()`.
   * This enables MarkdownCodeBlockProcessors and the full Obsidian rendering pipeline.
   * `initialContent` (if also set) will override the file's on-disk content.
   */
  file?: TFile;

  /** Modal width CSS value. Default: `"80vw"` */
  width?: string;

  /** Modal height CSS value. Default: `"85vh"` */
  height?: string;

  /** Called whenever the editor content changes. */
  onChange?: (content: string) => void;

  /** Called when the modal is closed, with the final content. */
  onClose?: (content: string) => void;

  /** Extra CSS class added to the modal's `contentEl`. */
  contentClass?: string;

  /** Extra CSS class added to the modal's `modalEl`. */
  modalClass?: string;

  /** Extra CSS class added to the modal's `containerEl`. */
  containerClass?: string;

  /** If provided, copies the initial cursor position from this editor. */
  sourceEditor?: Editor;
}

export interface WorkspaceWithActiveEditor extends Workspace {
  _activeEditor: any;
}

/**
 * A ready-to-use Modal that embeds a full Obsidian Markdown editor.
 *
 * Internally backed by `MagicalEditorWrapper`, which handles the editor
 * lifecycle (file mode vs virtual mode, save suppression, onChange, etc.).
 *
 * @example Virtual mode (no file)
 * ```ts
 * new ModalEditor(this.app, {
 *   initialContent: "# Hello",
 *   onChange: (content) => console.log(content),
 *   onClose: (content) => save(content),
 * }).open();
 * ```
 *
 * @example File mode (with CodeBlockProcessor support)
 * ```ts
 * new ModalEditor(this.app, {
 *   file: tfile,
 *   initialContent: "override content",
 *   onChange: (content) => save(content),
 * }).open();
 * ```
 */
export class ModalEditor extends Modal {
  private hiddenLeaf: WorkspaceLeaf | null = null;
  private prevActiveEditor: any = null;

  /** The underlying wrapper. Available after the modal is opened. */
  public wrapper!: MagicalEditorWrapper;

  constructor(app: App, private options: ModalEditorOptions = {}) {
    super(app);
  }

  async onOpen() {
    const { contentEl, modalEl, containerEl } = this;
    contentEl.empty();
    contentEl.addClass("magical-editor-modal-content");
    modalEl.addClass("magical-editor-modal");

    // Apply background blur directly to the backdrop
    const modalBg = containerEl.querySelector(".modal-bg") as HTMLElement;
    if (modalBg) {
      modalBg.setCssStyles({
        backdropFilter: "blur(12px)",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
      });
    }

    if (this.options.contentClass) {
      contentEl.addClass(this.options.contentClass);
    }
    if (this.options.modalClass) {
      modalEl.addClass(this.options.modalClass);
    }
    if (this.options.containerClass) {
      containerEl.addClass(this.options.containerClass);
    }
    modalEl.setCssStyles({
      width: this.options.width ?? "86vw",
      height: this.options.height ?? "86vh",
      maxWidth: "unset",
      backgroundColor: "var(--background-primary)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "8px",
      boxShadow: "var(--shadow-l)",
      padding: "0",
      overflow: "hidden",
    });

    // contentEl (.modal-content) must be height:100% + flex-column so the chain
    // modalEl → contentEl → editorArea → view.containerEl is all bounded.
    contentEl.setCssStyles({
      height: "100%",
      padding: "24px",
      paddingTop: "36px",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
    });

    const closeBtn = modalEl.querySelector(".modal-close-button") as HTMLElement;
    if (closeBtn) {
      closeBtn.setCssStyles({
        position: "absolute",
        top: "10px",
        right: "10px",
        zIndex: "99",
      });
    }

    this.prevActiveEditor = (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor;

    // Create a hidden real leaf (same technique as obsidian-modal-opener)
    this.hiddenLeaf = this.app.workspace.createLeafInParent(
      this.app.workspace.rootSplit,
      0
    );
    // @ts-expect-error
    (this.hiddenLeaf.containerEl as HTMLElement).setCssStyles({ display: "none" });

    // Delegate all editor setup to MagicalEditorWrapper
    this.wrapper = await MagicalEditorWrapper.create(this.hiddenLeaf, this.app, {
      file: this.options.file,
      initialContent: this.options.initialContent,
      onChange: this.options.onChange,
      sourceEditor: this.options.sourceEditor,
    });

    const view = this.wrapper.view;
    const editorArea = contentEl.createDiv({ cls: "magical-editor-modal-editor-area" });
    // editorArea must fill the remaining height so .cm-scroller gets a bounded height.
    // flex:1 + min-height:0 is the standard flexbox pattern for overflow in a flex child.
    editorArea.setCssStyles({
      flex: "1 1 0",
      minHeight: "0",
      overflow: "hidden",
      position: "relative",
    });
    // view.containerEl (.workspace-leaf) must also fill its parent.
    (view.containerEl as HTMLElement).setCssStyles({
      height: "100%",
      width: "100%",
    });
    editorArea.appendChild(view.containerEl);

    // Sync _activeEditor so editorCallback commands target this editor
    const setActiveEditor = () => {
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor = view;
    };
    editorArea.addEventListener("focusin", setActiveEditor);
    setActiveEditor();

    // Clicking the backdrop (outside the CM editor) should focus the editor
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

    setTimeout(() => { this.wrapper.focus(); }, 0);
    setTimeout(() => { modalBg.setCssStyles({ opacity: "1" }); }, 0);
  }

  /** Returns the current content of the editor. */
  getContent(): string {
    return this.wrapper?.getContent() ?? "";
  }

  /** Programmatically sets the editor content. */
  setContent(content: string): this {
    this.wrapper?.setContent(content);
    return this;
  }

  onClose() {
    const finalContent = this.getContent();
    this.options.onClose?.(finalContent);

    this.contentEl.empty();
    this.wrapper?.destroy();

    if (this.hiddenLeaf) {
      this.hiddenLeaf.detach();
      this.hiddenLeaf = null;
    }

    (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor =
      this.prevActiveEditor ?? null;
    this.prevActiveEditor = null;
  }
}
