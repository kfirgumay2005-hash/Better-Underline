import { App, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
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
// Styling: values live as CSS variables on <body>; styles.css consumes them.
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

/** Variables set on <body>: one color/size pair per preset, plus the built-in highlight. */
export function buildBodyVars(
	s: UnderlineSpoilerSettings,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const p of s.presets) {
		const underline = p.kind === 'underline';
		out[`--ou-p-${p.id}-color`] = underline
			? underlineColor(p)
			: hexToRgba(p.color, p.opacity);
		out[`--ou-p-${p.id}-size`] = underline
			? `${round2(p.size)}px`
			: `${Math.round(p.size)}%`;
	}
	const nh = s.nativeHighlight;
	out['--ou-nh-color'] = hexToRgba(nh.color, nh.opacity);
	out['--ou-nh-size'] = `${Math.round(nh.size)}%`;
	return out;
}

/** Variables set on a wrapped element, pointing at that preset's body variables. */
export function presetVars(p: StylePreset): Record<string, string> {
	return {
		'--ou-color': `var(--ou-p-${p.id}-color)`,
		'--ou-size': `var(--ou-p-${p.id}-size)`,
	};
}

// ---------------------------------------------------------------------------
// Settings tab (declarative API, Obsidian 1.13+)
//
// Control keys:
//   spoilerEnabled / spoilerRevealOnHover   -> top-level settings
//   native:<field>                          -> settings.nativeHighlight
//   p:<presetId>:<field>                    -> one entry of settings.presets
// Opacity is stored as 0..1 but shown as a 0..100 slider.
// ---------------------------------------------------------------------------

interface ResolvedKey {
	obj: Record<string, unknown>;
	field: string;
}

export class UnderlineSpoilerSettingTab extends PluginSettingTab {
	plugin: UnderlineSpoilerPlugin;

	constructor(app: App, plugin: UnderlineSpoilerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private resolveKey(key: string): ResolvedKey | null {
		const s = this.plugin.settings;
		if (key.startsWith('native:')) {
			return {
				obj: s.nativeHighlight as unknown as Record<string, unknown>,
				field: key.slice('native:'.length),
			};
		}
		if (key.startsWith('p:')) {
			const [, id, field] = key.split(':');
			const preset = s.presets.find((p) => p.id === id);
			if (!preset || !field) return null;
			return {
				obj: preset as unknown as Record<string, unknown>,
				field,
			};
		}
		return { obj: s as unknown as Record<string, unknown>, field: key };
	}

	getControlValue(key: string): unknown {
		const r = this.resolveKey(key);
		if (!r) return undefined;
		const v = r.obj[r.field];
		return r.field === 'opacity' && typeof v === 'number'
			? Math.round(v * 100)
			: v;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const r = this.resolveKey(key);
		if (!r) return;
		r.obj[r.field] =
			r.field === 'opacity' && typeof value === 'number'
				? value / 100
				: value;

		// Markers or on/off state changed: rebuild editors and previews.
		// Everything else is a look-only change and just updates CSS variables.
		if (
			r.field === 'delimiter' ||
			r.field === 'enabled' ||
			r.field === 'spoilerEnabled'
		) {
			await this.plugin.saveSettings();
		} else {
			await this.plugin.saveStyles();
		}
	}

	private async addPreset(kind: PresetKind): Promise<void> {
		const presets = this.plugin.settings.presets;
		presets.push(makePreset(kind, presets));
		await this.plugin.saveSettings();
		this.update();
	}

	private async deletePreset(id: string): Promise<void> {
		const presets = this.plugin.settings.presets;
		const i = presets.findIndex((p) => p.id === id);
		if (i !== -1) presets.splice(i, 1);
		await this.plugin.saveSettings();
		this.update();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const defs: SettingDefinitionItem[] = [];
		const settings = this.plugin.settings;

		const pushPresets = (kind: PresetKind) => {
			for (const p of settings.presets) {
				if (p.kind !== kind) continue;
				const underline = kind === 'underline';
				const k = (field: string) => `p:${p.id}:${field}`;

				defs.push({
					type: 'group',
					heading: `${underline ? 'Underline' : 'Highlighter'}: ${p.name || 'Untitled'}`,
					items: [
						{
							name: 'Name',
							control: {
								type: 'text',
								key: k('name'),
								placeholder: 'Preset name',
							},
						},
						{
							name: 'Enabled',
							control: { type: 'toggle', key: k('enabled') },
						},
						{
							name: 'Marker',
							desc: '2-3 characters, no letters, digits, spaces, or Markdown syntax characters.',
							control: {
								type: 'text',
								key: k('delimiter'),
								placeholder: '++',
								validate: (value: string) =>
									validatePresetDelimiter(
										value,
										this.plugin.settings.presets,
										p.id,
									) ?? undefined,
							},
						},
						{
							name: 'Use text color',
							desc: 'The underline takes the color of the text.',
							visible: () => underline,
							control: {
								type: 'toggle',
								key: k('useTextColor'),
							},
						},
						{
							name: 'Color',
							visible: () => !(underline && p.useTextColor),
							control: { type: 'color', key: k('color') },
						},
						{
							name: 'Opacity',
							desc: '100% is solid, 0% is invisible.',
							control: {
								type: 'slider',
								key: k('opacity'),
								min: 0,
								max: 100,
								step: 5,
							},
						},
						{
							name: 'Thickness',
							desc: 'Thickness of the underline in pixels.',
							visible: () => underline,
							control: {
								type: 'slider',
								key: k('size'),
								min: 0.5,
								max: 8,
								step: 0.5,
							},
						},
						{
							name: 'Marker height',
							desc: 'How much of the line height the marker covers (%).',
							visible: () => !underline,
							control: {
								type: 'slider',
								key: k('size'),
								min: 10,
								max: 100,
								step: 5,
							},
						},
						{
							name: 'Preview',
							render: (setting) => {
								const el = setting.controlEl.createEl('span', {
									text: 'Sample text',
									cls: underline
										? 'ou-underline'
										: 'ou-highlight',
								});
								el.setCssProps(presetVars(p));
							},
						},
						{
							name: 'Delete preset',
							desc: 'Removes this preset and its marker.',
							action: () => {
								void this.deletePreset(p.id);
							},
						},
					],
				});
			}
		};

		// Underline
		pushPresets('underline');
		defs.push({
			name: 'Add underline preset',
			action: () => {
				void this.addPreset('underline');
			},
		});

		// Highlighter: built-in ==text== first, then custom presets
		defs.push({
			type: 'group',
			heading: 'Highlighter: built-in',
			items: [
				{
					name: 'Customize built-in highlighter',
					desc: "Style Obsidian's own ==text== highlight.",
					control: { type: 'toggle', key: 'native:customize' },
				},
				{
					name: 'Color',
					visible: () =>
						this.plugin.settings.nativeHighlight.customize,
					control: { type: 'color', key: 'native:color' },
				},
				{
					name: 'Opacity',
					desc: '100% is solid, 0% is invisible.',
					visible: () =>
						this.plugin.settings.nativeHighlight.customize,
					control: {
						type: 'slider',
						key: 'native:opacity',
						min: 0,
						max: 100,
						step: 5,
					},
				},
				{
					name: 'Marker height',
					desc: 'How much of the line height the marker covers (%).',
					visible: () =>
						this.plugin.settings.nativeHighlight.customize,
					control: {
						type: 'slider',
						key: 'native:size',
						min: 10,
						max: 100,
						step: 5,
					},
				},
				{
					name: 'Preview',
					visible: () =>
						this.plugin.settings.nativeHighlight.customize,
					render: (setting) => {
						setting.controlEl.createEl('mark', {
							text: 'Sample text',
						});
					},
				},
			],
		});
		pushPresets('highlight');
		defs.push({
			name: 'Add highlighter preset',
			action: () => {
				void this.addPreset('highlight');
			},
		});

		// Spoiler
		defs.push({
			type: 'group',
			heading: 'Spoiler',
			items: [
				{
					name: 'Enable spoiler',
					desc: `Text wrapped in ${SPOILER_DELIMITER} is hidden until clicked. Not applied inside tables.`,
					control: { type: 'toggle', key: 'spoilerEnabled' },
				},
				{
					name: 'Reveal on mouse hover',
					desc: 'Desktop only: also reveal spoilers on hover.',
					visible: () => this.plugin.settings.spoilerEnabled,
					control: { type: 'toggle', key: 'spoilerRevealOnHover' },
				},
			],
		});

		// Conflict prevention
		defs.push({
			type: 'group',
			heading: 'Conflict prevention',
			items: [
				{
					name: 'Where markers are ignored',
					desc: 'Code, math, and comments are skipped. Markers must touch the text, so i++ and C++ stay unchanged.',
				},
			],
		});

		return defs;
	}
}
