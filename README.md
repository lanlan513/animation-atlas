# Animation Atlas

Animation Atlas is a full-stack workspace for exploring small animation experiments. The first slice focuses on identity, projects, drafts, autosave, and clear API boundaries for future media and async processing.

## Panel Punch · 动态漫画分镜阅读器

`panel-punch`（美漫）实验室的项目会打开动态分镜阅读器：

- 点击不规则多边形分镜格，镜头（SVG viewBox）补间聚焦到该区域，依次播放角色动作、对白气泡与拟声词
- 分镜热区与画面共用同一套页面坐标，缩放时命中区域始终与视觉边界一致
- 支持跨格角色（同一角色横跨多个分镜格演出）与自动导读路径（按阅读顺序逐格推进）
- 自由点读 / 自动导读共用同一条阅读进度，切换模式不丢位置；进度按访客持久化，本地快照兜底
- 损坏的 SVG 热区降级为备用矩形、越界坐标自动钳制、缺失分镜显示占位，全部带禁用标记提示
- 章节分 `draft` / `published`：草稿只有作者可读，发布后访客可读

新项目打开工作区后可一键「生成示例章节」，包含上述全部特性的演示数据。

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
- `/api/projects/:id/comic`: comic structure for the owner (chapters → pages → panels → beats)
- `/api/projects/:id/comic/pages`: page + SVG hotspot upsert with server-side sanitizing/degradation
- `/api/projects/:id/comic/chapters/:chapterId`: chapter state (`draft` / `published`)
- `/api/comic/pages/:pageId`: permission-checked page read (draft = owner only)
- `/api/comic/pages/:pageId/progress`: per-visitor reading position (page, panel, order, mode)
