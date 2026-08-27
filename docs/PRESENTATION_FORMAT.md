# Portable presentation format

Cueport saves each presentation as a versioned JSON document plus its media assets. The document is deliberately independent of Electron, local filesystem paths, and temporary object URLs.

## Contract

The source of truth is [`src/shared/presentation.ts`](../src/shared/presentation.ts). A document contains:

- `schemaVersion`: the document format version.
- presentation identity, name, and ISO creation/update timestamps.
- the selected slide and sanitized presentation settings.
- ordered slide and reference collections.
- an optional client-brand asset.

Every media record contains an ID, display name, pixel dimensions, MIME type, and a relative `assetKey`. MP4 records in either the sequence or References may also contain a JPEG `posterKey`. A key such as `assets/<id>.png`, `assets/<id>.mp4`, or `references/<id>.mp4` can resolve to a file in the desktop library today and to an object-storage key in a web publication later.

Runtime-only fields are excluded:

- absolute filesystem paths;
- Electron source keys;
- `blob:` or `cueport-asset:` URLs;
- open panels, temporary overlays, and current zoom/pan position.

## Safety rules

- Asset keys must be relative and cannot contain empty, current-directory, or parent-directory segments.
- Slides and references have bounded dimensions and collection sizes.
- IDs are UUIDs and cannot be duplicated across the two media collections.
- Image, MP4, poster, and brand MIME types are allow-listed.
- Unknown settings are ignored and known settings are clamped to safe values.

All readers must call `parsePresentationDocument` before trusting a document. Server code should additionally enforce account ownership and upload-size limits because document validation is not authorization.

## Compatibility

The first desktop storage format used `version: 1`, `assetFile`, and renderer-owned untyped settings. `parseDesktopPresentationFile` migrates that format in memory. The original files remain readable; the next successful save writes the portable `schemaVersion: 1` format.

Future format changes must:

1. increment `schemaVersion` when the document shape becomes incompatible;
2. add a deterministic migration into the current shape;
3. keep migration tests with a representative older document;
4. avoid rewriting asset bytes unless the asset format itself changes.
