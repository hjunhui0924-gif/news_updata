import { afterAll, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { nativeServices } from '../deploy/native-services.mjs';
import { getConfig } from '../src/server/config';

const temporary = await mkdtemp(join(tmpdir(), 'news-native-env-'));
afterAll(() => rm(temporary, { recursive: true, force: true }));

async function generate(folder: string, args: string[]) {
  const directory = join(temporary, folder);
  await mkdir(directory, { recursive: true });
  const script = join(directory, 'prepare-native-env.mjs');
  await copyFile('deploy/prepare-native-env.mjs', script);
  return {
    directory,
    run: () =>
      spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true }),
  };
}

it('generates a valid native guest preview without OAuth, sample content or printed secrets', async () => {
  const generated = await generate('preview', ['--preview']);
  const result = generated.run();
  expect(result.status).toBe(0);
  const before = await readFile(join(generated.directory, 'native.env'), 'utf8');
  const env = parseEnv(before);
  expect(getConfig(env).DATABASE_RUNTIME).toBe('native');
  expect(env).toMatchObject({
    APP_MODE: 'live',
    APP_RUNTIME: 'native',
    APP_HOSTNAME: '0.0.0.0',
    PORT: '8003',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    LOCAL_SKILLS_ENABLED: 'false',
    LLM_ENABLED: 'false',
  });
  const database = new URL(env.DATABASE_URL || '');
  expect(database.hostname).toBe('127.0.0.1');
  for (const value of [env.BETTER_AUTH_SECRET, database.password]) {
    expect(result.stdout + result.stderr).not.toContain(value);
  }
  expect(generated.run().status).toBe(1);
  expect(await readFile(join(generated.directory, 'native.env'), 'utf8')).toBe(before);
});

it('generates HTTPS configuration for real OAuth without changing production validation', async () => {
  const generated = await generate('https', ['https://news.example.test', '123,456']);
  expect(generated.run().status).toBe(0);
  const env = parseEnv(await readFile(join(generated.directory, 'native.env'), 'utf8'));
  expect(env.APP_HOSTNAME).toBe('127.0.0.1');
  expect(() => getConfig(env)).toThrow('GitHub OAuth');
  expect(
    getConfig({ ...env, GITHUB_CLIENT_ID: 'test', GITHUB_CLIENT_SECRET: 'test' }).APP_URL,
  ).toBe('https://news.example.test');
});

it('rejects invalid configuration and systemd expansions before generating units', async () => {
  const generated = await generate('invalid', ['http://public.example.test', '123']);
  expect(generated.run().status).toBe(1);
  for (const project of ['/tmp/a\nExecStart=/evil', '/home/%u/app', '/home/a b', '/tmp/../root'])
    expect(() => nativeServices(project, 'admin', '/opt/node24/bin/node')).toThrow();
  expect(() =>
    nativeServices('/home/admin/projects/news_updata', 'root', '/usr/bin/node'),
  ).toThrow();
});

it('orders both application services after migration, injects a private environment, and runs readiness checks', () => {
  const units = nativeServices(
    '/home/admin/projects/news_updata',
    'admin',
    '/opt/newsroom-node24/bin/node',
  );
  for (const name of ['web', 'worker']) {
    const unit = units[`newsroom-${name}.service`];
    expect(unit).toContain('Requires=postgresql.service newsroom-migrate.service');
    expect(unit).toContain('EnvironmentFile=/etc/newsroom/runtime.env');
    expect(unit).toContain(`native-run.mjs check-${name}`);
    expect(unit).toContain('User=admin');
    expect(unit).toContain('Restart=on-failure');
  }
  expect(units['newsroom-migrate.service']).toContain('Type=oneshot');
  expect(units['newsroom-migrate.service']).toContain('RemainAfterExit=yes');
});

it('probes the configured native Web port and fails when readiness is unavailable', async () => {
  let ready = true;
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ready }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const options = {
      env: { ...process.env, PORT: String(address.port) },
      timeout: 10000,
      windowsHide: true,
    };
    const exec = promisify(execFile);
    await expect(
      exec(process.execPath, ['deploy/healthcheck.mjs', 'web'], options),
    ).resolves.toMatchObject({ stdout: '' });
    ready = false;
    await expect(
      exec(process.execPath, ['deploy/healthcheck.mjs', 'web'], options),
    ).rejects.toMatchObject({ code: 1 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
