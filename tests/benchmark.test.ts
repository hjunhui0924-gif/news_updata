import { expect, it } from 'vitest';
import { benchmark, summarize } from '../scripts/benchmarks/statistics';

it('reports nearest-rank percentiles without changing the original samples', () => {
  const samples = Array.from({ length: 30 }, (_, index) => 30 - index);
  expect(summarize(samples)).toMatchObject({ sampleCount: 30, medianMs: 15, p95Ms: 29 });
  expect(samples[0]).toBe(30);
  expect(() => summarize([])).toThrow();
  expect(() => summarize([NaN])).toThrow();
});

it('keeps independent rounds and excludes every warmup from reported samples', async () => {
  let calls = 0;
  const result = await benchmark(
    async () => {
      calls++;
    },
    { samples: 30, rounds: 3, warmup: 2 },
  );
  expect(calls).toBe(96);
  expect(result.sampleCount).toBe(90);
  expect(result.rounds).toHaveLength(3);
  expect(result.rounds.every((round) => round.samplesMs.length === 30)).toBe(true);
});
