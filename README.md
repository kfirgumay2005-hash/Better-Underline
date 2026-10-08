# Better-Underline

An Obsidian plugin that enable customization of underline , highlight and spoiler formatting using simple text markers, instead of typing `<u>text</u>`.

## Installation

Requires Obsidian 1.13.0 or later.
Install from obsidian commiunity plugins.

## Features

- **Underline markers:** wrap text with `++text++` to underline it. Choose between `++`, `^^`, `&&`, or define your own custom marker.
- **Adjustable thickness:** set the underline thickness (0.5-6 px) from the settings.
- **Spoilers:** wrap text with `||text||` to hide it until it is clicked. Optionally reveal it on mouse hover (desktop).
- **Works everywhere:** Reading mode, Live Preview, and Source mode.
- **Commands:** toggle underline or spoiler markers around the selected text, so you can bind them to hotkeys or use them from a mobile toolbar.
- **Safe by design:** markers are ignored inside code blocks, inline code, math, and comments. Underline markers must be attached to the text, so `i++` or `C++` are not affected. Spoilers are disabled inside tables, where `|` separates columns.
- **Custom marker validation:** custom markers must be 2-3 characters and cannot use characters that already have meaning in Markdown or Obsidian.
- **Highlight and underline customization:** save presets of your favorites highlights and underlines.
