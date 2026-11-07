import pg from 'pg';

try {
  if (process.argv[2] === 'web') {
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (!response.ok || !data.ready) throw new Error('Web not ready');
  } else if (process.argv[2] === 'worker') {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
    });
    try {
      await client.connect();
      const { rows } = await client.query(
        "SELECT value FROM system_state WHERE key='worker-heartbeat'",
      );
      const seen = typeof rows[0]?.value === 'string' ? Date.parse(rows[0].value) : NaN;
      const age = Date.now() - seen;
      if (!Number.isFinite(age) || age < -5000 || age > 60000) throw new Error('Worker not ready');
    } finally {
      await client.end();
    }
  } else throw new Error('Unknown check');
} catch {
  console.error('Service health check failed.');
  process.exitCode = 1;
}
