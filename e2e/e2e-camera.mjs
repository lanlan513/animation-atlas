import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = 'http://localhost:5173';
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'} · ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
// 给一个伪造的摄像头流（Chromium fake device），验证拍摄路径
const context = await browser.newContext({
  viewport: { width: 1400, height: 950 },
  permissions: ['camera']
});
await context.grantPermissions(['camera']);
const page = await context.newPage();
page.on('pageerror', (err) => results.push({ name: 'pageerror: ' + err.message, ok: false }));
// 使用 chromium 自带 fake device（彩色滚动条视频）
await context.addInitScript(() => {
  // 确保 video.play() 不会被自动播放策略拦截
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('text=新建拍摄项目');
await page.fill('input[placeholder*="例如"]', '真实摄像头抓拍');
await page.click('button:has-text("进入拍摄台")');
await page.waitForURL(/#\/studio\//);

// 等待摄像头 ready（快门按钮可用）
await page.waitForSelector('.shutter:not([disabled])', { timeout: 10000 });
check('camera becomes ready', true);

// 视频元素真的拿到了轨道
const trackState = await page.evaluate(() => {
  const v = document.querySelector('.camera-video');
  return { hasStream: !!v.srcObject, tracks: v.srcObject?.getVideoTracks?.().length || 0, w: v.videoWidth, h: v.videoHeight };
});
check('live video track playing', trackState.tracks >= 1 && trackState.w > 0, JSON.stringify(trackState));

// 拍 3 帧
for (let i = 0; i < 3; i++) {
  await page.click('.shutter');
  await page.waitForFunction((n) => document.querySelectorAll('.timeline-frame').length === n, i + 1, { timeout: 10000 });
}
check('captured 3 frames', (await page.locator('.timeline-frame').count()) === 3);

// 残影标记出现（有帧之后）
const ghostFlag = await page.locator('.ghost-flag').textContent();
check('ghost flag references last frame', ghostFlag.includes('第 3 帧'), ghostFlag);

// 透明度滑块可调且持久化
await page.locator('.opacity-range').fill('0.75');
await page.waitForTimeout(800); // 自动保存防抖
const ghostOpacity = await page.locator('.ghost-layer').evaluate((el) => Number(getComputedStyle(el).opacity).toFixed(2));
check('ghost opacity applied to layer', Number(ghostOpacity) === 0.75, `opacity=${ghostOpacity}`);

// 关闭残影
await page.locator('.ghost-control input[type=checkbox]').uncheck();
await page.waitForSelector('.ghost-layer', { state: 'detached' });
check('ghost layer hidden when toggled off', true);

// 播放器：打开、播放、帧索引推进
await page.click('button:has-text("播放成片")');
await page.waitForSelector('.player-modal canvas');
// 用滑杆跳到第 3 帧
await page.locator('.player-scrub input').fill('2');
await page.waitForTimeout(200);
const scrubValue = await page.locator('.player-scrub input').inputValue();
check('scrubber seeks to frame 3', scrubValue === '2', scrubValue);
await page.locator('.player-modal button:has-text("播放")').click();
// 在 ~1 秒内多次采样帧索引，播放必须让索引发生变化（3 帧 × 130ms 会循环）
const samples = [];
for (let i = 0; i < 10; i++) {
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(110);
  samples.push(Number(await page.locator('.player-scrub input').inputValue()));
}
const distinct = new Set(samples);
check('playback advances through frames', distinct.size >= 2, `samples=${samples.join(',')}`);
await page.locator('.player-modal .player-head .icon-button').click();

// 刷新：3 帧 + 残影透明度设置还原
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelectorAll('.timeline-frame').length === 3, null, { timeout: 10000 });
const restoredOpacity = await page.locator('.opacity-range').inputValue();
check('opacity setting restored', Number(restoredOpacity) === 0.75, restoredOpacity);
const checkboxAfterReload = await page.locator('.ghost-control input[type=checkbox]').isChecked();
check('ghost-off preference restored', checkboxAfterReload === false);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
