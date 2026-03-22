import {
  App,
  Editor,
  EventRef,
  KeymapEventListener,
  MarkdownView,
  Modifier,
  Scope,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import {
  EditorImplementation,
  patchToggleSourceCommand,
  unpatchToggleSourceCommand,
} from "./editors";
import { EmbeddableMarkdownEditor } from "./editors/internal/magical-embeddable-editor";

interface WorkspaceWithActiveEditor extends Workspace {
  _activeEditor: MarkdownView | EmbeddableMarkdownEditor | null;
}

export interface BaseEditorOptions {
  hostLeaf?: WorkspaceLeaf;
  initialContent?: string;
  onChange?: (content: string) => void;
  onEscape?: () => void;
  placeholder?: string;
  isReadOnly?: boolean;
  readonlyPlaceholder?: string;
  parentScope?: Scope;
}

export interface EditorSetupResult {
  impl: EditorImplementation;
  leafToMount: WorkspaceLeaf;
  trackWorkspaceChanges?: boolean;
  cleanup?: () => void;
}

type ContentListener = (content: string) => void;

export abstract class BaseEditor<TOptions extends BaseEditorOptions = BaseEditorOptions> {
  protected _impl!: EditorImplementation;

  readonly ready: Promise<this>;

  private onChangeRef: EventRef | null = null;
  private placeholderChangeRef: EventRef | null = null;
  private leafToMount: WorkspaceLeaf | null = null;
  private cleanup: (() => void) | null = null;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: MarkdownView | EmbeddableMarkdownEditor | null = null;
  private placeholderEl: HTMLElement | null = null;
  private contentListeners = new Set<ContentListener>();
  private pendingMountEl: HTMLElement | null = null;
  private pendingFocus = false;
  private pendingHotkeys: Array<{
    hotkey: Modifier[] | null;
    key: string;
    callback: KeymapEventListener;
  }> = [];
  private destroyed = false;

  protected constructor(
    protected readonly app: App,
    protected readonly options: TOptions,
  ) {
    this.ready = this.initialize().then(() => this);
  }

  protected abstract createImplementation(
    handleContentChange: (content: string) => void,
  ): Promise<EditorSetupResult>;

  get editor(): Editor {
    return this._impl.editor;
  }

  get view(): MarkdownView | EmbeddableMarkdownEditor | undefined {
    return this._impl?.view;
  }

  getContent(): string {
    return this._impl?.editor.getValue() ?? this.options.initialContent ?? "";
  }

  getContentSnapshot(): string {
    return this.getContent();
  }

  subscribeContent(listener: ContentListener): () => void {
    this.contentListeners.add(listener);
    return () => {
      this.contentListeners.delete(listener);
    };
  }

  setContent(content: string): void {
    this.options.initialContent = content;
    if (!this._impl) {
      return;
    }

    this.editor.setValue(content);
    this.updatePlaceholderVisibility();
  }

  unpatch(): void {
    unpatchToggleSourceCommand(true);
  }

  setReadOnly(isReadOnly: boolean): void {
    this.options.isReadOnly = isReadOnly;
    if (!this._impl) {
      return;
    }
    this.applyReadOnlyState();
    this.updatePlaceholderText();
  }

  setPlaceholder(placeholder: string, readonlyPlaceholder?: string): void {
    this.options.placeholder = placeholder;
    if (readonlyPlaceholder !== undefined) {
      this.options.readonlyPlaceholder = readonlyPlaceholder;
    }
    if (!this._impl) {
      return;
    }
    this.updatePlaceholderText();
  }

  loadToDom(el: HTMLElement): void {
    el.empty();
    if (!this.leafToMount) {
      this.pendingMountEl = el;
      return;
    }

    this.leafToMount.containerEl.setCssStyles({
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
    });
    el.appendChild(this.leafToMount.containerEl);
  }

  registerHotkey(hotkey: Modifier[] | null, key: string, callback: KeymapEventListener): void {
    if (!this._impl) {
      this.pendingHotkeys.push({ hotkey, key, callback });
      return;
    }

    this._impl.view.scope ??= new Scope();
    this._impl.view.scope.register(hotkey, key, callback);
  }

  focus(): void {
    if (!this._impl) {
      this.pendingFocus = true;
      return;
    }

    this.editor.focus();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    this.contentListeners.clear();

    if (this.onChangeRef) {
      this.app.workspace.offref(this.onChangeRef);
      this.onChangeRef = null;
    }
    if (this.placeholderChangeRef) {
      this.app.workspace.offref(this.placeholderChangeRef);
      this.placeholderChangeRef = null;
    }

    if (this.focusinHandler && this._impl) {
      this._impl.view.containerEl.removeEventListener("focusin", this.focusinHandler);
      this.focusinHandler = null;
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor = this.prevActiveEditor ?? null;
      this.prevActiveEditor = null;
    }

    if (this._impl) {
      this._impl.view.containerEl.detach();
      this._impl.destroy();
      this._impl = undefined as never;
    }

    this.leafToMount = null;
    this.cleanup?.();
    this.cleanup = null;
    this.pendingMountEl = null;
    this.pendingHotkeys = [];
    unpatchToggleSourceCommand();

    if (this.placeholderEl) {
      this.placeholderEl.remove();
      this.placeholderEl = null;
    }
  }

  private async initialize(): Promise<void> {
    const handleContentChange = (content: string) => {
      this.options.onChange?.(content);
      this.notifyContentListeners(content);
    };

    patchToggleSourceCommand(this.app);
    const { impl, leafToMount, trackWorkspaceChanges, cleanup } = await this.createImplementation(handleContentChange);
    if (this.destroyed) {
      impl.destroy();
      cleanup?.();
      unpatchToggleSourceCommand();
      return;
    }

    this._impl = impl;
    this.leafToMount = leafToMount;
    this.cleanup = cleanup ?? null;

    if (trackWorkspaceChanges && this.options.onChange) {
      this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
        if (editor === (this._impl.view as MarkdownView).editor) {
          handleContentChange(editor.getValue());
        }
      });
    }

    this.enableActiveEditorSync();
    this.registerMousedownHandler();
    this.applyStyles();
    this.initPlaceholder();
    this.applyReadOnlyState();
    this.flushPendingOperations();

    window.setTimeout(() => {
      if (this.destroyed || !this._impl) {
        return;
      }

      this.editor.focus();
      const hostView = this.options.hostLeaf?.view;
      if (hostView?.getViewType?.() === "markdown" && "editor" in hostView) {
        this.editor.setCursor((hostView as MarkdownView).editor.getCursor());
      }
    });
  }

  private enableActiveEditorSync(): void {
    const workspace = this.app.workspace as WorkspaceWithActiveEditor;
    this.prevActiveEditor = workspace._activeEditor ?? null;

    const handler = () => {
      workspace._activeEditor = this._impl.view;
    };
    this.focusinHandler = handler;
    this._impl.view.containerEl.addEventListener("focusin", handler);
    handler();
  }

  private applyStyles(): void {
    this._impl.view.editor.cm.contentDOM.setCssStyles({
      paddingTop: "var(--editor-padding-top)",
      paddingBottom: "var(--editor-padding-bottom)",
    });
  }

  private registerMousedownHandler(): void {
    const sizer = this._impl.view.containerEl.find(".cm-sizer");
    if (!sizer) {
      return;
    }

    sizer.addEventListener("mousedown", (event: MouseEvent) => {
      const pos = this._impl.view.editor.posAtMouse(event);
      setTimeout(() => {
        if (pos) {
          this._impl.view.editor.setSelection(pos, pos);
        }
        this._impl.view.editor.focus();
      });
    });
  }

  private initPlaceholder(): void {
    this.updatePlaceholderText();
    this.updatePlaceholderVisibility();
    this.placeholderChangeRef = this.app.workspace.on("editor-change", () => {
      this.updatePlaceholderVisibility();
    });
  }

  private updatePlaceholderVisibility(): void {
    if (!this.placeholderEl) {
      return;
    }

    this.placeholderEl.setCssStyles({
      display: this.getContent() ? "none" : "block",
    });
  }

  private ensurePlaceholder(): void {
    if (this.placeholderEl) {
      return;
    }

    this._impl.view.containerEl.setCssStyles({ position: "relative" });
    this.placeholderEl = this._impl.view.containerEl.createDiv({
      cls: "magical-editor-placeholder",
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
  }

  private updatePlaceholderText(): void {
    const placeholderText = this.options.isReadOnly
      ? (this.options.readonlyPlaceholder ?? this.options.placeholder)
      : this.options.placeholder;

    if (!placeholderText) {
      if (this.placeholderEl) {
        this.placeholderEl.setText("");
        this.updatePlaceholderVisibility();
      }
      return;
    }

    this.ensurePlaceholder();
    this.placeholderEl?.setText(placeholderText);
    this.updatePlaceholderVisibility();
  }

  private applyReadOnlyState(): void {
    if (this.options.isReadOnly) {
      this.editor.cm.contentDOM.contentEditable = "false";
      this._impl.view.containerEl.addClass("is-read-only");
      return;
    }

    this.editor.cm.contentDOM.contentEditable = "true";
    this._impl.view.containerEl.removeClass("is-read-only");
  }

  private notifyContentListeners(content: string): void {
    for (const listener of this.contentListeners) {
      listener(content);
    }
  }

  private flushPendingOperations(): void {
    if (!this._impl) {
      return;
    }

    if (this.pendingMountEl) {
      const mountEl = this.pendingMountEl;
      this.pendingMountEl = null;
      this.loadToDom(mountEl);
    }

    for (const hotkey of this.pendingHotkeys) {
      this.registerHotkey(hotkey.hotkey, hotkey.key, hotkey.callback);
    }
    this.pendingHotkeys = [];

    if (this.pendingFocus) {
      this.pendingFocus = false;
      this.focus();
    }
  }
}
