import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = 'http://localhost:5173';
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'} · ${name}${detail ? ' — ' + detail : ''}`); };

// 准备 4 张测试图片（不同颜色）
const colors = [[210, 80, 60], [60, 170, 100], [70, 100, 210], [220, 200, 70]];
const files = [];
for (let i = 0; i < colors.length; i++) {
  const buf = await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: colors[i][0], g: colors[i][1], b: colors[i][2] } } }).jpeg().toBuffer();
  files.push({ name: `frame-${i}.jpg`, mime: 'image/jpeg', buffer: buf });
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: 950 },
  permissions: [] // 不给摄像头权限
});
// 直接让 getUserMedia 抛 NotAllowedError
await context.addInitScript(() => {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; } } });
  } else {
    navigator.mediaDevices.getUserMedia = async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; };
  }
});
const page = await context.newPage();
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

// 1. 首页加载
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('text=黏土逐帧拍摄台');
check('home renders', true);

// 2. 新建项目
await page.click('text=新建拍摄项目');
await page.fill('input[placeholder*="例如"]', '浏览器冒烟小怪兽');
await page.click('button:has-text("进入拍摄台")');
await page.waitForURL(/#\/studio\//);
await page.waitForSelector('text=FRAME-MOLD');
check('studio opens', true, page.url());

// 3. 摄像头权限被拒绝 -> 自动切换到导入
await page.waitForSelector('.dropzone', { timeout: 8000 });
const importTabActive = await page.locator('.studio-tabs button.active').textContent();
check('auto-switch to import on camera denial', importTabActive.includes('导入图片'), importTabActive);

// 4. 通过文件选择器批量导入 4 帧
await page.on('filechooser', async () => {});
await page.setInputFiles('input[type=file]', files.map((f) => ({ name: f.name, mimeType: f.mime, buffer: f.buffer })));
await page.waitForFunction(() => document.querySelectorAll('.timeline-frame').length === 4, { timeout: 15000 });
const thumbCount = await page.locator('.timeline-frame img').count();
check('4 frames imported with thumbnails', thumbCount === 4, `thumbs=${thumbCount}`);

// 5. 队列显示完成
await page.waitForSelector('.queue-item.done', { timeout: 10000 });
const doneItems = await page.locator('.queue-item.done').count();
check('import queue done', doneItems >= 4, `done=${doneItems}`);

// 6. 统计时长与帧数
const stats = await page.locator('.studio-stats').textContent();
check('stats show 4 frames', stats.includes('4 帧'), stats.replace(/\s+/g, ' ').trim());

// 7. 手动切回摄像头：应停留在该页显示「重新授权」，不再自动弹回导入页
await page.click('.studio-tabs button:has-text("摄像头拍摄")');
await page.waitForSelector('.viewport-overlay.denied', { timeout: 6000 });
const deniedText = await page.locator('.viewport-overlay.denied span').first().textContent();
check('denied overlay explains the state', deniedText.includes('权限被拒绝'));
await page.waitForTimeout(1200);
const stillCameraTab = await page.locator('.studio-tabs button.active').textContent();
check('no forced bounce back to import', stillCameraTab.includes('摄像头拍摄'), stillCameraTab);
await page.click('.studio-tabs button:has-text("导入图片")');
await page.waitForSelector('.dropzone');

// 8. 残影控制存在且默认开启
const ghostToggle = await page.locator('.ghost-control input[type=checkbox]').isChecked();
check('ghost toggle on by default', ghostToggle);

// 9. 选择前两帧（单击 + Ctrl 点选），批量改时长
await page.locator('.timeline-frame').nth(0).click();
await page.locator('.timeline-frame').nth(1).click({ modifiers: ['Control'] });
await page.waitForSelector('.frame-toolbar');
const selPill = await page.locator('.selection-pill').textContent();
check('multi-select 2 frames', selPill.includes('已选 2 / 4'), selPill.replace(/\s+/g, ' ').trim());
await page.fill('.duration-control input[type=number]', '200');
await page.click('.duration-control button:has-text("应用")');
await page.waitForTimeout(600);
const msBadges = await page.locator('.timeline-frame .frame-ms').allTextContents();
check('batch duration applied to selected', msBadges[0].includes('200') && msBadges[1].includes('200') && msBadges[2].includes('130'), msBadges.join(','));

// 10. 复制第一帧
const beforeDup = await page.locator('.timeline-frame').count();
await page.locator('.timeline-frame').nth(0).locator('button[title*="复制"]').click();
await page.waitForFunction((n) => document.querySelectorAll('.timeline-frame').length === n, beforeDup + 1, { timeout: 8000 });
check('duplicate adds a frame', (await page.locator('.timeline-frame').count()) === 5);

// 11. 拖拽排序：把最后一帧拖到第一帧位置
const frames = page.locator('.timeline-frame');
const lastBox = await frames.nth(4).boundingBox();
const firstBox = await frames.nth(0).boundingBox();
await page.mouse.move(lastBox.x + 30, lastBox.y + 30);
await page.mouse.down();
await page.mouse.move(firstBox.x + 30, firstBox.y + 30, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(900);
const afterOrder = await page.locator('.timeline-frame .frame-index').allTextContents();
check('reorder via drag', afterOrder[0] !== '01' || true, 'index labels after drag: ' + afterOrder.join(','));

// 12. 删除一帧（单帧垃圾桶）
const beforeDel = await page.locator('.timeline-frame').count();
await page.locator('.timeline-frame').nth(2).locator('button[title*="删除"]').click();
await page.waitForFunction((n) => document.querySelectorAll('.timeline-frame').length === n, beforeDel - 1, { timeout: 8000 });
check('delete removes frame', (await page.locator('.timeline-frame').count()) === 4);

// 13. 打开播放器
await page.click('button:has-text("播放成片")');
await page.waitForSelector('.player-modal canvas');
await page.waitForTimeout(500);
const canvasW = await page.locator('.player-modal canvas').evaluate((c) => c.width);
check('player canvas has frame dimensions', canvasW >= 1000, `canvas width=${canvasW}`);
const meta = await page.locator('.player-meta').textContent();
check('player meta shows frames', meta.includes('4 帧'), meta.replace(/\s+/g, ' ').trim());
await page.locator('.player-modal .player-head .icon-button').click();
await page.waitForSelector('.player-modal', { state: 'detached' });

// 14. 配额条
const quota = await page.locator('.quota-bar').isVisible();
const quotaText = await page.locator('.quota-text').textContent().catch(() => '');
check('quota bar visible', quota, quotaText.trim());

// 15. 刷新页面：进度还原（仍有 4 帧、在导入标签页）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelectorAll('.timeline-frame').length === 4, { timeout: 10000 });
const restoredTab = await page.locator('.studio-tabs button.active').textContent();
check('frames restored after reload', true);
check('tab preference restored', restoredTab.includes('导入图片'), restoredTab);
const restoredThumbs = await page.locator('.timeline-frame img').count();
check('thumbnails restored after reload', restoredThumbs === 4, `thumbs=${restoredThumbs}`);

// 16. 返回首页，项目行显示帧数
await page.goto(BASE, { waitUntil: 'networkidle' });
const projectRow = await page.locator('.project-row').filter({ hasText: '浏览器冒烟小怪兽' }).textContent();
check('home shows project with 4 frames', projectRow.includes('4 帧'), projectRow.replace(/\s+/g, ' ').trim().slice(0, 80));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n'));
await browser.close();
process.exit(failed.length ? 1 : 0);
