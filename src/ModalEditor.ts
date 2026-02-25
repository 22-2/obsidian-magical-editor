/// <reference types="obsidian" />
import {
  App,
  Editor,
  EventRef,
  Modal,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { MagicalEditorWrapper, TInlineView } from "./MagicalEditorWrapper";

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
  private wrapper!: MagicalEditorWrapper;
  private hiddenLeaf: WorkspaceLeaf | null = null;
  private eventRefs: EventRef[] = [];
  private prevActiveEditor: any = null;

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
    modalEl.style.width = this.options.width ?? "80vw";
    modalEl.style.height = this.options.height ?? "85vh";

    this.prevActiveEditor = (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor;

    // Create a hidden real leaf — needed to satisfy MagicalEditorWrapper's fakeLeaf logic
    this.hiddenLeaf = this.app.workspace.createLeafInParent(
      this.app.workspace.rootSplit,
      0
    );
    this.hiddenLeaf.containerEl.style.display = "none";

    const leaf = this.hiddenLeaf;
    const app = this.app;
    const initialContent = this.options.initialContent ?? "";
    let currentContent = initialContent;

    // Minimal TInlineView implementation for the modal context
    const fakeView: TInlineView = {
      leaf,
      app,
      editor: undefined as never, // filled after wrapper.initialize()
      file: undefined as never,   // filled after wrapper.initialize()
      wrapper: undefined as never, // filled below
      getViewType: () => "magical-editor-modal",
      getContent: async () => currentContent,
      setContent: (c: string) => { currentContent = c; },
    };

    const wrapper = new MagicalEditorWrapper({
      getActiveView: () => fakeView,
      workspace: {
        _activeEditor: null as never,
        on: this.app.workspace.on.bind(this.app.workspace),
      },
      // Collect EventRefs manually — Modal has no registerEvent like Plugin
      registerEvent: (ev: EventRef) => {
        this.eventRefs.push(ev);
        return ev;
      },
      parentView: fakeView,
      onChange: () => {
        this.options.onChange?.(wrapper.getContent());
      },
    });

    fakeView.wrapper = wrapper;
    this.wrapper = wrapper;

    const editorArea = contentEl.createDiv({ cls: "magical-editor-modal-editor-area" });
    await wrapper.initialize(editorArea, null);

    // Backfill references after initialization
    fakeView.editor = wrapper.magicalEditor.editor;
    fakeView.file = wrapper.magicalEditor.file as any;

    wrapper.setContent(initialContent);

    if (this.options.sourceEditor) {
      setTimeout(() => {
        const cursor = this.options.sourceEditor!.getCursor();
        wrapper.magicalEditor.editor.setCursor(cursor);
      }, 0);
    }
    wrapper.focus();
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
    const finalContent = this.wrapper?.getContent() ?? "";
    this.options.onClose?.(finalContent);

    this.contentEl.empty();
    this.wrapper?.unload();

    // Clean up workspace event listeners
    for (const ref of this.eventRefs) {
      this.app.workspace.offref(ref);
    }
    this.eventRefs = [];

    if (this.hiddenLeaf) {
      this.hiddenLeaf.detach();
      this.hiddenLeaf = null;
    }

    (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor = this.prevActiveEditor ?? null;
    this.prevActiveEditor = null;
  }
}
