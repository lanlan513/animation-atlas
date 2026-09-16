# Panel Punch — 超级英雄冲击字工坊

Panel Punch is a full-stack American-comic action-poster editor. Type **BAM / POW / CRASH**, tune the burst outline, ink stroke, halftone dots, bounce curve and RGB channel offset, then drag the result onto an action poster whose layers can be reordered, locked, hidden and re-edited. Refresh the page and the same artwork is restored from saved parameters — not from a screenshot.

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
