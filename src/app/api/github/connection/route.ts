import { api } from '@/server/http';
import { createUserGitHubConnector } from '@/server/connectors/github-user';
import { getGitHubAuthStatus, GitHubAuthError } from '@/server/connectors/github-auth';
import { getPool } from '@/server/db/client';
export const POST = (request: Request) =>
  api(request, async (viewer) => {
    try {
      const connector = await createUserGitHubConnector(viewer.id, request.signal);
      const { rows } = await getPool().query(
        'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=\'github\'',
        [viewer.id],
      );
      if (rows[0]) await connector.usernameById(rows[0].accountId);
    } catch (error) {
      if (!(error instanceof GitHubAuthError)) throw error;
    }
    return getGitHubAuthStatus(viewer.id);
  });
