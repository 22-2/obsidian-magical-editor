import { App, MarkdownView, TFile } from "obsidian";
import { BaseEditor, BaseEditorOptions, EditorSetupResult } from "./BaseEditor";
import { createHiddenLeaf } from "./editors";
import { MirrorEditorAdapter } from "./editors/mirror-editor";

export interface MirrorEditorOptions extends BaseEditorOptions {
  file: TFile;
}

export class MirrorEditor extends BaseEditor<MirrorEditorOptions> {
  constructor(app: App, options: MirrorEditorOptions) {
    super(app, options);
  }

  protected async createImplementation(): Promise<EditorSetupResult> {
    const leafToMount = createHiddenLeaf(this.app);
    await leafToMount.openFile(this.options.file);

    const impl = new MirrorEditorAdapter(leafToMount.view as MarkdownView);
    if (this.options.initialContent !== undefined) {
      impl.editor.setValue(this.options.initialContent);
    }

    return {
      impl,
      leafToMount,
      trackWorkspaceChanges: true,
      cleanup: () => {
        leafToMount.detach?.();
      },
    };
  }
}
