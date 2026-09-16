import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, Rocket, ShieldCheck } from 'lucide-react';

// 生成版本：发布（创建不可变快照 + 异步烘焙）与版本列表。
// 发布接口只允许当前项目所有者调用（服务端 requireProjectOwner 保证）。
export default function RenderingsPanel({ api, project, user, renderings, dirty, onPublishStart, onChanged }) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [pollTick, setPollTick] = useState(0);

  const hasBaking = renderings.some((rendering) => rendering.status === 'rendering');
  useEffect(() => {
    if (!hasBaking) return undefined;
    const timer = setInterval(() => setPollTick((n) => n + 1), 600);
    return () => clearInterval(timer);
  }, [hasBaking]);

  useEffect(() => {
    if (!hasBaking) return;
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollTick]);

  const publish = async () => {
    setPublishing(true);
    setError('');
    try {
      await onPublishStart(); // 先把未落盘的配置保存
      const result = await api(`/projects/${project.id}/henshin/renderings`, {
        method: 'POST',
        headers: { 'x-user-id': user.id },
        body: JSON.stringify({})
      });
      onChanged();
      return result;
    } catch (err) {
      setError(err.body?.errors?.[0]?.message || err.message);
      return null;
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="henshin-renderings">
      <div className="henshin-panel-title"><Rocket size={12} />发布版本</div>
      <button className="button primary small full" disabled={publishing || dirty} onClick={publish}
        title={dirty ? '有配置尚未保存，请稍候' : '以当前配置生成不可变演出版本'}>
        {publishing ? <LoaderCircle className="spin" size={13} /> : <Rocket size={13} />}发布当前演出
      </button>
      <p className="henshin-owner-note"><ShieldCheck size={11} />仅项目所有者可创建演出</p>
      {error && <p className="henshin-inline-error">{error}</p>}
      <ul className="henshin-rendering-list">
        {renderings.length === 0 && <li className="henshin-empty">还没有发布版本。每次发布会冻结当时的配置、镜头与素材引用。</li>}
        {renderings.map((rendering) => (
          <li key={rendering.id} className={`status-${rendering.status}`}>
            <span className="rendering-version">v{String(rendering.versionNumber).padStart(2, '0')}</span>
            <span className="rendering-meta">
              <strong>{rendering.name}</strong>
              <small>{rendering.templateSlug}{rendering.status === 'rendering' ? ` · 烘焙 ${rendering.taskProgress ?? 0}%` : ''}</small>
              {rendering.status === 'failed' && <em className="resource-error">{rendering.taskError || '烘焙失败'}</em>}
            </span>
            {rendering.status === 'rendering' && <LoaderCircle className="spin" size={14} />}
            {rendering.status === 'ready' && <CheckCircle2 size={15} className="status-ok" />}
            {rendering.status === 'failed' && <CircleAlert size={15} className="status-bad" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
