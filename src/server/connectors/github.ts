import { Octokit } from '@octokit/rest';
import { z } from 'zod';
import { getConfig } from '../config';

export class GitHubError extends Error {
  constructor(
    message: string,
    public status = 502,
    public retryAfter = 60,
  ) {
    super(message);
  }
}
export type GitHubTransport = (
  path: string,
  etag?: string,
) => Promise<{ data: unknown; etag?: string; hasNext: boolean; notModified?: boolean }>;
export const repositorySearchSchema = z
  .object({
    query: z.string().trim().min(1, '请输入项目关键词').max(200),
    page: z.number().int().min(1).max(50).default(1),
    sort: z.enum(['relevance', 'stars', 'updated']).default('relevance'),
  })
  .strict();
const id = z.union([z.number().int().safe(), z.string()]).transform(String);
const userSchema = z.object({
  id,
  login: z.string(),
  type: z.string().optional(),
  bio: z.string().nullable().optional(),
});
const repoSchema = z.object({
  id,
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  html_url: z.url(),
  created_at: z.string(),
  fork: z.boolean(),
  private: z.boolean().optional(),
  owner: userSchema,
});
const releaseSchema = z.object({
  id,
  name: z.string().nullable(),
  tag_name: z.string(),
  body: z.string().nullable(),
  html_url: z.url(),
  published_at: z.string().nullable(),
  created_at: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  updated_at: z.string().optional(),
  author: userSchema.optional(),
});
export type GitHubUpdate = {
  externalId: string;
  type: 'release' | 'new_repo';
  repo: string;
  author: string;
  title: string;
  body: string;
  description: string;
  url: string;
  contentUrl?: string;
  publishedAt: string;
  sourceUpdatedAt?: string;
};

export function parseSourceInput(input: string, kind: 'repo' | 'author') {
  let value = input.trim().replace(/\/$/, '');
  if (value.startsWith('https://')) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new GitHubError('请输入有效的 GitHub 地址', 400);
    }
    if (
      url.hostname !== 'github.com' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    )
      throw new GitHubError('仅支持 github.com 的公开账号或仓库地址', 400);
    value = url.pathname.slice(1);
  }
  const valid =
    kind === 'repo'
      ? /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/
      : /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  if (!valid.test(value) || value.endsWith('/..') || value.endsWith('/.'))
    throw new GitHubError(
      kind === 'repo' ? '请输入 owner/repo 格式的仓库路径' : '请输入有效的 GitHub 用户名',
      400,
    );
  return value;
}

export function createGitHubTransport(signal?: AbortSignal, accessToken?: string): GitHubTransport {
  const octokit = new Octokit({
    auth: accessToken || getConfig().GITHUB_READ_TOKEN || undefined,
    userAgent: 'newsroom-mvp',
    request: { timeout: 20000 },
  });
  return async (path, etag) => {
    signal?.throwIfAborted();
    try {
      const response = await octokit.request(`GET ${path}`, {
        request: { signal },
        headers: {
          accept: 'application/vnd.github+json',
          ...(etag ? { 'if-none-match': etag } : {}),
        },
      });
      return {
        data: response.data,
        etag: response.headers.etag,
        hasNext: (response.headers.link ?? '').includes('rel="next"'),
      };
    } catch (error) {
      signal?.throwIfAborted();
      const detail = error as { status?: number; response?: { headers?: Record<string, string> } };
      if (detail.status === 304) return { data: null, hasNext: false, notModified: true, etag };
      if (detail.status === 404)
        throw new GitHubError('来源不存在或不可公开访问，请检查名称。', 404);
      if (detail.status === 401)
        throw new GitHubError('GitHub 凭据无效，请更新服务端 Token。', 401);
      if (detail.status === 403 || detail.status === 429) {
        const h = detail.response?.headers ?? {};
        const delay = Math.max(
          60,
          Number(h['retry-after']) || Number(h['x-ratelimit-reset']) * 1 - Date.now() / 1000 || 60,
        );
        throw new GitHubError(
          'GitHub 暂时限制请求，请稍后重试或配置访问 Token。',
          429,
          Math.min(delay, 86400),
        );
      }
      throw new GitHubError('暂时无法连接 GitHub，已有内容仍可阅读。');
    }
  };
}

export class GitHubConnector {
  constructor(private request: GitHubTransport = createGitHubTransport()) {}
  async searchRepositories(input: unknown) {
    const { query, page, sort } = repositorySearchSchema.parse(input);
    const params = new URLSearchParams({
      q: `${query} is:public`,
      per_page: '20',
      page: String(page),
    });
    if (sort !== 'relevance') {
      params.set('sort', sort);
      params.set('order', 'desc');
    }
    const response = await this.request(`/search/repositories?${params}`);
    const result = z
      .object({
        total_count: z.number().int().nonnegative(),
        incomplete_results: z.boolean(),
        items: z.array(
          repoSchema.extend({
            private: z.boolean(),
            stargazers_count: z.number().int().nonnegative(),
            language: z.string().nullable(),
            updated_at: z.string(),
            archived: z.boolean(),
          }),
        ),
      })
      .parse(response.data);
    return {
      query,
      page,
      totalCount: result.total_count,
      incomplete: result.incomplete_results,
      nextPage: response.hasNext && page < 50 && page * 20 < result.total_count ? page + 1 : null,
      repositories: result.items
        .filter((repo) => !repo.private)
        .map((repo) => ({
          id: repo.id,
          name: repo.full_name,
          description: repo.description ?? '',
          url: `https://github.com/${parseSourceInput(repo.full_name, 'repo')}`,
          stars: repo.stargazers_count,
          language: repo.language,
          updatedAt: repo.updated_at,
          archived: repo.archived,
        })),
    };
  }
  async resolve(kind: 'repo' | 'author', input: string) {
    const name = parseSourceInput(input, kind);
    const response = await this.request(kind === 'repo' ? `/repos/${name}` : `/users/${name}`);
    if (kind === 'repo') {
      const repo = repoSchema.parse(response.data);
      if (repo.private) throw new GitHubError('首版仅支持公开仓库。', 400);
      return {
        externalId: repo.id,
        name: repo.full_name,
        description: repo.description ?? '',
        url: repo.html_url,
      };
    }
    const user = userSchema.parse(response.data);
    if (user.type && user.type !== 'User')
      throw new GitHubError('请添加个人开发者账号；组织项目请直接订阅仓库。', 400);
    return {
      externalId: user.id,
      name: user.login,
      description: user.bio ?? '新建公开项目与本人发布的正式版本',
      url: `https://github.com/${user.login}`,
    };
  }
  async updates(kind: 'repo' | 'author', name: string, page: number, etag?: string) {
    parseSourceInput(name, kind);
    const path =
      kind === 'repo'
        ? `/repos/${name}/releases?per_page=100&page=${page}`
        : `/users/${name}/repos?type=owner&sort=created&direction=desc&per_page=100&page=${page}`;
    const response = await this.request(path, etag);
    if (response.notModified)
      return {
        items: [] as GitHubUpdate[],
        hasNext: false,
        notModified: true,
        etag: response.etag,
      };
    const items: GitHubUpdate[] =
      kind === 'repo'
        ? z
            .array(releaseSchema)
            .parse(response.data)
            .filter((x) => !x.draft && !x.prerelease)
            .map((release) => ({
              externalId: release.id,
              type: 'release',
              repo: name,
              author: release.author?.login ?? name.split('/')[0],
              title: release.name || release.tag_name,
              body: release.body ?? '',
              description: '',
              url: release.html_url,
              publishedAt: release.published_at ?? release.created_at,
              sourceUpdatedAt: release.updated_at,
            }))
        : z
            .array(repoSchema)
            .parse(response.data)
            .filter(
              (repo) =>
                !repo.fork &&
                !repo.private &&
                repo.owner.login.toLowerCase() === name.toLowerCase(),
            )
            .map((repo) => ({
              externalId: repo.id,
              type: 'new_repo',
              repo: repo.full_name,
              author: repo.owner.login,
              title: repo.name,
              body: '',
              description: repo.description ?? '',
              url: repo.html_url,
              contentUrl: `https://github.com/${repo.full_name}/blob/HEAD/README.md`,
              publishedAt: repo.created_at,
            }));
    return { items, hasNext: response.hasNext, notModified: false, etag: response.etag };
  }

  async authorReleases(input: string, page: number, actorId: string) {
    const name = parseSourceInput(input, 'author');
    if (!Number.isSafeInteger(page) || page < 1 || page > 3)
      throw new GitHubError('公开动态仅支持最近 300 条事件。', 400);
    const response = await this.request(`/users/${name}/events/public?per_page=100&page=${page}`);
    const events = z.array(z.object({ type: z.string() }).passthrough()).parse(response.data);
    const items: GitHubUpdate[] = [];
    const seen = new Set<string>();
    const repositories = new Map<string, z.infer<typeof repoSchema> | null>();
    for (const value of events) {
      if (value.type !== 'ReleaseEvent') continue;
      const event = z
        .object({
          public: z.boolean(),
          actor: userSchema,
          repo: z.object({ name: z.string() }),
          payload: z.object({ action: z.string(), release: z.object({ id }) }),
        })
        .parse(value);
      if (!event.public || event.actor.id !== actorId || event.payload.action !== 'published')
        continue;
      const releaseId = event.payload.release.id;
      if (!/^\d+$/.test(releaseId)) throw new GitHubError('版本标识格式异常。');
      const repoName = parseSourceInput(event.repo.name, 'repo');
      if (seen.has(releaseId)) continue;
      seen.add(releaseId);
      try {
        if (!repositories.has(repoName)) {
          const repo = repoSchema.parse((await this.request(`/repos/${repoName}`)).data);
          repositories.set(repoName, repo.private ? null : repo);
        }
        const repo = repositories.get(repoName);
        if (!repo) continue;
        // Event payloads are snapshots. Read canonical notes and check current publication state.
        const canonical = parseSourceInput(repo.full_name, 'repo');
        const release = releaseSchema.parse(
          (await this.request(`/repos/${canonical}/releases/${releaseId}`)).data,
        );
        if (
          release.id !== releaseId ||
          release.draft ||
          release.prerelease ||
          !release.published_at
        )
          continue;
        items.push({
          externalId: release.id,
          type: 'release',
          repo: canonical,
          author: release.author?.login ?? event.actor.login,
          title: release.name || release.tag_name,
          body: release.body ?? '',
          description: '',
          url: release.html_url,
          publishedAt: release.published_at,
          sourceUpdatedAt: release.updated_at,
        });
      } catch (error) {
        // Deleted/inaccessible event targets do not mean the followed person is inaccessible.
        if (error instanceof GitHubError && error.status === 404) continue;
        throw error;
      }
    }
    return {
      items,
      hasNext: response.hasNext && page < 3,
      windowCapped: page === 3 && events.length === 100,
    };
  }
  async readme(repo: string) {
    try {
      const response = await this.request(`/repos/${parseSourceInput(repo, 'repo')}/readme`);
      const file = z
        .object({ content: z.string(), encoding: z.literal('base64') })
        .parse(response.data);
      return Buffer.from(file.content, 'base64').toString('utf8').slice(0, 60000);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return '';
      throw error;
    }
  }
  async repositoryTree(repo: string) {
    const name = parseSourceInput(repo, 'repo');
    const repository = z
      .object({ default_branch: z.string().min(1) })
      .parse((await this.request(`/repos/${name}`)).data);
    const branch = encodeURIComponent(repository.default_branch);
    const response = await this.request(`/repos/${name}/git/trees/${branch}?recursive=1`);
    const tree = z
      .object({
        truncated: z.boolean(),
        tree: z.array(z.object({ path: z.string(), type: z.string() })),
      })
      .parse(response.data);
    return { branch: repository.default_branch, truncated: tree.truncated, tree: tree.tree };
  }
  async readFile(repo: string, filePath: string) {
    const name = parseSourceInput(repo, 'repo');
    if (
      !filePath ||
      filePath.startsWith('/') ||
      filePath.includes('\\') ||
      filePath.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new GitHubError('Skill 文件路径无效', 400);
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    try {
      const response = await this.request(`/repos/${name}/contents/${encodedPath}`);
      const file = z
        .object({ type: z.literal('file'), content: z.string(), encoding: z.literal('base64') })
        .parse(response.data);
      return Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return null;
      throw error;
    }
  }
  async following(input: string, page = 1) {
    const name = parseSourceInput(input, 'author');
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      throw new GitHubError('分页参数无效', 400);
    const response = await this.request(`/users/${name}/following?per_page=50&page=${page}`);
    const nextPage = response.hasNext && page < 10000 ? page + 1 : null;
    return {
      users: z
        .array(userSchema)
        .parse(response.data)
        .map((x) => ({ login: x.login, id: x.id })),
      page,
      nextPage,
      truncated: nextPage !== null,
    };
  }
  async usernameById(accountId: string) {
    if (!/^\d+$/.test(accountId)) throw new GitHubError('GitHub 账号 ID 无效', 400);
    const response = await this.request(`/user/${accountId}`);
    return userSchema.parse(response.data).login;
  }
  async starred(input: string, page = 1) {
    const name = parseSourceInput(input, 'author');
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      throw new GitHubError('分页参数无效', 400);
    const response = await this.request(
      `/users/${name}/starred?sort=created&direction=desc&per_page=50&page=${page}`,
    );
    const repositories = z
      .array(repoSchema)
      .parse(response.data)
      .filter((repo) => !repo.private);
    return {
      repositories: [
        ...new Map(
          repositories.map((repo) => [
            repo.id,
            {
              id: repo.id,
              name: repo.full_name,
              description: repo.description ?? '',
              url: repo.html_url,
            },
          ]),
        ).values(),
      ],
      nextPage: response.hasNext ? page + 1 : null,
    };
  }
}
