// 客户端图片压缩：摄像头抓拍帧或相册原图先在这里被收敛到
// 最长边 1920、JPEG 0.82，再走网络与服务端复检。几十帧原始照片
// 不会同时驻留内存——处理完立即释放 canvas / objectURL。
export const CLIENT_LONG_EDGE = 1920;
export const CLIENT_QUALITY = 0.82;

export async function compressImage(source, { longEdge = CLIENT_LONG_EDGE, quality = CLIENT_QUALITY, signal } = {}) {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality));
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export const formatBytes = (bytes) => {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(mb >= 100 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const formatDuration = (ms) => {
  const totalSeconds = ms / 1000;
  return totalSeconds >= 60
    ? `${Math.floor(totalSeconds / 60)}分${Math.round(totalSeconds % 60)}秒`
    : `${totalSeconds.toFixed(1)}秒`;
};
