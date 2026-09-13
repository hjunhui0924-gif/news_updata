import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn(), mark: vi.fn(), request: vi.fn() }));
vi.mock('../src/server/connectors/github-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/connectors/github-auth')>()),
  githubReadToken: mocks.token,
  markGitHubRejected: mocks.mark,
}));
vi.mock('../src/server/connectors/github', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/connectors/github')>()),
  createGitHubTransport: (_signal: unknown, token: string) => (path: string) =>
    mocks.request(token, path),
}));
import { createUserGitHubConnector } from '../src/server/connectors/github-user';
import { GitHubError } from '../src/server/connectors/github';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GITHUB_READ_TOKEN', '');
});
it('late concurrent 401 uses the token actually sent, not a sibling request replacement', async () => {
  let rejectOld: (error: Error) => void = () => {};
  const late = new Promise((_, reject) => {
    rejectOld = reject;
  });
  mocks.token.mockResolvedValueOnce('old').mockResolvedValue('new');
  mocks.request.mockImplementation(async (token: string, path: string) => {
    if (token === 'old' && path.includes('second')) return late;
    if (token === 'old') throw new GitHubError('invalid', 401);
    return { data: { id: 1, login: 'person', type: 'User' }, hasNext: false };
  });
  const connector = await createUserGitHubConnector('user');
  const second = connector.resolve('author', 'second');
  await connector.resolve('author', 'first');
  rejectOld(new GitHubError('invalid', 401));
  await second;
  expect(mocks.token.mock.calls.slice(1).map((call) => call[1].rejectedToken)).toEqual([
    'old',
    'old',
  ]);
  expect(mocks.mark).not.toHaveBeenCalled();
});
it('a failed retry marks only its sent token even after another request rotates again', async () => {
  let rejectRetry: (error: Error) => void = () => {};
  let started: () => void = () => {};
  const retryStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const late = new Promise((_, reject) => {
    rejectRetry = reject;
  });
  mocks.token
    .mockResolvedValueOnce('old')
    .mockResolvedValueOnce('new1')
    .mockResolvedValueOnce('new2');
  mocks.request.mockImplementation(async (token: string, path: string) => {
    if (token === 'new1' && path.includes('first')) {
      started();
      return late;
    }
    if (token !== 'new2') throw new GitHubError('invalid', 401);
    return { data: { id: 1, login: 'person', type: 'User' }, hasNext: false };
  });
  const connector = await createUserGitHubConnector('user');
  const first = connector.resolve('author', 'first').catch((error) => error);
  await retryStarted;
  await connector.resolve('author', 'second');
  rejectRetry(new GitHubError('invalid', 401));
  expect(await first).toMatchObject({ state: 'reconnect_required' });
  expect(mocks.mark).toHaveBeenCalledWith('user', 'new1');
});

it('configured token rejection keeps subscription preferences and requests config repair', async () => {
  vi.stubEnv('GITHUB_READ_TOKEN', 'configured-token');
  mocks.token.mockResolvedValue('configured-token');
  mocks.request.mockRejectedValue(new GitHubError('invalid', 401));
  const connector = await createUserGitHubConnector('user');
  await expect(connector.resolve('author', 'person')).rejects.toMatchObject({
    status: 503,
    state: 'configuration_error',
  });
  expect(mocks.token).toHaveBeenCalledTimes(1);
  expect(mocks.mark).toHaveBeenCalledWith('user', 'configured-token');
});
