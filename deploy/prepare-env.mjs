import { randomBytes } from 'node:crypto';
import { writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [site, allowed] = process.argv.slice(2);
let domain;
try {
  const url = new URL(site);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname)
  )
    throw new Error();
  domain = url.hostname;
  if (!allowed || !allowed.split(',').every((id) => /^\d+$/.test(id))) throw new Error();
} catch {
  console.error(
    'Usage: node deploy/prepare-env.mjs https://your-domain.example github_numeric_id[,another_id]',
  );
  process.exit(1);
}
const target = new URL('./server.env', import.meta.url);
const contents = `# Private runtime configuration. Do not commit or share this file.
APP_DOMAIN=${domain}
DATABASE_RUNTIME=docker
POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}
DATABASE_PASSWORD=${randomBytes(32).toString('hex')}
BETTER_AUTH_SECRET=${randomBytes(48).toString('hex')}
ALLOWED_GITHUB_USER_IDS=${allowed}
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_READ_TOKEN=
LOCAL_SKILLS_ENABLED=false
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_API_KEY=
LLM_ENABLED=false
LLM_API_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
LLM_PERSONAL_ALLOWED_BASE_URLS=
LLM_INPUT_USD_PER_MILLION=0
LLM_OUTPUT_USD_PER_MILLION=0
LLM_DAILY_BUDGET_USD=0.5
LLM_MONTHLY_BUDGET_USD=5
LLM_GLOBAL_DAILY_BUDGET_USD=5
LLM_GLOBAL_MONTHLY_BUDGET_USD=50
API_READ_LIMIT_PER_MINUTE=600
API_WRITE_LIMIT_PER_MINUTE=60
API_EXTERNAL_LIMIT_PER_MINUTE=30
API_AI_LIMIT_PER_MINUTE=10
SYNC_REPO_INTERVAL_MINUTES=15
SYNC_AUTHOR_INTERVAL_MINUTES=30
SYNC_STAR_INTERVAL_MINUTES=5
SYNC_YOUTUBE_INTERVAL_MINUTES=180
BACKUP_RETENTION_DAYS=7
LOG_LEVEL=info
`;
try {
  await writeFile(target, contents, { flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(target, 0o600);
  console.log(
    `Created ${fileURLToPath(target)}. Fill OAuth credentials locally; secrets were not printed.`,
  );
} catch (error) {
  if (error?.code === 'EEXIST')
    console.error('Configuration already exists; it was not overwritten or rotated.');
  else console.error('Unable to write private configuration.');
  process.exitCode = 1;
}
