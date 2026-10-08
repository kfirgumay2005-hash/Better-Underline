import { App, PluginSettingTab, Setting } from 'obsidian';
import type UnderlineSpoilerPlugin from './main';

export const SPOILER_DELIMITER = '||';

export type PresetKind = 'underline' | 'highlight';

/** Shared look settings (used by presets and by the built-in ==highlight==). */
export interface Appearance {
	/** Hex color, e.g. #ffd000 */
	color: string;
	/** 0 (invisible) .. 1 (solid) */
	opacity: number;
	/** underline: thickness in px. highlight: % of line height the marker covers. */
	size: number;
	/** underline only: use the text color instead of `color` */
	useTextColor?: boolean;
}

export interface StylePreset extends Appearance {
	id: string;
	name: string;
	kind: PresetKind;
	enabled: boolean;
	delimiter: string;
}

export interface NativeHighlightSettings extends Appearance {
	/** When false, Obsidian's own highlight style is left untouched. */
	customize: boolean;
}

export interface UnderlineSpoilerSettings {
	presets: StylePreset[];
	nativeHighlight: NativeHighlightSettings;
	spoilerEnabled: boolean;
	spoilerRevealOnHover: boolean;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const CANDIDATE_DELIMITERS = ['++', '^^', '&&', '@@', ';;', '??', ',,'];

const RESERVED_CHARS = new Set([...'*_~=%$`[]()<>{}#-|\\:!/"\'']);

export function validateDelimiter(value: string): string | null {
	if (value.length < 2 || value.length > 3) {
		return 'The marker must be 2-3 characters long.';
	}
	if (/[\s\p{L}\p{N}]/u.test(value)) {
		return 'The marker cannot contain spaces, letters, or digits.';
	}
	for (const ch of value) {
		if (RESERVED_CHARS.has(ch)) {
			return `The character ${ch} is already used by Markdown or Obsidian syntax. Choose a different marker.`;
		}
	}
	return null;
}

/** Validates a delimiter and makes sure it doesn't clash with another preset. */
export function validatePresetDelimiter(
	value: string,
	presets: StylePreset[],
	selfId: string,
): string | null {
	const base = validateDelimiter(value);
	if (base) return base;
	for (const other of presets) {
		if (other.id === selfId) continue;
		if (other.delimiter === value) {
			return `The marker ${value} is already used by "${other.name}".`;
		}
		if (
			other.delimiter &&
			(other.delimiter.includes(value) || value.includes(other.delimiter))
		) {
			return `The marker conflicts with "${other.name}" (${other.delimiter}).`;
		}
	}
	return null;
}

export function newId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function nextFreeDelimiter(presets: StylePreset[]): string {
	for (const d of CANDIDATE_DELIMITERS) {
		if (validatePresetDelimiter(d, presets, '') === null) return d;
	}
	return '';
}

export function makePreset(
	kind: PresetKind,
	existing: StylePreset[],
): StylePreset {
	const isUnderline = kind === 'underline';
	const n = existing.filter((p) => p.kind === kind).length + 1;
	return {
		id: newId(),
		name: `${isUnderline ? 'Underline' : 'Highlighter'} ${n}`,
		kind,
		enabled: true,
		delimiter: nextFreeDelimiter(existing),
		useTextColor: isUnderline,
		color: isUnderline ? '#e5484d' : '#ffd000',
		opacity: isUnderline ? 1 : 0.4,
		size: isUnderline ? 1 : 100,
	};
}

export function createDefaultSettings(): UnderlineSpoilerSettings {
	return {
		presets: [
			{
				...makePreset('underline', []),
				name: 'Underline',
				delimiter: '++',
			},
		],
		nativeHighlight: {
			customize: false,
			color: '#ffd000',
			opacity: 0.4,
			size: 100,
		},
		spoilerEnabled: true,
		spoilerRevealOnHover: false,
	};
}

function clampNum(v: unknown, min: number, max: number, fallback: number) {
	return typeof v === 'number' && Number.isFinite(v)
		? Math.min(max, Math.max(min, v))
		: fallback;
}

function readPreset(raw: unknown): StylePreset | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const kind: PresetKind | null =
		r.kind === 'underline'
			? 'underline'
			: r.kind === 'highlight'
				? 'highlight'
				: null;
	if (!kind) return null;
	const base = makePreset(kind, []);
	const underline = kind === 'underline';
	return {
		id:
			typeof r.id === 'string' && /^[a-z0-9]+$/i.test(r.id)
				? r.id
				: base.id,
		name: typeof r.name === 'string' ? r.name : base.name,
		kind,
		enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
		delimiter:
			typeof r.delimiter === 'string' ? r.delimiter : base.delimiter,
		useTextColor:
			typeof r.useTextColor === 'boolean'
				? r.useTextColor
				: base.useTextColor,
		color:
			typeof r.color === 'string' && HEX_RE.test(r.color)
				? r.color
				: base.color,
		opacity: clampNum(r.opacity, 0, 1, base.opacity),
		size: clampNum(
			r.size,
			underline ? 0.5 : 10,
			underline ? 8 : 100,
			base.size,
		),
	};
}

/** Loads saved data, migrating the old single-underline settings format. */
export function normalizeSettings(raw: unknown): UnderlineSpoilerSettings {
	const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const s = createDefaultSettings();

	if (typeof data.spoilerEnabled === 'boolean') {
		s.spoilerEnabled = data.spoilerEnabled;
	}
	if (typeof data.spoilerRevealOnHover === 'boolean') {
		s.spoilerRevealOnHover = data.spoilerRevealOnHover;
	}

	if (Array.isArray(data.presets)) {
		const seenIds = new Set<string>();
		const presets: StylePreset[] = [];
		for (const item of data.presets as unknown[]) {
			const p = readPreset(item);
			if (!p) continue;
			if (seenIds.has(p.id)) p.id = newId();
			seenIds.add(p.id);
			presets.push(p);
		}
		s.presets = presets;
	} else if (
		'underlinePreset' in data ||
		'underlineEnabled' in data ||
		'underlineCustom' in data ||
		'underlineThickness' in data
	) {
		// Migration from the old format (single underline marker).
		const key = data.underlinePreset;
		const candidate = key === 'custom' ? data.underlineCustom : key;
		const delimiter =
			typeof candidate === 'string' &&
			validateDelimiter(candidate) === null
				? candidate
				: '++';
		s.presets = [
			{
				...makePreset('underline', []),
				name: 'Underline',
				delimiter,
				enabled: data.underlineEnabled !== false,
				size: clampNum(data.underlineThickness, 0.5, 8, 1),
			},
		];
	}

	const nh = data.nativeHighlight;
	if (typeof nh === 'object' && nh !== null) {
		const r = nh as Record<string, unknown>;
		const d = s.nativeHighlight;
		s.nativeHighlight = {
			customize:
				typeof r.customize === 'boolean' ? r.customize : d.customize,
			color:
				typeof r.color === 'string' && HEX_RE.test(r.color)
					? r.color
					: d.color,
			opacity: clampNum(r.opacity, 0, 1, d.opacity),
			size: clampNum(r.size, 10, 100, d.size),
		};
	}

	return s;
}

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

function hexToRgba(hex: string, alpha: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	const n = m && m[1] ? parseInt(m[1], 16) : 0xffd000;
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return `rgba(${r}, ${g}, ${b}, ${round2(alpha)})`;
}

function underlineColor(a: Appearance): string {
	if (a.useTextColor) {
		return a.opacity >= 1
			? 'currentColor'
			: `color-mix(in srgb, currentColor ${Math.round(a.opacity * 100)}%, transparent)`;
	}
	return hexToRgba(a.color, a.opacity);
}

/** Per-preset CSS variables + the override for Obsidian's built-in highlight. */
export function buildPresetCss(s: UnderlineSpoilerSettings): string {
	const out: string[] = [];

	for (const p of s.presets) {
		const sel = `.ou-p-${p.id}`;
		if (p.kind === 'underline') {
			out.push(
				`${sel} { --ou-ul-color: ${underlineColor(p)}; --ou-ul-thickness: ${round2(p.size)}px; }`,
			);
		} else {
			out.push(
				`${sel} { --ou-hl-color: ${hexToRgba(p.color, p.opacity)}; --ou-hl-size: ${Math.round(p.size)}%; }`,
			);
		}
	}

	const nh = s.nativeHighlight;
	if (nh.customize) {
		out.push(
			`body mark, body .cm-highlight { ` +
				`--ou-hl-color: ${hexToRgba(nh.color, nh.opacity)}; ` +
				`--ou-hl-size: ${Math.round(nh.size)}%; ` +
				`background-color: transparent; ` +
				`background-image: linear-gradient(to top, var(--ou-hl-color) var(--ou-hl-size), transparent var(--ou-hl-size)); ` +
				`}`,
		);
	}

	return out.join('\n');
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

export class UnderlineSpoilerSettingTab extends PluginSettingTab {
	plugin: UnderlineSpoilerPlugin;

	constructor(app: App, plugin: UnderlineSpoilerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderPresetSection(containerEl, 'underline');
		this.renderPresetSection(containerEl, 'highlight');
		this.renderSpoilerSection(containerEl);

		new Setting(containerEl).setName('Conflict prevention').setHeading();
		new Setting(containerEl)
			.setName('Where markers are ignored')
			.setDesc(
				'Code, math, and comments are skipped. Markers must touch the text, so i++ and C++ stay unchanged.',
			);
	}

	private renderPresetSection(el: HTMLElement, kind: PresetKind) {
		const isUnderline = kind === 'underline';
		new Setting(el)
			.setName(isUnderline ? 'Underline' : 'Highlighter')
			.setHeading();

		if (!isUnderline) this.renderNativeHighlight(el);

		for (const p of this.plugin.settings.presets.filter(
			(x) => x.kind === kind,
		)) {
			this.renderPreset(el, p);
		}

		new Setting(el).addButton((b) =>
			b
				.setButtonText(
					isUnderline
						? 'Add underline preset'
						: 'Add highlighter preset',
				)
				.setCta()
				.onClick(async () => {
					const presets = this.plugin.settings.presets;
					presets.push(makePreset(kind, presets));
					await this.plugin.saveSettings();
					this.display();
				}),
		);
	}

	private renderNativeHighlight(el: HTMLElement) {
		const nh = this.plugin.settings.nativeHighlight;
		const card = el.createDiv({ cls: 'ou-preset' });
		const details: Setting[] = [];

		new Setting(card)
			.setName('Built-in highlighter')
			.setDesc(
				"Customize the look of ==text== (Obsidian's own highlight).",
			)
			.addToggle((t) =>
				t.setValue(nh.customize).onChange(async (v) => {
					nh.customize = v;
					for (const d of details) d.settingEl.toggle(v);
					await this.plugin.saveStyles();
				}),
			);

		details.push(...this.addAppearance(card, nh, 'highlight'));

		const preview = new Setting(card).setName('Preview');
		preview.controlEl.createEl('mark', { text: 'Sample text' });
		details.push(preview);

		for (const d of details) d.settingEl.toggle(nh.customize);
	}

	private renderPreset(el: HTMLElement, p: StylePreset) {
		const card = el.createDiv({ cls: 'ou-preset' });

		new Setting(card)
			.setName('Preset')
			.addText((t) =>
				t
					.setPlaceholder('Name')
					.setValue(p.name)
					.onChange(async (v) => {
						p.name = v;
						await this.plugin.saveStyles();
					}),
			)
			.addToggle((t) =>
				t
					.setTooltip('Enabled')
					.setValue(p.enabled)
					.onChange(async (v) => {
						p.enabled = v;
						await this.plugin.saveSettings();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon('trash')
					.setTooltip('Delete preset')
					.onClick(async () => {
						const presets = this.plugin.settings.presets;
						const i = presets.indexOf(p);
						if (i !== -1) presets.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		const delim = new Setting(card)
			.setName('Marker')
			.setDesc(
				'2-3 characters, no letters, digits, spaces, or Markdown syntax characters.',
			);
		const err = delim.descEl.createDiv({ cls: 'ou-setting-error' });
		delim.addText((t) =>
			t
				.setPlaceholder('++')
				.setValue(p.delimiter)
				.onChange(async (v) => {
					const msg = validatePresetDelimiter(
						v,
						this.plugin.settings.presets,
						p.id,
					);
					err.setText(msg ?? '');
					if (msg) return;
					p.delimiter = v;
					await this.plugin.saveSettings();
				}),
		);

		this.addAppearance(card, p, p.kind);

		const preview = new Setting(card).setName('Preview');
		preview.controlEl.createEl('span', {
			text: 'Sample text',
			cls: [
				p.kind === 'underline' ? 'ou-underline' : 'ou-highlight',
				`ou-p-${p.id}`,
			],
		});
	}

	/** Color / opacity / size controls. Returns the created rows. */
	private addAppearance(
		parent: HTMLElement,
		a: Appearance,
		kind: PresetKind,
	): Setting[] {
		const rows: Setting[] = [];
		const isUnderline = kind === 'underline';
		let colorRow: Setting | null = null;

		if (isUnderline) {
			rows.push(
				new Setting(parent)
					.setName('Use text color')
					.setDesc('The underline takes the color of the text.')
					.addToggle((t) =>
						t
							.setValue(a.useTextColor ?? false)
							.onChange(async (v) => {
								a.useTextColor = v;
								colorRow?.settingEl.toggle(!v);
								await this.plugin.saveStyles();
							}),
					),
			);
		}

		colorRow = new Setting(parent).setName('Color').addColorPicker((c) =>
			c.setValue(a.color).onChange(async (v) => {
				a.color = v;
				await this.plugin.saveStyles();
			}),
		);
		colorRow.settingEl.toggle(!(isUnderline && a.useTextColor));
		rows.push(colorRow);

		rows.push(
			new Setting(parent)
				.setName('Opacity')
				.setDesc('100% is solid, 0% is invisible.')
				.addSlider((s) =>
					s
						.setLimits(0, 100, 5)
						.setValue(Math.round(a.opacity * 100))
						.setDynamicTooltip()
						.onChange(async (v) => {
							a.opacity = v / 100;
							await this.plugin.saveStyles();
						}),
				),
		);

		rows.push(
			new Setting(parent)
				.setName(isUnderline ? 'Thickness' : 'Marker height')
				.setDesc(
					isUnderline
						? 'Thickness of the underline in pixels.'
						: 'How much of the line height the marker covers (%).',
				)
				.addSlider((s) =>
					(isUnderline
						? s.setLimits(0.5, 8, 0.5)
						: s.setLimits(10, 100, 5)
					)
						.setValue(a.size)
						.setDynamicTooltip()
						.onChange(async (v) => {
							a.size = v;
							await this.plugin.saveStyles();
						}),
				),
		);

		return rows;
	}

	private renderSpoilerSection(el: HTMLElement) {
		new Setting(el).setName('Spoiler').setHeading();

		let hoverRow: Setting | null = null;

		new Setting(el)
			.setName('Enable spoiler')
			.setDesc(
				`Text wrapped in ${SPOILER_DELIMITER} is hidden until clicked. Not applied inside tables.`,
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.spoilerEnabled)
					.onChange(async (v) => {
						this.plugin.settings.spoilerEnabled = v;
						hoverRow?.settingEl.toggle(v);
						await this.plugin.saveSettings();
					}),
			);

		hoverRow = new Setting(el)
			.setName('Reveal on mouse hover')
			.setDesc('Desktop only: also reveal spoilers on hover.')
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.spoilerRevealOnHover)
					.onChange(async (v) => {
						this.plugin.settings.spoilerRevealOnHover = v;
						await this.plugin.saveStyles();
					}),
			);
		hoverRow.settingEl.toggle(this.plugin.settings.spoilerEnabled);
	}
}
