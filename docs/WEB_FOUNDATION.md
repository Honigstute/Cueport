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
- S3-compatible object storage holds immutable image/video assets and generated video posters.
- A reverse proxy provides TLS, a stable domain, upload limits, and request logging.

Do not store the relational database inside object storage or network-mounted storage. Do not place project-wide object-storage credentials in the desktop app or browser. The API should issue short-lived, narrowly scoped upload access or proxy the upload.

## First web milestone

Keep the first hosted version intentionally small:

- email-based accounts;
- owner-only presentation management;
- private, unguessable read-only share links;
- non-persistent viewer controls for Canvas/Fit width, viewport visibility,
  fold position, and zoom; these always start from the published settings and
  never modify the immutable revision;
- a desktop-matched viewer top bar that can be fully hidden or restored with H;
- publication upload, replace, unpublish, and revoke;
- the exact desktop home-card preview as a reserved JPEG publication asset,
  with client-mark/first-screen fallbacks for older revisions;
- desktop-style owner cards with thumbnail opening, link copying, rename, and
  deletion while publication content remains immutable;
- the existing presentation surface without editing controls;
- access and error logs, database backups, and asset-retention cleanup.

Team workspaces, analytics, custom domains, live co-editing, and billing should wait until the private viewer and authorization model are proven.

## Accounts and artwork discussions

Cueport now has one protected owner plus invited member accounts. The owner can
create, update, and remove members; PostgreSQL prevents the configured owner
from being deleted, demoted, or renamed even if a future API route is wrong.
Invitation URLs are single-use, expire after seven days, and let each member set
their own password. Profiles contain the display name, optional title, and an
optional compact JPEG/PNG/WebP avatar used beside comments.

Published links require a signed-in Cueport account. Discussion threads belong
to the presentation and a stable slide UUID. Their pin coordinates are stored
as integer parts per million of the imported artwork—not the browser window,
canvas gutter, frame bezel, or viewport—so fit-width, zoom, and responsive
layouts cannot move the logical point. Thread creation plus its first comment,
and final-comment removal plus thread cleanup, are transactional.

The artwork context menu exposes both comment creation and temporary reference
placement without requiring comment mode first. Selecting Create Comment turns
comments on and opens the composer at that source-relative point. Pin movement
uses a drag threshold so a click still opens the discussion; only the thread
creator or the protected owner may persist a new position.

Members may edit or delete their own comments. The owner may delete any comment
or an entire thread. Comment author names and titles are snapshotted for audit
history; deleted members appear as “Deleted account” while their old discussion
text remains. The web client renders only HTTP(S) links and never injects comment
HTML.

## Implemented first deployment

The initial Hetzner deployment deliberately uses the server's local disk behind
the same immutable asset boundary described above. PostgreSQL owns account and
publication metadata; `/var/lib/cueport/assets` owns uploaded JPEG, PNG, WebP,
and MP4 objects. The API is the only component allowed to join those two stores.

This is not a dependency on Supabase. A future project can receive its own
database and service, and Cueport can later replace the local asset adapter with
S3-compatible object storage without changing the desktop document or viewer.

The first owner is configured privately on the server. A one-time setup link
sets the password; the password itself is never written to source control or a
deployment secret.

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
