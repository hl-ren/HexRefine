# Windows Desktop Test App

HexRefine can be packaged as a portable Windows desktop app for easier local
testing. The desktop app wraps the same static browser workbench with Electron.

## Build The Windows App

From the project root:

```bash
npm install
npm run desktop:win
```

The first run downloads the Windows Electron runtime into
`release/electron-zips/`. Later builds reuse that local cache. Set
`ELECTRON_MIRROR` before running the command if another Electron mirror is
needed.

The build writes:

```txt
release/desktop/HexRefine-win32-x64/
release/desktop/HexRefine-win32-x64.zip
```

## Run On Windows

1. Copy `HexRefine-win32-x64.zip` to a Windows machine.
2. Extract the zip file.
3. Open the extracted folder.
4. Double-click `HexRefine.exe`.

No Node.js, Python, or server setup is required on the Windows machine.

## How It Works

The Electron app starts a local `127.0.0.1` static server inside the app process
and opens the HexRefine browser workbench in a desktop window. This keeps the
runtime close to the web version while avoiding `file://` module-worker issues.

The app is currently unsigned. Windows SmartScreen may show a warning the first
time it is opened. For internal testing, choose "More info" and then "Run
anyway" if you trust the build source.

## Local Desktop Preview

On the development machine, run:

```bash
npm run desktop:run
```

This launches the Electron app for the current platform using the generated
desktop app source in `release/desktop-app/`.
