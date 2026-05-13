# Release Guide

This project can produce two release artifacts:

- A static web bundle in `release/comformhex-<version>/web/`.
- A stable GitHub Pages bundle in `release/pages/`.
- A portable Windows desktop app in `release/desktop/` when `npm run desktop:win`
  is run.
- Portable macOS desktop apps in `release/desktop/` when `npm run desktop:mac`
  is run.
- An npm source/runtime tarball in `release/comformhex-<version>.tgz`.

## Build A Release

```bash
npm install
npm run release
```

The release script runs:

1. `npm test`
2. `npm run examples:vtk`
3. `node scripts/prepare-release.mjs`
4. `npm pack --pack-destination release --cache .npm-cache`

## Try The Web Bundle

After `npm run release`, serve the generated release directory:

```bash
python3 -m http.server 8080 --directory release/comformhex-0.1.0/web
```

Then open:

```txt
http://127.0.0.1:8080/
```

You can also use the shortcut:

```bash
npm run pages:serve
```

## Release Contents

The generated `release/comformhex-<version>/` directory contains:

- `dist/`: compiled runtime JavaScript and TypeScript declarations.
- `src/`: TypeScript source.
- `docs/`: project documentation.
- `examples/`: browser workbench and generated VTK examples.
- `test/`: reproducibility and regression tests.
- `web/`: static browser bundle suitable for GitHub Pages or any static host.
- `manifest.json`: generated release metadata.

## Publish Notes

For a GitHub release, attach:

- `release/comformhex-<version>.tgz`
- The `release/comformhex-<version>/` directory as a zip archive if desired.

For a static website, upload the contents of:

```txt
release/pages/
```

The web bundle is static and does not require a backend server.

For GitHub Pages deployment from GitHub Actions, see:

```txt
docs/github-pages.md
```

## Windows Desktop App

Build a portable Windows x64 desktop app:

```bash
npm run desktop:win
```

The build writes:

```txt
release/desktop/ComformHex-win32-x64/
release/desktop/ComformHex-win32-x64.zip
```

Copy the zip file to Windows, extract it, and double-click `ComformHex.exe`.
See `docs/windows-desktop.md` for details.

## macOS Desktop Apps

Build portable macOS desktop apps:

```bash
npm run desktop:mac
```

The build writes:

```txt
release/desktop/ComformHex-darwin-arm64/
release/desktop/ComformHex-darwin-arm64.zip
release/desktop/ComformHex-darwin-x64/
release/desktop/ComformHex-darwin-x64.zip
```

Use the arm64 zip for Apple Silicon Macs and the x64 zip for Intel Macs. The
apps are unsigned, so macOS may require right-clicking `ComformHex.app` and
choosing "Open" on first launch. See `docs/macos-desktop.md` for details.
