// Shared with plain Node workers: do not import Next request/session APIs here.
import { getConfig } from '../config';
import { getPool } from '../db/client';

export function allowedGitHubIds() {
  return [
    ...new Set(
      getConfig()
        .ALLOWED_GITHUB_USER_IDS.split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export async function userIsAllowed(userId: string) {
  if (getConfig().APP_MODE === 'demo') return true;
  const result = await getPool().query(
    `SELECT 1 FROM account WHERE "userId"=$1 AND "providerId"='github' AND "accountId"=ANY($2::text[]) LIMIT 1`,
    [userId, allowedGitHubIds()],
  );
  return !!result.rowCount;
}
