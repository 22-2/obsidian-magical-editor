import {
    App,
    Component,
    MarkdownScrollableEditView,
    Scope,
    TFile, WidgetEditorView,
    Workspace,
    WorkspaceLeaf
} from "obsidian";

import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder, ViewUpdate } from "@codemirror/view";

import { around } from "monkey-around";
import { Editor } from "obsidian";

/**
 * Internal Obsidian types not exposed in the official API
 */
interface MarkdownEditorInstance extends MarkdownScrollableEditView {
	editor: Editor;
	owner: MockView;
	onUpdate: (update: ViewUpdate, changed: boolean) => void;
	updateOptions: () => void;
	buildLocalExtensions: () => any[];
	updateBottomPadding: () => void;
	destroy: () => void;
	toggleSource: () => void;
}

interface MarkdownEditorConstructor {
	new (app: App, container: HTMLElement, owner: MockView): MarkdownEditorInstance;
	prototype: MarkdownEditorInstance;
}

interface MockView extends Component {
	app: App;
	leaf?: WorkspaceLeaf;
	containerEl?: HTMLElement;
	contentEl?: HTMLElement;
	onMarkdownScroll: () => void;
	getMode: () => string;
	getViewType: () => string;
	getDisplayText?: () => string;
	showSearch: () => void;
	toggleMode: () => void;
	scroll: number;
	file: TFile | null;
	path: string;
	editMode: MarkdownEditorInstance | null;
	// Optional properties for some plugins
	editor?: Editor;
	save?: () => Promise<void>;
	requestSave?: () => Promise<void>;

	// Additional methods to mimic MarkdownView
	getState?: () => any;
	setState?: (state: any, result: any) => Promise<void>;
	previewMode?: any;
}

interface InternalApp extends App {
	embedRegistry: {
		embedByExtension: {
			md: (
				info: { app: App; containerEl: HTMLElement },
				file: TFile | null,
				content: string
			) => WidgetEditorView;
		};
	};
}

interface InternalEditor extends Editor {
	cm: EditorView;
}

/**
 * Creates an embeddable markdown editor
 * @param app The Obsidian app instance
 * @param container The container element
 * @param options Editor options
 * @returns A configured markdown editor
 */
export async function createEmbeddableMarkdownEditor(
	app: App,
	container: HTMLElement,
	options: Partial<MarkdownEditorProps>,
	leaf?: WorkspaceLeaf
): Promise<EmbeddableMarkdownEditor> {
	// Get the editor class
	const EditorClass = resolveEditorPrototype(app);
	const associatedFile = await ensureAssociatedFile(app);

	// Create the editor instance
	return new EmbeddableMarkdownEditor(app, EditorClass, container, options, associatedFile, leaf);
}

async function ensureAssociatedFile(app: App): Promise<TFile> {
	const lastOpenFilePath = app.workspace.getLastOpenFiles()[0];
	if (lastOpenFilePath) {
		const lastOpenFile = app.vault.getFileByPath(lastOpenFilePath);
		if (lastOpenFile) {
			return lastOpenFile;
		}
	}

	const existingMarkdownFile = app.vault.getMarkdownFiles()[0];
	if (existingMarkdownFile) {
		return existingMarkdownFile;
	}

	return app.fileManager.createNewMarkdownFile();
}

/**
 * Resolves the markdown editor prototype from the app
 */
function resolveEditorPrototype(app: App): MarkdownEditorConstructor {
	// Create a temporary editor to resolve the prototype of ScrollableMarkdownEditor
	const widgetEditorView = (app as unknown as InternalApp).embedRegistry.embedByExtension.md(
		{ app, containerEl: createDiv() },
		null as unknown as TFile,
		""
	);

	// Mark as editable to instantiate the editor
	widgetEditorView.editable = true;
	widgetEditorView.showEditor();
	const MarkdownEditor = Object.getPrototypeOf(
		Object.getPrototypeOf(widgetEditorView.editMode!)
	);

	// Unload to remove the temporary editor
	widgetEditorView.unload();

	// Return the constructor, using 'any' type to bypass the abstract class check
	return MarkdownEditor.constructor as MarkdownEditorConstructor;
}

interface MarkdownEditorProps {
	cursorLocation?: { anchor: number; head: number };
	value?: string;
	cls?: string;
	placeholder?: string;
	singleLine?: boolean; // New option for single line mode

	onEnter: (
		editor: EmbeddableMarkdownEditor,
		mod: boolean,
		shift: boolean
	) => boolean;
	onEscape: (editor: EmbeddableMarkdownEditor) => void;
	onSubmit: (editor: EmbeddableMarkdownEditor) => void;
	onBlur: (editor: EmbeddableMarkdownEditor) => void;
	onFocus: (editor: EmbeddableMarkdownEditor) => void;
	onPaste: (e: ClipboardEvent, editor: EmbeddableMarkdownEditor) => void;
	onChange: (update: ViewUpdate) => void;
	parentScope?: Scope;
}

const defaultProperties: MarkdownEditorProps = {
	cursorLocation: { anchor: 0, head: 0 },
	value: "",
	singleLine: false,
	cls: "",
	placeholder: "",

	onEnter: () => false,
	onEscape: () => {},
	onSubmit: () => {},
	// NOTE: Blur takes precedence over Escape (this can be changed)
	onBlur: () => {},
	onFocus: () => {},
	onPaste: () => {},
	onChange: () => {},
};

// app.workspace.activeEditorにセットされる
/**
 * A markdown editor that can be embedded in any container
 */
export class EmbeddableMarkdownEditor {
	options: MarkdownEditorProps;
	initial_value: string;
	scope: Scope;
	editMode: MarkdownEditorInstance;
	mockView: MockView;
	app: App;

	// Expose commonly accessed properties
	get editorEl(): HTMLElement {
		return this.editMode.editorEl;
	}
	get containerEl(): HTMLElement {
		return this.editMode.containerEl;
	}
	get activeCM(): EditorView {
		return this.editMode.activeCM;
	}
	get editor(): Editor {
		return this.editMode.editor;
	}
	get owner(): MockView {
		return this.editMode.owner;
	}
	get _loaded(): boolean {
		return this.editMode._loaded;
	}
	get file(): TFile | null {
		return this.owner.file;
	}
	getMode(): string {
		return "source";
	}
	getViewType(): string {
		return "v-markdown";
	}
	getDisplayText(): string {
		return this.owner.getDisplayText?.() || "Virtual Editor";
	}
	getState() {
		return this.owner.getState?.();
	}
	setState(state: any, result: any) {
		return this.owner.setState?.(state, result);
	}

	// Mock view properties to satisfy Obsidian internals
	async save() {}
	async requestSave() {}

	/**
	 * Construct the editor
	 * @param app - Reference to App instance
	 * @param EditorClass - The editor class constructor
	 * @param container - Container element to add the editor to
	 * @param options - Options for controlling the initial state of the editor
	 */
	constructor(
		app: App,
		EditorClass: MarkdownEditorConstructor,
		container: HTMLElement,
		options: Partial<MarkdownEditorProps>,
		associatedFile: TFile,
		leaf?: WorkspaceLeaf
	) {
		this.app = app;
		// Store user options first
		this.options = { ...defaultProperties, ...options };
		this.initial_value = this.options.value!;
		this.scope = new Scope(this.options.parentScope || app.scope);

		// Prevent Mod+Enter default behavior and trigger onSubmit
		this.scope.register(["Ctrl"], "Enter", () => {
			this.options.onEnter(this, true, false);
			return false;
		});

		// @ts-expect-error
		this.app.scope.keys = this.app.scope.keys.filter((binding) => binding.key !== "Escape");
		; // Remove Escape handler added by Obsidian
		this.scope.register([], "Escape", () => {
			// Clear selection
			this.editor.cm.dispatch({
				selection: EditorSelection.single(this.activeCM.state.selection.main.head),
			});

			if (this.options.onEscape) {
				this.options.onEscape(this);
			}
			return true;
		});

		// Store reference to self for the patched method BEFORE using it
		const self = this;

		// Create a robust mock view (owner)
		// DO NOT USE FakeTFile, because it will cause the editor to be treated as a real file, which will cause various problems
		const file = associatedFile;

		const mockView = new Component() as MockView;
		Object.assign(mockView, {
			app,
			showSearch: () => {},
			toggleMode: () => {},
			onMarkdownScroll: () => {},
			getMode: () => "source",
			getViewType: () => "markdown",
			scroll: 0,
			editMode: null,
			containerEl: container,
			contentEl: container,
			get file() {
				return file;
			},
			get path() {
				return file?.path || "";
			},
			leaf: leaf || app.workspace.getLeaf(false),
			register: (cb: (editor: EmbeddableMarkdownEditor) => void) => self.register(cb),
			getState: () => ({ mode: "source", source: false }),
      syncScroll: () => {
        // this.editMode.getSCroll();
      },
			setState: async () => {},
			previewMode: {
				containerEl: createDiv(),
				renderer: {
					on: () => {},
					off: () => {},
				}
			}
		});
		this.mockView = mockView;

		// Use monkey-around to safely patch the method
		const uninstaller = around(EditorClass.prototype, {
			buildLocalExtensions: (originalMethod: (this: MarkdownEditorInstance) => any[]) =>
				function (this: MarkdownEditorInstance) {
					const extensions = originalMethod.call(this);

					// Only add our custom extensions if this is our editor instance
					// We check this.owner === mockView instead of this === self.editMode
					// because self.editMode is undefined during the constructor execution!
					if (this.owner === mockView) {
						// Add placeholder if configured
						if (self.options.placeholder) {
							extensions.push(
								// placeholder(self.options.placeholder)
							);
						}

						// Add paste, blur, and focus event handlers
						extensions.push(
							EditorView.domEventHandlers({
								paste: (event) => {
									self.options.onPaste(event, self);
								},
								blur: () => {
									// Always trigger blur callback and let it handle the logic
									app.keymap.popScope(self.scope);
									if (self.options.onBlur) {
										self.options.onBlur(self);
									}
								},
								focusin: () => {
									app.keymap.pushScope(self.scope);
									// @ts-expect-error
									app.workspace.activeEditor = self.owner;
								},
							})
						);

						// Add keyboard handlers
						const keyBindings = [
							{
								key: "Enter",
								run: () => {
									return self.options.onEnter(
										self,
										false,
										false
									);
								},
								shift: () =>
									self.options.onEnter(
										self,
										false,
										true
									),
							},
							{
								key: "Mod-Enter",
								run: () =>
									self.options.onEnter(
										self,
										true,
										false
									),
								shift: () =>
									self.options.onEnter(
										self,
										true,
										true
									),
							},
							{
								key: "Escape",
								run: () => {
									self.options.onEscape(self);
									return true;
								},
								preventDefault: true,
							},
						];

						// For single line mode, prevent Enter key from creating new lines
						if (self.options.singleLine) {
							keyBindings[0] = {
								key: "Enter",
								run: () => {
									// In single line mode, Enter should trigger onEnter
									return self.options.onEnter(
										self,
										false,
										false
									);
								},
								shift: () => {
									// Even with shift, still call onEnter in single line mode
									return self.options.onEnter(
										self,
										false,
										true
									);
								},
							};
						}

						extensions.push(
							Prec.highest(keymap.of(keyBindings))
						);
					}

					return extensions;
				},
			// Thino subclasses and overrides updateBottomPadding to do nothing.
			// This prevents layout crashes in non-standard environments.
			updateBottomPadding: (originalMethod: (this: MarkdownEditorInstance) => void) =>
				function (this: MarkdownEditorInstance) {
					if (this.owner === mockView) return;
					return originalMethod.call(this);
				},
		});

		// Create the editor with the app instance
		this.editMode = new EditorClass(app, container, mockView);
		mockView.editMode = this.editMode;
		mockView.addChild(this.editMode);

		// Initialize mock view and editor
		if (typeof this.editMode.load === "function") {
			// embeded-viewに必須
			this.editMode.load();
		}
		mockView.load();

		// Register the uninstaller for cleanup
		this.register(uninstaller);

		// Set up the editor relationship for commands to work
		if (this.owner) {
			this.owner.editMode = this.editMode;
			this.owner.editor = this.editMode.editor;
		}

		// ここを消すとほかプラグインからのregisterEditorExtensionの影響が受けられなくなる
		// Support dynamic updates to editor extensions (e.g. when a plugin is enabled/disabled)
		this.register(
			around(app.workspace, {
				updateOptions: (oldMethod: (...args: any[]) => void) =>
					function (this: Workspace, ...args: any[]) {
						oldMethod.apply(this, args);
						if (typeof self.editMode.updateOptions === "function") {
							self.editMode.updateOptions();
						}
					},
			})
		);

		// Set initial content
		this.set(options.value || "", false);


		// Blur and focus event handlers are now handled via EditorView.domEventHandlers in buildLocalExtensions

		// Apply custom class if provided
		if (options.cls && this.editorEl) {
			this.editorEl.classList.add(options.cls);
		}

		// Set cursor position if specified
		if (options.cursorLocation && this.editMode.editor) {
			(this.editMode.editor as InternalEditor).cm.dispatch({
				selection: EditorSelection.range(
					options.cursorLocation.anchor,
					options.cursorLocation.head
				),
			});
		}

		// Override onUpdate to call our onChange handler
		const originalOnUpdate = this.editMode.onUpdate.bind(this.editMode);
		this.editMode.onUpdate = (update: ViewUpdate, changed: boolean) => {
			originalOnUpdate(update, changed);
			if (changed) this.options.onChange(update);
		};

    const editorEl = (this.editor as unknown as { containerEl: HTMLElement }).containerEl;
    editorEl.addEventListener("focusin", () => {
      this.options.onFocus(this);
    });
    editorEl.addEventListener("focusout", () => {
      this.options.onBlur(this);
    });
	}

	// Get the current editor value
	get value(): string {
		return (this.editMode.editor as InternalEditor).cm?.state.doc.toString() || "";
	}

	// Set content in the editor
	set(content: string, focus: boolean = false): void {
		this.editMode.set(content, focus);
	}

	// Register cleanup callback
	register(cb: (editor: EmbeddableMarkdownEditor) => void): void {
		this.editMode.register(cb as any);
	}

	// Clean up method that ensures proper destruction
	destroy(): void {
		if (this._loaded && typeof this.editMode.unload === "function") {
			this.editMode.unload();
		}

		this.app.keymap.popScope(this.scope);
		this.app.workspace.activeEditor = null;
		this.containerEl.empty();

		this.editMode.destroy();
	}

	// Unload handler
	onunload(): void {
		if (typeof this.editMode.onunload === "function") {
			this.editMode.onunload();
		}
		this.destroy();
	}

	// Required method for MarkdownScrollableEditView compatibility
	unload(): void {
		if (typeof this.editMode.unload === "function") {
			this.editMode.unload();
		}
	}
}
