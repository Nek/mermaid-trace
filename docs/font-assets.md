# Prepared emoji fallback

The unfinished font integration uses a bundled OpenType emoji fallback before system fallback fonts. Explicit authored font families still take precedence. Native measurement and SVG export share that database through `NativeFontContext::from_database`; this does not install fonts globally. Preserving existing CSS font-size changes remains mandatory.

Apple Color Emoji uses AAT shaping that Chromium drops from downloaded fonts: a joined emoji can become two glyphs and overflow native-measured geometry. The prepared Noto font retains OpenType shaping and packages the original PNG glyphs as sbix. Chromium production regressions pass; real Safari and Firefox acceptance remain required. Explicitly requested AAT fonts are an unresolved portability case.

## Source and reproduction

- Source: [Noto Emoji revision e20cbc2](https://github.com/googlefonts/noto-emoji/tree/e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e), `2D/fonts/NotoColorEmoji_WindowsCompatible.ttf`.
- Source SHA-256: `2c7ede2f5438f9c1da098778bd681535933a345334008bb03fc51119f6b1cd72`.
- Prepared asset: [NotoColorEmoji-sbix.ttf](../mermaid-trace-rs/assets/fonts/NotoColorEmoji-sbix.ttf).
- Prepared SHA-256: `100363ed01d0926f912545d123ea3cb3d55a750748f8db0ce476bb1e242c34a9`.
- [SIL Open Font License 1.1](../mermaid-trace-rs/assets/fonts/LICENSE); original copyright and font naming records retained. The modified font remains under that license.

Download the source file at that exact revision. With Python and FontTools **4.60.1**, run from the repository root:

```sh
python3 mermaid-trace-rs/scripts/prepare-emoji-font.py /path/to/NotoColorEmoji_WindowsCompatible.ttf /tmp/NotoColorEmoji-sbix.ttf
cmp /tmp/NotoColorEmoji-sbix.ttf mermaid-trace-rs/assets/fonts/NotoColorEmoji-sbix.ttf
```

The script replaces CBDT/CBLC bitmap storage with sbix, preserving PNG bytes and bearings. It verifies unchanged GSUB shaping, cmap character mappings and hmtx advances, reopens every bitmap, and checks the exact output hash. FontTools is only needed to update this asset; it is not a runtime or normal build dependency. Production export subsets the selected font, rather than attaching the whole fallback to every SVG.

The asset and preparation are committed independently of the unfinished runtime integration. [Font acceptance and remaining gaps](specs/flowchart-mapping/spec.md) govern adoption; the asset alone does not establish portable typography.
