import CanvasStage from './CanvasStage.jsx';
import BeatTimeline from './BeatTimeline.jsx';
import ConfigPanel from './ConfigPanel.jsx';
import ResourcesPanel from './ResourcesPanel.jsx';
import RenderingsPanel from './RenderingsPanel.jsx';

// 三个模板不仅镜头 / 动画不同，页面栅格与信息编排也完全不同：
//  - constellation（魔法少女）：放射星环 —— 左竖栏配置 + 中央大舞台 + 节拍轨悬浮于舞台下缘
//  - cockpit（机甲）：驾驶舱 —— 顶部 HUD 状态条 + 三栏（资源｜舞台｜配置）+ 时间轴压底
//  - scroll（剑士）：竖卷轴 —— 右栏纵向排布、舞台左宽右窄留白，版本表收成细列
// 公共面板组件相同，但栅格位置、阅读顺序与视觉层级各不相同。

function ShotRibbon({ template, time }) {
  return (
    <div className="henshin-shotribbon">
      {template.shots.map((shot, index) => {
        const active = time >= shot.start && (index === template.shots.length - 1 || time < shot.end);
        return (
          <div key={shot.id} className={`ribbon-shot ${active ? 'active' : ''}`}>
            <i>{String(index + 1).padStart(2, '0')}</i>
            <span>{shot.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function HudStrip({ template, time, playing }) {
  const activeIndex = template.shots.findIndex((shot, index) => time >= shot.start && (index === template.shots.length - 1 || time < shot.end));
  return (
    <div className="henshin-hudstrip">
      <span className="hud-cell"><label>UNIT</label><strong>{template.name}</strong></span>
      <span className="hud-cell"><label>SEQ</label><strong>{String(activeIndex + 1).padStart(2, '0')}/{String(template.shots.length).padStart(2, '0')}</strong></span>
      <span className="hud-cell"><label>T+</label><strong>{time.toFixed(2)}s</strong></span>
      <span className={`hud-lamp ${playing ? 'on' : ''}`}>{playing ? 'RUNNING' : 'STANDBY'}</span>
    </div>
  );
}

function ScrollIndex({ template, time }) {
  return (
    <ol className="henshin-scroll-index">
      {template.shots.map((shot, index) => {
        const active = time >= shot.start && (index === template.shots.length - 1 || time < shot.end);
        return (
          <li key={shot.id} className={active ? 'active' : ''}>
            <i>{String(index + 1).padStart(2, '0')}</i>
            <div><strong>{shot.name}</strong><small>{shot.start.toFixed(1)}–{shot.end.toFixed(1)}s · {shot.anim}</small></div>
          </li>
        );
      })}
    </ol>
  );
}

export function ConstellationLayout(props) {
  const { template, config, time, playing, muted, timeRef, panelProps, transportProps } = props;
  return (
    <div className="layout-constellation">
      <aside className="constellation-left">
        <div className="panel-scroll soft-panel">
          <ConfigPanel template={template} config={config} {...panelProps} />
        </div>
      </aside>
      <main className="constellation-stage">
        <div className="constellation-frame">
          <CanvasStage template={template} config={config} timeRef={timeRef} playing={playing} muted={muted} onSyncTime={transportProps.onSyncTime} />
          <div className="constellation-ribbon"><ShotRibbon template={template} time={time} /></div>
        </div>
        <BeatTimeline template={template} config={config} time={time} playing={playing} muted={muted} {...transportProps} />
      </main>
      <aside className="constellation-right stack-panel">
        <ResourcesPanel {...panelProps.apiProps} resources={panelProps.resources} onChanged={panelProps.reload} />
        <RenderingsPanel {...panelProps.apiProps} renderings={panelProps.renderings} dirty={panelProps.dirty} onPublishStart={panelProps.flushSave} onChanged={panelProps.reload} />
      </aside>
    </div>
  );
}

export function CockpitLayout(props) {
  const { template, config, time, playing, muted, timeRef, panelProps, transportProps } = props;
  return (
    <div className="layout-cockpit">
      <HudStrip template={template} time={time} playing={playing} />
      <div className="cockpit-grid">
        <aside className="cockpit-left">
          <div className="hud-panel"><ResourcesPanel {...panelProps.apiProps} resources={panelProps.resources} onChanged={panelProps.reload} /></div>
          <div className="hud-panel"><RenderingsPanel {...panelProps.apiProps} renderings={panelProps.renderings} dirty={panelProps.dirty} onPublishStart={panelProps.flushSave} onChanged={panelProps.reload} /></div>
        </aside>
        <main className="cockpit-stage">
          <div className="cockpit-frame">
            <CanvasStage template={template} config={config} timeRef={timeRef} playing={playing} muted={muted} onSyncTime={transportProps.onSyncTime} />
          </div>
          <BeatTimeline template={template} config={config} time={time} playing={playing} muted={muted} {...transportProps} />
        </main>
        <aside className="cockpit-right hud-panel">
          <ConfigPanel template={template} config={config} {...panelProps} />
        </aside>
      </div>
    </div>
  );
}

export function ScrollLayout(props) {
  const { template, config, time, playing, muted, timeRef, panelProps, transportProps } = props;
  return (
    <div className="layout-scroll">
      <main className="scroll-stage">
        <ScrollIndex template={template} time={time} />
        <div className="scroll-frame">
          <CanvasStage template={template} config={config} timeRef={timeRef} playing={playing} muted={muted} onSyncTime={transportProps.onSyncTime} />
        </div>
        <BeatTimeline template={template} config={config} time={time} playing={playing} muted={muted} {...transportProps} />
      </main>
      <aside className="scroll-right">
        <section className="scroll-panel">
          <ConfigPanel template={template} config={config} {...panelProps} />
        </section>
        <section className="scroll-panel slim">
          <ResourcesPanel {...panelProps.apiProps} resources={panelProps.resources} onChanged={panelProps.reload} />
        </section>
        <section className="scroll-panel slim">
          <RenderingsPanel {...panelProps.apiProps} renderings={panelProps.renderings} dirty={panelProps.dirty} onPublishStart={panelProps.flushSave} onChanged={panelProps.reload} />
        </section>
      </aside>
    </div>
  );
}

export const LAYOUT_COMPONENTS = {
  constellation: ConstellationLayout,
  cockpit: CockpitLayout,
  scroll: ScrollLayout
};
