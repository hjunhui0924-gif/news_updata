// Start the Next.js standalone server produced by `pnpm build`.
// Keep local development convenient while allowing production process managers
// to provide environment variables directly instead of requiring .env.local.
import { loadEnvFile } from 'node:process';

for (const file of ['.env.local', '.env']) {
  try {
    loadEnvFile(file);
  } catch {
    // Production deployments may inject the environment through systemd/Docker.
  }
}

process.env.NODE_ENV = 'production';
// Do not inherit a machine/container HOSTNAME and accidentally bind publicly.
// Set APP_HOSTNAME=0.0.0.0 explicitly when running behind a container proxy.
process.env.HOSTNAME = process.env.APP_HOSTNAME ?? '127.0.0.1';
await import('../.next/standalone/server.js');
