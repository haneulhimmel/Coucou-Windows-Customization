# Coucou Task Hub — personal Windows build

Coucou's Mochi companion now lives in an everyday activity hub inspired by Dynamic Island.

## Use it

For a normal installation, close any running Coucou Task Hub and run **Coucou Task Hub Setup.exe**. It installs for your Windows account, includes the helper, adds a Start menu shortcut and an uninstall entry, and checks for the Microsoft Edge WebView2 Runtime. If the runtime is missing, setup downloads it. This personal installer is unsigned.

The portable option is also available: run **Coucou Task Hub.exe** from the portable Windows folder and keep its accompanying **coucou-hook.exe** beside it. The portable app requires WebView2 to be present already.

- Click the compact island at the top of your screen to expand it. Click outside the expanded island, including on the desktop or another app, to fold it back to compact. Escape also folds it.
- Music, timers, shortcuts and connected activities each use their own rounded, bordered space, following Coucou's original card style.
- Play audio in Spotify, Apple Music, a browser, or another player that exposes a Windows media session. Its activity appears automatically.
- Select a player in the activity list. Play/pause, previous/next and seek are enabled only when that player reports support. Coucou controls existing playback; it does not stream audio itself or require a Spotify login.
- Start a 5-, 15-, or 25-minute timer, or choose **Custom timer** for a name and a duration from 1 to 1440 minutes. Up to eight timers can coexist.
- Pause, resume, or cancel a timer. **Done** acknowledges a completed timer.
- Choose **Pin activity** to keep the selected activity at the front. A completed timer temporarily takes priority; acknowledgement restores the prior selection.
- The compact island shows a second indicator when music and a timer are both active.
- Add up to eight shortcuts for web URLs or full paths to an application, file, or folder. Shortcuts open the resource directly, without interpreting a command string.
- Mochi keeps his cursor tracking, reactions, wardrobe and desktop mode. Right-click him to open the wardrobe. He dances during music and celebrates completed timers.
- The small activity icon beside Home opens the existing AI and connected-service views. Chat and file drop are also available. Service integrations are opt-in in this build.

## Persistence and audio coverage

Timers and shortcuts are saved locally in the app's WebView storage. Timers use deadlines, so elapsed time catches up after sleep. **The app must be running to show an alert at the deadline.** If it was closed, the finished timer appears when you reopen it.

Media support depends on what the source app exposes to Windows. A player can supply partial metadata or omit seeking and track navigation. Audio from an app without a Windows media session cannot be controlled by this build. Spotify library browsing, device transfer, shuffle, repeat, and per-app volume are outside this first revision.

This Windows build uses a separate application ID, `CoucouTaskHub` settings/data folders and hook pipe. Existing Coucou preferences are not migrated automatically. Installing optional coding-agent hooks still requires the normal preview and confirmation within Settings.

## Build from source

Requirements: Node.js 20+, pnpm, Rust's MSVC toolchain, Visual Studio C++ build tools, and WebView2.

From `windows/`:

```powershell
pnpm install --ignore-scripts
cargo build --release -p coucou-hook
pnpm exec tauri build --no-bundle --config tauri.local-build.json
```

The app executable is `windows/target/release/coucou.exe`. Copy it and `coucou-hook.exe` into a portable folder. `tauri.local-build.json` runs the frontend tools directly, so it does not depend on npm being on PATH.

To package the built app as a Windows setup executable:

```powershell
pnpm exec tauri bundle --bundles nsis --config tauri.local-build.json
```

The installer is generated under `windows/target/release/bundle/nsis/`.

For development, run `pnpm exec tauri dev --config tauri.local-build.json`. A browser-only preview can be served with `pnpm exec vite`; native playback and local app/folder shortcuts require the Windows app.

## Tests

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --import ./tests/setup.mjs --test "tests/**/*.test.mjs"
cargo test -p coucou --lib
```

`windows/dev/media-test.html` is a silent, local browser audio source for manually checking Windows media detection, pause/resume, and seeking. It is a development fixture and is not packaged in the app.

## Implementation map

- `windows/src/core/hub.ts`: activity selection, pinning, deadline timers, persistence and shortcuts.
- `windows/src/views/hub.ts`: the expanded home screen and supported media controls.
- `windows/src/island/hub.ts`: media events, timer alerts, and compact-island visibility.
- `windows/src-tauri/src/media.rs`: Windows media-session metadata, events and targeted playback commands.
- `windows/src-tauri/src/hub.rs`: native shortcut opening.
- `windows/tests/hub.test.mjs`: recovery, sleep/deadline behavior, source changes, priority and validation tests.

The macOS/iOS implementation remains in the repository; this revision targets the Windows app.
