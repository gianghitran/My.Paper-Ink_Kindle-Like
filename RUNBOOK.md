## Develop

```bash
npm install
cp .env.example .env.local   # then paste the anon/publishable key
npm run dev                  # http://localhost:5173
npm run build                # type-check + static build into dist/
npm run preview
```

Node 20+ is recommended (CI uses Node 22).

### Environment variables

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://[YOUR_].supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's **anon / publishable** key (Dashboard → Project Settings → API) |

## Deploy to GitHub Pages

1. Push this project to a GitHub repository with a `main` branch.
2. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Under **Settings → Secrets and variables → Actions**, add the variable `VITE_SUPABASE_URL` = `https://[YOUR_].supabase.co` and the secret `VITE_SUPABASE_ANON_KEY` = your anon/publishable key.
4. Push to `main`. `.github/workflows/deploy.yml` builds and deploys to `https://<username>.github.io/<repository>/`.

The workflow sets `BASE_PATH=/<repository>/`, or `/` for `<username>.github.io` repositories. Vite uses it as `base`, so the assets, the pdf.js worker, CMaps and fonts, the manifest, the icons and the service worker all resolve under that sub-path. When `BASE_PATH` is not set, the build uses a relative base (`./`) and works from any folder. Routing uses `HashRouter`, so refreshing any page never hits a GitHub Pages 404.

## Supabase setup (once)

1. **Database**: the schema — tables, constraints, indexes, RLS policies, the private `documents` bucket and its Storage policies — is already deployed in the project (Dashboard → Database / Storage). Keep RLS enabled on every table.
   Then run [`sql/profiles-display-name.sql`](sql/profiles-display-name.sql) once in the SQL Editor: it stores each account's username in `profiles.display_name` (new accounts through the sign-up trigger, existing ones backfilled) and makes that column read-only for clients.
   Also run [`sql/koreader-highlights.sql`](sql/koreader-highlights.sql) once: it adds `highlights.tags` and `highlights.drawer` (KOReader highlight styles) and removes the old text-pinned notes without a highlight. Until it runs, highlights still save but their style/tags stay on this device only.
   Also run [`sql/mobi-format.sql`](sql/mobi-format.sql) once: it allows `source_format = 'mobi'`. Until it runs, MOBI imports fail with a check-constraint error.
   Also run [`sql/remove-upload-limit.sql`](sql/remove-upload-limit.sql) once: it removes the 200 MB cap on `documents.size_bytes` (files in R2 have no size limit). The legacy Supabase `documents` bucket keeps its own 200 MB limit; it is only used when `VITE_FILES_URL` is not set.
   **Deleting a user's files with the profile** (deleting a row in `profiles` — or the auth user, which cascades to it — removes everything under `documents/{user_id}/` and the account):
   1. Dashboard → **Edge Functions** → Deploy a new function → *Via editor*, name it `purge-user`, paste [`edge-functions/purge-user/index.ts`](edge-functions/purge-user/index.ts), and turn **Verify JWT off** (the trigger authenticates with its own secret).
   2. Run [`sql/purge-user-storage.sql`](sql/purge-user-storage.sql) in the SQL Editor (enables `pg_net`, creates the secret in Vault and the `AFTER DELETE` trigger).
   3. Copy the secret it created (`select decrypted_secret from vault.decrypted_secrets where name = 'paperink_purge_secret'`) into **Edge Functions → Secrets** as `PURGE_WEBHOOK_SECRET`.
   The function uses the service-role key that Supabase injects into Edge Functions; it never appears in the app. Results of each call: `select * from net._http_response order by created desc`.
2. **Auth → Sign In / Providers → Email**: keep the Email provider **enabled** (username accounts use it internally), turn **Confirm email OFF** (username accounts have no inbox), and turn **Secure password change OFF** (the app re-checks the current password itself). Set the minimum password length to 8 with letters and digits.
3. **Auth → Sign In / Providers → Google**: enable it with a Google Cloud OAuth client (type *Web application*) whose **Authorized redirect URI** is `https://[YOUR_].supabase.co/auth/v1/callback`. The client secret stays in Supabase.
4. **Auth → URL Configuration**: Site URL `https://<username>.github.io/<repository>/`; Redirect URLs:
   - `https://<username>.github.io/<repository>/**`
   - `http://localhost:5173/**`
   - `http://localhost:4173/**` 
5. **Auth → Rate limits / Attack protection**: keep the default sign-in rate limits; optionally enable CAPTCHA.

## Cloudflare R2 file storage (once)

Book files and covers live in a private Cloudflare R2 bucket. The database and sign-in stay in Supabase. The app never talks to R2 directly: the `paperink-files` Worker ([`workers/files`](workers/files)) checks the caller's Supabase access token with Supabase Auth and only serves keys under `{user_id}/`. Uploads also need a `documents` row that the caller owns (checked through PostgREST with the caller's JWT, so RLS decides). The Worker reaches the bucket through an R2 binding, so no R2 access keys exist anywhere.

1. In the Cloudflare dashboard, create an account if needed. Leave the bucket private: do **not** enable public access or an `r2.dev` URL.
2. ```bash
   cd workers/files
   npm install
   npx wrangler login
   npx wrangler r2 bucket create paperink-documents
   ```
3. Check `[vars]` in [`workers/files/wrangler.toml`](workers/files/wrangler.toml): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (the same public key as the app) and `ALLOWED_ORIGINS` (your GitHub Pages origin plus local dev origins; CORS is not a security boundary, the token check is).
4. Create the purge secret and store it in the Worker:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx wrangler secret put FILES_PURGE_SECRET
   ```
5. `npm run deploy`. Wrangler prints the Worker URL, e.g. `https://paperink-files.<your-subdomain>.workers.dev`.
6. Supabase → **Edge Functions → Secrets**: add `FILES_URL` (the Worker URL) and `FILES_PURGE_SECRET` (the same value as step 4). Redeploy `purge-user` with the current [`edge-functions/purge-user/index.ts`](edge-functions/purge-user/index.ts) so that deleting a profile also empties `{user_id}/` in R2.
7. GitHub → **Settings → Secrets and variables → Actions → Variables**: add `VITE_FILES_URL` = the Worker URL. For local builds put the same line in `.env.local`. Push to redeploy.

Without `VITE_FILES_URL` the app keeps using the Supabase Storage bucket, so nothing breaks before the Worker is deployed.

**Moving existing files.** No bulk copy is needed. When the app needs a file that is not in R2 yet, it downloads it from Supabase Storage with the user's own session, uploads it to R2 and deletes the Supabase copy. Files that are never opened stay in Supabase Storage until they are opened. Deleting a book removes it from both. Keep the `documents` bucket and its policies until it is empty (Dashboard → Storage).

**Local development.** `cd workers/files && npm run dev` starts the Worker on port 8787 with a local, on-disk R2. Put `FILES_PURGE_SECRET=<random hex>` in `workers/files/.dev.vars` (git-ignored) and `VITE_FILES_URL=http://localhost:8787` in `.env.local`.

Limits enforced by the Worker:
- no size limit per file (R2 allows up to 10,000 parts of 50 MB, about 488 GB);
- PDF, EPUB, comic and JPEG types only;
- no overwrites;
- files over 90 MB are uploaded in 50 MB parts, because of the Workers request-size limit.

Username accounts are stored by Supabase Auth as `<username>@users.paperink.invalid` — the reserved `.invalid` domain can never receive mail, so no email is ever sent and passwords are only handled by Supabase. A forgotten username password can't be recovered by email; Google accounts are managed by Google.

## Architecture

```
src/
  lib/            db (cloud tables + row mappers), library (document service: import/delete),
                  annotations, graph, wikilinks, backup (JSON/Markdown), pwa, formats/ (format registry)
    supabase/     client (anon key from env, PKCE auth)
    cloud/        table (in-memory session cache), sync (debounced write queue), session (load/sign-out),
                  useLiveQuery
    services/     auth, storage (R2 through the files Worker; Supabase Storage fallback), readingState
  store/          settings (Zustand, saved to the account)
  components/
    reader/       ReaderPage (shell, persistence, panels, annotation actions)
      pdf/        PdfReader (virtualized pages, zoom gestures, selection) + PdfPage (canvas/text/links)
      epub/       EpubReader (epub.js rendition, typography injection, CFI highlights)
    graph/, notes/, library/, layout/, ui/ (shadcn-style primitives on Radix)
  pages/          Library, Notes, Graph, Settings, AuthPages (sign in / create account / change password)
```

- **Document identity**: each document has a random UUID; the file's SHA-256 (`content_hash`, unique per user) detects duplicates. Files live at `{user_id}/{document_id}/{filename}` in the R2 bucket (older files: the same path in the Supabase `documents` bucket until they are moved). Restoring a JSON backup re-attaches annotations to documents already in your library by content hash.
- **Persistence**: Supabase is the source of truth for all app data. The client keeps the signed-in user's rows in memory for the session (wiped on sign-out). The one exception is an **on-device file cache** (IndexedDB, `src/lib/services/deviceCache.ts`) holding downloaded book files and covers, so each book is downloaded once per device instead of on every visit (saves egress). It is bound to one account (wiped when another user signs in, on sign-out and on *Erase all data*), prunes files of documents deleted elsewhere, and evicts least-recently-used files beyond 2 GB / 60 % of the browser quota. Settings → Cloud library shows its size and can clear it. Supabase Auth keeps its session token in localStorage so you stay signed in.
- **Adding formats** (AZW3/KF8, DjVu…): register a handler in `src/lib/formats/index.ts`. Reflowable formats should `convert` to EPUB (see `textFormats.ts`, `fb2.ts`). Page-image formats can reuse the page engine through an adapter like `comicDoc.ts`.
- **Performance**: only the pages near the viewport have canvases and text layers. Canvases are released when pages scroll away and are capped in pixel size for iOS. The PDF reader, EPUB reader, knowledge graph, Markdown and settings are lazy-loaded chunks.

## Security and privacy

- **Authorization is enforced by Supabase, not the frontend**: every user-owned table has RLS policies `auth.uid() = user_id` for SELECT/INSERT/UPDATE/DELETE (role `authenticated` only; `anon` has no privileges). A trigger forces `user_id := auth.uid()` on insert and rejects any change of `user_id` or `id`, so ownership values sent by a client are ignored and can't be transferred. Composite foreign keys `(document_id, user_id)` stop rows from pointing at another user's document, highlight, note or node. File paths must sit inside the owner's folder.
- **Storage**: files are in a private Cloudflare R2 bucket with no public URLs. Only the `paperink-files` Worker can reach it, through its R2 binding. Every request carries the user's Supabase access token, and the Worker:
  - checks the token with Supabase Auth;
  - derives the user id from it, never from the request;
  - only allows keys under `{user_id}/`;
  - requires a document row that RLS shows to the caller before any write.

  Uploads are limited to PDF/EPUB/comic/JPEG types (no size limit), and can't overwrite existing files. The purge endpoint only accepts a server-side shared secret. The legacy Supabase `documents` bucket keeps its policies: private, `{auth.uid()}/…` only, uploads need a matching document row.
- **No roles**: there are no admin/moderator flags or privilege levels. The `service_role` key is never used by the app.
- Passwords and tokens are never logged. User-controlled text is length-checked in the UI and by database CHECK constraints.
- Imported documents are untrusted:
  - EPUB content renders in sandboxed iframes without `allow-scripts`.
  - External EPUB links open with `noopener`.
  - PDF JavaScript and XFA are never run.
  - PDF links are limited to `http(s)`/`mailto`.
  - Notes render through `react-markdown`, so raw HTML is never interpreted.
