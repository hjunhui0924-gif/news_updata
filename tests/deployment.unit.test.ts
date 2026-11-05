import { afterAll, expect, it } from 'vitest';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'newsroom-env-check-'));
const script = join(temporary, 'prepare-env.mjs');
await copyFile('deploy/prepare-env.mjs', script);
afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});
const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });

it('rejects invalid origins and admission before writing a configuration', () => {
  for (const args of [
    [],
    ['http://news.example.test', '123'],
    ['https://news.example.test/path', '123'],
    ['https://news.example.test', '*'],
  ])
    expect(run(...args).status).toBe(1);
});
it('generates separate secrets without printing them and never rotates an existing configuration', async () => {
  const result = run('https://news.example.test', '123,456');
  expect(result.status).toBe(0);
  const before = await readFile(join(temporary, 'server.env'), 'utf8');
  const values = Object.fromEntries(
    before
      .split('\n')
      .filter((s) => s.includes('='))
      .map((s) => s.split('=')),
  );
  for (const key of ['POSTGRES_PASSWORD', 'DATABASE_PASSWORD', 'BETTER_AUTH_SECRET']) {
    expect(values[key]).toMatch(/^[a-f0-9]{64,96}$/);
    expect(result.stdout + result.stderr).not.toContain(values[key]);
  }
  expect(values.POSTGRES_PASSWORD).not.toBe(values.DATABASE_PASSWORD);
  expect(run('https://other.example.test', '999').status).toBe(1);
  expect(await readFile(join(temporary, 'server.env'), 'utf8')).toBe(before);
});
