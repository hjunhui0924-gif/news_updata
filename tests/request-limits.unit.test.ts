import { expect, it } from 'vitest';
import { requestLimitScope } from '../src/server/request-limits';

it('keeps external lookups and paid work separate from local reading and state mutations', () => {
  for (const [method, path, scope] of [
    ['GET', '/api/feed', 'read'],
    ['PATCH', '/api/items/fixture/state', 'write'],
    ['POST', '/api/subscriptions', 'external'],
    ['GET', '/api/subscriptions', 'read'],
    ['DELETE', '/api/platforms/youtube/connection', 'external'],
    ['POST', '/api/platforms/youtube/connect', 'external'],
    ['POST', '/api/github/following/preview', 'external'],
    ['GET', '/api/github/repositories/search?q=fixture', 'external'],
    ['POST', '/api/items/fixture/translation', 'ai'],
    ['POST', '/api/items/fixture/summary/retry', 'ai'],
    ['POST', '/api/trending/translation', 'ai'],
    ['POST', '/api/skills/ai', 'ai'],
  ])
    expect(requestLimitScope(new Request(`https://app.example.test${path}`, { method }))).toBe(
      scope,
    );
});
