import React from 'react';
import { HardDriveDownload } from 'lucide-react';
import { formatBytes } from '../lib/image.js';

export default function QuotaBar({ usageBytes, quotaBytes, frameCount }) {
  const ratio = Math.min(1, usageBytes / Math.max(1, quotaBytes));
  const level = ratio > 0.9 ? 'danger' : ratio > 0.7 ? 'warn' : 'ok';
  return (
    <div className={`quota-bar ${level}`} title={`项目存储：${formatBytes(usageBytes)} / ${formatBytes(quotaBytes)}`}>
      <HardDriveDownload size={14} />
      <div className="quota-track">
        <div className="quota-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="quota-text">
        {formatBytes(usageBytes)} / {formatBytes(quotaBytes)} · {frameCount} 帧
      </span>
    </div>
  );
}
