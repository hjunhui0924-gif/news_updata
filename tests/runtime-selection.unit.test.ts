import { afterAll, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const temporary = await mkdtemp(join(tmpdir(), 'news-runtime-selection-'));
afterAll(() => rm(temporary, { recursive: true, force: true }));

async function setup(folder: string) {
  const directory = join(temporary, folder);
  await mkdir(directory, { recursive: true });
  for (const file of ['prepare-runtime-env.mjs', 'prepare-env.mjs', 'prepare-native-env.mjs'])
    await copyFile(`deploy/${file}`, join(directory, file));
  return {
    directory,
    run: (args: string[], appRuntime?: string) => {
      const env = { ...process.env };
      delete env.APP_RUNTIME;
      if (appRuntime !== undefined) env.APP_RUNTIME = appRuntime;
      return spawnSync(process.execPath, [join(directory, 'prepare-runtime-env.mjs'), ...args], {
        encoding: 'utf8',
        windowsHide: true,
        env,
      });
    },
  };
}

it('selects the native generator explicitly without requiring Docker or changing defaults', async () => {
  const native = await setup('native');
  expect(native.run(['--runtime', 'native', '--preview'], 'docker').status).toBe(0);
  expect(parseEnv(await readFile(join(native.directory, 'native.env'), 'utf8'))).toMatchObject({
    APP_RUNTIME: 'native',
    DATABASE_RUNTIME: 'native',
  });
  expect(native.run(['--runtime', 'native', '--preview']).status).toBe(1);
});

it('uses APP_RUNTIME when provided and retains legacy server:init Docker arguments otherwise', async () => {
  const native = await setup('environment');
  expect(native.run(['--preview'], 'native').status).toBe(0);
  const docker = await setup('legacy');
  expect(docker.run(['https://news.example.test', '123']).status).toBe(0);
  expect(parseEnv(await readFile(join(docker.directory, 'server.env'), 'utf8'))).toMatchObject({
    APP_RUNTIME: 'docker',
    DATABASE_RUNTIME: 'docker',
  });
});

it('rejects unknown or duplicate targets without generating configuration', async () => {
  const generated = await setup('invalid');
  for (const args of [
    ['--runtime'],
    ['--runtime', 'invalid'],
    ['--runtime', 'native', '--runtime', 'docker'],
  ])
    expect(generated.run(args).status).toBe(1);
  await expect(readFile(join(generated.directory, 'native.env'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(readFile(join(generated.directory, 'server.env'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('blocks a Docker application configuration before systemd touches services or the database', () => {
  const result = spawnSync(process.execPath, ['deploy/native-run.mjs', 'migrate'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, APP_MODE: 'live', APP_RUNTIME: 'docker', DATABASE_RUNTIME: 'native' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('APP_RUNTIME=native');
});
