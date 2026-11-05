import { expect, test, type Page } from '@playwright/test';
import type { Preferences } from '../../src/shared/types';
import type { TrendingSnapshot } from '../../src/shared/trending';
import type { SkillCatalogPage } from '../../src/shared/skills';
import { mockReaderBootstrap } from './reader-fixtures';

async function expectSaveLayout(page: Page) {
  const metrics = await page.locator('.settings-save').evaluate((el) => {
    const button = el.querySelector('button')!.getBoundingClientRect();
    const status = el.querySelector('[role="status"]')!.getBoundingClientRect();
    const card = el.closest('.settings-card')!.getBoundingClientRect();
    const sameLine = Math.min(button.bottom, status.bottom) > Math.max(button.top, status.top);
    return {
      sameLine,
      gap: sameLine
        ? Math.max(status.left - button.right, button.left - status.right)
        : Math.max(status.top - button.bottom, button.top - status.bottom),
      centerOffset: Math.abs((button.top + button.bottom - status.top - status.bottom) / 2),
      contained:
        button.left >= card.left &&
        button.right <= card.right &&
        status.left >= card.left &&
        status.right <= card.right,
      buttonHeight: button.height,
    };
  });
  expect(metrics.gap).toBeGreaterThanOrEqual(12);
  if (metrics.sameLine) expect(metrics.centerOffset).toBeLessThanOrEqual(1);
  expect(metrics.contained).toBe(true);
  if (page.viewportSize()!.width < 768) expect(metrics.buttonHeight).toBeGreaterThanOrEqual(44);
}

for (const width of [320, 390, 768, 1440]) {
  test(`settings actions keep a clear gap and alignment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/settings');
    const toggle = page.getByRole('switch', { name: '紧凑列表' });
    await toggle.click();
    await expect(page.locator('.settings-save [role="status"]')).toHaveText('有未保存修改');
    await expectSaveLayout(page);
    await page.screenshot({ path: `work/layout-review/settings-${width}.png` });
    await toggle.click();
    await expect(page.locator('.settings-save [role="status"]')).toHaveText('偏好已同步');
    await expectSaveLayout(page);
  });
}

test('settings pending, failure and retry preserve input and action layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  let saved: Preferences | undefined;
  await mockReaderBootstrap(page, (data) => ({ ...data, preferences: saved ?? data.preferences }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/settings', async (route) => {
    calls++;
    if (calls === 1) {
      await gate;
      await route.fulfill({ status: 503, json: { error: '保存暂时失败，请重试。' } });
    } else {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: '紧凑列表' });
  const initial = await toggle.getAttribute('aria-checked');
  await toggle.click();
  const save = page.getByRole('button', { name: '保存偏好', exact: true });
  await save.click();
  try {
    await expect(save).toBeDisabled();
    await expect(page.locator('.settings-save [role="status"]')).toHaveText('正在保存偏好…');
    await expectSaveLayout(page);
    await page.screenshot({ path: 'work/layout-review/settings-pending.png' });
  } finally {
    release();
  }
  await expect(page.locator('.toast')).toHaveText('保存暂时失败，请重试。');
  await expect(toggle).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true');
  await expect(page.locator('.settings-save [role="status"]')).toHaveText('有未保存修改');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.toast')).toHaveText('偏好已保存');
  await expect(page.locator('.settings-save [role="status"]')).toHaveText('偏好已同步');
  await expectSaveLayout(page);
  expect(calls).toBe(2);
  expect(errors).toEqual([]);
});

const trending: TrendingSnapshot = {
  repositories: [
    {
      name: 'example/readable-updates',
      url: 'https://github.com/example/readable-updates',
      rank: 1,
      description:
        'A reading application with a deliberately long description to exercise wrapping and action layouts.',
      language: 'TypeScript',
      stars: 12345,
      starsToday: 120,
    },
  ],
  fetchedAt: '2026-11-05T00:00:00Z',
  sourceUrl: 'https://github.com/trending?since=daily',
  language: '',
  stale: false,
  error: null,
  retryAt: null,
};
const skills: SkillCatalogPage = {
  skills: [
    {
      id: 'layout-review',
      source: 'local',
      scope: 'project',
      name: 'layout-review',
      description: '检查布局与按钮换行，保持页面清晰且易于阅读。',
      relativePath: 'layout-review/SKILL.md',
      location: '项目目录',
      updatedAt: null,
      files: { scripts: false, references: false, assets: false, interface: false },
      category: '测试与质量',
      tags: ['测试'],
    },
  ],
  nextPage: null,
  truncated: false,
};

for (const width of [320, 390, 1440]) {
  test(`main pages keep action groups inside the viewport at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/trending?*', (route) => route.fulfill({ json: trending }));
    await page.route('**/api/skills/local*', (route) => route.fulfill({ json: skills }));
    for (const route of ['settings', 'subscriptions', 'feed', 'saved', 'today', 'skills']) {
      await page.goto(`/${route}`);
      await expect(page.locator('main h1').first()).toBeVisible();
      if (route === 'today')
        await expect(page.getByRole('heading', { name: 'example/readable-updates' })).toBeVisible();
      if (route === 'skills')
        await expect(page.getByRole('button', { name: /layout-review/ }).first()).toBeVisible();
      // An interaction also ensures screenshots do not race initial hydration.
      await page.getByRole('button', { name: '通知中心', exact: true }).click();
      const notice = page.getByRole('dialog', { name: '通知中心' });
      await expect(notice).toBeVisible();
      const bounds = await notice.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(notice).not.toBeVisible();
      const violations = await page.evaluate(() => {
        const violations: string[] = [];
        const panel = document.querySelector<HTMLElement>(
          '.management-page, .discovery-panel, .skills-page, .feed-panel',
        );
        if (document.documentElement.scrollWidth > window.innerWidth + 1)
          violations.push('document overflow');
        if (panel && panel.scrollWidth > panel.clientWidth + 1) violations.push('panel overflow');
        const groups = document.querySelectorAll(
          '.settings-save, .management-heading, .discovery-filters, .skills-toolbar, .connection-actions, .subscription-actions, .top-actions',
        );
        for (const group of groups) {
          const controls = [...group.querySelectorAll('button, a, input, select')]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width && r.height);
          for (let i = 0; i < controls.length; i++) {
            const a = controls[i];
            if (a.left < -1 || a.right > window.innerWidth + 1)
              violations.push(`${group.className}: control overflow`);
            for (const b of controls.slice(i + 1))
              if (
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
              )
                violations.push(`${group.className}: overlapping controls`);
          }
        }
        return violations;
      });
      expect(violations, `${route} at ${width}px`).toEqual([]);
      await page.screenshot({ path: `work/layout-review/${route}-audit-${width}.png` });
    }
    expect(errors).toEqual([]);
  });
}
