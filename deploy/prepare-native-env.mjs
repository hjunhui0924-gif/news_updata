import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [site, allowed] = process.argv.slice(2);
const preview = site === '--preview' && allowed === undefined;
let origin;
try {
  if (preview) origin = 'http://127.0.0.1:8003';
  else {
    const url = new URL(site);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !allowed ||
      !allowed.split(',').every((id) => /^\d+$/.test(id))
    )
      throw new Error();
    origin = url.origin;
  }
} catch {
  console.error(
    'Usage: node deploy/prepare-native-env.mjs --preview OR https://your-site.example github_numeric_id[,another_id]',
  );
  process.exit(1);
}

const target = new URL('./native.env', import.meta.url);
const contents = `# Private native runtime configuration; do not commit or share.
# Preview keeps login disabled and only shows an empty guest workspace.
NODE_ENV=production
APP_MODE=live
APP_RUNTIME=native
APP_URL=${origin}
APP_HOSTNAME=${preview ? '0.0.0.0' : '127.0.0.1'}
PORT=8003
NEXT_TELEMETRY_DISABLED=1
DATABASE_RUNTIME=native
DATABASE_URL=postgresql://news:${randomBytes(32).toString('hex')}@127.0.0.1:5432/news
BETTER_AUTH_SECRET=${randomBytes(48).toString('hex')}
ALLOWED_GITHUB_USER_IDS=${preview ? '0' : allowed}
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_READ_TOKEN=
LOCAL_SKILLS_ENABLED=false
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_API_KEY=
LLM_ENABLED=false
LLM_PERSONAL_ALLOWED_BASE_URLS=
LOG_LEVEL=info
`;
try {
  await writeFile(target, contents, { flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(target, 0o600);
  console.log(
    `Created ${fileURLToPath(target)}; secrets were not printed. Existing production data must keep its original auth secret.`,
  );
} catch (error) {
  console.error(
    error?.code === 'EEXIST'
      ? 'Native configuration already exists; it was not overwritten or rotated.'
      : 'Unable to write private native configuration.',
  );
  process.exitCode = 1;
}
