# FrameMold · 黏土逐帧拍摄台

Animation Atlas 工作区中的「定格动画」实验室：调用摄像头逐帧拍摄（或批量导入照片），
通过上一帧的半透明**残影叠层**校正黏土模型的位置，在时间尺上排序、复制、删除、
批量调整帧时长，最后播放/导出成定格短片。重新打开项目时，帧序列与所有编辑设置都会还原。

## 运行

```bash
npm install
npm run dev
```

- Web 拍摄台：http://localhost:5173
- API：http://localhost:4000

首次进入自动领取本地访客身份（身份存在浏览器 localStorage，素材归属该身份），
也可以在右上角注册/登录。生产构建：`npm run build`，`npm start` 只启动 API。

> 在 Linux 上首次安装如遇 rollup 报缺少 `@rollup/rollup-linux-*` 可选依赖（npm 已知问题，
> 多发生在 macOS 生成的 lockfile 上），执行
> `npm i --no-save @rollup/rollup-linux-arm64-gnu`（x64 机换成 `x64-gnu`）即可。

## 拍摄台工作流

1. **摄像头拍摄**：授权后实时画面上叠加「上一帧残影」（可调透明度、可指定任意帧为基准），
   对齐模型轮廓后点击快门或按 **空格** 拍摄。
2. **权限被拒绝 / 无摄像头**：自动切换到**图片导入**（也可随时手动切回），
   支持多选与拖拽，按选择顺序逐帧加入，队列实时显示压缩/上传/复检状态。
3. **时间尺**：拖拽缩略图排序、单帧复制/删除；单击选择、`Ctrl/⌘` 点选、`Shift` 连选后
   批量改时长（直接填毫秒或按 fps 换算）、批量复制、批量删除。
4. **播放成片**：按各帧时长逐帧播放、循环、拖动检视，并用 `MediaRecorder` 导出 WebM。
5. **进度还原**：标签页、残影开关/透明度/基准帧、选择等编辑设置走草稿自动保存，
   帧序列与缩略图持久化在服务端，重开项目原样恢复（URL 形如 `#/studio/:projectId`）。

## 内存与磁盘防护（不被几十帧原图撑爆）

- **客户端压缩**：抓拍帧 / 相册原图先用 Canvas 缩到最长边 1920、编码 JPEG(0.82) 再上传，
  处理完立即释放 `ImageBitmap` 与队列 Blob。
- **原始文件不落盘**：multer 使用内存存储，单文件上限 25MB，处理完随请求释放。
- **服务端复检**：不信任客户端声明的类型——按 magic number 识别 JPEG/PNG/WebP，
  sharp 重新解码（拒绝损坏文件）、复核像素尺寸（4000 万像素解压炸弹上限），
  统一再编码为有界 JPEG（正片最长边 1920 / 缩略图最长边 256）后才落盘。
- **缩略图生成**：每帧同步生成 256px 缩略图，时间尺只加载缩略图。
- **配额管理**：每项目默认 250MB、全局 2GB（环境变量 `PROJECT_QUOTA_MB` / `GLOBAL_QUOTA_MB`），
  上传与复制前预判，超限返回 413/507；时间尺旁有实时配额条。删除帧/项目会同步清理文件。
- 同一项目的帧写入/重排在服务端用按键互斥串行，连拍不会打乱 order。

## 存储说明

服务端数据位于 `server/data/`：

- `animation-atlas.json`：用户、项目、帧元数据、草稿（写临时文件 + rename 原子落盘，进程退出前 flush）；
- `media/<projectId>/`：每帧一对 `<uuid>.jpg`（正片）与 `<uuid>-thumb.jpg`（缩略图）。

复制帧会在磁盘上生成独立文件副本，删除任一帧不影响其他帧。媒体路由只放行已登记、
文件名合法的 jpg，并做了目录穿越防护；非属主访问项目返回 404。

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/guest` `/register` `/login` | 访客 / 注册 / 登录 |
| GET/POST | `/api/projects` | 项目列表 / 创建 |
| GET/DELETE | `/api/projects/:id` | 项目详情（帧序列+草稿，用于还原）/ 删除（连同素材） |
| PUT | `/api/projects/:id/drafts` | 编辑设置自动保存 |
| POST | `/api/projects/:id/frames` | multipart 上传一帧：复检 → 压缩 → 缩略图 → 落盘 |
| POST | `/api/projects/:id/frames/:fid/duplicate` | 复制帧（独立文件，插在其后） |
| DELETE | `/api/projects/:id/frames/:fid` | 删除帧并清理文件 |
| PATCH | `/api/projects/:id/frames` | 批量改时长（`frameIds` 为空表示全部） |
| PUT | `/api/projects/:id/frames/order` | 全量拖拽排序 |
| GET | `/api/projects/:id/quota` | 配额与用量 |
| GET | `/media/:projectId/:file` | 正片 / 缩略图 |
