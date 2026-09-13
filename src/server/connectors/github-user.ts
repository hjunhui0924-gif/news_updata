import { getConfig } from '../config';
import { GitHubConnector, GitHubError, createGitHubTransport } from './github';
import { githubReadToken, GitHubAuthError, markGitHubRejected } from './github-auth';
export { githubReadToken } from './github-auth';

export async function createUserGitHubConnector(userId: string, signal?: AbortSignal) {
  let token = await githubReadToken(userId, { signal });
  return new GitHubConnector(async (path, etag) => {
    const sentToken = token;
    try {
      return await createGitHubTransport(signal, sentToken)(path, etag);
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 401 || !sentToken) throw error;
      if (getConfig().GITHUB_READ_TOKEN) {
        await markGitHubRejected(userId, sentToken);
        throw new GitHubAuthError('configuration_error');
      }
      const retryToken = await githubReadToken(userId, { signal, rejectedToken: sentToken });
      token = retryToken;
      try {
        return await createGitHubTransport(signal, retryToken)(path, etag);
      } catch (retryError) {
        if (retryError instanceof GitHubError && retryError.status === 401) {
          await markGitHubRejected(userId, retryToken);
          throw new GitHubAuthError('reconnect_required');
        }
        throw retryError;
      }
    }
  });
}
