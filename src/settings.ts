import { App, PluginSettingTab, Setting } from 'obsidian';
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
			return `The character ${ch} is already used by existing Markdown / Obsidian syntax. Choose a different marker.`;
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

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName('Underline').setHeading();

		new Setting(containerEl)
			.setName('Enable underline')
			.setDesc(
				'Instead of writing <u>text</u>, wrap the text with the marker chosen below.',
			)
			.addToggle((t) =>
				t.setValue(s.underlineEnabled).onChange(async (v) => {
					s.underlineEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Underline thickness')
			.setDesc('Thickness of the underline line in pixels.')
			.addSlider((sl) =>
				sl
					.setLimits(0.5, 6, 0.5)
					.setValue(s.underlineThickness)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.underlineThickness = v;
						await this.plugin.saveSettings();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon('reset')
					.setTooltip('Reset to default')
					.onClick(async () => {
						s.underlineThickness =
							DEFAULT_SETTINGS.underlineThickness;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		const previewSetting = new Setting(containerEl).setName('Preview');
		const updatePreview = () => {
			const d = resolveUnderlineDelimiter(s);
			previewSetting.setDesc(`${d}text${d}`);
		};

		new Setting(containerEl)
			.setName('Underline marker')
			.setDesc('Choose a built-in marker or define your own.')
			.addDropdown((dd) => {
				for (const p of UNDERLINE_PRESETS) {
					dd.addOption(p, `${p}text${p}`);
				}
				dd.addOption('custom', 'Custom');
				dd.setValue(s.underlinePreset).onChange(async (v) => {
					s.underlinePreset = v as UnderlinePreset;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (s.underlinePreset === 'custom') {
			const customSetting = new Setting(containerEl)
				.setName('Custom marker')
				.setDesc(
					'2-3 characters, no letters / digits / spaces, and no characters already used by Markdown syntax.',
				);
			const warnEl = containerEl.createDiv({
				cls: 'setting-item-description mod-warning',
			});

			customSetting.addText((t) =>
				t
					.setPlaceholder('+=')
					.setValue(s.underlineCustom)
					.onChange(async (v) => {
						const err = validateDelimiter(v);
						warnEl.setText(err ?? '');
						if (err) return;
						s.underlineCustom = v;
						await this.plugin.saveSettings();
						updatePreview();
					}),
			);
		}
		updatePreview();

		new Setting(containerEl).setName('Spoiler').setHeading();

		new Setting(containerEl)
			.setName('Enable spoiler')
			.setDesc(
				`Writing ${SPOILER_DELIMITER}text${SPOILER_DELIMITER} hides the text until it is clicked. Spoilers are disabled inside tables because | is reserved there for column separation.`,
			)
			.addToggle((t) =>
				t.setValue(s.spoilerEnabled).onChange(async (v) => {
					s.spoilerEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Reveal on mouse hover')
			.setDesc(
				'Desktop only: reveal the spoiler when hovering with the mouse, not only on click.',
			)
			.addToggle((t) =>
				t.setValue(s.spoilerRevealOnHover).onChange(async (v) => {
					s.spoilerRevealOnHover = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Conflict prevention').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'Markers are not applied inside code blocks, inline code, math, or comments. ' +
				'An opening underline marker must follow a space, line start, or punctuation, and the text cannot start or end with a space, ' +
				'so i++ or C++ are not turned into underlines by mistake.',
		});
	}
}
