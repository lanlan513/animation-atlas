# Animation Atlas

Animation Atlas is a full-stack workspace for exploring small animation experiments. The first slice focuses on identity, projects, drafts, autosave, and clear API boundaries for future media and async processing.

> **运行要求：Node ≥ 22.5**（服务端使用内置 `node:sqlite`）。

## 高燃战斗镜头设计器（Sakuga Spark）

从 **Sakuga Spark** 实验室新建项目即可进入设计器：

- **素材库**：14 个内置 SVG 素材，分角色剪影 / 冲击波 / 速度线 / 背景四类，点击即加入片段。
- **十秒时间轴**：固定 10s 片段，双击图层轨道添加关键帧，可拖动关键帧钻石改时间、拖动镜头片段移动 / 拉边缘改时长；空格键播放，方向键步进（Shift + 方向键跳 1 秒）。
- **五种镜头行为**：推镜（推进后保持）、横摇（一侧极值匀速摇到另一侧）、震屏（确定性噪声 + 淡入淡出）、闪白（起点瞬间达峰再消退）、定格（锁定动作起点姿态，震屏也停住）。
- **即时预览**：拖动播放头时主线程用同一份纯函数引擎立即精确求值；文档变化后 Web Worker 防抖重烤 601 帧（`Float32Array` TypedArray 紧凑存储），播放 / 拖动走 O(1) 查表，大批量关键帧计算不阻塞 UI。也可以直接在画布上拖动图层，自动在播放头位置写入位置关键帧。
- **乐观锁**：保存必须携带 `expectedVersion`；其他标签页已写入时返回 `409 VERSION_CONFLICT` 并附带服务器当前片段，用户可选择「采用服务器版本」或「强制覆盖」。
- **服务端校验**：非法时间范围（越界、end ≤ start、同层关键帧时刻重复、同类镜头重叠）、缺失素材 / 素材类型不匹配、过大的动作配置（单动作参数 2KB、整体 256KB、图层/关键帧/动作数量上限）一律 400 拒绝并返回结构化 `errors[]`。

## Run locally

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000

The API creates `server/data/animation-atlas.db` on first start (可用 `ATLAS_DATA_DIR` 覆盖数据目录). Anonymous visitors receive a local guest identity and can create projects immediately. Registration/login endpoints are included as the next identity step.

## Tests

```bash
npm test   # node --test tests/*.test.mjs，需要 Node ≥ 22
```

- `tests/engine.test.mjs`：关键帧插值 / 五种镜头行为 / 烤帧查表一致性 / 震屏确定性。
- `tests/api.test.mjs`：在临时数据目录启动真实 Express 服务，覆盖素材库、持久化、乐观锁 409 与全部服务端校验。

## API boundaries

- `/api/auth`: anonymous guest identity, registration, login
- `/api/categories`: experiment lab entry points
- `/api/library/assets`: 战斗素材库（只读）
- `/api/projects`: project creation and listing
- `/api/projects/:id/clip`: 十秒战斗片段（GET / PUT，乐观锁 `expectedVersion`）
- `/api/projects/:id/drafts`: autosaved working state
- `/api/projects/:id/versions`: immutable project snapshots
- `/api/projects/:id/assets`: resource upload metadata boundary
- `/api/projects/:id/tasks`: asynchronous task boundary

