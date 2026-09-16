# Animation Atlas

Animation Atlas is a full-stack workspace for exploring small animation experiments. The featured lab is **InkDrift(水墨动画)** — a "brush-stroke growth canvas": as you drag with mouse or touch, the system turns speed, direction and pauses into ink shades (浓淡), flying white (飞白), dry/wet variation (干湿) and ink bleeding (墨迹扩散). Mountains, rivers, birds and inscriptions can be placed on the scroll, each with its own appearance time, and the whole painting can be replayed as a growing animation.

## Run locally

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000

Run the tests (server API + brush/sampler/op-log logic):

```bash
npm test
```

Open a project from the **InkDrift / 水墨动画** lab to enter the ink workspace.

## InkDrift 功能

- **毛笔**:速度反推压力(触屏无压感也能画出提按),行笔耗墨,墨枯出飞白,停顿晕墨。
- **元素**:山(皴笔剪影)、川(流动水纹)、鸟(扇翅飞行)、题字(竖排 + 朱红印章),每个元素可独立设置出现时间与时长。
- **播放生长**:笔画按录制时的真实节奏重现,元素按出场表依次入场。
- **长卷**:16000×1080 世界坐标,横向卷轴,缩略图导航。

## 架构

```
client/src/inkdrift/
  sampler.js    指针采样:getCoalescedEvents + 距离/转角/停顿三重阈值抽稀,
                速度→压力模拟,停顿累积(触屏无压感、点过密两个问题的核心)
  brush.js      笔刷引擎:离屏 Canvas 缓存湿笔/枯笔/晕墨三种图章,盖章式渲染;
                墨量模型驱动 湿笔↔飞白 切换;全部随机走确定性哈希(重绘/同步一致)
  tiles.js      512×512 瓦片离屏缓存,2x 超采样,LRU 回收;
                撤销后只重建受影响瓦片,不重画整卷
  history.js    追加式操作日志:undo/redo 也是操作。
                撤销后再画不会产生分支,断网补传只是继续追加
  elements.js   山/川/鸟/题字的程序化生成与渐进渲染
  timeline.js   生长时间轴:笔画按录制时间,元素按 appearAt
  sync.js       分段提交队列(IndexedDB 持久化),409 冲突时先拉远端重基再重试,
                online 事件 + 指数退避补传,空闲时上传缩略图
server/src/
  store.js          用户/项目/草稿/版本(JSON 文件存储,原子写)
  inkdrift-store.js 画卷分段存储:每段一个文件,meta 维护版本号与 x 范围索引;
                    按 id 幂等去重(补传重试安全)
  app.js            REST 边界
```

### 关键问题的处理

1. **触屏没有压感** — `sampler.js` 用速度反推压力(慢=重=浓,快=轻=枯),停顿额外增压;
   有真压感(手写笔)时优先使用。停顿由看门狗定时器检测(指针静止时浏览器不上报事件)。
2. **笔触点过密** — 采样器按 最小间距 + 转角阈值 + 停顿事件 抽稀,单笔 2400 点硬上限;
   传输前打包成紧凑数组。
3. **撤销后重新绘制** — 操作日志是 append-only 的,undo/redo 本身也是操作并同步到服务端,
   撤销后画新笔只是继续追加,不存在分支冲突;瓦片按包围盒局部重建。
4. **超长画卷加载过慢** — 服务端按段存储并维护 x 范围索引;客户端操作数超过阈值时只拉
   视口附近的分段,滚动时按需补拉;瓦片懒创建 + LRU;缩略图让列表页与首屏先有画面。

### InkDrift API

- `GET  /api/projects/:id/inkdrift` — 版本号 + 段索引(含 x 范围) + 缩略图时间
- `GET  /api/projects/:id/inkdrift/ops?after=&x0=&x1=` — 增量/视口范围拉取(undo 等全局操作始终返回)
- `POST /api/projects/:id/inkdrift/segments` — `{baseVersion, ops}` 追加一段;版本不符返回 `409 + currentVersion`;同 id 操作幂等去重
- `PUT /api/projects/:id/inkdrift/thumbnail` — 上传 PNG dataURL 缩略图
- `GET  /api/projects/:id/inkdrift/thumbnail.png` — 读取缩略图

## API boundaries

- `/api/auth`: anonymous guest identity, registration, login
- `/api/categories`: experiment lab entry points
- `/api/projects`: project creation and listing
- `/api/projects/:id/drafts`: autosaved working state
- `/api/projects/:id/versions`: immutable project snapshots
- `/api/projects/:id/assets`: resource upload metadata boundary
- `/api/projects/:id/tasks`: asynchronous task boundary
- `/api/projects/:id/inkdrift/*`: segmented ink-scroll ops, canvas versions, thumbnails

数据存放在 `server/data/`(JSON 存储 + `inkdrift/<projectId>/segments/*.json`)。
