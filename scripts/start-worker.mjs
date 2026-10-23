import { loadEnvFile } from 'node:process';

for (const file of ['.env.local', '.env']) {
  try {
    loadEnvFile(file);
  } catch {
    // Production deployments may inject the environment through systemd/Docker.
  }
}

// Match Next start: production startup must enforce the live-mode configuration boundary.
process.env.NODE_ENV = 'production';
await import('../dist/worker/main.js');
