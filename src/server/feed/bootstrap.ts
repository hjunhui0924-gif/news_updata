import { getConfig } from '../config';
import { getPool } from '../db/client';
import { getItems, getJobs, getNotifications, getPreferences, getSubscriptions } from '../db/store';
import type { Bootstrap } from '@/shared/types';
import { getStarSync } from '../subscriptions/star-sync';
import { itemSourceIds } from '@/shared/feed';
import { getGitHubAuthStatus } from '../connectors/github-auth';

export async function bootstrap(user: {
  id: string;
  name: string;
  image?: string | null;
}): Promise<Bootstrap> {
  const config = getConfig();
  const [items, subscriptions, preferences, jobs, notifications, heartbeat, usage, githubAccount] =
    await Promise.all([
      getItems(user.id),
      getSubscriptions(user.id),
      getPreferences(user.id),
      getJobs(user.id),
      getNotifications(user.id),
      getPool().query("SELECT value FROM system_state WHERE key='worker-heartbeat'"),
      getPool().query(
        "SELECT coalesce(sum(cost),0) cost FROM ai_usage WHERE user_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [user.id],
      ),
      getGitHubAuthStatus(user.id),
    ]);
  const currentSubscriptions = new Map(subscriptions.map((sub) => [sub.id, sub]));
  return {
    mode: config.APP_MODE,
    user: { name: user.name, image: user.image },
    items: items.map((item) => ({
      ...item,
      priority: itemSourceIds(item).some((id) => currentSubscriptions.get(id)?.priority),
      matchedSources: itemSourceIds(item).flatMap((id) => {
        const sub = currentSubscriptions.get(id);
        return sub ? [{ id, kind: sub.kind, name: sub.name }] : [];
      }),
    })),
    subscriptions,
    preferences,
    jobs,
    starSync: await getStarSync(user.id),
    notifications,
    services: {
      github: ['connected', 'configured', 'refresh_pending'].includes(githubAccount.state),
      githubAuth: githubAccount,
      ai: config.LLM_ENABLED === 'true',
      workerLastSeen: heartbeat.rows[0]?.value ?? null,
      workerOnline:
        !!heartbeat.rows[0]?.value && Date.now() - Date.parse(heartbeat.rows[0].value) < 60000,
      costToday: Number(usage.rows[0].cost),
    },
  };
}
