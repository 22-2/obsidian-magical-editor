import { App, MarkdownView } from "obsidian";
import {
  BaseEditor,
  type BaseEditorOptions,
  type EditorSetupResult,
} from "./BaseEditor";
import { createFakeLeaf } from "./editors";
import { FakeEditorAdapter } from "./editors/fake-editor";
import {
  createEmbeddableMarkdownEditor,
  EmbeddableMarkdownEditor,
} from "./editors/internal/magical-embeddable-editor";

export interface FakeEditorOptions extends BaseEditorOptions {
  onEnter?: (
    editor: EmbeddableMarkdownEditor,
    mod: boolean,
    shift: boolean,
  ) => boolean | void;
  onChange?: (content: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
}

export class FakeEditor extends BaseEditor<FakeEditorOptions> {
  constructor(app: App, options: FakeEditorOptions) {
    super(app, options);
  }

  protected async createImplementation(
    handleContentChange: (content: string) => void,
  ): Promise<EditorSetupResult> {
    const leafToMount = createFakeLeaf(this.app);
    const view = await createEmbeddableMarkdownEditor(
      this.app,
      leafToMount.containerEl,
      {
        value: this.options.initialContent ?? "",
        onChange: () => {
          handleContentChange(this.getContent());
        },
        onEnter: (editor, mod, shift) => {
          return this.options.onEnter?.(editor, mod, shift) ?? false;
        },
        onEscape: () => {
          this.options.onEscape?.();
        },
        onBlur: () => {
          this.options.onBlur?.();
        },
        onFocus: () => {
          this.options.onFocus?.();
        },
        parentScope:
          this.options.parentScope ||
          (this.options.hostLeaf?.view as MarkdownView | undefined)?.scope ||
          this.app.scope,
      },
      leafToMount,
    );

    return {
      impl: new FakeEditorAdapter(view),
      leafToMount,
    };
  }
}
