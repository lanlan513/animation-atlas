import { chromium } from 'playwright';
import sharp from 'sharp';
const BASE = 'http://localhost:5173';
const files = [];
for (let i = 0; i < 4; i++) {
  const buf = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 30*i, g: 80+i*40, b: 200-i*40 } } }).jpeg().toBuffer();
  files.push({ name: `f${i}.jpg`, mimeType: 'image/jpeg', buffer: buf });
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// 强制拒绝摄像头 -> 落到导入
await context.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async()=>{const e=new Error('d');e.name='NotAllowedError';throw e;} } }); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('text=新建拍摄项目');
await page.fill('input[placeholder*="例如"]', '导出验证');
await page.click('button:has-text("进入拍摄台")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', files);
await page.waitForFunction(() => document.querySelectorAll('.timeline-frame').length === 4);
// 把时长调小加快导出
await page.locator('.timeline-frame').nth(0).click();
await page.waitForSelector('.frame-toolbar');
await page.fill('.duration-control input[type=number]', '120');
await page.click('.duration-control button:has-text("应用")');
await page.click('button:has-text("播放成片")');
await page.waitForSelector('.player-modal canvas');
await page.waitForTimeout(500);
// 拦截导出下载
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.player-modal button:has-text("导出 WebM")').click()
]);
const path = '/tmp/fm-export.webm';
await download.saveAs(path);
const stat = await import('node:fs/promises').then(fs => fs.stat(path));
console.log('WebM exported:', download.suggestedFilename(), stat.size, 'bytes');
// 检查是否 webm 魔数 EBML
const head = Buffer.alloc(4);
const fh = await import('node:fs/promises').then(fs => fs.open(path,'r'));
await fh.read(head, 0, 4, 0); await fh.close();
console.log('magic:', head.toString('latin1',0,4), head.toString('latin1',0,4) === '\x1aE\xdf\xa3' ? 'VALID WEBM' : 'INVALID');
console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
