import crypto from 'node:crypto';
import db from './db.js';

/* ---------------------------------------------------------------------------
 * Panel Punch / 美漫动态分镜
 * 漫画页、SVG 热区、动画节点、章节状态与访客阅读进度的存储和校验。
 * 所有热区数据在写入前经过 sanitizePanel：损坏的 SVG 降级为备用矩形热区，
 * 越界坐标钳制到页面内，缺失聚焦框自动推算 —— 降级信息随数据一起返回。
 * ------------------------------------------------------------------------ */

export function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), Math.max(min, max));
}

const polygonArea = (pts) => pts.reduce((sum, [x1, y1], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length];
  return sum + x1 * y2 - x2 * y1;
}, 0) / 2;

// 接受 [[x,y]…]、[{x,y}…]、"x,y x,y" 或简单 SVG 路径 "M x y L x y Z"。解析失败即抛错。
function parsePolygonPoints(raw) {
  if (Array.isArray(raw)) {
    if (raw.length < 3) throw new Error('too few points');
    const pts = raw.map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p?.x), Number(p?.y)]));
    if (pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) throw new Error('non-numeric point');
    return pts;
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) throw new Error('empty svg');
    if (/[^0-9eE+\-.,\smlzMLZ]/.test(text)) throw new Error('unsupported svg command');
    const nums = text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    if (nums.length < 6 || nums.length % 2 !== 0) throw new Error('broken coordinate list');
    const pts = [];
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  }
  throw new Error('unsupported polygon format');
}

const rectToPoints = ({ x, y, w, h }) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function boundsOf(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function sanitizeFocus(rawFocus, polygon, page) {
  const issues = [];
  const f = rawFocus && typeof rawFocus === 'object' ? rawFocus : {};
  let x = Number(f.x); let y = Number(f.y); let w = Number(f.w); let h = Number(f.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    const fallback = polygon.length >= 3
      ? boundsOf(polygon)
      : { x: page.width * 0.25, y: page.height * 0.25, w: page.width * 0.5, h: page.height * 0.5 };
    ({ x, y, w, h } = fallback);
    issues.push('focus-fallback');
  }
  w = clampNumber(w, 1, page.width);
  h = clampNumber(h, 1, page.height);
  x = clampNumber(x, 0, page.width - w);
  y = clampNumber(y, 0, page.height - h);
  return { focus: { x, y, w, h }, issues };
}

const BEAT_TYPES = new Set(['action', 'bubble', 'sfx', 'camera']);

function sanitizeBeat(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    seq: Number.isFinite(Number(raw.seq)) ? Math.round(Number(raw.seq)) : index + 1,
    type: BEAT_TYPES.has(raw.type) ? raw.type : 'bubble',
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
    durationMs: clampNumber(raw.durationMs ?? 900, 120, 8000),
    delayMs: clampNumber(raw.delayMs ?? 0, 0, 8000)
  };
}

export function sanitizePanel(raw, page, index = 0) {
  const issues = [];
  let polygon = [];
  try {
    polygon = parsePolygonPoints(raw?.polygon)
      .map(([px, py]) => {
        const cx = clampNumber(px, 0, page.width);
        const cy = clampNumber(py, 0, page.height);
        if (cx !== px || cy !== py) issues.push('coords-clamped');
        return [cx, cy];
      })
      .filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]);
    if (polygon.length < 3 || Math.abs(polygonArea(polygon)) < 1) throw new Error('degenerate polygon');
  } catch {
    issues.push('svg-corrupted');
    polygon = [];
  }
  const { focus, issues: focusIssues } = sanitizeFocus(raw?.focus, polygon, page);
  issues.push(...focusIssues);
  if (!polygon.length) polygon = rectToPoints(focus); // 损坏 SVG 的备用热区，保证永远可点击
  return {
    panelKey: String(raw?.panelKey || raw?.key || `panel-${index + 1}`).slice(0, 60),
    readingOrder: Number.isFinite(Number(raw?.readingOrder)) ? Math.max(0, Math.round(Number(raw.readingOrder))) : index + 1,
    polygon,
    focus,
    art: raw?.art && typeof raw.art === 'object' ? raw.art : {},
    beats: (Array.isArray(raw?.beats) ? raw.beats : []).map(sanitizeBeat).filter(Boolean),
    degraded: issues.length > 0,
    issues: [...new Set(issues)]
  };
}

/* ---------------------------------- 读取 ---------------------------------- */

const safeParse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

const chapterDto = (row) => ({ id: row.id, chapterNumber: row.chapter_number, title: row.title, status: row.status });

function hydratePanel(row) {
  return {
    id: row.id,
    panelKey: row.panel_key,
    readingOrder: row.reading_order,
    polygon: safeParse(row.polygon, []),
    focus: safeParse(row.focus, {}),
    art: safeParse(row.art, {}),
    degraded: Boolean(row.degraded),
    issues: safeParse(row.issues, []),
    beats: db.prepare('SELECT * FROM comic_beats WHERE panel_id = ? ORDER BY seq').all(row.id).map((b) => ({
      id: b.id, seq: b.seq, type: b.type, payload: safeParse(b.payload, {}), durationMs: b.duration_ms, delayMs: b.delay_ms
    }))
  };
}

function hydratePage(row) {
  return {
    id: row.id,
    pageNumber: row.page_number,
    title: row.title,
    width: row.width,
    height: row.height,
    background: safeParse(row.background, {}),
    actors: safeParse(row.actors, []),
    panels: db.prepare('SELECT * FROM comic_panels WHERE page_id = ? ORDER BY reading_order').all(row.id).map(hydratePanel)
  };
}

function loadComicStructure(projectId) {
  return db.prepare('SELECT * FROM comic_chapters WHERE project_id = ? ORDER BY chapter_number').all(projectId)
    .map((chapter) => ({
      ...chapterDto(chapter),
      pages: db.prepare('SELECT * FROM comic_pages WHERE chapter_id = ? ORDER BY page_number').all(chapter.id).map(hydratePage)
    }));
}

/* ---------------------------------- 写入 ---------------------------------- */

function writePanels(pageId, page, rawPanels) {
  rawPanels.forEach((raw, index) => {
    const panel = sanitizePanel(raw, page, index);
    const panelId = crypto.randomUUID();
    db.prepare('INSERT INTO comic_panels (id, page_id, panel_key, reading_order, polygon, focus, art, degraded, issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(panelId, pageId, panel.panelKey, panel.readingOrder, JSON.stringify(panel.polygon), JSON.stringify(panel.focus), JSON.stringify(panel.art), panel.degraded ? 1 : 0, JSON.stringify(panel.issues));
    panel.beats.forEach((beat) => {
      db.prepare('INSERT INTO comic_beats (id, panel_id, seq, type, payload, duration_ms, delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), panelId, beat.seq, beat.type, JSON.stringify(beat.payload), beat.durationMs, beat.delayMs);
    });
  });
}

function insertPage(projectId, chapterId, data) {
  const pageId = crypto.randomUUID();
  const page = { width: clampNumber(data.width, 200, 4000), height: clampNumber(data.height, 200, 4000) };
  db.prepare('INSERT INTO comic_pages (id, chapter_id, project_id, page_number, title, width, height, background, actors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pageId, chapterId, projectId, data.pageNumber, String(data.title || ''), page.width, page.height, JSON.stringify(data.background || {}), JSON.stringify(Array.isArray(data.actors) ? data.actors : []));
  writePanels(pageId, page, Array.isArray(data.panels) ? data.panels : []);
  return pageId;
}

/* -------------------------------- 示例章节 ---------------------------------
 * 一页完整分镜 + 一页待绘制空页：
 *  - splash / roof-left / roof-right / echo：合法不规则多边形热区
 *  - impact：polygon 是损坏的 SVG 字符串 → 服务端降级为备用矩形热区
 *  - fall：包含越界坐标 (y=1720 > 1600) → 钳制并标记降级
 *  - VOLT 横跨 roof-left 与 roof-right 两格（跨格角色）
 * ------------------------------------------------------------------------ */

function samplePages() {
  return [
    {
      pageNumber: 1,
      title: '港口警报',
      width: 1200,
      height: 1600,
      background: { tone: '#14161f' },
      actors: [
        { id: 'volt', name: 'VOLT', kind: 'hero', spanPanels: ['roof-left', 'roof-right'], x: 588, y: 806, scale: 1.3, palette: ['#f4b942', '#20222b'] },
        { id: 'wraith', name: 'WRAITH', kind: 'villain', spanPanels: ['impact'], x: 836, y: 1252, scale: 1.45, palette: ['#c69cff', '#1c1a26'] }
      ],
      panels: [
        {
          panelKey: 'splash', readingOrder: 1,
          polygon: [[50, 60], [1150, 40], [1130, 420], [70, 450]],
          focus: { x: 50, y: 40, w: 1100, h: 410 },
          art: { kind: 'skyline', tint: '#2b3350' },
          beats: [
            { seq: 1, type: 'camera', payload: { move: 'shake' }, durationMs: 520, delayMs: 0 },
            { seq: 2, type: 'bubble', payload: { speaker: '旁白', text: '午夜十二点，港口的警报第三次响起。', anchor: [590, 150], tone: 'narrator' }, durationMs: 2300, delayMs: 380 },
            { seq: 3, type: 'sfx', payload: { text: 'KRAKOOM', anchor: [905, 295], rotation: -8, size: 64, color: '#f2674a' }, durationMs: 1500, delayMs: 950 }
          ]
        },
        {
          panelKey: 'roof-left', readingOrder: 2,
          polygon: [[70, 500], [610, 480], [560, 930], [90, 950]],
          focus: { x: 70, y: 480, w: 540, h: 470 },
          art: { kind: 'rooftop', tint: '#232a3d' },
          beats: [
            { seq: 1, type: 'action', payload: { actorId: 'volt', move: 'crouch' }, durationMs: 1100, delayMs: 200 },
            { seq: 2, type: 'bubble', payload: { speaker: 'VOLT', text: '信号就是从对面楼顶发出来的。', anchor: [300, 640] }, durationMs: 2300, delayMs: 750 }
          ]
        },
        {
          panelKey: 'roof-right', readingOrder: 3,
          polygon: [[650, 470], [1140, 450], [1120, 940], [600, 920]],
          focus: { x: 600, y: 450, w: 540, h: 490 },
          art: { kind: 'rooftop-edge', tint: '#262238' },
          beats: [
            { seq: 1, type: 'action', payload: { actorId: 'volt', move: 'leap' }, durationMs: 1200, delayMs: 150 },
            { seq: 2, type: 'sfx', payload: { text: 'FWIP!', anchor: [905, 600], rotation: 6, size: 52, color: '#74a9ff' }, durationMs: 1100, delayMs: 550 },
            { seq: 3, type: 'bubble', payload: { speaker: 'VOLT', text: '抓到了。', anchor: [965, 790] }, durationMs: 1800, delayMs: 1050 }
          ]
        },
        {
          panelKey: 'impact', readingOrder: 4,
          polygon: 'M90,990 L1150,960 L---,1360 L120,1390 Z', // 故意损坏：演示 SVG 降级
          focus: { x: 90, y: 960, w: 1060, h: 430 },
          art: { kind: 'burst', tint: '#3a2b2b' },
          beats: [
            { seq: 1, type: 'action', payload: { actorId: 'volt', move: 'punch' }, durationMs: 900, delayMs: 150 },
            { seq: 2, type: 'sfx', payload: { text: 'BAM!', anchor: [600, 1160], rotation: -4, size: 96, color: '#f4b942' }, durationMs: 1500, delayMs: 420 },
            { seq: 3, type: 'bubble', payload: { speaker: 'WRAITH', text: '你不可能——', anchor: [880, 1060], tone: 'villain' }, durationMs: 1900, delayMs: 1000 }
          ]
        },
        {
          panelKey: 'fall', readingOrder: 5,
          polygon: [[70, 1430], [720, 1410], [560, 1580], [90, 1720]], // y=1720 越界：演示坐标钳制
          focus: { x: 70, y: 1410, w: 650, h: 190 },
          art: { kind: 'static', tint: '#1d2b2b' },
          beats: [
            { seq: 1, type: 'bubble', payload: { speaker: '旁白', text: '通讯信号，中断。', anchor: [330, 1500], tone: 'narrator' }, durationMs: 2000, delayMs: 300 },
            { seq: 2, type: 'sfx', payload: { text: 'KSSHH…', anchor: [540, 1545], rotation: 3, size: 40, color: '#8bd5ca' }, durationMs: 1300, delayMs: 850 }
          ]
        },
        {
          panelKey: 'echo', readingOrder: 6,
          polygon: [[760, 1400], [1130, 1380], [1110, 1570], [800, 1585]],
          focus: { x: 760, y: 1380, w: 370, h: 205 },
          art: { kind: 'alley', tint: '#2b2420' },
          beats: [
            { seq: 1, type: 'sfx', payload: { text: 'THUD', anchor: [945, 1495], rotation: -2, size: 56, color: '#f2f0ea' }, durationMs: 1200, delayMs: 250 },
            { seq: 2, type: 'bubble', payload: { speaker: 'VOLT', text: '……收工。', anchor: [950, 1445] }, durationMs: 1900, delayMs: 900 }
          ]
        }
      ]
    },
    { pageNumber: 2, title: '待绘制', width: 1200, height: 1600, background: { tone: '#14161f' }, actors: [], panels: [] }
  ];
}

/* ---------------------------------- 路由 ---------------------------------- */

export function registerComicRoutes(app, { requireUser, requireProjectOwner }) {
  // 作者视角：完整漫画结构（章节 → 页 → 分镜 → 动画节点）
  app.get('/api/projects/:projectId/comic', requireUser, requireProjectOwner, (req, res) => {
    res.json({ chapters: loadComicStructure(req.project.id) });
  });

  // 生成示例章节（幂等：已有时直接返回现状）
  app.post('/api/projects/:projectId/comic/sample', requireUser, requireProjectOwner, (req, res) => {
    const existing = db.prepare('SELECT id FROM comic_chapters WHERE project_id = ?').get(req.project.id);
    if (!existing) {
      const chapterId = crypto.randomUUID();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO comic_chapters (id, project_id, chapter_number, title, status) VALUES (?, ?, 1, ?, ?)').run(chapterId, req.project.id, '第 1 章 · 港口警报', 'draft');
        for (const pageData of samplePages()) insertPage(req.project.id, chapterId, pageData);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    res.status(existing ? 200 : 201).json({ chapters: loadComicStructure(req.project.id) });
  });

  // 写入 / 覆盖一页（含分镜热区与动画节点），服务端统一做降级校验
  app.put('/api/projects/:projectId/comic/pages', requireUser, requireProjectOwner, (req, res) => {
    const body = req.body || {};
    const page = { width: clampNumber(body.width ?? 1200, 200, 4000), height: clampNumber(body.height ?? 1600, 200, 4000) };
    let chapter = body.chapterId
      ? db.prepare('SELECT * FROM comic_chapters WHERE id = ? AND project_id = ?').get(body.chapterId, req.project.id)
      : null;
    if (!chapter) chapter = db.prepare('SELECT * FROM comic_chapters WHERE project_id = ? ORDER BY chapter_number').get(req.project.id);
    if (!chapter) {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO comic_chapters (id, project_id, chapter_number, title) VALUES (?, ?, 1, ?)').run(id, req.project.id, String(body.chapterTitle || '第 1 章').slice(0, 80));
      chapter = db.prepare('SELECT * FROM comic_chapters WHERE id = ?').get(id);
    }
    let pageId = body.pageId && db.prepare('SELECT id FROM comic_pages WHERE id = ? AND project_id = ?').get(body.pageId, req.project.id) ? body.pageId : null;
    const pageNumber = Number.isFinite(Number(body.pageNumber))
      ? Math.max(1, Math.round(Number(body.pageNumber)))
      : db.prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM comic_pages WHERE chapter_id = ?').get(chapter.id).n;
    db.exec('BEGIN');
    try {
      if (pageId) {
        db.prepare('UPDATE comic_pages SET page_number = ?, title = ?, width = ?, height = ?, background = ?, actors = ? WHERE id = ?')
          .run(pageNumber, String(body.title || ''), page.width, page.height, JSON.stringify(body.background || {}), JSON.stringify(Array.isArray(body.actors) ? body.actors : []), pageId);
        db.prepare('DELETE FROM comic_panels WHERE page_id = ?').run(pageId);
      } else {
        pageId = crypto.randomUUID();
        db.prepare('INSERT INTO comic_pages (id, chapter_id, project_id, page_number, title, width, height, background, actors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(pageId, chapter.id, req.project.id, pageNumber, String(body.title || ''), page.width, page.height, JSON.stringify(body.background || {}), JSON.stringify(Array.isArray(body.actors) ? body.actors : []));
      }
      writePanels(pageId, page, Array.isArray(body.panels) ? body.panels : []);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ page: hydratePage(db.prepare('SELECT * FROM comic_pages WHERE id = ?').get(pageId)) });
  });

  // 章节状态：draft（私有草稿）/ published（访客可读）
  app.patch('/api/projects/:projectId/comic/chapters/:chapterId', requireUser, requireProjectOwner, (req, res) => {
    const chapter = db.prepare('SELECT * FROM comic_chapters WHERE id = ? AND project_id = ?').get(req.params.chapterId, req.project.id);
    if (!chapter) return res.status(404).json({ error: '找不到这个章节。' });
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 80) : chapter.title;
    const status = ['draft', 'published'].includes(req.body?.status) ? req.body.status : chapter.status;
    db.prepare('UPDATE comic_chapters SET title = ?, status = ?, updated_at = ? WHERE id = ?').run(title, status, new Date().toISOString(), chapter.id);
    res.json({ chapter: chapterDto(db.prepare('SELECT * FROM comic_chapters WHERE id = ?').get(chapter.id)) });
  });

  /* ------------------------- 访客视角：权限验证 -------------------------
   * 草稿章节只有作者可读；发布后任何有效身份（含匿名访客）可读。
   * ------------------------------------------------------------------ */

  const loadPageContext = (pageId) => {
    const page = db.prepare('SELECT * FROM comic_pages WHERE id = ?').get(pageId);
    if (!page) return null;
    return {
      page,
      chapter: db.prepare('SELECT * FROM comic_chapters WHERE id = ?').get(page.chapter_id),
      project: db.prepare('SELECT * FROM projects WHERE id = ?').get(page.project_id)
    };
  };
  const canRead = (ctx, user) => ctx.chapter?.status === 'published' || ctx.project?.owner_id === user.id;
  const progressDto = (row) => ({ pageId: row.page_id, panelId: row.panel_id, readingOrder: row.reading_order, mode: row.mode, updatedAt: row.updated_at });

  app.get('/api/comic/pages/:pageId', requireUser, (req, res) => {
    const ctx = loadPageContext(req.params.pageId);
    if (!ctx) return res.status(404).json({ error: '找不到这一页。' });
    if (!canRead(ctx, req.user)) return res.status(403).json({ error: '这一章还是私有草稿，只有作者可以阅读。' });
    res.json({ page: hydratePage(ctx.page), chapter: chapterDto(ctx.chapter), permission: ctx.project.owner_id === req.user.id ? 'owner' : 'reader' });
  });

  app.get('/api/comic/pages/:pageId/progress', requireUser, (req, res) => {
    const ctx = loadPageContext(req.params.pageId);
    if (!ctx) return res.status(404).json({ error: '找不到这一页。' });
    if (!canRead(ctx, req.user)) return res.status(403).json({ error: '这一章还是私有草稿，只有作者可以阅读。' });
    const row = db.prepare('SELECT * FROM comic_progress WHERE user_id = ? AND project_id = ?').get(req.user.id, ctx.page.project_id);
    res.json({ progress: row ? progressDto(row) : null });
  });

  // 每个访客一条阅读位置（user_id + project_id 主键 upsert），模式切换不清空
  app.put('/api/comic/pages/:pageId/progress', requireUser, (req, res) => {
    const ctx = loadPageContext(req.params.pageId);
    if (!ctx) return res.status(404).json({ error: '找不到这一页。' });
    if (!canRead(ctx, req.user)) return res.status(403).json({ error: '这一章还是私有草稿，只有作者可以阅读。' });
    const mode = req.body?.mode === 'auto' ? 'auto' : 'free';
    const readingOrder = clampNumber(req.body?.readingOrder ?? 0, 0, 10000);
    const panelId = req.body?.panelId == null ? null : String(req.body.panelId).slice(0, 64);
    if (panelId && !db.prepare('SELECT id FROM comic_panels WHERE id = ? AND page_id = ?').get(panelId, ctx.page.id)) {
      return res.status(400).json({ error: '这个分镜不在当前页面上。' });
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO comic_progress (user_id, project_id, page_id, panel_id, reading_order, mode, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, project_id) DO UPDATE SET
        page_id = excluded.page_id, panel_id = excluded.panel_id,
        reading_order = excluded.reading_order, mode = excluded.mode, updated_at = excluded.updated_at`)
      .run(req.user.id, ctx.page.project_id, ctx.page.id, panelId, readingOrder, mode, now);
    res.json({ saved: true, progress: { pageId: ctx.page.id, panelId, readingOrder, mode, updatedAt: now } });
  });
}
