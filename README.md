# PixelPulse · 像素角色走路循环编辑器

在放大网格上逐帧绘制像素角色，组织八方向走路循环，即时预览并导出**不被浏览器抗锯齿处理**的 PNG 精灵图。后端按项目版本保存像素矩阵、色板、帧顺序与导出尺寸，保存采用**增量提交**而不是每次上传整张画布。

## 运行

```bash
npm install
npm run dev          # API :4000 + Vite :5173
```

- 编辑器：http://localhost:5173
- API：http://localhost:4000/api/health
- 测试：`npm test`（共享核心 19 项 + 客户端 store 6 项，无外部测试框架）
- 构建：`npm run build`

数据落在 `server/data/`（JSON 快照 + 追加式 commit 日志，零原生依赖），可随时删除重置。

## 功能

| 需求 | 实现 |
| --- | --- | --- |
| 放大网格逐帧绘制 | 1:1 离屏位图 + 整数倍放大显示，画笔 / 橡皮 / 油漆桶 / 吸色，Bresenham 连线拖拽 |
| 洋葱皮 | 当前帧前后各 N 帧半透明叠影（蓝/橙），数量可配 |
| 镜像绘制 | X / Y / XY 轴对称，轴上像素自动去重，画布显示镜像辅助线 |
| 调色板锁定 | 锁定的色板颜色：其既有像素绘制时受保护不可覆盖，颜色不可编辑/删除 |
| 帧复制 | 时间轴逐帧复制（含像素数据），也可复制到其他方向 |
| 八方向动作 | down/downLeft/left/upLeft/up/upRight/right/downRight，时间轴按方向分组 |
| 即时预览 | 独立面板按 FPS 循环播放全部方向或仅当前方向 |
| PNG 导出 | 离屏 `putImageData` + 整数倍 `drawImage`，全程 `imageSmoothingEnabled=false`，CSS `image-rendering: pixelated`；网格（八方向分行）或长条布局，1×–8× 倍率与帧间距 |
| 后端按版本保存矩阵/色板/帧顺序/导出尺寸 | `server/data/p/<id>.json` 全量快照 + `<id>.log` 追加式增量日志，版本号单调递增 |
| 增量提交而非整画布 | 客户端只发送稀疏 op（`paint` 仅含变化的 `[x,y,color,old]` 单元格），服务端重放 op 修改模型 |
| Canvas 更新限制到变化区域 | 每次 paint 产出脏矩形，rAF 中仅在 native 缓冲重绘该矩形、可见画布按外扩 1 格的区域局部刷新；切帧/结构变化才整绘 |
| 撤销栈过大 | 条目数 200 / 序列化体积 4 MB 双上限，FIFO 回收最早历史并提示；已保存内容不受影响 |
| 调色板颜色被删除 | `palDelete` op 在删除前快照所有受影响帧，级联清空对应像素→透明；操作可完整撤销（恢复色槽+像素）；其他端的删除通过 rebase 生效 |
| 离线绘制后的冲突恢复 | 断网时 op 持久化在 localStorage 队列；重连发 409 后**服务器优先**：回放远程 catch-up 的结构变化，再用共享的 `rebaseQueuedOps` 变换本地队列（索引迁移、帧/色被删则丢弃对应 op 或单元格并提示），然后重新提交；日志窗口被压缩时走全量 resync |

## 操作

- `B` 画笔 · `E` 橡皮 · `G` 填充 · `I`/右键 吸色
- `X` 循环切换镜像模式（关 → X → XY → Y）· `O` 洋葱皮开关
- `Ctrl/⌘+Z` 撤销 · `Ctrl/⌘+Shift+Z`（或 `Ctrl+Y`）重做 · `Ctrl/⌘+S` 立即同步
- 顶栏「模拟离线」可直接演练离线绘制 → 重连冲突恢复流程。

## 架构

```
shared/pixel-core.js      前后端共享：模型 / op 应用 / 逆 op / 位图编解码 / rebase
server/src/db.js          JSON 快照 + 追加日志、写串行化、幂等 nonce、日志压缩
server/src/index.js       REST：访客、项目 CRUD、POST /commits（409 + catchUp）
client/src/pixel/store.js 工作模型、撤销/重做（补偿提交）、增量队列、离线 409 恢复
client/src/pixel/PixelCanvas.jsx  脏矩形 Canvas 渲染器（离屏原生分辨率 + 关闭平滑）
client/src/pixel/export.js        预览 / 精灵图离屏渲染与 PNG 下载
client/src/pixel/{Timeline,PalettePanel,PreviewPanel,ExportPanel}.jsx
test/core.test.js         op 代数、色板级联、逆操作、rebase（19 项）
test/store.test.js        浏览器 shim 下的补偿撤销 / 离线队列 / 409 恢复（6 项）
```

### 为什么导出没有抗锯齿

像素先以**原生分辨率**（如 16×16）写入一个离屏 canvas（`putImageData`，无缩放无插值），再用 `drawImage` 以**整数倍**放大到目标 canvas，且目标上下文 `imageSmoothingEnabled = false`；预览/缩略图同样如此并配合 CSS `image-rendering: pixelated`。整条链路不存在非整数缩放，浏览器不会生成半透明插值像素。

### 增量提交协议

```
POST /api/projects/:id/commits
{ "baseVersion": 7,
  "clientId": "<uuid>", "clientSeq": 42,        // 幂等 nonce
  "ops": [ {"t":"paint","frame":123,"cells":[[3,4,555,TRANSPARENT], ...]} ] }

200 { saved, version }                          // 已接受
409 { serverVersion, catchUp:[commit...] }      // 落后：先拿增量日志再 rebase
409 { resync:true, project }                    // 日志窗口已压缩：全量快照
```

op 类型：`paint` · `frameData` · `frameAdd/Del/Move/Dir` · `palAdd/Delete/Update/Lock/Move` · `resize` · `settings` · `batch`。每个结构 op 都带有生成逆 op 所需的元数据（旧索引、旧颜色、受影响帧快照等），因此撤销本身也是一条新提交，多端一致收敛。

### ID 方案

色槽/帧 id = `seq * 2^20 + clientNum`（clientNum 取访客 UUID 首段哈希），不同设备离线生成的 id 不会碰撞；客户端重连后 id 工厂从模型已有 id 与本地提交序号的最大值继续。
