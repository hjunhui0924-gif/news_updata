const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const projectRequire = createRequire(path.resolve(__dirname, '../../../package.json'));
const playwright = projectRequire('@playwright/test');
const root = path.resolve(__dirname, '../../../..');
const output = path.join(root, 'work', 'aggregation-ui-v0');

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright.chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
    await page.goto('http://127.0.0.1:3004/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '关注的世界，正在更新。' }).waitFor();
    await page.screenshot({ path: path.join(output, 'desktop-overview.png'), fullPage: true });
    await page.getByRole('button', { name: '列表布局' }).click();
    assert.equal(await page.locator('.entry-grid.list-layout .entry-card').count(), 8);
    await page.locator('button.entry-title[data-entry="1"]').click();
    await page.getByRole('heading', { name: '一次框架更新，哪些变化值得你真正关注？' }).waitFor();
    await page.screenshot({ path: path.join(output, 'desktop-reader.png'), fullPage: true });
    await page.getByRole('tab', { name: 'AI 摘要' }).click();
    await page.getByText('AI 摘要位置示意').waitFor();
    await page.locator('.back-button').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-entry') === '1');
    await page.getByRole('button', { name: '未读更新' }).click();
    await page.getByRole('button', { name: '概览布局' }).click();
    assert.equal(await page.locator('.timeline-entry').count(), 3);
    assert.equal(await page.locator('.timeline-group').first().getAttribute('aria-label'), '今天');
    assert.match(await page.locator('.timeline-entry').first().textContent(), /YouTube/);
    assert.match(await page.locator('.timeline-entry').nth(1).textContent(), /GitHub/);
    await page.getByRole('button', { name: '管理订阅来源' }).click();
    await page.getByRole('heading', { name: '你的来源，你的信息流。' }).waitFor();
    await page.screenshot({ path: path.join(output, 'desktop-sources.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.mobile-bottom').getByRole('button', { name: '信息流' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile-overview-viewport.png') });
    await page.screenshot({ path: path.join(output, 'mobile-overview.png'), fullPage: true });
    await page.getByRole('button', { name: '打开导航' }).click();
    const drawer = page.getByRole('dialog', { name: '聚合导航' });
    await drawer.getByRole('button', { name: '未读更新' }).click();
    await page.getByRole('heading', { name: '留给下一次好奇。' }).waitFor();
    await page.locator('.topbar .primary-button.add-source').click();
    await page.getByRole('heading', { name: '让关注的更新，来到这里。' }).waitFor();
    await page.getByRole('button', { name: '关闭说明' }).click();
    await page.locator('button.timeline-title[data-entry="2"]').click();
    await page.getByRole('heading', { name: '好的信息流，应该让内容站到前面' }).waitFor();
    await page.screenshot({ path: path.join(output, 'mobile-reader.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ screenshots: ['desktop-overview.png', 'desktop-reader.png', 'desktop-sources.png', 'mobile-overview-viewport.png', 'mobile-overview.png', 'mobile-reader.png'].map((file) => path.join(output, file)), failures }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
