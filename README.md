# Cueport

Cueport is a local-first desktop presenter for website designs, walkthrough videos, and other visual work. It keeps client media on the presenter’s computer and replaces desktop clutter with a controlled canvas, sequence, references, viewport previews, and optional client branding.

The desktop app targets macOS and Windows through Electron. Its React renderer is browser-only, and saved presentations use a portable document format so the presentation surface can later be published to the web without rebuilding its data model.

## Run locally

Requirements: Node.js 22.13 or newer and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Drop JPEG, PNG, WebP, or MP4 files into the start screen or choose media from the computer. Videos stay paused until started, use native playback controls, and loop while playing. Cueport can save, rename, reorder, reopen, and delete local presentations. Saved media remains inside Cueport’s private application library.

## Main controls

- **Sequence** contains the presentation order. Drag cards to rearrange them.
- **References** stores supporting images and MP4 animations that can be placed temporarily over a slide. Reference videos stay paused until played and then loop.
- **Fit width** fills the available width and scrolls vertically.
- **Canvas** provides zooming, panning, viewports, frames, colors, client branding, and an optional fold marker.
- **Settings** contains presentation-wide title options.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + O` | Add media |
| `Cmd/Ctrl + S` | Save presentation |
| `←` / `→` | Previous / next item |
| `F` / `G` | Canvas / Fit width |
| `Cmd/Ctrl + scroll` | Zoom toward the pointer in Canvas |
| `0` | Return Canvas to 100% |
| `V` | Show or hide the viewport |
| `Home` | Scroll the active item to the top |
| `H` | Show or hide interface panels |
| `?` | Open shortcut help |
| `Esc` | Close help or hide the interface |

## Verify and package

```sh
pnpm verify
pnpm dist:mac
pnpm dist:win
```

`pnpm verify` runs type checks, all automated tests, and the production build. Installers should still be created on their target operating system. Code signing and notarization require release credentials and are intentionally not stored in this repository.

## Architecture

- [`src/main`](src/main) owns the hardened Electron window, local presentation library, safe asset protocol, and narrow IPC handlers.
- [`src/preload`](src/preload) exposes only the typed `CueportHost` capability surface. The renderer has no filesystem or generic IPC access.
- [`src/renderer`](src/renderer) owns the React presentation experience and does not import Electron.
- [`src/shared/presentation.ts`](src/shared/presentation.ts) is the runtime-independent, versioned presentation document and settings validator.
- [`src/shared/projects.ts`](src/shared/projects.ts) contains desktop runtime messages; opaque source keys and local URLs never enter the portable document.

The Electron renderer is sandboxed, context-isolated, and has Node integration disabled. Saved asset references are relative keys such as `assets/<id>.png` or `assets/<id>.mp4`, never absolute filesystem paths. MP4 files are streamed with byte-range support instead of being loaded into memory. Original version-1 desktop projects are migrated when read and are written in the portable format on their next save.

See [`docs/PRESENTATION_FORMAT.md`](docs/PRESENTATION_FORMAT.md) for the document contract and [`docs/WEB_FOUNDATION.md`](docs/WEB_FOUNDATION.md) for the deliberate desktop/web boundary and next implementation phase.

## Current boundary

This repository now contains the desktop app and the shared document foundation required by a future web viewer. Accounts, public/private sharing links, server uploads, and Hetzner deployment are deliberately the next phase: they require authentication, authorization, object storage, a database, and release secrets that do not belong inside the desktop editor.
