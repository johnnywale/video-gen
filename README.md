# Video Editor

A desktop video editor built with **Tauri 2**, **React 18**, **TypeScript**, **Zustand**, and **ffmpeg-next** (Rust libav bindings).

---

## Architecture

```
[ React UI ]
     ↓
[ Application Layer (hooks/services) ]
     ↓
[ Domain Layer (pure timeline logic) ]
     ↓
[ Infrastructure Layer (Tauri + FFmpeg) ]
```

### Layers

| Layer | Location | Rules |
|-------|----------|-------|
| UI | `src/features/editor/components/` | Dumb – no logic |
| Application | `src/features/editor/hooks/`, `services/` | Orchestration only |
| Domain | `src/domain/` | Pure functions, no React, no async |
| Infrastructure | `src/infrastructure/` | Side effects only |
| State | `src/features/editor/store/` | Zustand, calls domain functions |

---

## Prerequisites

### System

- **Node.js** ≥ 18
- **Rust** (stable) + Cargo — [rustup.rs](https://rustup.rs)
- **Tauri CLI v2** — `cargo install tauri-cli --version "^2"`
- **ffmpeg** on PATH (runtime dependency for encoding)
- **libav*** development headers (compile-time for `ffmpeg-next`):

```bash
# macOS
brew install ffmpeg pkg-config

# Ubuntu / Debian
sudo apt install libavcodec-dev libavformat-dev libavutil-dev \
                 libavfilter-dev libswscale-dev libswresample-dev pkg-config

# Arch
sudo pacman -S ffmpeg pkg-config
```

---

## Setup

```bash
npm install
```

---

## Development

```bash
npm run tauri dev
```

This starts:
1. Vite dev server on `http://localhost:1420`
2. Tauri app wrapping the dev server

---

## Production Build

```bash
npm run tauri build
```

Produces a native binary + installer in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
video-editor/
├── src/
│   ├── app/                        # Bootstrap
│   ├── assets/                     # Global CSS
│   ├── domain/
│   │   ├── timeline/
│   │   │   ├── models.ts           # Clip / Track / Timeline types
│   │   │   ├── timeline.ts         # addClip, removeClip, …
│   │   │   ├── clip.ts             # trimClip, moveClip, …
│   │   │   └── track.ts            # sortClips, hasOverlap, …
│   │   └── renderer/
│   │       └── ffmpegGraph.ts      # Timeline → ffmpeg args
│   ├── features/editor/
│   │   ├── components/
│   │   │   ├── Timeline/           # Timeline, Track, Clip
│   │   │   ├── Preview/            # VideoPlayer
│   │   │   └── Controls/           # Toolbar
│   │   ├── hooks/useEditor.ts      # Orchestration hook
│   │   ├── services/renderService.ts
│   │   └── store/editorStore.ts    # Zustand store
│   ├── infrastructure/
│   │   ├── tauri/commands.ts       # invoke() wrappers
│   │   ├── tauri/event.ts          # listen() wrappers
│   │   └── ffmpeg/ffmpegService.ts # Bridge to Tauri
│   └── shared/
│       ├── types/
│       └── constants/
└── src-tauri/
    ├── src/
    │   ├── main.rs                 # Tauri bootstrap
    │   ├── commands.rs             # Tauri commands
    │   └── media.rs                # ffmpeg-next probe
    ├── Cargo.toml
    └── tauri.conf.json
```

---

## Adding the File Picker (Production)

In `src-tauri/Cargo.toml`, add:

```toml
tauri-plugin-dialog = "2"
```

In `main.rs`:
```rust
.plugin(tauri_plugin_dialog::init())
```

Then in `commands.rs`, replace the `open_file_picker` stub:

```rust
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_file_picker(app: AppHandle, multiple: bool) -> Option<String> {
    app.dialog().file().pick_file().await.map(|p| p.to_string())
}
```

---

## Hard Parts (ffmpeg filter graph)

See `src/domain/renderer/ffmpegGraph.ts` — this is where complexity grows:

- **concat** — video segments joined end-to-end
- **overlay** — picture-in-picture
- **transitions** — xfade filter between clips
- **audio sync** — amix with delays matching `timelineStart`

Extend `buildFFmpegCommand` as your feature set grows.

---

## Undo / Redo

The store is structured for easy command-pattern extension. To add undo:

```ts
// In editorStore, wrap mutations in:
past: Timeline[]
future: Timeline[]
undo: () => void
redo: () => void
```

---

## License

MIT
