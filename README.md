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

## 变身演出生成台（Henshin Stage）

从 **Sakuga Spark** 实验室新建项目后，在工具枢纽选择「变身演出生成台」：

- **三套截然不同的模板**：魔法少女「星彩变身」、机甲启动「零号机接続」、剑士觉醒「居合一闪」。三者不仅是配色 / 文案不同——
  - **镜头顺序**：5 镜（点火 → 丝带涡旋 → 棱镜换装 → 宝冠降临 → 星姿定格）／ 6 镜（冷启动 → 反应堆 → 装甲咬合 → HUD 自检 → 面罩砸下 → 推进出击）／ 4 镜（聚气 → 居合拔刀 → 十字一闪 → 收刀余韵）；
  - **页面布局**：`constellation` 放射星环三栏 ／ `cockpit` 顶部 HUD + 三栏 ／ `scroll` 右侧竖卷轴；
  - **动画逻辑**：径向光晕、双螺旋丝带、星芒绽放 ／ 扫描线、六边反应堆、纵向切片遮罩、方块尾迹 ／ 水墨留白、单笔光刃路径遮罩、墨点螺旋。三套渲染器的 anim key 集合互不相交，全部 Canvas2D 绘制。
- **四项可替换配置**：角色名、主色（#rrggbb 取色器 + 色板）、光效符号（模板私有符号表）、音轨节拍（模板私有音轨，另允许最多 16 个严格升序的追加节拍）。
- **Canvas 渲染**：粒子（星芒 / 方块 / 墨点 / 光环）与遮罩（圆形扩张 / 水平扫描 / 纵向切片 / 单笔路径）全部 Canvas2D；RAF ref 直驱 60fps，节拍用 WebAudio 三角波短音提示（可静音），倒拖播放头时粒子自动重置。
- **四张数据表**：`henshin_templates`（模板定义，内置只读）、`henshin_configs`（每项目唯一的用户配置）、`henshin_resources`（资源引用 + 处理状态）、`henshin_renderings`（发布时冻结的不可变快照版本）。
- **白名单校验**：配置只接受五个白名单字段；符号 / 音轨必须取自当前模板；颜色仅接受 `#rrggbb`；未知字段、路径穿越存储键一律 400 + 结构化 `errors[]`。
- **异步资源处理**：登记资源即入队 `queued → processing(progress) → completed / failed`，`GET …/henshin/tasks/:id` 可查询；面板轮询状态，失败任务把资源对账为 `failed`（存储键以 `fail:` 开头可演示失败路径）。发布演出同样异步烘焙，版本从 `rendering` 走到 `ready`。
- **所有者限制**：所有演出接口都经过身份 + 项目所有者校验，且只挂在 Sakuga Spark 实验室下；**发布接口只允许当前项目所有者创建演出**，非所有者返回 404。

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
- `tests/henshin.test.mjs`：三套模板的镜头 / 布局 / 动画互异性、配置与资源白名单校验、异步任务 queued→completed/failed 轮询、发布版本不可变快照、所有者权限（401/404）与实验室边界。

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
- `/api/henshin/templates`: 三个内置变身模板定义（只读）
- `/api/projects/:id/henshin/config`: 用户演出配置（GET / PUT，字段白名单 + 模板私有枚举）
- `/api/projects/:id/henshin/resources`: 资源引用登记（POST 202，触发异步处理）
- `/api/projects/:id/henshin/renderings`: 发布演出（POST 202，仅项目所有者）与版本列表；`/:renderingId` 取不可变快照
- `/api/projects/:id/henshin/tasks` 与 `/:taskId`: 异步资源 / 烘焙任务的可查询状态（queued / processing / completed / failed + progress）

