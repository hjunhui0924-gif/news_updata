import { getConfig } from '../config';
import { getPool } from '../db/client';
import {
  getFeedPage,
  getJobs,
  getNotifications,
  getPreferences,
  getSubscriptions,
} from '../db/store';
import type { Bootstrap } from '@/shared/types';
import { getStarSync } from '../subscriptions/star-sync';
import { itemSourceIds } from '@/shared/feed';
import { getGitHubAuthStatus } from '../connectors/github-auth';
import { workerIsOnline } from '@/shared/health';

export async function bootstrap(
  user: {
    id: string;
    name: string;
    image?: string | null;
  },
  metadataOnly = false,
): Promise<Bootstrap> {
  const config = getConfig();
  const [feed, subscriptions, preferences, jobs, notifications, heartbeat, usage, githubAccount] =
    await Promise.all([
      metadataOnly
        ? Promise.resolve(undefined)
        : getFeedPage(user.id, {
            view: 'feed',
            type: 'all',
            search: '',
            unread: false,
            source: '',
          }),
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
  const feedStats = feed ? { ...feed, items: undefined } : undefined;
  return {
    mode: config.APP_MODE,
    user: { name: user.name, image: user.image },
    items: (feed?.items ?? []).map((item) => ({
      ...item,
      priority: itemSourceIds(item).some((id) => currentSubscriptions.get(id)?.priority),
      matchedSources: itemSourceIds(item).flatMap((id) => {
        const sub = currentSubscriptions.get(id);
        return sub ? [{ id, kind: sub.kind, name: sub.name }] : [];
      }),
    })),
    feed: feedStats,
    subscriptions,
    preferences,
    jobs,
    starSync: await getStarSync(user.id),
    notifications,
    services: {
      platforms: {
        github: {
          configured: ['connected', 'configured', 'refresh_pending'].includes(githubAccount.state),
          intervalMinutes: config.SYNC_REPO_INTERVAL_MINUTES,
        },
        youtube: {
          configured: !!config.YOUTUBE_API_KEY,
          intervalMinutes: config.SYNC_YOUTUBE_INTERVAL_MINUTES,
        },
      },
      github: ['connected', 'configured', 'refresh_pending'].includes(githubAccount.state),
      githubAuth: githubAccount,
      ai: config.LLM_ENABLED === 'true',
      workerLastSeen: heartbeat.rows[0]?.value ?? null,
      workerOnline: workerIsOnline(heartbeat.rows[0]?.value),
      costToday: Number(usage.rows[0].cost),
    },
  };
}
