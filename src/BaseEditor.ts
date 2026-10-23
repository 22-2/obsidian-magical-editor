import {
  Compartment,
  EditorState,
  Prec,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { around } from "monkey-around";
import {
  App,
  Editor,
  type EventRef,
  type KeymapEventListener,
  MarkdownView,
  type Modifier,
  Scope,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import {
  type EditorImplementation,
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
  /** Focus the editor after initialization. Default: `true`. */
  autoFocus?: boolean;
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

interface ViewWithLocalExtensions {
  editMode: {
    buildLocalExtensions(): Extension[];
  };
}

type ContentListener = (content: string) => void;

export abstract class BaseEditor<
  TOptions extends BaseEditorOptions = BaseEditorOptions,
> {
  protected _impl!: EditorImplementation;

  readonly ready: Promise<this>;

  private onChangeRef: EventRef | null = null;
  private leafToMount: WorkspaceLeaf | null = null;
  private cleanup: (() => void) | null = null;
  private focusinHandler: (() => void) | null = null;
  private prevActiveEditor: MarkdownView | EmbeddableMarkdownEditor | null =
    null;
  private editorExtensionCompartment = new Compartment();
  private editorExtensionCleanup: (() => void) | null = null;
  private contentListeners = new Set<ContentListener>();
  private pendingMountEl: HTMLElement | null = null;
  private pendingFocus = false;
  private pendingHotkeys: Array<{
    hotkey: Modifier[] | null;
    key: string;
    callback: KeymapEventListener;
  }> = [];
  private pendingInitialContentSync = false;
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
      this.pendingInitialContentSync = true;
      return;
    }

    this.pendingInitialContentSync = false;
    this.editor.setValue(content);
  }

  setCursor(pos: number): void {
    if (!this._impl) {
      return;
    }
    this.editor.setCursor(pos, pos);
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

  registerHotkey(
    hotkey: Modifier[] | null,
    key: string,
    callback: KeymapEventListener,
  ): void {
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
    this.editorExtensionCleanup?.();
    this.editorExtensionCleanup = null;

    if (this.focusinHandler && this._impl) {
      this._impl.view.containerEl.removeEventListener(
        "focusin",
        this.focusinHandler,
      );
      this.focusinHandler = null;
      (this.app.workspace as WorkspaceWithActiveEditor)._activeEditor =
        this.prevActiveEditor ?? null;
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
  }

  private async initialize(): Promise<void> {
    const handleContentChange = (content: string) => {
      this.options.onChange?.(content);
      this.notifyContentListeners(content);
    };

    patchToggleSourceCommand(this.app);
    const { impl, leafToMount, trackWorkspaceChanges, cleanup } =
      await this.createImplementation(handleContentChange);
    if (this.destroyed) {
      impl.destroy();
      cleanup?.();
      unpatchToggleSourceCommand();
      return;
    }

    this._impl = impl;
    this.leafToMount = leafToMount;
    this.cleanup = cleanup ?? null;

    if (this.pendingInitialContentSync) {
      // Re-apply latest content only when setContent() ran before async setup finished.
      // This keeps ready() as the point where DOM and snapshot are guaranteed in sync,
      // without forcing an extra layout pass on the common first-mount path.
      this.editor.setValue(this.options.initialContent ?? "");
      this.pendingInitialContentSync = false;
    }

    if (trackWorkspaceChanges && this.options.onChange) {
      this.onChangeRef = this.app.workspace.on("editor-change", (editor) => {
        if (editor === (this._impl.view as MarkdownView).editor) {
          handleContentChange(editor.getValue());
        }
      });
    }

    this.enableActiveEditorSync();
    this.initPlaceholder();
    this.applyReadOnlyState();
    this.flushPendingOperations();

    window.setTimeout(() => {
      if (
        this.destroyed ||
        !this._impl ||
        this.options.autoFocus === false
      ) {
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

  private initPlaceholder(): void {
    const editMode = (this._impl.view as unknown as ViewWithLocalExtensions)
      .editMode;
    const self = this;

    // Obsidian rebuilds local extensions when editor options or source mode change.
    // Keep our compartment in that configuration, scoped to this editor instance.
    this.editorExtensionCleanup = around(editMode, {
      buildLocalExtensions: (original) =>
        function (this: ViewWithLocalExtensions["editMode"]) {
          return [
            ...original.call(this),
            self.editorExtensionCompartment.of(self.createEditorExtensions()),
          ];
        },
    });
    this.editor.cm.dispatch({
      effects: StateEffect.appendConfig.of(
        this.editorExtensionCompartment.of(this.createEditorExtensions()),
      ),
    });
  }

  private createEditorExtensions(): Extension {
    const text = this.options.isReadOnly
      ? (this.options.readonlyPlaceholder ?? this.options.placeholder)
      : this.options.placeholder;

    return [
      text
        ? placeholder((view) => {
            const span = view.dom.ownerDocument.createElement("span");
            span.className = "magical-editor-placeholder";
            span.textContent = text;
            return span;
          })
        : [],
      EditorView.theme({
        ".cm-placeholder": {
          color: "var(--text-muted)",
          opacity: "0.5",
          whiteSpace: "pre-wrap",
        },
      }),
      // Obsidian also supplies contenteditable through contentAttributes.
      // Override both sources so option updates cannot re-enable a read-only editor.
      Prec.highest([
        EditorView.editable.of(!this.options.isReadOnly),
        EditorState.readOnly.of(!!this.options.isReadOnly),
        EditorView.contentAttributes.of({
          contenteditable: String(!this.options.isReadOnly),
        }),
      ]),
      // Obsidian sets `user-select: none` app-wide and only turns text selection back on
      // for contenteditable="true" content. A read-only editor is contenteditable="false",
      // so without this its text cannot be selected or copied.
      this.options.isReadOnly
        ? EditorView.theme({ ".cm-content": { userSelect: "text" } })
        : [],
    ];
  }

  private updatePlaceholderText(): void {
    // Reconfigure only this compartment so document, selection and other extensions survive.
    this.editor.cm.dispatch({
      effects: this.editorExtensionCompartment.reconfigure(
        this.createEditorExtensions(),
      ),
    });
  }

  private applyReadOnlyState(): void {
    this._impl.view.containerEl.toggleClass(
      "is-read-only",
      !!this.options.isReadOnly,
    );
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
