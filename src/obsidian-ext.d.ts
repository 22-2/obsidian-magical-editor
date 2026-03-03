import { EditorView } from "@codemirror/view";
import "obsidian";

declare module "obsidian" {
  interface WorkspaceLeaf {
    containerEl: HTMLElement;
  }
  interface MarkdownView {
    headerEl: HTMLElement;
    saveTitle(title: string): void;
  }
  interface Editor {
    posAtMouse(event: MouseEvent): EditorPosition;
    cm: EditorView;
  }
  interface App {
    embedRegistry: {
      embedByExtension: {
        md: (info: any, file: TFile, content: string) => WidgetEditorView;
      };
    };
  }
  interface WidgetEditorView {
    editable: boolean;
    showEditor(): void;
    editMode: MarkdownScrollableEditView;
    unload(): void;
  }
  interface MarkdownScrollableEditView extends Component {
    activeCM: EditorView;
    editor: Editor;
    editorEl: HTMLElement;
    containerEl: HTMLElement;
    app: App;
    owner: any;
    _loaded: boolean;
    onUpdate(update: any, changed: boolean): void;
    set(content: string, focus: boolean): void;
  }
}
