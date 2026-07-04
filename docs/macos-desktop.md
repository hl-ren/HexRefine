# macOS Desktop Test App

HexRefine can be packaged as a portable macOS desktop app for easier local
testing. The desktop app wraps the same static browser workbench with Electron.

## Build The macOS Apps

From the project root:

```bash
npm install
npm run desktop:mac
```

The first run downloads the macOS Electron runtimes into
`release/electron-zips/`. Later builds reuse that local cache. Set
`ELECTRON_MIRROR` before running the command if another Electron mirror is
needed.

By default the command builds both Apple Silicon and Intel packages. To build
only one architecture, set `DESKTOP_MAC_ARCHS`:

```bash
DESKTOP_MAC_ARCHS=arm64 npm run desktop:mac
DESKTOP_MAC_ARCHS=x64 npm run desktop:mac
```

The build writes:

```txt
release/desktop/HexRefine-darwin-arm64/
release/desktop/HexRefine-darwin-arm64.zip
release/desktop/HexRefine-darwin-x64/
release/desktop/HexRefine-darwin-x64.zip
```

## Run On macOS

1. Choose the zip for the user's Mac:
   - `HexRefine-darwin-arm64.zip` for Apple Silicon Macs.
   - `HexRefine-darwin-x64.zip` for Intel Macs.
2. Extract the zip file.
3. Open `HexRefine.app`.

No Node.js, Python, or server setup is required on the user's Mac.

## Gatekeeper Notice

The app is currently unsigned. macOS Gatekeeper may block the first launch. For
internal testing, right-click `HexRefine.app`, choose "Open", and confirm that
you trust the build source.

## Local Desktop Preview

On the development machine, run:

```bash
npm run desktop:run
```

This launches the Electron app for the current platform using the generated
desktop app source in `release/desktop-app/`.
