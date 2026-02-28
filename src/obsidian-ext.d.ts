import "obsidian";
import { EditorView } from "@codemirror/view";

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
}
