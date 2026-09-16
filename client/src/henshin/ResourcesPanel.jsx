import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Send } from 'lucide-react';
import { HENSHIN_RESOURCE_META } from './constants.js';

// 资源引用 + 异步处理任务状态。登记资源后服务端返回 pending，
// 这里轮询任务，状态走到 ready / failed 后刷新资源列表。
export default function ResourcesPanel({ api, project, user, resources, onChanged }) {
  const [kind, setKind] = useState('audio');
  const [label, setLabel] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollTick, setPollTick] = useState(0);

  const hasPending = resources.some((resource) => resource.status === 'pending');
  useEffect(() => {
    if (!hasPending) return undefined;
    const timer = setInterval(() => setPollTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [hasPending]);

  useEffect(() => {
    if (!hasPending) return;
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollTick]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${project.id}/henshin/resources`, {
        method: 'POST',
        headers: { 'x-user-id': user.id },
        body: JSON.stringify({ kind, label, storageKey, note: '生成台登记' })
      });
      setLabel(''); setStorageKey('');
      onChanged();
    } catch (err) {
      setError(err.body?.errors?.[0]?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="henshin-resources">
      <div className="henshin-panel-title"><RefreshCw size={12} />资源引用</div>
      <form className="henshin-resource-form" onSubmit={submit}>
        <div className="henshin-kind-row">
          {Object.entries(HENSHIN_RESOURCE_META).map(([value, meta]) => (
            <button key={value} type="button" className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>
              <span>{meta.glyph}</span>{meta.label}
            </button>
          ))}
        </div>
        <input placeholder="资源名称（如：副歌重鼓点）" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} />
        <input placeholder="存储键 library/audio/loop-01.wav（fail: 可模拟失败）" value={storageKey} onChange={(event) => setStorageKey(event.target.value)} maxLength={240} />
        {error && <p className="henshin-inline-error">{error}</p>}
        <button className="button secondary small full" disabled={busy || !label.trim() || !storageKey.trim()}>
          {busy ? <LoaderCircle className="spin" size={13} /> : <Send size={13} />}登记并异步处理
        </button>
      </form>
      <ul className="henshin-resource-list">
        {resources.length === 0 && <li className="henshin-empty">还没有资源引用。登记后会自动排队解码。</li>}
        {resources.map((resource) => (
          <li key={resource.id} className={`status-${resource.status}`}>
            <span className="resource-glyph">{HENSHIN_RESOURCE_META[resource.kind]?.glyph}</span>
            <span className="resource-label">
              <strong>{resource.label}</strong>
              <small>{resource.kind}{resource.taskProgress != null && resource.status === 'pending' ? ` · 处理中 ${resource.taskProgress}%` : ''}</small>
              {resource.status === 'failed' && <em className="resource-error">{resource.taskError || '处理失败'}</em>}
            </span>
            {resource.status === 'pending' && <LoaderCircle className="spin" size={14} />}
            {resource.status === 'ready' && <CheckCircle2 size={15} className="status-ok" />}
            {resource.status === 'failed' && <CircleAlert size={15} className="status-bad" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
