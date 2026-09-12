import { createHash } from 'node:crypto';
import type { FeedItem, Subscription, Summary } from '@/shared/types';

const examples = [
  [
    'shadcn-ui/ui',
    '让组件协作更顺手',
    '新增组件预览与可访问性说明，让设计与代码之间少一点来回。',
    '界面组件',
    'blue',
  ],
  [
    'vercel/next.js',
    '更轻快的开发反馈',
    '调整开发时的错误提示，改善路由切换过程中的状态反馈。',
    'Web 开发',
    'slate',
  ],
  [
    'drizzle-team/drizzle-orm',
    '数据库迁移，更容易核对',
    '增加迁移变更预览，并补充常见查询的类型说明。',
    '数据库',
    'green',
  ],
  [
    'tailwindlabs/tailwindcss',
    '把界面细节打磨得更好',
    '补充响应式布局示例，改善长文本和小屏幕下的样式表现。',
    '设计工具',
    'cyan',
  ],
  [
    'microsoft/playwright',
    '更清楚地定位页面问题',
    '改进测试失败时的上下文展示，便于复现交互中的异常。',
    '测试工具',
    'green',
  ],
  [
    'oven-sh/bun',
    '日常脚本的运行体验更新',
    '优化脚本输出与依赖安装提示，补充常见环境问题的说明。',
    '开发工具',
    'amber',
  ],
  [
    'TanStack/query',
    '让数据加载状态更直观',
    '更新缓存管理示例，区分首次加载和后台刷新的界面反馈。',
    'Web 开发',
    'amber',
  ],
  [
    'vuejs/core',
    '组件状态处理的细节改进',
    '完善组件生命周期示例，增加异步交互的边界说明。',
    'Web 开发',
    'green',
  ],
  [
    'vitejs/vite',
    '更容易理解的构建反馈',
    '改进依赖错误提示，并整理常见配置的迁移说明。',
    '开发工具',
    'blue',
  ],
  [
    'withastro/astro',
    '内容站点的阅读体验优化',
    '补充内容集合示例，完善图片和文章索引的处理说明。',
    '内容工具',
    'amber',
  ],
  [
    'excalidraw/excalidraw',
    '让想法更快变成草图',
    '完善图形选择和复制反馈，补充键盘操作提示。',
    '设计工具',
    'blue',
  ],
  [
    'supabase/supabase',
    '项目管理流程的小改进',
    '补充数据库连接说明，优化本地开发环境的错误反馈。',
    '数据库',
    'green',
  ],
];

export function createDemoData(now = new Date()) {
  const baseline = new Date(now.getTime() - 86400000 * 7).toISOString();
  const subscriptions: Subscription[] = examples.slice(0, 6).map(([repo, , description], i) => ({
    id: `demo-source-${i}`,
    externalId: `demo-${repo}`,
    kind: 'repo',
    name: repo,
    description,
    url: `https://github.com/${repo}`,
    enabled: true,
    priority: i < 3,
    demo: true,
    createdAt: baseline,
    lastSyncAt: now.toISOString(),
    error: null,
    coverage: 'complete',
  }));
  const items: FeedItem[] = Array.from({ length: 24 }, (_, index) => {
    const [repo, title, overview, tag, color] = examples[index % examples.length];
    const type = index % 5 === 4 ? 'new_repo' : 'release';
    const empty = index === 19;
    const sourceId = `demo-source-${index % 6}`;
    const publishedAt = new Date(now.getTime() - (index + 1) * 3600000).toISOString();
    const changes = [
      overview,
      '补充了示例和使用说明，方便快速了解这次变化。',
      '原文没有说明兼容性或升级要求，使用前请核对项目文档。',
    ];
    const body = empty
      ? ''
      : `# ${title}\n\n> DEMO FIXTURE — This text is an illustrative example, not an official announcement.\n\n## What changed\n\n${index % 3 === 0 ? 'Component previews and accessibility examples make it easier to review interface changes.' : 'This example demonstrates clearer documentation and improved development feedback.'}\n\n## Documentation\n\nExamples and setup instructions have been expanded.\n\n## Compatibility\n\nCompatibility and migration requirements are not specified in this example. Check the original project documentation before upgrading.\n\n\`\`\`typescript\nconst updates = await reader.getUpdates();\nconsole.log(updates);\n\`\`\`\n`;
    const evidence = [
      {
        id: 's1',
        text: 'This example demonstrates clearer documentation and improved development feedback.',
      },
      { id: 's2', text: 'Examples and setup instructions have been expanded.' },
      {
        id: 's3',
        text: 'Compatibility and migration requirements are not specified in this example.',
      },
    ];
    const summary: Summary = {
      headline: title,
      overview,
      changes: changes.map((text, i) => ({ text, evidenceIds: [`s${i + 1}`] })),
      impact: {
        text: '如果你正在使用这个项目，可以先查看示例与文档，再判断是否需要跟进。',
        kind: 'inferred',
      },
      breakingChange: 'unknown',
      migrationNote: null,
      evidence,
    };
    return {
      id: `demo-item-${index}`,
      sourceId,
      externalId: `demo-${index}`,
      type,
      repo,
      author: repo.split('/')[0],
      title,
      description: overview,
      url: `https://github.com/${repo}${type === 'release' ? '/releases' : ''}`,
      publishedAt,
      firstSeenAt: publishedAt,
      body,
      contentHash: createHash('sha256').update(body).digest('hex'),
      language: 'en',
      tags: [tag],
      color,
      demo: true,
      backfill: index > 20,
      summary: empty || index === 18 ? null : summary,
      aiStatus: empty ? 'insufficient' : index === 18 ? 'failed' : 'ready',
      aiError: index === 18 ? '演示：模型暂时不可用，原文仍可阅读。' : undefined,
      translation: null,
      read: index > 6,
      saved: index === 10 || index === 3,
      muted: false,
      priority: index % 6 < 3,
    } satisfies FeedItem;
  });
  return { items, subscriptions };
}

export function demoTranslation(item: FeedItem) {
  return `# ${item.title}\n\n> 演示译文：预先编写的体验样本，不是实时 AI 输出，也不是官方发布记录。\n\n## 变化概述\n\n${item.description}\n\n## 文档\n\n示例和配置说明得到了补充。\n\n## 兼容性\n\n示例没有说明兼容性和迁移要求。升级前请核对项目的官方文档。\n\n\`\`\`typescript\nconst updates = await reader.getUpdates();\nconsole.log(updates);\n\`\`\``;
}
