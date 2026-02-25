/// <reference types="obsidian" />
import {
  App,
  Editor,
  MarkdownView,
  Plugin,
  TFile,
  TFolder,
  ViewState,
  Workspace,
  WorkspaceLeaf,
  type ViewStateResult,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import type { }  from 'obsidian-typings';

const noop = async () => {};

interface VirtualMarkdownView extends MarkdownView {
  [key: string]: any;
}

/**
 * The interface that the parent view (the view that hosts the editor) must implement.
 */
export interface TInlineView {
  leaf: WorkspaceLeaf;
  editor: Editor;
  wrapper: MagicalEditorWrapper;
  file: TFile;
  app: App;
  getViewType(): string;
  getContent(): Promise<string>;
  setContent(content: string): void;
}

export interface ParentViewState {
  content?: string;
  [key: string]: unknown;
}

type Context = {
  getActiveView: () => TInlineView | null;
  workspace: {
    _activeEditor: never;
    on: Workspace["on"];
    onLayoutReady: Workspace["onLayoutReady"];
  };
  registerEvent: Plugin["registerEvent"];
  parentView: TInlineView;
  onChange?: () => void;
};

/**
 * Manages an inline MarkdownView without a physical file.
 *
 * This allows embedding a full-featured Obsidian Markdown editor into any
 * ItemView or Modal without creating or writing to actual vault files.
 *
 * @example
 * ```ts
 * this.wrapper = new MagicalEditorWrapper({
 *   getActiveView: () => this,
 *   workspace: {
 *     _activeEditor: null as never,
 *     on: this.app.workspace.on.bind(this.app.workspace),
 *     onLayoutReady: this.app.workspace.onLayoutReady.bind(this.app.workspace),
 *   },
 *   registerEvent: (ev) => this.registerEvent(ev),
 *   parentView: this,
 *   onChange: () => { console.log(this.wrapper.getContent()); },
 * });
 *
 * await this.wrapper.initialize(containerEl, null);
 * ```
 */
export class MagicalEditorWrapper {
  public magicalEditor!: VirtualMarkdownView;
  containerEl!: HTMLDivElement;
  public targetEl: HTMLElement | null = null;
  private content = "";

  constructor(private context: Context) {
    this.context.registerEvent(
      this.context.workspace.on("active-leaf-change", () => {
        this.syncActiveEditorState();
      })
    );
    this.context.registerEvent(
      this.context.workspace.on("layout-change", () => {
        this.syncActiveEditorState();
      })
    );
    this.context.workspace.onLayoutReady(() => {
      this.syncActiveEditorState();
    });
  }

  /** Initialize the editor and load content. */
  async initialize(
    target: HTMLElement,
    initialState: ParentViewState | null
  ) {
    await this.onload(); // Create virtual editor
    const editorContainer = (target as any).createEl("div", {
      cls: "magical-editor-sandbox-container",
    });
    this.load(editorContainer); // Attach to DOM and focus

    const initialContent =
      initialState?.content ?? (await this.context.parentView.getContent());
    this.content = initialContent;
    this.context.parentView.setContent(initialContent);

    if (initialState) {
      await this.magicalEditor.setState(initialState, {
        history: false,
      });
    }
    this.syncActiveEditorState();
    this.setupChangeListener();
  }

  getContent() {
    return this.magicalEditor.editor.getValue();
  }

  setContent(content: string) {
    this.magicalEditor.__setViewData__(content, true);
  }

  load(target: HTMLElement) {
    this.setContent(this.content);
    target.append(this.containerEl);
    setTimeout(() => this.focus());
    this.targetEl = target;
  }

  focus() {
    this.magicalEditor.editor.focus();
  }

  private setupChangeListener(): void {
    if (!this.context.onChange) return;

    const onChange = this.context.onChange;
    this.context.registerEvent(
      this.context.workspace.on("editor-change", (editor) => {
        if (editor === this.magicalEditor.editor) {
          onChange();
        }
      })
    );
  }

  unload() {
    if (this.targetEl) {
      (this.targetEl as any).empty();
      this.targetEl = null;
    }
  }

  async onload() {
    this.containerEl = createEl("div");
    this.containerEl.addClasses(["magical-editor-container"]);

    this.magicalEditor = new MarkdownView(
      this.createFakeLeaf()
    ) as VirtualMarkdownView;
    // @ts-expect-error
    this.magicalEditor.leaf.working = false;
    this.disableSaveOperations();
  }

  private disableSaveOperations() {
    this.magicalEditor.save = noop;
    this.magicalEditor.saveTitle = noop;
    this.magicalEditor.requestSave = noop;
    this.magicalEditor.__setViewData__ = this.magicalEditor.setViewData;
    this.magicalEditor.setViewData = noop;

    // Use a dummy file to prevent synchronization with actual files in the vault
    this.magicalEditor.file = {
      path: "magical-editor-virtual.md",
      name: "magical-editor-virtual.md",
      basename: "magical-editor-virtual",
      extension: "md",
      vault: this.context.parentView.app.vault,
      parent: null as unknown as TFolder,
      stat: { ctime: 0, mtime: 0, size: 0 },
    } as TFile;
  }

  private createFakeLeaf() {
    // --- The Magic ---
    // We create a "fake" leaf object to trick the MarkdownView constructor.
    // The goal is to make it render inside our `containerEl` instead of the
    // leaf's main container. This avoids modifying the real leaf,
    // preventing crashes and instability.
    const fakeLeaf = {
      ...this.context.parentView.leaf,
      containerEl: this.containerEl,
      setViewState: async (state: ViewState, result: ViewStateResult) => {
        if (state.type === "markdown") {
          state.type = this.context.parentView.getViewType();
        }
        this.context.parentView.leaf.setViewState(
          state,
          result || { history: false }
        );
      },
      __FAKE_LEAF__: true,
    } as unknown as WorkspaceLeaf;
    return fakeLeaf;
  }

  /**
   * Syncs Obsidian's internal active editor state with our virtual editor.
   * This ensures that commands and other editor features work correctly.
   */
  private syncActiveEditorState = (): void => {
    const activeView = this.context.getActiveView();
    const workspace = this.context.workspace;

    if (activeView?.editor) {
      // @ts-expect-error
      workspace._activeEditor = activeView.wrapper.magicalEditor;
    } else if (
      // @ts-expect-error
      workspace._activeEditor?.leaf?.__FAKE_LEAF__
    ) {
      // @ts-expect-error
      workspace._activeEditor = null;
    }
  };
}
