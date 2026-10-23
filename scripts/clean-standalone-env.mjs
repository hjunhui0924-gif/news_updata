import { cp, rm } from 'node:fs/promises';

const distDir = process.env.STARRED_E2E === 'true' ? '.next-e2e' : '.next';
await cp(`${distDir}/static`, `${distDir}/standalone/.next/static`, {
  recursive: true,
  force: true,
});
try {
  await cp('public', `${distDir}/standalone/public`, { recursive: true, force: true });
} catch {
  // This project currently has no public directory.
}
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  await rm(`${distDir}/standalone/${name}`, { force: true });
}
