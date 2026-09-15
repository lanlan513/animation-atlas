# Animation Atlas

Animation Atlas is a full-stack workspace for exploring small animation experiments. The first slice focuses on identity, projects, drafts, autosave, and clear API boundaries for future media and async processing.

## Run locally

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000

The API creates `server/data/animation-atlas.db` on first start. Anonymous visitors receive a local guest identity and can create projects immediately. Registration/login endpoints are included as the next identity step.

## API boundaries

- `/api/auth`: anonymous guest identity, registration, login
- `/api/categories`: experiment lab entry points
- `/api/projects`: project creation and listing
- `/api/projects/:id/drafts`: autosaved working state
- `/api/projects/:id/versions`: immutable project snapshots
- `/api/projects/:id/assets`: resource upload metadata boundary
- `/api/projects/:id/tasks`: asynchronous task boundary
