import { expect, it, vi } from 'vitest';
import {
  assertDrillTarget,
  diagnosticErrorCode,
  localDatabaseTarget,
  cleanupMaintenanceResources,
  assertE2eDatabase,
} from '../scripts/lib/database-safety';

it('limits maintenance to local databases with safe identifiers', () => {
  expect(localDatabaseTarget('postgresql://news:secret@127.0.0.1:54329/news').database).toBe(
    'news',
  );
  for (const value of [
    undefined,
    'https://localhost/db',
    'postgres://u:p@example.com/db',
    'postgres://u:p@localhost/a%22b',
    'postgres://-u:p@localhost/news',
    'postgres://news:p@127.0.0.1:54329/news?host=remote.example',
    'postgres://news:p@127.0.0.1:54329/news?database=other',
    'postgres://news:p@localhost/news#ignored',
  ])
    expect(() => localDatabaseTarget(value)).toThrow();
});
it('refuses source database and arbitrary cleanup targets', () => {
  const own = 'news_restore_drill_20261104000000_abcdef12';
  expect(() => assertDrillTarget('news', own)).not.toThrow();
  for (const target of ['news', 'news_test', 'news_restore_drill_abc', own + ';DROP'])
    expect(() => assertDrillTarget('news', target)).toThrow();
  expect(() => assertDrillTarget(own, own)).toThrow();
});

it('only permits resetting a dedicated E2E database, never daily or unit-test databases', () => {
  expect(() => assertE2eDatabase('news_e2e_test')).not.toThrow();
  for (const database of ['news', 'news_test', 'news_e2e_test;', 'news_e2e_test\n'])
    expect(() => assertE2eDatabase(database)).toThrow();
});
it('diagnostics expose a safe code and never driver messages or credentials', () => {
  expect(diagnosticErrorCode({ code: 'ECONNREFUSED', message: 'secret' })).toBe('ECONNREFUSED');
  expect(diagnosticErrorCode({ code: 'postgresql://user:secret@host' })).toBe('UNAVAILABLE');
  expect(diagnosticErrorCode(new Error('private'))).toBe('UNAVAILABLE');
});

it('attempts dump cleanup even if dropping an uncertain-created database fails', async () => {
  const drop = vi.fn().mockRejectedValue(new Error('Docker disconnected'));
  const remove = vi.fn().mockResolvedValue('');
  expect(await cleanupMaintenanceResources(drop, remove)).toBe(false);
  expect(drop).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
});

it('reports failed dump cleanup and supports backups with no owned database', async () => {
  const drop = vi.fn().mockResolvedValue('');
  const remove = vi.fn().mockRejectedValue(new Error('Docker unavailable'));
  expect(await cleanupMaintenanceResources(drop, remove)).toBe(false);
  expect(drop).toHaveBeenCalledOnce();
  expect(await cleanupMaintenanceResources(undefined, async () => {})).toBe(true);
});
