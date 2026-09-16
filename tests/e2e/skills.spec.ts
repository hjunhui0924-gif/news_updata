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
  const localCard = page.getByRole('button', { name: /codebase-design/ }).first();
  await expect(localCard).toBeVisible();
  await localCard.click();
  await expect(page.getByRole('region', { name: /codebase-design Skill 详情/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'codebase-design', exact: true })).toBeVisible();
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
            description: 'Review changes with a repeatable workflow.',
            relativePath: 'skills/reviewer/SKILL.md',
            location: 'GitHub Star',
            repository: 'owner/skill-pack',
            repositoryDescription: 'A collection of agent skills',
            repositoryUrl: 'https://github.com/owner/skill-pack',
            url: 'https://github.com/owner/skill-pack/blob/HEAD/skills/reviewer/SKILL.md',
            updatedAt: null,
            files: { scripts: false, references: true, assets: false, interface: false },
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
        description: 'Review changes with a repeatable workflow.',
        relativePath: 'skills/reviewer/SKILL.md',
        location: 'GitHub Star',
        repository: 'owner/skill-pack',
        repositoryUrl: 'https://github.com/owner/skill-pack',
        url: 'https://github.com/owner/skill-pack/blob/HEAD/skills/reviewer/SKILL.md',
        updatedAt: null,
        files: { scripts: false, references: true, assets: false, interface: false },
        content: '---\nname: reviewer\ndescription: Review changes\n---\n# Review workflow',
      }),
    }),
  );
  await page.goto('/skills');
  await page.getByRole('tab', { name: 'GitHub Star', exact: true }).click();
  await expect(page.getByRole('button', { name: /reviewer/ })).toBeVisible();
  await page.getByRole('button', { name: /reviewer/ }).click();
  await expect(page.getByRole('heading', { name: 'reviewer', exact: true })).toBeVisible();
  await expect(page.getByText('Review workflow', { exact: true })).toBeVisible();
});
