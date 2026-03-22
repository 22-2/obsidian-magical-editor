const { Plugin, MarkdownView, Notice } = require("obsidian");
const { ModalEditor } = require("../../../src/index.ts");

module.exports = class MinimalModalOpener extends Plugin {
  async onload() {
    this.addRibbonIcon("popup-open", "Open Magical Modal", () => {
      this.openModal();
    });

    this.addCommand({
      id: "open-magical-modal",
      name: "Open Magical Modal",
      editorCallback: () => {
        this.openModal();
      },
    });
  }

  openModal() {
    const activeView = this.app.workspace.activeLeaf?.view;
    if (!(activeView instanceof MarkdownView)) {
      new Notice("Please open a markdown file");
      return;
    }

    const editor = activeView.editor;
    new ModalEditor(this.app, {
      initialContent: editor.getValue(),
      file: activeView.file,
      sourceEditor: editor,
      hostLeaf: activeView.leaf,
      onChange: (content) => {
        editor.setValue(content);
      },
    }).open();
  }
};