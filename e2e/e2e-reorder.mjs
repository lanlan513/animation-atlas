import { chromium } from 'playwright';
import sharp from 'sharp';
const BASE = 'http://localhost:5173';
const files = [];
for (let i = 0; i < 4; i++) {
  const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: i*60, g: 100, b: 200-i*50 } } }).jpeg().toBuffer();
  files.push({ name: `f${i}.jpg`, mimeType: 'image/jpeg', buffer: buf });
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{const e=new Error('d');e.name='NotAllowedError';throw e;}}}); });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('text=新建拍摄项目');
await page.fill('input[placeholder*="例如"]', '拖拽排序');
await page.click('button:has-text("进入拍摄台")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', files);
await page.waitForFunction(() => document.querySelectorAll('.timeline-frame').length === 4);

const order = () => page.$$eval('.timeline-frame img', imgs => imgs.map(i => i.src.split('/').pop()));
const before = await order();
// 用 Playwright 的 HTML5 DnD：把第 1 帧拖到第 4 帧位置
await page.locator('.timeline-frame').nth(0).dragTo(page.locator('.timeline-frame').nth(3));
await page.waitForTimeout(1000);
const after = await order();
console.log('before:', before.join(','));
console.log('after :', after.join(','));
console.log('first moved to end:', after[3] === before[0] && JSON.stringify(after.slice(0,3)) === JSON.stringify(before.slice(1,4)) ? 'PASS' : 'FAIL');
// 刷新后顺序保持（服务端持久化）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelectorAll('.timeline-frame').length === 4);
const restored = await order();
console.log('order persisted after reload:', JSON.stringify(restored) === JSON.stringify(after) ? 'PASS' : 'FAIL');
await browser.close();
