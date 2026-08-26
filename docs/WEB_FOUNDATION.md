# Desktop-to-web foundation

## What is complete in the desktop app

Cueport has one portable presentation document, one settings sanitizer, and one narrow host interface. The React presentation surface remains browser-only. Local saving is an adapter around that shared document instead of the definition of the document itself.

This boundary lets a web viewer receive the same presentation settings and ordered assets without access to Electron, the presenter’s filesystem, or desktop source keys.

## Publishing model for the next phase

Publishing should create an immutable snapshot rather than turn the editable desktop project into a live server folder:

1. The desktop app authenticates the presenter.
2. It asks the API to create a draft publication and receives scoped upload targets.
3. It uploads only assets referenced by the validated portable document.
4. The API validates the document, records ownership, and commits a numbered revision.
5. A share link resolves to one published revision; later desktop edits do not silently change a client presentation.

The desktop app remains useful offline. Publishing is an explicit additional action, not a replacement for local saving.

## Recommended Hetzner split

- A small web/API service handles accounts, sessions, presentation ownership, share permissions, and signed upload/download access.
- PostgreSQL on local server storage holds users, publications, revisions, and permissions.
- S3-compatible object storage holds immutable image assets and optional generated previews.
- A reverse proxy provides TLS, a stable domain, upload limits, and request logging.

Do not store the relational database inside object storage or network-mounted storage. Do not place project-wide object-storage credentials in the desktop app or browser. The API should issue short-lived, narrowly scoped upload access or proxy the upload.

## First web milestone

Keep the first hosted version intentionally small:

- email-based accounts;
- owner-only presentation management;
- private, unguessable read-only share links;
- publication upload, replace, unpublish, and revoke;
- the existing presentation surface without editing controls;
- access and error logs, database backups, and asset-retention cleanup.

Team workspaces, comments, analytics, custom domains, live co-editing, and billing should wait until the private viewer and authorization model are proven.

## Required security invariants

- The server derives ownership from the authenticated session, never from a request body.
- Every presentation read, update, publish, and delete checks authorization.
- Share tokens are random, revocable, rate-limited, and stored hashed where practical.
- Upload types, byte sizes, image dimensions, document counts, and asset keys are validated server-side.
- SVG client marks are treated as active content and sanitized or rasterized before web delivery.
- Secrets live in deployment configuration, never in Git, the renderer bundle, or saved presentation documents.
- Database and object-storage backups are tested by restoring them, not only by creating them.

## Repository growth

When web implementation begins, add it as a separate application while preserving the existing boundaries:

```text
apps/
  desktop/       Electron host and desktop packaging
  web/           Read-only viewer and account UI
  api/           Authentication, publications, permissions
packages/
  presentation/  Portable document, migrations, validation
  viewer/        Reusable presentation surface
```

Move code into that structure only when the corresponding web application is introduced. The current locations already enforce the dependency direction, so a speculative monorepo migration is not required before then.
