import { App, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type UnderlineSpoilerPlugin from './main';

export const SPOILER_DELIMITER = '||';

export const UNDERLINE_PRESETS = ['++', '^^', '&&'] as const;

export type UnderlinePreset = (typeof UNDERLINE_PRESETS)[number] | 'custom';

export interface UnderlineSpoilerSettings {
	underlineEnabled: boolean;
	underlinePreset: UnderlinePreset;
	underlineCustom: string;
	underlineThickness: number;
	spoilerEnabled: boolean;
	spoilerRevealOnHover: boolean;
}

export const DEFAULT_SETTINGS: UnderlineSpoilerSettings = {
	underlineEnabled: true,
	underlinePreset: '++',
	underlineCustom: '+=',
	underlineThickness: 1,
	spoilerEnabled: true,
	spoilerRevealOnHover: false,
};

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

export function resolveUnderlineDelimiter(s: UnderlineSpoilerSettings): string {
	const d =
		s.underlinePreset === 'custom' ? s.underlineCustom : s.underlinePreset;
	return validateDelimiter(d) === null ? d : '++';
}

export class UnderlineSpoilerSettingTab extends PluginSettingTab {
	plugin: UnderlineSpoilerPlugin;

	constructor(app: App, plugin: UnderlineSpoilerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[
			key
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			value;
		await this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const presetOptions: Record<string, string> = {};
		for (const p of UNDERLINE_PRESETS) {
			presetOptions[p] = `${p}text${p}`;
		}
		presetOptions.custom = 'Custom';

		const underlineOn = () => this.plugin.settings.underlineEnabled;

		return [
			{
				name: 'Enable underline',
				desc: 'Wrap text with a marker instead of writing <u> tags.',
				control: { type: 'toggle', key: 'underlineEnabled' },
			},
			{
				name: 'Underline marker',
				desc: 'Choose a built-in marker or define your own.',
				visible: underlineOn,
				control: {
					type: 'dropdown',
					key: 'underlinePreset',
					defaultValue: DEFAULT_SETTINGS.underlinePreset,
					options: presetOptions,
				},
			},
			{
				name: 'Custom marker',
				desc: '2-3 characters, no letters, digits, spaces, or Markdown syntax characters.',
				visible: () =>
					this.plugin.settings.underlineEnabled &&
					this.plugin.settings.underlinePreset === 'custom',
				control: {
					type: 'text',
					key: 'underlineCustom',
					placeholder: '+=',
					defaultValue: DEFAULT_SETTINGS.underlineCustom,
					validate: (value: string) =>
						validateDelimiter(value) ?? undefined,
				},
			},
			{
				name: 'Underline thickness',
				desc: 'Thickness of the underline in pixels.',
				visible: underlineOn,
				control: {
					type: 'slider',
					key: 'underlineThickness',
					min: 0.5,
					max: 6,
					step: 0.5,
					defaultValue: DEFAULT_SETTINGS.underlineThickness,
				},
			},
			{
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
						control: {
							type: 'toggle',
							key: 'spoilerRevealOnHover',
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Conflict prevention',
				items: [
					{
						name: 'Where markers are ignored',
						desc: 'Code, math, and comments are skipped. Underline markers must touch the text, so i++ and C++ stay unchanged.',
					},
				],
			},
		];
	}
}
