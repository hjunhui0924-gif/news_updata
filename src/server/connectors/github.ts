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
  async following(input: string) {
    const name = parseSourceInput(input, 'author');
    const response = await this.request(`/users/${name}/following?per_page=50&page=1`);
    return {
      users: z
        .array(userSchema)
        .parse(response.data)
        .map((x) => ({ login: x.login, id: x.id })),
      truncated: response.hasNext,
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
