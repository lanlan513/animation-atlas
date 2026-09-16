// Traceable history (own records, restorable) + the read-only public wall.

import { Globe, History, RotateCcw, Share2, Undo2 } from 'lucide-react';

function winnerText(record) {
  if (record.winner === 'draw') return '平局';
  return `${record.winner === 'a' ? record.heroA : record.heroB} 胜`;
}

export default function HistoryPanel({ records, publicRecords, activeId, userId, onRestore, onSelect, onTogglePublic }) {
  return (
    <div className="history-panel">
      <section className="side-block">
        <div className="side-heading"><span>我的对决记录</span><History size={14} /></div>
        {!records.length && <p className="muted">还没有记录，调整参数即会生成第一条。</p>}
        {records.map((record) => (
          <div key={record.id} className={`history-item ${record.id === activeId ? 'active' : ''}`}>
            <button className="history-main" onClick={() => onSelect(record.id)} title="查看这条记录的判定">
              <strong>{record.heroA} vs {record.heroB}</strong>
              <small>
                {record.outcomeLabel} · {winnerText(record)} · {new Date(record.createdAt).toLocaleTimeString()}
                {record.restoredFrom && <em title={`恢复自 ${record.restoredFrom.slice(0, 8)}`}><Undo2 size={11} /> 恢复</em>}
              </small>
            </button>
            <div className="history-actions">
              <button onClick={() => onRestore(record.id)} title="以此记录的参数生成一条新对决">
                <RotateCcw size={13} />恢复
              </button>
              <button
                className={record.isPublic ? 'public-on' : ''}
                onClick={() => onTogglePublic(record.id, !record.isPublic)}
                title={record.isPublic ? '从公开墙撤回' : '发布到公开墙（发布后不可改）'}
              >
                <Share2 size={13} />{record.isPublic ? '已公开' : '公开'}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="side-block">
        <div className="side-heading"><span>公开对决墙</span><Globe size={14} /></div>
        {!publicRecords.length && <p className="muted">还没有人公开对决结果。</p>}
        {publicRecords.map((record) => (
          <div key={record.id} className="history-item public">
            <button className="history-main" onClick={() => onSelect(record.id)} title="查看公开判定（只读）">
              <strong>{record.heroA} vs {record.heroB}</strong>
              <small>
                {record.outcomeLabel} · {winnerText(record)} · by {record.ownerName}
                {record.ownerId === userId && <em>（我）</em>}
              </small>
            </button>
          </div>
        ))}
        <p className="muted tiny">公开结果由服务器存档，任何人无法修改他人的记录。</p>
      </section>
    </div>
  );
}
