// 服务端图片复检管线：客户端压缩结果在这里被重新解码、校验类型与尺寸，
// 再由 sharp 统一输出成有界 JPEG 与缩略图。任何原始照片都不会落盘
// （multer 使用内存存储，处理完立即随请求释放），避免磁盘被撑爆。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { mediaDir } from './store.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// 允许的输入类型（按 magic number 复检，不信任客户端声明的 mimetype）
const SIGNATURES = [
  { type: 'jpeg', mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { type: 'png', mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'webp', mime: 'image/webp', prefix: 'RIFF', at: 0, also: 'WEBP', alsoAt: 8 }
];

function sniffType(buffer) {
  for (const spec of SIGNATURES) {
    if (spec.sig && spec.sig.every((byte, index) => buffer[index] === byte)) return spec;
    if (spec.prefix && buffer.subarray(spec.at, spec.at + 4).toString('latin1') === spec.prefix
      && buffer.subarray(spec.alsoAt, spec.alsoAt + 4).toString('latin1') === spec.also) return spec;
  }
  return null;
}

export const MAX_LONG_EDGE = 1920;          // 正片单边上限
export const THUMB_LONG_EDGE = 256;        // 时间尺缩略图单边
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
// sharp 输入像素安全闸：防止解压炸弹。约 4000 万像素（约 6300×6300）
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * @param {Buffer} buffer multer 收到的原始字节
 * @param {string} projectId
 * @returns 落盘帧的元信息（不含 id/order，由调用方补）
 */
export async function ingestFrame(buffer, projectId) {
  if (!buffer || buffer.length === 0) throw new HttpError(400, '没有收到图片内容。');
  const sniffed = sniffType(buffer);
  if (!sniffed) throw new HttpError(415, '只支持 JPEG / PNG / WebP 图片，这个文件的类型无法识别。');

  let image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw new HttpError(415, '图片无法解码，文件可能已损坏。');
  }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new HttpError(415, `不支持的图片格式（${metadata.format || '未知'}），请使用 JPEG、PNG 或 WebP。`);
  }
  if (!metadata.width || !metadata.height) throw new HttpError(422, '图片尺寸无效。');
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new HttpError(422, `图片像素过高（${metadata.width}×${metadata.height}），请压缩后再上传。`);
  }

  // 统一把正片压到有界尺寸：几十帧原始手机照片在这里被收敛到磁盘可承受的体量。
  let imageBuffer;
  if (metadata.width > MAX_LONG_EDGE || metadata.height > MAX_LONG_EDGE) {
    image = image.resize(MAX_LONG_EDGE, MAX_LONG_EDGE, { fit: 'inside', withoutEnlargement: true });
  }
  imageBuffer = await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  const thumbBuffer = await sharp(imageBuffer)
    .resize(THUMB_LONG_EDGE, THUMB_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  const [im, tm] = await Promise.all([sharp(imageBuffer).metadata(), sharp(thumbBuffer).metadata()]);

  const projectMediaDir = path.join(mediaDir, projectId);
  fs.mkdirSync(projectMediaDir, { recursive: true });
  const base = crypto.randomUUID();
  const imageFile = `${base}.jpg`;
  const thumbFile = `${base}-thumb.jpg`;
  fs.writeFileSync(path.join(projectMediaDir, imageFile), imageBuffer);
  fs.writeFileSync(path.join(projectMediaDir, thumbFile), thumbBuffer);

  return {
    file: imageFile,
    thumbFile,
    width: im.width,
    height: im.height,
    imageBytes: imageBuffer.length,
    thumbWidth: tm.width,
    thumbHeight: tm.height,
    thumbBytes: thumbBuffer.length,
    sourceFormat: sniffed.type,
    createdAt: new Date().toISOString()
  };
}

// 复制帧时直接复用服务端文件（不要求客户端重传），只新增一条序列记录。
export function frameFilePaths(projectId, frame) {
  return {
    image: path.join(mediaDir, projectId, frame.file),
    thumb: path.join(mediaDir, projectId, frame.thumbFile)
  };
}

// 复制帧时在磁盘上复制一份文件（而不是共用同一份）：
// 这样删除任一副本都不会影响另一帧，删除逻辑无需引用计数。
export function cloneFrameFiles(projectId, frame) {
  const paths = frameFilePaths(projectId, frame);
  const base = crypto.randomUUID();
  const file = `${base}.jpg`;
  const thumbFile = `${base}-thumb.jpg`;
  const dir = path.join(mediaDir, projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(paths.image, path.join(dir, file));
  fs.copyFileSync(paths.thumb, path.join(dir, thumbFile));
  return { file, thumbFile };
}

export function removeFrameFiles(projectId, frame) {
  const paths = frameFilePaths(projectId, frame);
  fs.rmSync(paths.image, { force: true });
  fs.rmSync(paths.thumb, { force: true });
}
