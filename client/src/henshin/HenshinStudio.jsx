import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Cloud, LoaderCircle, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { HENSHIN_LAYOUT_META, HENSHIN_TEMPLATE_ORDER } from './constants.js';
import { LAYOUT_COMPONENTS } from './Layouts.jsx';

// 变身演出生成台：模板选择 + 用户配置（防抖保存）+ Canvas 预览 + 资源 / 版本 / 任务。
export default function HenshinStudio({ project, user, api, onError, onExit }) {
  const [templates, setTemplates] = useState([]);
  const [templateSlug, setTemplateSlug] = useState(HENSHIN_TEMPLATE_ORDER[0]);
  const [config, setConfig] = useState(null);
  const [resources, setResources] = useState([]);
  const [renderings, setRenderings] = useState([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const timeRef = useRef(0);
  const saveTimer = useRef(0);
  const saveSeq = useRef(0);
  const templateRef = useRef(null);

  const template = useMemo(() => templates.find((item) => item.slug === templateSlug) || null, [templates, templateSlug]);
  templateRef.current = template;

  // ---------- 载入：模板表 + 已保存配置 + 资源 + 版本 ----------
  const reloadExtras = useCallback(() => {
    api(`/projects/${project.id}/henshin/resources`, { headers: { 'x-user-id': user.id } })
      .then((result) => setResources(result.resources)).catch(() => {});
    api(`/projects/${project.id}/henshin/renderings`, { headers: { 'x-user-id': user.id } })
      .then((result) => setRenderings(result.renderings)).catch(() => {});
  }, [api, project.id, user.id]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api('/henshin/templates'),
      api(`/projects/${project.id}/henshin/config`, { headers: { 'x-user-id': user.id } })
    ]).then(([templateResult, configResult]) => {
      if (cancelled) return;
      setTemplates(templateResult.templates);
      if (configResult.templateSlug) {
        setTemplateSlug(configResult.templateSlug);
        setConfig(configResult.config);
      } else if (templateResult.templates[0]) {
        setConfig(templateResult.templates[0].defaults);
      }
      setLoaded(true);
    }).catch((err) => { if (!cancelled) onError(err.message); });
    reloadExtras();
    return () => { cancelled = true; clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // ---------- 防抖保存（白名单校验在服务端） ----------
  const persist = useCallback(async (slug, nextConfig, seq) => {
    setSaving(true);
    try {
      await api(`/projects/${project.id}/henshin/config`, {
        method: 'PUT',
        headers: { 'x-user-id': user.id },
        body: JSON.stringify({ templateSlug: slug, config: nextConfig })
      });
      if (seq === saveSeq.current) setDirty(false);
    } catch (err) {
      onError(err.body?.errors?.map((e) => e.message).join('；') || err.message);
    } finally {
      if (seq === saveSeq.current) setSaving(false);
    }
  }, [api, project.id, user.id, onError]);

  const scheduleSave = useCallback((slug, nextConfig) => {
    saveSeq.current += 1;
    setDirty(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(slug, nextConfig, saveSeq.current), 450);
  }, [persist]);

  // 发布前确保最新配置已落盘
  const flushSave = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!templateRef.current || !config) return;
    saveSeq.current += 1;
    await persist(templateRef.current.slug, config, saveSeq.current);
  }, [config, persist]);

  const patchConfig = useCallback((patch) => {
    setConfig((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      scheduleSave(templateRef.current?.slug || templateSlug, next);
      return next;
    });
  }, [scheduleSave, templateSlug]);

  const switchTemplate = useCallback((slug) => {
    setPlaying(false);
    setTemplateSlug(slug);
    setTime(0);
    timeRef.current = 0;
    setConfig((current) => {
      const nextTemplate = templates.find((item) => item.slug === slug);
      if (!nextTemplate) return current;
      // 切模板是整份替换（符号 / 音轨白名单不同），只保留角色名与主色
      const next = { ...nextTemplate.defaults, characterName: current?.characterName || nextTemplate.defaults.characterName, primaryColor: current?.primaryColor || nextTemplate.defaults.primaryColor };
      scheduleSave(slug, next);
      return next;
    });
  }, [templates, scheduleSave]);

  // ---------- 播放控制 ----------
  const scrub = useCallback((t) => {
    setPlaying(false);
    timeRef.current = t;
    setTime(t);
  }, []);

  const syncTime = useCallback((t, ended = false) => {
    setTime(t);
    if (ended) setPlaying(false);
  }, []);

  // 播放结束后 timeRef 停在结尾；重新开始时回到 0
  const togglePlay = useCallback(() => {
    setPlaying((current) => {
      const duration = templateRef.current?.duration || 10;
      if (!current && timeRef.current >= duration - 0.001) {
        timeRef.current = 0;
        setTime(0);
      }
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowLeft') scrub(Math.max(0, timeRef.current - (event.shiftKey ? 1 : 0.1)));
      if (event.code === 'ArrowRight') {
        const duration = templateRef.current?.duration || 10;
        scrub(Math.min(duration, timeRef.current + (event.shiftKey ? 1 : 0.1)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrub]);

  const addBeat = useCallback(() => {
    setConfig((current) => {
      if (!current || current.customBeats.length >= 16) return current;
      const t = Math.round(timeRef.current * 100) / 100;
      if (current.customBeats.some((beat) => Math.abs(beat - t) < 0.01)) return current;
      const next = { ...current, customBeats: [...current.customBeats, t].sort((a, b) => a - b) };
      scheduleSave(templateRef.current?.slug || templateSlug, next);
      return next;
    });
  }, [scheduleSave, templateSlug]);

  const removeBeat = useCallback((index) => {
    setConfig((current) => {
      const next = { ...current, customBeats: current.customBeats.filter((_, i) => i !== index) };
      scheduleSave(templateRef.current?.slug || templateSlug, next);
      return next;
    });
  }, [scheduleSave, templateSlug]);

  if (!loaded || !template || !config) {
    return <div className="screen-state"><LoaderCircle className="spin" size={26} /><span>正在装配变身舞台…</span></div>;
  }

  const Layout = LAYOUT_COMPONENTS[template.layout];
  const activeShotIndex = template.shots.findIndex((shot, index) => time >= shot.start && (index === template.shots.length - 1 || time < shot.end));
  const activeShot = template.shots[Math.max(0, activeShotIndex)];

  const panelProps = {
    dirty,
    saving,
    onPatch: patchConfig,
    onAddBeat: addBeat,
    onRemoveBeat: removeBeat,
    resources,
    renderings,
    reload: reloadExtras,
    flushSave,
    apiProps: { api, project, user }
  };
  const transportProps = {
    onScrub: scrub,
    onTogglePlay: togglePlay,
    onToggleMute: () => setMuted((m) => !m),
    onSyncTime: syncTime
  };

  return (
    <div className="henshin-studio" style={{ '--henshin-accent': template.accent }}>
      <header className="henshin-bar">
        <button className="button ghost small" onClick={onExit}>← 项目列表</button>
        <div className="henshin-title">
          <p className="eyebrow">SAKUGA SPARK / HENSHIN STAGE · 变身演出生成台</p>
          <h2>{project.name}</h2>
        </div>
        <div className="henshin-template-switch">
          {templates.filter((item) => HENSHIN_TEMPLATE_ORDER.includes(item.slug)).map((item) => (
            <button
              key={item.slug}
              className={item.slug === templateSlug ? 'active' : ''}
              style={{ '--tpl-accent': item.accent }}
              onClick={() => switchTemplate(item.slug)}
              title={`${item.name} · ${HENSHIN_LAYOUT_META[item.layout]?.label}`}
            >
              <i>{item.slug === 'magical-girl' ? '✦' : item.slug === 'mecha-startup' ? '⬡' : '刃'}</i>
              <span>{item.name}</span>
            </button>
          ))}
        </div>
        <div className="henshin-bar-right">
          <span className="henshin-current-shot"><Sparkles size={12} />{activeShot?.name}</span>
          <span className={`save-status ${saving ? 'saving' : dirty ? '' : 'saved'}`}>
            {saving ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
            {saving ? '保存中' : dirty ? '待保存' : <><Cloud size={13} />已保存</>}
          </span>
          <button className="icon-button" title={muted ? '开启节拍音' : '静音节拍音'} onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
      </header>

      <Layout
        template={template}
        config={config}
        time={time}
        playing={playing}
        muted={muted}
        timeRef={timeRef}
        panelProps={panelProps}
        transportProps={transportProps}
      />
    </div>
  );
}
