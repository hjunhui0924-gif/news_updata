import { expect, test, type Page } from '@playwright/test';
import type { PersonalAiSettings } from '../../src/shared/ai-settings';
import { mockReaderBootstrap } from './reader-fixtures';

const initial: PersonalAiSettings = {
  mode: 'site',
  revision: 0,
  hasKey: false,
  baseUrl: '',
  model: '',
  inputPrice: 1,
  outputPrice: 1,
  dailyBudget: 0.5,
  monthlyBudget: 5,
  allowedBaseUrls: ['https://models.example.com/v1'],
  siteAvailable: false,
  personalAvailable: true,
  effectiveMode: 'disabled',
};
async function live(page: Page) {
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    mode: 'live',
    user: { name: '个人设置演示账号' },
    services: {
      ...data.services,
      github: true,
      githubAuth: { state: 'connected', message: '测试账号已连接', expiresAt: null, retryAt: null },
    },
  }));
  await page.goto('/home');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.locator('.toast')).toHaveText('内容已刷新');
  await page.getByRole('button', { name: '设置 AI 服务' }).click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const panels = document.querySelectorAll<HTMLElement>(
        '.management-page, .home-content, .account-popover',
      );
      return (
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        [...panels].every((panel) => panel.scrollWidth <= panel.clientWidth + 1)
      );
    }),
  ).toBe(true);
}
for (const width of [1440, 390, 320]) {
  test(`workspace home exposes first-use steps, connections and optional AI at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { name: '首次使用，四步就好' })).toBeVisible();
    await expect(page.locator('.home-steps > li')).toHaveCount(4);
    await expect(page.getByRole('heading', { name: '连接你的关注' })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `work/personal-space/home-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '连接 YouTube', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('tab', { name: 'YouTube 关注' }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '进入信息流' }).click();
    await expect(page.getByRole('heading', { name: '全部更新', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test(`account popup supports keyboard, outside dismissal and settings navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/home');
    if (width < 768) await page.getByRole('button', { name: '打开导航' }).click();
    const trigger = page.getByRole('button', { name: '账号菜单', exact: true });
    await trigger.click();
    const menu = page.getByRole('menu', { name: '个人账号' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '工作空间首页' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: '阅读偏好' })).toBeFocused();
    await page.screenshot({ path: `work/personal-space/account-${width}.png` });
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page
      .locator(
        width < 768 ? '.navigation-drawer .nav-caption' : '.app-shell > .sidebar .nav-caption',
      )
      .first()
      .click();
    await expect(menu).toBeHidden();
    await trigger.click();
    await menu.getByRole('menuitem', { name: '个人 AI 服务' }).click();
    await expect(page).toHaveURL(/\/ai-settings$/);
    await expect(page.getByRole('heading', { name: '个人 AI 服务', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: '个人设置导航' })
      .getByRole('button', { name: '阅读偏好' })
      .click();
    await expect(page.getByRole('switch', { name: '紧凑列表' })).toBeVisible();
    await noOverflow(page);
  });
}
for (const width of [1440, 390]) {
  test(`personal model settings save, test, retain blank key and confirm deletion at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    let saved = structuredClone(initial);
    let writes = 0,
      tests = 0;
    await page.route('**/api/settings/ai', async (route) => {
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON();
        writes++;
        if (writes === 1) expect(input.apiKey).toBe('fixture-browser-only-key');
        else expect(input.apiKey).toBeUndefined();
        const { apiKey, ...fields } = input;
        saved = {
          ...saved,
          ...fields,
          hasKey: !!apiKey || saved.hasKey,
          revision: saved.revision + 1,
          effectiveMode: 'personal',
        };
      } else if (route.request().method() === 'DELETE')
        saved = { ...initial, mode: 'disabled', revision: saved.revision + 1 };
      await route.fulfill({ json: saved });
    });
    await page.route('**/api/settings/ai/test', async (route) => {
      tests++;
      await route.fulfill({ json: { ok: true, message: '连接成功，模型支持当前接口格式。' } });
    });
    await live(page);
    await page.getByLabel('AI 提供方式').selectOption('personal');
    await page.getByLabel('API Key', { exact: false }).fill('fixture-browser-only-key');
    await page.getByLabel('模型名称', { exact: true }).fill('fixture-model');
    const address = await page.getByLabel('服务地址', { exact: false }).boundingBox();
    const model = await page.getByLabel('模型名称', { exact: true }).boundingBox();
    expect(Math.abs(address!.width - model!.width)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: '测试已保存配置' })).toBeDisabled();
    await page.screenshot({ path: `work/personal-space/ai-form-${width}.png`, fullPage: true });
    await noOverflow(page);
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByText('个人配置已保存。', { exact: false })).toBeVisible();
    await expect(page.getByLabel('API Key', { exact: false })).toHaveValue('');
    await page.getByRole('button', { name: '测试已保存配置' }).click();
    await expect(page.getByText('连接成功，模型支持当前接口格式。')).toBeVisible();
    await page.getByLabel('每日预算（美元）').fill('0.6');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByText('配置已同步', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '删除个人密钥' }).click();
    await expect(page.getByRole('button', { name: '确认删除密钥' })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '删除个人密钥' }).click();
    await page.getByRole('button', { name: '确认删除密钥' }).click();
    await expect(page.getByText('个人密钥已删除，AI 已停用。', { exact: false })).toBeVisible();
    await expect(page.getByLabel('AI 提供方式')).toHaveValue('disabled');
    expect(writes).toBe(2);
    expect(tests).toBe(1);
    expect(
      await page.evaluate(() =>
        JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
      ),
    ).not.toContain('fixture-browser-only-key');
    expect(errors).toEqual([]);
  });
}
test('personal settings keep input on save failure and warn before discarding changes', async ({
  page,
}) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: initial });
      return;
    }
    calls++;
    await gate;
    await route.fulfill({ status: 503, json: { error: '暂时无法保存，请重试。' } });
  });
  await live(page);
  await page.getByLabel('AI 提供方式').selectOption('personal');
  await page.getByLabel('API Key', { exact: false }).fill('fixture-retry-key');
  await page.getByLabel('模型名称', { exact: true }).fill('my-model');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  try {
    await expect(page.getByLabel('模型名称', { exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator('.personal-ai-page').getByRole('alert')).toContainText('暂时无法保存');
  await expect(page.getByLabel('API Key', { exact: false })).toHaveValue('fixture-retry-key');
  const dismissal = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
  await page
    .getByRole('navigation', { name: '个人设置导航' })
    .getByRole('button', { name: '阅读偏好' })
    .click();
  await dismissal;
  await expect(page).toHaveURL(/\/ai-settings$/);
  const acceptance = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await page
    .getByRole('navigation', { name: '个人设置导航' })
    .getByRole('button', { name: '阅读偏好' })
    .click();
  await acceptance;
  await expect(page).toHaveURL(/\/settings$/);
  expect(calls).toBe(1);
});
test('account logout reports failures, allows retry and returns to login', async ({ page }) => {
  await page.route('**/api/settings/ai', (route) => route.fulfill({ json: initial }));
  await live(page);
  let attempts = 0;
  await page.route('**/api/auth/sign-out', async (route) => {
    expect(route.request().method()).toBe('POST');
    attempts++;
    await route.fulfill(
      attempts === 1
        ? { status: 503, json: { error: '退出暂未完成，请重试。' } }
        : { json: { success: true } },
    );
  });
  await page.getByRole('button', { name: '账号菜单', exact: true }).click();
  const menu = page.getByRole('menu', { name: '个人账号' });
  await menu.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await expect(menu.getByRole('alert')).toContainText('退出暂未完成');
  await expect(menu.getByRole('menuitem', { name: '退出登录', exact: true })).toBeEnabled();
  await menu.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(attempts).toBe(2);
});

test('browser back cancellation keeps the personal AI draft and allows later back and forward', async ({
  page,
}) => {
  await page.route('**/api/settings/ai', (route) => route.fulfill({ json: initial }));
  await live(page);
  await page.getByLabel('AI 提供方式').selectOption('personal');
  await page.getByLabel('API Key', { exact: false }).fill('fixture-unsaved-history');
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    if (dialogs === 1) await dialog.dismiss();
    else await dialog.accept();
  });
  await page.evaluate(() => history.back());
  await expect.poll(() => dialogs).toBe(1);
  await expect(page).toHaveURL(/\/ai-settings$/);
  await expect(page.getByLabel('API Key', { exact: false })).toHaveValue('fixture-unsaved-history');
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/home$/);
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(/\/ai-settings$/);
  await expect(page.getByLabel('AI 提供方式')).toHaveValue('site');
  expect(dialogs).toBe(2);
});

test('cancelled logout keeps the session and draft; confirmed logout asks only once', async ({
  page,
}) => {
  await page.route('**/api/settings/ai', (route) => route.fulfill({ json: initial }));
  await live(page);
  await page.getByLabel('AI 提供方式').selectOption('personal');
  await page.getByLabel('API Key', { exact: false }).fill('fixture-unsaved-logout');
  let attempts = 0;
  await page.route('**/api/auth/sign-out', async (route) => {
    attempts++;
    await route.fulfill({ json: { success: true } });
  });
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    if (dialogs === 1) await dialog.dismiss();
    else await dialog.accept();
  });
  await page.getByRole('button', { name: '账号菜单', exact: true }).click();
  const logout = page.getByRole('menuitem', { name: '退出登录', exact: true });
  await logout.click();
  await expect.poll(() => dialogs).toBe(1);
  expect(attempts).toBe(0);
  await expect(page).toHaveURL(/\/ai-settings$/);
  await expect(page.getByLabel('API Key', { exact: false })).toHaveValue('fixture-unsaved-logout');
  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
  expect(attempts).toBe(1);
  expect(dialogs).toBe(2);
});

test('demo mode never accepts real model keys and help has usable guidance', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('/ai-settings');
  await expect(page.getByLabel('AI 提供方式')).toBeDisabled();
  await expect(page.getByText('演示模式只展示设置', { exact: false })).toBeVisible();
  const response = await request.put('/api/settings/ai', {
    headers: { Origin: baseURL! },
    data: { mode: 'personal', revision: 0, apiKey: 'fixture-not-stored' },
  });
  expect(response.status()).toBe(400);
  await page.goto('/help');
  await page.getByText('需要填写 GitHub 或 Google 的密钥吗？', { exact: true }).click();
  await expect(
    page.getByText('普通用户不需要。登录或连接按钮不可用时', { exact: false }),
  ).toBeVisible();
});
