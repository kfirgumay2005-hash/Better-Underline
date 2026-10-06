import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from '@codemirror/view';
import { Extension, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
	DEFAULT_SETTINGS,
	SPOILER_DELIMITER,
	UnderlineSpoilerSettings,
	UnderlineSpoilerSettingTab,
	resolveUnderlineDelimiter,
} from './settings';

interface Rule {
	delim: string;
	cls: string;
	tag: string;
	strict: boolean;
	spoiler: boolean;
	skipTables: boolean;
}

const STYLE_ID = 'underline-spoiler-styles';

const CSS = `
.ou-underline {
	text-decoration: underline;
	text-underline-offset: 2px;
	text-decoration-thickness: var(--ou-underline-thickness, 1px);
}
.ou-spoiler {
	background-color: var(--text-normal);
	color: transparent;
	border-radius: 4px;
	padding: 0 2px;
	cursor: pointer;
	transition: background-color 0.15s ease, color 0.15s ease;
}
.ou-spoiler:not(.is-revealed) * {
	color: transparent !important;
}
.ou-spoiler.is-revealed {
	background-color: var(--background-modifier-hover);
	color: inherit;
}
body.ou-spoiler-hover .ou-spoiler:hover {
	background-color: var(--background-modifier-hover);
	color: inherit;
}
body.ou-spoiler-hover .ou-spoiler:hover * {
	color: inherit !important;
}
.ou-delim {
	opacity: 0.45;
}
`;

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

function isSpace(ch: string | undefined): boolean {
	return ch !== undefined && /\s/.test(ch);
}

function scanLine(
	text: string,
	rule: Rule,
): Array<{ open: number; close: number }> {
	const result: Array<{ open: number; close: number }> = [];
	const d = rule.delim;
	const len = d.length;
	const d0 = d[0];
	let open = -1;
	let pos = 0;

	while (pos < text.length) {
		const i = text.indexOf(d, pos);
		if (i === -1) break;
		pos = i + len;

		const before = i > 0 ? text[i - 1] : undefined;
		const after = i + len < text.length ? text[i + len] : undefined;

		if (before === d0 || after === d0) continue;

		if (open !== -1) {
			if (i === open + len) continue;
			if (rule.strict && (isSpace(before) || isWordChar(after))) continue;
			result.push({ open, close: i });
			open = -1;
			continue;
		}

		if (
			rule.strict &&
			(isWordChar(before) || after === undefined || isSpace(after))
		)
			continue;
		open = i;
	}
	return result;
}

const SKIP_TAGS = new Set([
	'CODE',
	'PRE',
	'SCRIPT',
	'STYLE',
	'TEXTAREA',
	'MJX-CONTAINER',
]);

function shouldSkip(el: Element, rule: Rule): boolean {
	if (SKIP_TAGS.has(el.tagName)) return true;
	if (el.classList.contains('math')) return true;
	if (rule.skipTables && el.tagName === 'TABLE') return true;
	return false;
}

interface Pos {
	node: Text;
	idx: number;
}
interface DomMatch {
	open: Pos;
	close: Pos;
}

function findDomMatches(container: Element, rule: Rule): DomMatch[] {
	const matches: DomMatch[] = [];
	const d = rule.delim;
	const len = d.length;
	const d0 = d[0];
	const kids = Array.from(container.childNodes);
	let open: Pos | null = null;

	for (let k = 0; k < kids.length; k++) {
		const child = kids[k];
		if (!child || child.nodeType !== Node.TEXT_NODE) continue;
		const node = child as Text;
		const text = node.data;
		let pos = 0;

		while (pos < text.length) {
			const i = text.indexOf(d, pos);
			if (i === -1) break;
			pos = i + len;

			const before = i > 0 ? text[i - 1] : undefined;
			const after = i + len < text.length ? text[i + len] : undefined;
			if (before === d0 || after === d0) continue;

			if (open) {
				if (open.node === node && open.idx + len === i) continue;
				if (rule.strict && (isSpace(before) || isWordChar(after)))
					continue;
				matches.push({ open, close: { node, idx: i } });
				open = null;
				continue;
			}

			if (rule.strict) {
				if (isWordChar(before) || isSpace(after)) continue;
				if (after === undefined && k === kids.length - 1) continue;
			}
			open = { node, idx: i };
		}
	}
	return matches;
}

function applyDomMatches(matches: DomMatch[], rule: Rule): void {
	const len = rule.delim.length;
	for (let m = matches.length - 1; m >= 0; m--) {
		const match = matches[m];
		if (!match) continue;
		const { open, close } = match;
		close.node.deleteData(close.idx, len);
		open.node.deleteData(open.idx, len);
		const endIdx = open.node === close.node ? close.idx - len : close.idx;

		const range = document.createRange();
		range.setStart(open.node, open.idx);
		range.setEnd(close.node, endIdx);

		const wrapper = document.createElement(rule.tag);
		wrapper.className = rule.cls;
		if (rule.spoiler) {
			wrapper.addEventListener('click', () =>
				wrapper.classList.toggle('is-revealed'),
			);
		}
		range.surroundContents(wrapper);
	}
}

function processContainer(container: Element, rule: Rule): void {
	const matches = findDomMatches(container, rule);
	for (const child of Array.from(container.children)) {
		if (!shouldSkip(child, rule)) processContainer(child, rule);
	}
	applyDomMatches(matches, rule);
}

const SKIP_NODE_NAMES = /code|math|comment|frontmatter/i;

function inSkippedSyntax(view: EditorView, pos: number): boolean {
	const name = syntaxTree(view.state).resolve(pos, 1).type.name;
	return SKIP_NODE_NAMES.test(name);
}

function buildDecorations(
	view: EditorView,
	plugin: UnderlineSpoilerPlugin,
): DecorationSet {
	const rules = plugin.getRules();
	if (rules.length === 0) return Decoration.none;

	const live = !!view.dom.closest('.is-live-preview');
	const selection = view.hasFocus ? view.state.selection.ranges : [];
	const out: Range<Decoration>[] = [];

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			const text = line.text;
			const isTableLine = text.trimStart().startsWith('|');

			for (const rule of rules) {
				if (rule.skipTables && isTableLine) continue;
				if (!text.includes(rule.delim)) continue;
				const len = rule.delim.length;

				for (const m of scanLine(text, rule)) {
					const openFrom = line.from + m.open;
					const openTo = openFrom + len;
					const closeFrom = line.from + m.close;
					const closeTo = closeFrom + len;

					if (
						inSkippedSyntax(view, openFrom) ||
						inSkippedSyntax(view, closeFrom)
					)
						continue;

					const touching = selection.some(
						(r) => r.from <= closeTo && r.to >= openFrom,
					);

					out.push(
						Decoration.mark({
							class: rule.cls + (touching ? ' is-revealed' : ''),
						}).range(openTo, closeFrom),
					);

					if (live && !touching) {
						out.push(
							Decoration.replace({}).range(openFrom, openTo),
						);
						out.push(
							Decoration.replace({}).range(closeFrom, closeTo),
						);
					} else {
						out.push(
							Decoration.mark({ class: 'ou-delim' }).range(
								openFrom,
								openTo,
							),
						);
						out.push(
							Decoration.mark({ class: 'ou-delim' }).range(
								closeFrom,
								closeTo,
							),
						);
					}
				}
			}
			pos = line.to + 1;
		}
	}
	return Decoration.set(out, true);
}

function buildEditorExtension(plugin: UnderlineSpoilerPlugin): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, plugin);
			}
			update(u: ViewUpdate) {
				if (
					u.docChanged ||
					u.viewportChanged ||
					u.selectionSet ||
					u.focusChanged
				) {
					this.decorations = buildDecorations(u.view, plugin);
				}
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

export default class UnderlineSpoilerPlugin extends Plugin {
	settings: UnderlineSpoilerSettings = { ...DEFAULT_SETTINGS };
	private editorExtensions: Extension[] = [];

	async onload() {
		await this.loadSettings();

		const styleEl = document.createElement('style');
		styleEl.id = STYLE_ID;
		styleEl.textContent = CSS;
		document.head.appendChild(styleEl);
		this.register(() => styleEl.remove());

		this.registerMarkdownPostProcessor((el) => {
			for (const rule of this.getRules()) {
				processContainer(el, rule);
			}
		});

		this.editorExtensions.push(buildEditorExtension(this));
		this.registerEditorExtension(this.editorExtensions);

		this.addCommand({
			id: 'toggle-underline',
			name: 'Underline: toggle markers around selected text',
			editorCheckCallback: (checking, editor) => {
				if (!this.settings.underlineEnabled) {
					if (!checking)
						new Notice(
							'Underline is disabled in the plugin settings.',
						);
					return false;
				}
				if (!checking)
					this.toggleWrap(editor, this.getUnderlineDelimiter());
				return true;
			},
		});

		this.addCommand({
			id: 'toggle-spoiler',
			name: 'Spoiler: toggle markers around selected text',
			editorCheckCallback: (checking, editor) => {
				if (!this.settings.spoilerEnabled) {
					if (!checking)
						new Notice(
							'Spoiler is disabled in the plugin settings.',
						);
					return false;
				}
				if (!checking) this.toggleWrap(editor, SPOILER_DELIMITER);
				return true;
			},
		});

		this.addSettingTab(new UnderlineSpoilerSettingTab(this.app, this));
		this.applyBodyClasses();
	}

	onunload() {
		document.body.classList.remove('ou-spoiler-hover');
		document.body.style.removeProperty('--ou-underline-thickness');
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refresh();
	}

	getUnderlineDelimiter(): string {
		return resolveUnderlineDelimiter(this.settings);
	}

	getRules(): Rule[] {
		const rules: Rule[] = [];
		if (this.settings.spoilerEnabled) {
			rules.push({
				delim: SPOILER_DELIMITER,
				cls: 'ou-spoiler',
				tag: 'span',
				strict: false,
				spoiler: true,
				skipTables: true,
			});
		}
		if (this.settings.underlineEnabled) {
			rules.push({
				delim: this.getUnderlineDelimiter(),
				cls: 'ou-underline',
				tag: 'u',
				strict: true,
				spoiler: false,
				skipTables: false,
			});
		}
		return rules;
	}

	private applyBodyClasses() {
		document.body.classList.toggle(
			'ou-spoiler-hover',
			this.settings.spoilerRevealOnHover,
		);
		document.body.style.setProperty(
			'--ou-underline-thickness',
			`${this.settings.underlineThickness}px`,
		);
	}

	private refresh() {
		this.applyBodyClasses();

		this.editorExtensions.length = 0;
		this.editorExtensions.push(buildEditorExtension(this));
		this.app.workspace.updateOptions();

		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.previewMode.rerender(true);
			}
		});
	}

	private wrapSelection(editor: Editor, d: string) {
		const sel = editor.getSelection();
		if (sel) {
			editor.replaceSelection(d + sel + d);
			return;
		}
		const cur = editor.getCursor();
		editor.replaceRange(d + d, cur);
		editor.setCursor({ line: cur.line, ch: cur.ch + d.length });
	}

	private toggleWrap(editor: Editor, d: string) {
		const sel = editor.getSelection();

		if (
			sel.length >= d.length * 2 &&
			sel.startsWith(d) &&
			sel.endsWith(d)
		) {
			editor.replaceSelection(sel.slice(d.length, sel.length - d.length));
			return;
		}
		this.wrapSelection(editor, d);
	}
}
