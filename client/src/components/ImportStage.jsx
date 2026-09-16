import React, { useCallback, useRef, useState } from 'react';
import { CheckCircle2, ImagePlus, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { compressImage, formatBytes } from '../lib/image.js';

// 图片导入流程：摄像头被拒绝时的主路径，也用于把相机拍好的照片批量补进来。
// 逐张「客户端压缩 → 上传 → 释放 Blob URL」，队列长度不构成内存压力。
export default function ImportStage({ busy, onImport, onNotice }) {
  const inputRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [dragging, setDragging] = useState(false);

  const processFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
    const rejected = fileList.length - files.length;
    if (rejected > 0) onNotice(`已跳过 ${rejected} 个不支持的文件，只接受 JPEG / PNG / WebP。`, 'info');
    if (files.length === 0) return;

    const items = files.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, size: file.size, status: 'pending' }));
    setQueue((current) => [...current, ...items]);
    for (const [index, item] of items.entries()) {
      const file = files[index];
      try {
        setQueue((current) => current.map((q) => q.id === item.id ? { ...q, status: 'compressing' } : q));
        const { blob, width, height } = await compressImage(file);
        setQueue((current) => current.map((q) => q.id === item.id ? { ...q, status: 'uploading', width, height, compressedSize: blob.size } : q));
        const result = await onImport(blob);
        if (result?.frame) {
          setQueue((current) => current.map((q) => q.id === item.id ? { ...q, status: 'done', frameId: result.frame.id } : q));
        }
      } catch (error) {
        setQueue((current) => current.map((q) => q.id === item.id ? { ...q, status: 'error', error: error.message } : q));
        onNotice(`「${item.name}」导入失败：${error.message}`);
      }
    }
  }, [onImport, onNotice]);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    processFiles(event.dataTransfer.files);
  }, [busy, processFiles]);

  const done = queue.filter((item) => item.status === 'done').length;

  return (
    <div className="import-stage">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => { processFiles(event.target.files); event.target.value = ''; }}
        />
        <div className="dropzone-icon"><UploadCloud size={28} /></div>
        <h3>把照片拖到这里，或点击选择</h3>
        <p>支持多选 JPEG / PNG / WebP，按文件名顺序逐帧加入；每张都会先在本机压缩再上传。</p>
        <div className="dropzone-badge"><ImagePlus size={13} />手机/相机原图 · 自动缩到最长边 1920</div>
      </div>

      {queue.length > 0 && (
        <div className="import-queue">
          <div className="queue-head">
            <span>导入队列 · {done}/{queue.length} 完成</span>
            <button className="queue-clear" onClick={() => setQueue((current) => current.filter((item) => ['pending', 'error'].includes(item.status)))}>
              <X size={13} />清除完成项
            </button>
          </div>
          <div className="queue-list">
            {queue.slice(-8).map((item) => (
              <div key={item.id} className={`queue-item ${item.status}`}>
                <span className="queue-state">
                  {item.status === 'done' ? <CheckCircle2 size={14} /> : item.status === 'error' ? <X size={14} /> : <LoaderCircle className="spin" size={14} />}
                </span>
                <span className="queue-name" title={item.name}>{item.name}</span>
                <span className="queue-meta">
                  {item.status === 'done' ? `${item.width}×${item.height} · ${formatBytes(item.compressedSize)}`
                    : item.status === 'error' ? item.error
                    : item.status === 'compressing' ? '本机压缩中…'
                    : '上传与服务端复检中…'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
