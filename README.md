<p align="center">
  <a href="/">
    <img src="/assets/logo.svg" alt="SoloSound Logo" width="150px">
  </a>
</p>

<h1 align="center">SoloSound</h1>

SoloSound is a lightweight, privacy-first, open-source music web app focused on a clean listening experience with high-quality audio, lyrics support, and a polished user interface.

---

## 🚀 Features

- High-quality playback with support for Hi-Res audio
- Word-synced lyrics and karaoke mode (AM-Lyrics integration)
- Recently played & history tracking
- Personal library: favorites, playlists, and user playlists
- Offline-capable PWA with download support
- Queue and playback controls, including shuffle/repeat
- Multiple API instance support with smart failover
- Customizable themes and accessibility-first design
- Keyboard shortcuts and media session integration

---

## 💿 Quick Start

Clone and install dependencies:

```bash
git clone https://github.com/SamidyFR/monochrome.git solosound
cd solosound
# Use bun (recommended) or yarn/npm
bun i
# or
# yarn
# npm i
```

Run development server:

```bash
bun dev
```

Open your browser at http://localhost:3000 (or the port Bun reports).

Build for production:

```bash
bun build
```

---

## 🛠️ Project Structure

- `index.html` — single-page entry and global assets
- `styles.css` & `animation.css` — global styles
- `am-lyrics.css` — enhanced lyrics styling for `am-lyrics` component
- `js/` — application logic (player, UI, lyrics, settings)
- `functions/` — serverless endpoints used by the app
- `public/` — static assets and manifests

---

## 🎤 Lyrics (AM-Lyrics)

SoloSound ships a refined styling layer for the `am-lyrics` web component. Features include:

- Word-by-word karaoke highlighting and per-letter lift animations
- Theme classes (`am-lyrics-theme-light`, `-minimal`, `-vibrant`, `-ambient`)
- Fullscreen and cinema display modes
- Respect for `prefers-reduced-motion` and high-contrast modes

The component is loaded from CDN in `js/lyrics.js` when needed and the `am-lyrics.css` file is included globally. The CSS supports both shadow DOM `::part()` and standard DOM fallbacks. If you want automatic per-letter splitting, let us know and we can include the small helper that transforms words into letter spans with staggered indices.

---

## 🧩 Theming & Customization

Customize the app via CSS variables or the theme UI (when available):

- Colors: `--background`, `--foreground`, `--highlight`, `--muted`, `--border`
- Lyrics: `--am-lyrics-highlight-color`, `--am-lyrics-glow-intensity`, `--am-lyrics-font-size`
- Layout: `--player-bar-height-desktop`, `--player-bar-height-mobile`

---

## 🧪 Development Tips

- The app is optimized to run locally with Bun for a fast dev loop. Use `bun dev` to start the server with automatic reloads.
- Linting/formatting is set up; run `bun run lint` and `bun run format` if you make style changes.

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Open an issue to discuss large changes.
2. Create a branch for your work.
3. Keep changes focused and include tests where appropriate.

See `CONTRIBUTE.md` for more guidelines.

---

## 🔒 License

MIT — see `LICENSE`.

---

Made with ❤️ by the SoloSound community. If you'd like help integrating AM-Lyrics per-letter JS helper or adding more themes, tell me and I’ll add it as a PR.

