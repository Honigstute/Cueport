# Desktop-to-web foundation

## What is complete in the desktop app

Cueport has one portable presentation document, one settings sanitizer, and one narrow host interface. The React presentation surface remains browser-only. Local saving is an adapter around that shared document instead of the definition of the document itself.

This boundary lets a web viewer receive the same presentation settings and ordered assets without access to Electron, the presenter’s filesystem, or desktop source keys.

## Publishing model

Publishing replaces one current web version without turning the editable desktop project into a live server folder:

1. The desktop app authenticates the presenter.
2. It asks the API to create a temporary draft and receives scoped upload targets.
3. It fingerprints every referenced asset and uploads only content the server
   has not already verified for that owner.
4. The API validates the complete draft and atomically replaces the current web version.
5. The previous web version and its obsolete files are deleted after the switch.

The temporary draft is an upload-safety boundary, not user-visible history. A
failed upload leaves the previous live version intact, and starting a new upload
replaces an abandoned draft. Publishing never creates selectable revisions.

The desktop app remains useful offline. Publishing is an explicit additional action, not a replacement for local saving.

## Recommended Hetzner split

- A small web/API service handles accounts, sessions, presentation ownership, share permissions, and signed upload/download access.
- PostgreSQL on local server storage holds users, current publications, temporary drafts, and permissions.
- S3-compatible object storage holds current image/video assets and generated video posters.
- A reverse proxy provides TLS, a stable domain, upload limits, and request logging.

Do not store the relational database inside object storage or network-mounted storage. Do not place project-wide object-storage credentials in the desktop app or browser. The API should issue short-lived, narrowly scoped upload access or proxy the upload.

## First web milestone

Keep the first hosted version intentionally small:

- email-based accounts;
- role-based presentation management with Viewer, Editor, Admin, and one
  protected Owner;
- private, unguessable read-only share links;
- non-persistent viewer controls for Canvas/Fit width, viewport visibility,
  fold position, and zoom; these always start from the published settings and
  never modify the saved desktop presentation;
- a desktop-matched viewer top bar that can be fully hidden or restored with H;
- publication upload, replace, unpublish, and revoke;
- the exact desktop home-card preview as a reserved JPEG publication asset,
  with client-mark/first-screen fallbacks for older publications;
- desktop-style owner cards with thumbnail opening, link copying, rename, and
  deletion while the current publication remains read-only;
- the existing presentation surface without editing controls;
- access and error logs, database backups, and asset-retention cleanup.

Team workspaces, analytics, custom domains, live co-editing, and billing should wait until the private viewer and authorization model are proven.

## Accounts and artwork discussions

Cueport now has one protected Owner plus invited Viewer, Editor, and Admin
accounts. Admins and the Owner can create, update, and remove accounts;
PostgreSQL prevents the configured Owner from being deleted, demoted, or
renamed even if a future API route is wrong. Editors may manage only
presentations they own or that were explicitly granted to them. Viewers remain
in presentation mode and can comment.
Password URLs are single-use, expire after seven days, and let each account set
their initial password or recover a forgotten one. Issuing a new link invalidates
every older unused link; redeeming it invalidates prior browser sessions and
desktop credentials. Signed-in users can also change their own password after
confirming the current one. Profiles contain the display name, optional title,
and an optional compact JPEG/PNG/WebP avatar used beside comments.

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

Accounts may edit or delete their own comments. The Owner may delete any comment
or an entire thread. Comment author names and titles are snapshotted for audit
history; deleted accounts appear as “Deleted account” while their old discussion
text remains. The web client renders only HTTP(S) links and never injects comment
HTML.

## Implemented first deployment

The initial Hetzner deployment deliberately uses the server's local disk behind
the same controlled asset boundary described above. PostgreSQL owns account and
publication metadata; `/var/lib/cueport/assets` owns uploaded JPEG, PNG, WebP,
and MP4 objects. The API is the only component allowed to join those two stores.

This is not a dependency on Supabase. A future project can receive its own
database and service, and Cueport can later replace the local asset adapter with
S3-compatible object storage without changing the desktop document or viewer.

The first owner is configured privately on the server. A one-time setup link
sets the password; the password itself is never written to source control or a
deployment secret.

### Incremental replacement publishing

Desktop publishing computes SHA-256 from the actual bytes of every asset. The
API combines that fingerprint with byte size and media type, and only reuses a
previous asset after the server has independently verified the same fingerprint
for the same owner. File names and modification dates never prove equality.

Each replacement is staged separately until every upload has been verified. On
local server storage, unchanged objects are materialized as hard links inside
the draft, so publishing does not upload or duplicate them. The database then
switches to the complete draft in one transaction and removes the former live
records and directory. Legacy published assets are fingerprinted from server
storage on demand when their stable asset key appears in the next publish. Old
desktop builds remain compatible and simply upload normally.

The owner dashboard measures both whole-server free space and Cueport's physical
media allocation. Per-presentation values show only the current live payload.
Server backups use hard-link snapshots for assets plus independent PostgreSQL
dumps; they are disaster-recovery copies, not accessible presentation revisions.

## Required security invariants

- The server derives ownership from the authenticated session, never from a request body.
- Every presentation read, update, publish, and delete checks authorization.
- Share tokens are random, revocable, rate-limited, and stored hashed where practical.
- Upload types, byte sizes, image dimensions, document counts, and asset keys are validated server-side.
- Asset reuse is owner-scoped and requires a server-verified SHA-256, byte size, and media type match.
- SVG client marks are treated as active content and sanitized or rasterized before web delivery.
- Secrets live in deployment configuration, never in Git, the renderer bundle, or saved presentation documents.
- Database and object-storage backups are tested by restoring them, not only by creating them.

## Repository growth

Continue the web editor by preserving the existing boundaries:

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

See [`WEB_EDITOR_PLAN.md`](WEB_EDITOR_PLAN.md) for the role matrix, mode model,
incremental upload flow, and focused parity phases.
