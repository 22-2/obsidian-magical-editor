const { Plugin, ItemView, TFile } = require("obsidian");
const { MagicalEditor, ModalEditor } = require("../../../src/index.ts");

const FILE_PATH = "magical-editor-harness.md";
const VIEW_TYPES = {
  file: "magical-editor-harness-file-view",
  virtual: "magical-editor-harness-virtual-view",
};
const PLACEHOLDERS = {
  file: "File placeholder",
  virtual: "Virtual placeholder",
};
const MODAL_PLACEHOLDERS = {
  file: "File modal placeholder",
  virtual: "Virtual modal placeholder",
};

async function ensureHarnessFile(app) {
  const existing = app.vault.getAbstractFileByPath(FILE_PATH);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, "");
    return existing;
  }
  return await app.vault.create(FILE_PATH, "");
}

function syncActiveEditor(app, editor) {
  return () => {
    app.workspace.activeEditor = editor.view;
  };
}

class HarnessView extends ItemView {
  constructor(leaf, plugin, mode) {
    super(leaf);
    this.plugin = plugin;
    this.mode = mode;
    this.editor = null;
    this.focusinHandler = null;
  }

  getViewType() {
    return VIEW_TYPES[this.mode];
  }

  getDisplayText() {
    return `Harness ${this.mode}`;
  }

  getIcon() {
    return "pencil";
  }

  async onOpen() {
    this.contentEl.empty();
    const host = this.contentEl.createDiv({
      cls: `magical-editor-harness-view mode-${this.mode}`,
    });

    const options = {
      initialContent: "",
      placeholder: PLACEHOLDERS[this.mode],
      onChange: (content) => {
        this.plugin.lastViewContent[this.mode] = content;
      },
    };

    if (this.mode === "file") {
      options.file = await ensureHarnessFile(this.app);
    }

    this.editor = await MagicalEditor.create(this.app, this.leaf, options);
    this.editor.loadToDom(host);

    this.focusinHandler = syncActiveEditor(this.app, this.editor);
    this.editor.view.containerEl.addEventListener(
      "focusin",
      this.focusinHandler,
    );

    this.plugin.activeViews[this.mode] = this;
    window.setTimeout(() => this.editor.focus(), 50);
  }

  async onClose() {
    this.plugin.activeViews[this.mode] = null;
    if (this.editor && this.focusinHandler) {
      this.editor.view.containerEl.removeEventListener(
        "focusin",
        this.focusinHandler,
      );
    }
    this.editor?.destroy();
    this.editor = null;
  }
}

class HarnessModal extends ModalEditor {
  constructor(app, plugin, mode, options) {
    super(app, options);
    this.plugin = plugin;
    this.mode = mode;
    this.focusinHandler = null;
    this.modalEl.addClass("magical-editor-harness-modal");
    this.modalEl.addClass(`mode-${mode}`);
  }

  async onOpen() {
    await super.onOpen();
    this.focusinHandler = syncActiveEditor(this.app, this.editor);
    this.editor.view.containerEl.addEventListener(
      "focusin",
      this.focusinHandler,
    );
    this.plugin.activeModal = this;
    window.setTimeout(() => this.editor.focus(), 50);
  }

  onClose() {
    this.plugin.lastModalContent[this.mode] = this.getContent();
    if (this.editor && this.focusinHandler) {
      this.editor.view.containerEl.removeEventListener(
        "focusin",
        this.focusinHandler,
      );
    }
    this.plugin.activeModal = null;
    super.onClose();
  }
}

module.exports = class MagicalEditorHarnessPlugin extends Plugin {
  async onload() {
    this.activeViews = {
      file: null,
      virtual: null,
    };
    this.activeModal = null;
    this.lastViewContent = {
      file: "",
      virtual: "",
    };
    this.lastModalContent = {
      file: "",
      virtual: "",
    };

    this.registerView(
      VIEW_TYPES.file,
      (leaf) => new HarnessView(leaf, this, "file"),
    );
    this.registerView(
      VIEW_TYPES.virtual,
      (leaf) => new HarnessView(leaf, this, "virtual"),
    );

    this.addCommand({
      id: "open-file-view",
      name: "Open file view",
      callback: async () => {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPES.file, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-virtual-view",
      name: "Open virtual view",
      callback: async () => {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPES.virtual, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-file-modal",
      name: "Open file modal",
      callback: async () => {
        const file = await ensureHarnessFile(this.app);
        new HarnessModal(this.app, this, "file", {
          file,
          initialContent: "",
          placeholder: MODAL_PLACEHOLDERS.file,
          onChange: (content) => {
            this.lastModalContent.file = content;
          },
        }).open();
      },
    });

    this.addCommand({
      id: "open-virtual-modal",
      name: "Open virtual modal",
      callback: async () => {
        new HarnessModal(this.app, this, "virtual", {
          initialContent: "",
          placeholder: MODAL_PLACEHOLDERS.virtual,
          onChange: (content) => {
            this.lastModalContent.virtual = content;
          },
        }).open();
      },
    });
  }

  async onunload() {
    if (this.activeModal) {
      this.activeModal.close();
    }
    for (const mode of Object.keys(this.activeViews)) {
      const view = this.activeViews[mode];
      if (view?.leaf?.detach) {
        view.leaf.detach();
      }
    }
  }
};
