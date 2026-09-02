# Cueport web editor plan

## Product rule

Cueport keeps one presentation document and one set of presentation components.
The web editor must reuse the desktop Stage, Sequence, References, Inspector,
settings validation, and media rules instead of developing a second editor that
only looks similar.

Every opened web presentation starts in **Presentation** mode. Viewer accounts
remain in that mode. Editors, Admins, and the Owner see a stable
**Presentation / Edit** switch in the desktop-style top bar when they may manage
that presentation. Switching modes changes available controls, never the
presentation layout or current screen position.

## Authorization model

| Role | Presentation mode | Comments | Edit assigned presentations | Publish and manage links | Manage accounts |
| --- | --- | --- | --- | --- | --- |
| Viewer | Yes | Yes | No | No | No |
| Editor | Yes | Yes | Yes | Yes | No |
| Admin | Yes | Yes | Yes | Yes | Yes |
| Owner | Yes | Yes | Every presentation | Every presentation | Yes |

Global role defines capability. Presentation ownership or an explicit dashboard
grant defines which presentations an Editor or Admin can change. The protected
Owner is never assignable, demotable, or deletable.

## Shared editor boundary

The web application should add a small web persistence adapter around the same
portable `PresentationDocument` used by desktop:

```text
shared presentation document + validation
                 |
        reusable editor components
          /                    \
desktop local adapter      web API adapter
```

The web adapter owns only authentication, remote asset URLs, upload progress,
and saving. Presentation behavior stays in the reusable renderer components.
This keeps Canvas, Fit width, viewport, fold, window frames, Sequence,
References, media playback, and keyboard behavior consistent.

## Loading and saving without duplicate uploads

1. An editor endpoint returns the current document, current publication ID, and
   a manifest containing each server-verified asset's key, type, byte size, and
   SHA-256 fingerprint.
2. Reordering or changing settings updates only the in-browser document draft;
   existing media does not need to be downloaded and uploaded again.
3. Newly dropped PNGs are converted to JPEG at 85% before hashing and upload,
   matching the desktop media policy. JPEG, WebP, and MP4 keep their supported
   formats; videos remain paused initially and loop while playing.
4. Save creates a temporary server draft. Verified unchanged assets are
   hard-linked from the live publication and only new or changed bytes upload.
5. Commit atomically replaces the one live version. A stale publication ID is
   rejected with a clear “presentation changed elsewhere” message instead of
   silently overwriting another editor's work.
6. Failed or abandoned drafts never replace the live presentation and are safe
   to clean up. They are not user-visible revision history.

## Focused delivery phases

1. **Permissions foundation — complete:** Viewer, Editor, Admin, protected
   Owner, presentation-scoped edit checks, desktop Editor login, and role-aware
   account management.
2. **Edit shell — complete:** the authenticated publication response contains
   an editor-only asset manifest; the viewer reuses Sequence, References,
   Inspector, and a stable Present / Edit switch.
3. **Media and save — complete:** picker and drag/drop imports, large opaque PNG
   conversion, server manifest reuse, in-button progress, atomic save, and
   stale-editor conflict handling.
4. **Web library parity:** create presentation, choose thumbnail, rename,
   reorder, delete, and presentation access from the same dashboard patterns.
5. **Parity verification:** keyboard controls, viewport/frame settings,
   reference overlays, video behavior, responsive layout, and accessibility.

## Download contract

The viewer download action streams one ZIP containing the complete ordered
Sequence in its original supported formats. File names are numbered so their
presentation order survives extraction. Reference-tray media and generated
video posters remain excluded.
