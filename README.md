# obsidian-magical-editor

A reusable inline Markdown editor wrapper for Obsidian plugins.  
Embed a full-featured Obsidian Markdown editor into any `ItemView` or `Modal` — without creating or writing to actual vault files.

## Install

```bash
pnpm add git+https://github.com/YOUR_NAME/obsidian-magical-editor.git
```

Or from a local path during development:

```bash
pnpm add git+file:///path/to/obsidian-magical-editor
```

## Usage

### 1. Make your view implement `TInlineView`

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import { MagicalEditorWrapper, TInlineView } from "obsidian-magical-editor";

export class MyView extends ItemView implements TInlineView {
  public wrapper: MagicalEditorWrapper;
  public editor!: Editor;
  public file!: TFile;

  constructor(leaf: WorkspaceLeaf, private plugin: Plugin) {
    super(leaf);

    this.wrapper = new MagicalEditorWrapper({
      getActiveView: () => this,
      workspace: {
        _activeEditor: null as never,
        on: this.app.workspace.on.bind(this.app.workspace),
      },
      registerEvent: (ev) => this.registerEvent(ev),
      parentView: this,
      onChange: () => {
        const content = this.wrapper.getContent();
        // handle changes
      },
    });
  }

  async onOpen() {
    const editorArea = this.contentEl.createDiv();
    await this.wrapper.initialize(editorArea, null);
    this.editor = this.wrapper.magicalEditor.editor;
    this.file = this.wrapper.magicalEditor.file!;
  }

  async onClose() {
    this.wrapper.unload();
  }

  async getContent(): Promise<string> {
    return this.wrapper?.getContent() ?? "";
  }

  setContent(content: string): void {
    this.wrapper?.setContent(content);
  }
}
```

### 2. Use in a Modal

```ts
import { Modal, App, WorkspaceLeaf } from "obsidian";

export class MyEditorModal extends Modal {
  private leaf: WorkspaceLeaf | null = null;

  async onOpen() {
    this.modalEl.style.width = "80vw";
    this.modalEl.style.height = "85vh";

    this.leaf = this.app.workspace.createLeafInParent(
      this.app.workspace.rootSplit,
      0
    );
    if (this.leaf) {
      this.leaf.containerEl.style.display = "none";
      // set up your view on this.leaf ...
      this.contentEl.appendChild(this.leaf.view.containerEl);
    }
  }

  onClose() {
    this.contentEl.empty();
    this.leaf?.detach();
    this.leaf = null;
  }
}
```

## API

### `MagicalEditorWrapper`

| Method | Description |
|---|---|
| `initialize(target, initialState)` | DOM に attach してエディタを起動 |
| `getContent()` | 現在のエディタの内容を取得 |
| `setContent(content)` | エディタの内容をセット |
| `focus()` | エディタにフォーカス |
| `unload()` | DOM から取り外し、後片付け |

### `TInlineView` (interface)

親となるビューが実装する必要があるインターフェース。

## License

MIT
