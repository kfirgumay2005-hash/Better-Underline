# Better-Underline

Underline, highlighter and spoiler formatting for Obsidian using simple text markers, instead of typing `<u>text</u>`.

| Marker         | Result                                            |
| -------------- | ------------------------------------------------- |
| `++text++`     | Underline (default marker)                        |
| `==text==`     | Highlight (Obsidian's built-in, now customizable) |
| `\|\|text\|\|` | Spoiler, hidden until clicked                     |

## Features

- **Presets:** create as many underline and highlighter presets as you like. Each has its own marker, color, opacity, and thickness (underline) or marker height (highlighter).
- **Built-in highlight:** restyle Obsidian's `==text==` with your own color, opacity, and height.
- **Bold text:** set your own color and weight for `**bold**`.
- **Image alignment:** images are centered; add `#left` or `#right` to the link (`![[photo.png#left]]`) to align one to a side.
- **Spoilers:** click to reveal, with optional reveal on hover (desktop).
- **Works everywhere:** Reading mode, Live Preview, and Source mode.
- **Commands:** toggle underline, highlighter, spoiler, or any preset with one tap. With no selection the word under the cursor is wrapped, and existing markers are found and removed automatically. Bind them to hotkeys or the mobile toolbar.
- **Safe by design:** markers are ignored in code, math, and comments. Markers must touch the text, so `i++` and `C++` are unaffected. Spoilers are disabled in tables.
- **Marker validation:** 2-3 characters, no letters, digits, spaces, or Markdown syntax characters, and no overlap with other presets.

## Installation

Requires Obsidian 1.13.0 or later.

**Manual**

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them to `<your-vault>/.obsidian/plugins/Better-Underline/`.
3. Reload Obsidian and enable **Better-Underline** under _Settings → Community plugins_.

**From source**

```bash
git clone <repository-url>
cd Better-Underline
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` as above.
