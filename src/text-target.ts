import {
	App,
	Editor,
	EditorPosition,
	ItemView,
	MarkdownView,
	Plugin,
	WorkspaceWindow,
} from 'obsidian';
import { EditorView } from '@codemirror/view';

/** The editor calls the toggle commands use. */
export type TextEditor = Pick<
	Editor,
	| 'getSelection'
	| 'getCursor'
	| 'getLine'
	| 'getRange'
	| 'replaceSelection'
	| 'replaceRange'
	| 'setCursor'
	| 'setSelection'
>;

/** Plain text with a selection, measured in character offsets. */
interface TextModel {
	text(): string;
	selection(): [number, number];
	select(from: number, to: number): void;
	replace(from: number, to: number, insert: string): void;
}

type Field = HTMLTextAreaElement | HTMLInputElement;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel']);

/** Cross-window safe: popout windows have their own element classes. */
function asHTMLElement(t: EventTarget | null): HTMLElement | null {
	const node = t as Node | null;
	return node?.instanceOf?.(HTMLElement) ? node : null;
}

function isField(el: Element): el is Field {
	if (el.instanceOf(HTMLTextAreaElement)) return !el.readOnly && !el.disabled;
	return (
		el.instanceOf(HTMLInputElement) &&
		TEXT_INPUT_TYPES.has(el.type) &&
		!el.readOnly &&
		!el.disabled
	);
}

function isEditable(el: Element): boolean {
	return (
		isField(el) ||
		!!el.closest('.cm-editor') ||
		(el.instanceOf(HTMLElement) && el.isContentEditable)
	);
}

/**
 * Focuses an element. Some views only show their text box while it is being
 * edited (a sticky note, a card), so a focus event is sent first to wake it up.
 */
function focus(el: HTMLElement): boolean {
	const doc = el.ownerDocument;
	el.focus();
	if (doc.activeElement !== el) {
		el.dispatchEvent(new FocusEvent('focus'));
		el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		el.focus();
	}
	return doc.activeElement === el;
}

/**
 * Types the text in, as the user would: the change goes through the browser,
 * so it can be undone and the owner of the text box hears about it.
 */
function typeText(doc: Document, insert: string): boolean {
	// execCommand is deprecated, but it is still the only way to edit a text
	// box with native undo and the input events its owner listens to.
	return insert
		? doc.execCommand('insertText', false, insert)
		: doc.execCommand('delete');
}

function fieldModel(el: Field): TextModel {
	return {
		text: () => el.value,
		selection: () => [el.selectionStart ?? 0, el.selectionEnd ?? 0],
		select: (from, to) => {
			focus(el);
			el.setSelectionRange(from, to);
		},
		// The value is changed directly, not typed in: typing through the
		// browser is unreliable in text boxes (it misbehaves with mobile
		// keyboards, autocomplete and plugins that listen to key input).
		replace: (from, to, insert) => {
			el.setRangeText(insert, from, to, 'end');
			el.dispatchEvent(new Event('input', { bubbles: true }));
		},
	};
}

function cmModel(view: EditorView): TextModel {
	return {
		text: () => view.state.doc.toString(),
		selection: () => {
			const r = view.state.selection.main;
			return [r.from, r.to];
		},
		select: (from, to) => {
			view.dispatch({ selection: { anchor: from, head: to } });
			view.focus();
		},
		replace: (from, to, insert) =>
			view.dispatch({ changes: { from, to, insert } }),
	};
}

/** Finds the text node and index at a character offset inside `root`. */
function locate(root: Node, offset: number): { node: Node; idx: number } {
	const doc = root.ownerDocument ?? document;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let left = offset;
	let last: Text | null = null;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const t = n as Text;
		if (left <= t.length) return { node: t, idx: left };
		left -= t.length;
		last = t;
	}
	return last
		? { node: last, idx: last.length }
		: { node: root, idx: root.childNodes.length };
}

function contentEditableModel(
	root: HTMLElement,
	savedRange: () => Range | null,
): TextModel {
	const doc = root.ownerDocument;
	const win = doc.defaultView ?? window;
	const offsetOf = (node: Node, idx: number): number => {
		const r = doc.createRange();
		r.setStart(root, 0);
		r.setEnd(node, idx);
		return r.toString().length;
	};
	const rangeOf = (from: number, to: number): Range => {
		const a = locate(root, from);
		const b = locate(root, to);
		const r = doc.createRange();
		r.setStart(a.node, a.idx);
		r.setEnd(b.node, b.idx);
		return r;
	};
	const select = (from: number, to: number) => {
		const sel = win.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(rangeOf(from, to));
	};
	return {
		text: () => root.textContent ?? '',
		selection: () => {
			const sel = win.getSelection();
			const live =
				sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
			const r =
				live && root.contains(live.commonAncestorContainer)
					? live
					: savedRange();
			if (!r) {
				const end = (root.textContent ?? '').length;
				return [end, end];
			}
			return [
				offsetOf(r.startContainer, r.startOffset),
				offsetOf(r.endContainer, r.endOffset),
			];
		},
		select,
		replace: (from, to, insert) => {
			const focused = focus(root);
			select(from, to);
			if (focused && typeText(doc, insert)) return;
			const r = rangeOf(from, to);
			r.deleteContents();
			if (insert) r.insertNode(doc.createTextNode(insert));
			root.normalize();
			root.dispatchEvent(new Event('input', { bubbles: true }));
		},
	};
}

/** Gives a TextModel the line/ch editor calls the toggle commands use. */
class ModelEditor implements TextEditor {
	constructor(private model: TextModel) {}

	private lines(): string[] {
		return this.model.text().split('\n');
	}

	private toOffset(pos: EditorPosition): number {
		const lines = this.lines();
		let offset = 0;
		for (let i = 0; i < pos.line && i < lines.length; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return Math.min(offset + pos.ch, this.model.text().length);
	}

	private toPos(offset: number): EditorPosition {
		const before = this.model.text().slice(0, offset).split('\n');
		return {
			line: before.length - 1,
			ch: before[before.length - 1]?.length ?? 0,
		};
	}

	getSelection(): string {
		const [from, to] = this.model.selection();
		return this.model.text().slice(from, to);
	}

	getCursor(which?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition {
		const [from, to] = this.model.selection();
		return this.toPos(which === 'from' || which === 'anchor' ? from : to);
	}

	getLine(line: number): string {
		return this.lines()[line] ?? '';
	}

	getRange(from: EditorPosition, to: EditorPosition): string {
		return this.model.text().slice(this.toOffset(from), this.toOffset(to));
	}

	replaceSelection(replacement: string): void {
		const [from, to] = this.model.selection();
		this.model.replace(from, to, replacement);
		const end = from + replacement.length;
		this.model.select(end, end);
	}

	replaceRange(
		replacement: string,
		from: EditorPosition,
		to?: EditorPosition,
	): void {
		const a = this.toOffset(from);
		this.model.replace(a, to ? this.toOffset(to) : a, replacement);
	}

	setCursor(pos: EditorPosition | number, ch?: number): void {
		const p = typeof pos === 'number' ? { line: pos, ch: ch ?? 0 } : pos;
		const offset = this.toOffset(p);
		this.model.select(offset, offset);
	}

	setSelection(anchor: EditorPosition, head?: EditorPosition): void {
		const a = this.toOffset(anchor);
		const b = head ? this.toOffset(head) : a;
		this.model.select(Math.min(a, b), Math.max(a, b));
	}
}

/**
 * Finds the text the user is working in. Besides notes and canvas cards this
 * covers any text box a plugin draws: CodeMirror editors that are not
 * registered with the workspace, textareas (sticky notes, Excalidraw text,
 * card editors), text inputs and contenteditable fields.
 *
 * Running a command from the command palette moves the focus away first, so
 * the last text box that had the focus is remembered.
 */
export class TextTargetFinder {
	private last: HTMLElement | null = null;
	private lastRange: Range | null = null;

	constructor(
		private app: App,
		plugin: Plugin,
	) {
		const watch = (doc: Document) => {
			plugin.registerDomEvent(doc, 'focusin', (e) => this.onFocus(e));
			plugin.registerDomEvent(doc, 'focusout', (e) => this.onBlur(e));
		};
		watch(document);
		plugin.registerEvent(
			app.workspace.on('window-open', (win: WorkspaceWindow) =>
				watch(win.doc),
			),
		);
	}

	private onFocus(e: FocusEvent) {
		const el = asHTMLElement(e.target);
		// The command palette and other pickers are not where the text goes.
		if (!el || el.closest('.prompt')) return;
		if (!isEditable(el)) return;
		this.last = el;
		this.lastRange = null;
	}

	private onBlur(e: FocusEvent) {
		const el = asHTMLElement(e.target);
		if (!el || el !== this.last) return;
		if (isField(el) || el.closest('.cm-editor')) return;
		const sel = el.ownerDocument.getSelection();
		if (sel && sel.rangeCount > 0) {
			const r = sel.getRangeAt(0);
			if (el.contains(r.commonAncestorContainer))
				this.lastRange = r.cloneRange();
		}
	}

	/** The remembered text box, while it is still on screen in the active tab. */
	private remembered(): HTMLElement | null {
		const el = this.last;
		if (!el || !el.isConnected) return null;
		if (el.closest('.workspace-leaf')) {
			const view = this.app.workspace.getActiveViewOfType(ItemView);
			if (!view || !view.containerEl.contains(el)) return null;
		}
		return el;
	}

	private workspaceEditor(): Editor | null {
		return (
			this.app.workspace.activeEditor?.editor ??
			this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ??
			null
		);
	}

	private fromElement(el: HTMLElement): TextEditor | null {
		const cmEl = el.closest<HTMLElement>('.cm-editor');
		if (cmEl) {
			const view = EditorView.findFromDOM(cmEl);
			if (!view) return null;
			const editor = this.workspaceEditor();
			// The workspace's own editor, when it is this one.
			if (editor && (editor as { cm?: EditorView }).cm === view)
				return editor;
			return new ModelEditor(cmModel(view));
		}
		if (isField(el)) return new ModelEditor(fieldModel(el));
		if (el.isContentEditable) {
			let root = el;
			while (root.parentElement?.isContentEditable)
				root = root.parentElement;
			const saved = el === this.last ? this.lastRange : null;
			return new ModelEditor(contentEditableModel(root, () => saved));
		}
		return null;
	}

	find(): TextEditor | null {
		const active = asHTMLElement(activeDocument.activeElement);
		if (
			active &&
			!active.closest('.prompt') &&
			isEditable(active)
		) {
			const editor = this.fromElement(active);
			if (editor) return editor;
		}
		const el = this.remembered();
		if (el) {
			const editor = this.fromElement(el);
			if (editor) return editor;
		}
		return this.workspaceEditor();
	}
}
