import { test, expect } from '@playwright/test';

test('local Skill directory searches, opens details, and fits a phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/skills');
  await expect(page.getByRole('heading', { name: 'Skill 目录', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '本机已安装', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('搜索 Skill').fill('codebase-design');
  await expect(page.getByRole('group', { name: 'Skill 分类' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Skill 标签' })).toBeVisible();
  const localCard = page.getByRole('button', { name: /codebase-design/ }).first();
  await expect(localCard).toBeVisible();
  await localCard.click();
  await expect(page.getByRole('region', { name: /codebase-design Skill 详情/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'codebase-design', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'AI 摘要', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '中英文对照', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '原文', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(page.getByText('Codebase Design', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '返回 Skill 列表' }).click();
  await expect(page.getByRole('heading', { name: 'Skill 目录', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'work/skills-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('GitHub Star source renders mocked Skill results and details', async ({ page }) => {
  await page.route('**/api/skills/starred*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        username: 'alice',
        page: 1,
        nextPage: null,
        truncated: false,
        skills: [
          {
            id: 'github:owner/skill-pack:skills/reviewer/SKILL.md',
            source: 'github',
            scope: 'github',
            name: 'reviewer',
            description: 'Review changes with a repeatable workflow. Inspect the diff first. Then verify the tests and report findings.',
            relativePath: 'skills/reviewer/SKILL.md',
            location: 'GitHub Star',
            repository: 'owner/skill-pack',
            repositoryDescription: 'A collection of agent skills',
            repositoryUrl: 'https://github.com/owner/skill-pack',
            url: 'https://github.com/owner/skill-pack/blob/HEAD/skills/reviewer/SKILL.md',
            updatedAt: null,
            files: { scripts: false, references: true, assets: false, interface: false },
            category: '测试与质量',
            tags: ['测试', '代码'],
          },
        ],
      }),
    }),
  );
  await page.route('**/api/skills/detail*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'github:owner/skill-pack:skills/reviewer/SKILL.md',
        source: 'github',
        scope: 'github',
        name: 'reviewer',
        description: 'Review changes with a repeatable workflow. Inspect the diff first. Then verify the tests and report findings.',
        relativePath: 'skills/reviewer/SKILL.md',
        location: 'GitHub Star',
        repository: 'owner/skill-pack',
        repositoryUrl: 'https://github.com/owner/skill-pack',
        url: 'https://github.com/owner/skill-pack/blob/HEAD/skills/reviewer/SKILL.md',
        updatedAt: null,
        files: { scripts: false, references: true, assets: false, interface: false },
        category: '测试与质量',
        tags: ['测试', '代码'],
        contentHash: 'remote-reviewer-hash',
        ai: {
          summary: {
            headline: 'reviewer 的代码审查工作流',
            overview: '帮助团队按固定步骤检查代码变更。',
            scenarios: ['适合提交代码审查请求时使用。'],
            workflow: ['先阅读变更，再运行测试。'],
            cautions: ['最终结论仍需人工确认。'],
            evidence: [{ id: 'k1', text: 'Review changes with a repeatable workflow.' }],
          },
          translation: {
            text: '# Review workflow\n# 审查工作流',
            blocks: [{ original: '# Review workflow', translation: '# 审查工作流' }],
          },
          summaryStatus: 'ready',
          translationStatus: 'ready',
          summaryError: null,
          translationError: null,
        },
        content: '---\nname: reviewer\ndescription: Review changes\n---\n# Review workflow',
      }),
    }),
  );
  await page.goto('/skills');
  await page.getByRole('tab', { name: 'GitHub Star', exact: true }).click();
  await expect(page.getByRole('button', { name: /测试与质量/ })).toBeVisible();
  await page.getByRole('button', { name: /测试与质量/ }).click();
  await expect(page.getByRole('button', { name: /reviewer/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /打开项目/ })).toHaveAttribute(
    'href',
    'https://github.com/owner/skill-pack',
  );
  await page.getByRole('button', { name: /reviewer/ }).click();
  await expect(page.getByRole('heading', { name: 'reviewer', exact: true })).toBeVisible();
  await expect(page.locator('.skill-detail-description p')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /打开项目/ })).toHaveAttribute(
    'href',
    'https://github.com/owner/skill-pack',
  );
  await expect(page.getByText('reviewer 的代码审查工作流', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '中英文对照', exact: true }).click();
  await expect(page.getByText(/审查工作流/)).toBeVisible();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(page.getByText(/Review workflow/)).toBeVisible();
  await page.screenshot({ path: 'work/skills-detail-desktop.png', fullPage: true });
});
