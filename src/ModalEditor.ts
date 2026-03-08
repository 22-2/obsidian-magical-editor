import {
    App,
    Editor,
    Modal,
    TFile,
    WorkspaceLeaf
} from "obsidian";
import { MagicalEditor } from "./MagicalEditor";
import { createHiddenLeaf } from "./editors";

export interface ModalEditorOptions {
  /** Initial content of the editor. Default: `""` */
  initialContent?: string;

  /**
   * If provided, the editor opens this real file via `leaf.openFile()`.
   * This enables MarkdownCodeBlockProcessors and the full Obsidian rendering pipeline.
   * `initialContent` (if also set) will override the file's on-disk content.
   */
  file?: TFile;

  /** Modal width CSS value. Default: `"86vw"` */
  width?: string;

  /** Modal height CSS value. Default: `"86vh"` */
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

  /** Placeholder text for the editor. Default: `"Hello, Magical Editor!"` */
  placeholder?: string;

  hostLeaf?: WorkspaceLeaf;
}


/**
 * A ready-to-use Modal that embeds a full Obsidian Markdown editor.
 *
 * Internally backed by `MagicalEditor`, which handles the editor
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
  /** The underlying wrapper. Available after the modal is opened. */
  public editor!: MagicalEditor;

  constructor(app: App, private options: ModalEditorOptions) {
    super(app);
  }

  async onOpen() {
    this.applyStyles();
    await this.initEditor();
  }

  /**
   * モーダルの DOM 要素にスタイルとクラスを適用する。
   * @returns backdrop 要素 (`modalBg`)。後続処理で opacity アニメーションに使用。
   */
  private applyStyles(): HTMLElement | null {
    const { contentEl, modalEl, containerEl } = this;

    contentEl.empty();
    contentEl.addClass("magical-editor-modal-content");
    modalEl.addClass("magical-editor-modal");

    // Apply background blur directly to the backdrop
    const modalBg = containerEl.querySelector(".modal-bg") as HTMLElement | null;
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

    const closeBtn = modalEl.querySelector(".modal-close-button") as HTMLElement | null;
    if (closeBtn) {
      closeBtn.setCssStyles({
        position: "absolute",
        top: "10px",
        right: "10px",
        zIndex: "99",
      });
    }
    setTimeout(() => { modalBg?.setCssStyles({ opacity: "1" }); });
    return modalBg;
  }

  /**
   * MagicalEditor を生成し、エディタ DOM を contentEl に挿入する。
   */
  private async initEditor(): Promise<void> {
    const { contentEl } = this;

    this.editor = await MagicalEditor.create(this.app, this.options.hostLeaf || createHiddenLeaf(this.app), {
      file: this.options.file,
      initialContent: this.options.initialContent,
      onChange: this.options.onChange,
      placeholder: this.options.placeholder || "Hello, Magical Editor!",
    });

    // view.containerEl (.workspace-leaf) must also fill its parent.
    this.editor.view.containerEl.setCssStyles({
      height: "100%",
      width: "100%",
    });
    
    const editorArea = contentEl.createDiv({ cls: "magical-editor-modal-editor-area" });
    // editorArea must fill the remaining height so .cm-scroller gets a bounded height.
    // flex:1 + min-height:0 is the standard flexbox pattern for overflow in a flex child.
    editorArea.setCssStyles({
      flex: "1 1 0",
      minHeight: "0",
      overflow: "hidden",
      position: "relative",
    });

    this.editor.loadToDom(editorArea);
  }


  /** Returns the current content of the editor. */
  getContent(): string {
    return this.editor?.getContent() ?? "";
  }

  /** Programmatically sets the editor content. */
  setContent(content: string): this {
    this.editor?.setContent(content);
    return this;
  }

  onClose() {
    const finalContent = this.getContent();
    this.options.onClose?.(finalContent);

    this.contentEl.empty();
    this.editor?.destroy();
  }
}
