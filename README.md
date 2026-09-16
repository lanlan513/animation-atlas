# Panel Punch — 超级英雄冲击字工坊 × 英雄对决

Panel Punch is a full-stack American-comic action-poster editor. Type **BAM / POW / CRASH**, tune the burst outline, ink stroke, halftone dots, bounce curve and RGB channel offset, then drag the result onto an action poster whose layers can be reordered, locked, hidden and re-edited. Refresh the page and the same artwork is restored from saved parameters — not from a screenshot.

The **英雄对决 (Hero Duel)** page is a two-hero decision tool: configure 力量 / 速度 / 装备 / 场景优势 / 弱点 for both fighters, and the **server-side rules engine** produces a chase, melee, counter or retreat ending. The browser only renders the radar chart, the battlefield animation and the engine's step-by-step explanation — it never computes a winner locally.

## Hero Duel

- **Server-only verdicts** (`server/src/duel-engine.js`): terrain amplification → offense/defense scores → tanh-compressed net score → ending rules (`retreat ≥ 70 margin` → `counter` on weakness ≥ 55 vs effective gear ≥ 60 → `chase` on speed gap ≥ 25 → `melee`). Every rule that fires is appended to a human-readable `steps[]` log, and identical setups always reproduce the identical verdict (`seed` = FNV-1a of the sanitized setup).
- **Traceable records**: every parameter change is submitted as a new append-only record (`server/data/duels/`). Restoring history creates a *new* record with `restoredFrom` lineage; there is no update/delete route for verdicts. The only mutable field is the owner's `isPublic` flag — other users can read published records via the public wall but can never modify them (ownership is checked on every load/publish/restore).
- **Rate limiting**: duel submissions are capped at 8 per 10 s sliding window per user; excess requests get `429` + `Retry-After`, and the client backs off for the server-provided window with a single retry.
- **No stale conclusions**: submissions carry a sequence number and an `AbortController` — superseded requests are aborted and late responses discarded. The canvas runs exactly one rAF loop; a newer verdict replaces the timeline immediately, and while a verdict is in flight the previous conclusion is torn down in favor of a neutral "judging" idle.

### Duel API

- `POST /api/duels` — submit a setup, returns the frozen record (setup + verdict)
- `GET /api/duels` — own history · `GET /api/duels/public` — public wall
- `GET /api/duels/:id` — owner always; others only when published
- `POST /api/duels/:id/restore` — new record from a historical setup (lineage kept)
- `POST /api/duels/:id/publish` — owner-only `isPublic` toggle

## Run locally

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000

Anonymous visitors receive a guest id stored in `localStorage`. On first open a poster is created automatically; the most recent poster is reloaded on refresh.

## What is saved

Everything is stored as **editable SVG parameters**, keyed by random seeds:

- per-impact params: word, burst/blob/badge outline, spike count, jaggedness, stroke width, halftone radius/gap/density, channel distance/angle, roughness, bounce curve/amplitude, five colors, `seed`
- layer relations: ordered `layers[]`, per-layer `x/y/scale/rotation`, `locked`, `visible`, editable `name`
- poster `width/height`, global background `seed`, `exportConfig` (SVG/PNG, export scale)
- optimistic `revision` for multi-tab conflict detection

Server storage is atomic JSON under `server/data/panel-punch/` (poster files + an index), with writes serialized.

## Rendering pipeline

- **SVG filters**: `feTurbulence` + `feDisplacementMap` give the hand-printed rough outline.
- **Canvas**: the poster background (radial paper, speed lines, dense halftone) is painted deterministically from the seed.
- **CSS blend modes**: red/cyan channel layers use `mix-blend-mode: multiply`.
- Deterministic `mulberry32` geometry means the same seed + parameters always produce the same burst path and dot field.

### Safari / unsupported filters

The editor UA-detects Safari and defaults the SVG turbulence filter off. A static offset/duplicate outline keeps the rough-ink look without relying on `feTurbulence`. The toggle can be forced on manually.

## Frequent dragging & autosave

- Mousemove/touchmove during a drag only mutates local state; saves are coalesced behind a 420 ms debounce.
- A single save promise chain means a newer revision is never sent before the previous save resolves.
- Optimistic revision (`If-Match`) returns `409` with the server poster for multi-tab safety.
- Tab hide / `beforeunload` flushes once with `fetch(..., { keepalive: true })`, preserving the auth header.

## Malicious / oversized input

- Words are normalized (`NFKC`), control characters and tags stripped, limited to 12 characters — on input, in the shared normalizer, and again on the server.
- Numeric params are clamped; layer ids are regenerated when malformed; layers are capped at 36; colors must be 6-digit hex.
- Request bodies are capped at 192 kb (`413`), and every poster is run through the same strict normalizer server-side before storage.

## API

- `POST /api/auth/guest`, `GET /api/auth/me`
- `GET /api/posters`, `POST /api/posters`
- `GET /api/posters/:id`
- `PUT /api/posters/:id` — optional `If-Match: <revision>` for optimistic concurrency; `409` returns the server poster.

## Export

The live SVG node is serialized for **SVG** export or rasterized through an `Image` + `Canvas` pipeline at 1×–4× for **PNG** export. Export format/scale are part of the saved export configuration.
