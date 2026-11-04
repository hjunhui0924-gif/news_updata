export function localDatabaseTarget(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value || '');
  } catch {
    throw new Error('DATABASE_URL 无效。');
  }
  if (
    url.search ||
    url.hash ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('维护脚本只支持本机 Compose PostgreSQL。');
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  if (
    database !== database.trim() ||
    username !== username.trim() ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(database) ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(username)
  )
    throw new Error('数据库或角色名称不符合本地维护规则。');
  return { url, database, username, port: Number(url.port || 5432) };
}

export function assertDrillTarget(source: string, target: string) {
  if (
    source === target ||
    target !== target.trim() ||
    !/^news_restore_drill_\d{14}_[a-f0-9]{8}$/.test(target)
  )
    throw new Error('拒绝操作非本轮生成的隔离恢复库。');
}

export function assertE2eDatabase(database: string) {
  if (database !== database.trim() || !/^[a-z0-9_]+_e2e_test$/.test(database))
    throw new Error('E2E requires a dedicated *_e2e_test database');
}

export async function cleanupMaintenanceResources(
  dropDatabase: (() => Promise<unknown>) | undefined,
  removeDump: () => Promise<unknown>,
) {
  const results = await Promise.allSettled([
    ...(dropDatabase ? [Promise.resolve().then(dropDatabase)] : []),
    Promise.resolve().then(removeDump),
  ]);
  return results.every((result) => result.status === 'fulfilled');
}

export function diagnosticErrorCode(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  return typeof code === 'string' && /^[A-Z0-9_]{2,30}$/.test(code) ? code : 'UNAVAILABLE';
}
