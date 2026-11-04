export function summarize(samplesMs: readonly number[]) {
  if (!samplesMs.length || samplesMs.some((sample) => !Number.isFinite(sample) || sample < 0))
    throw new Error('Benchmark samples must be nonempty finite durations.');
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const rank = (fraction: number) =>
    Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));
  return {
    sampleCount: sorted.length,
    medianMs: rank(0.5),
    p95Ms: rank(0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1)!,
  };
}

export async function benchmark(
  run: () => Promise<unknown>,
  options = { samples: 30, rounds: 3, warmup: 2 },
) {
  if (
    Object.values(options).some((n) => !Number.isInteger(n) || n < 0) ||
    !options.samples ||
    !options.rounds
  )
    throw new Error('Invalid benchmark sampling options.');
  const rounds = [];
  for (let round = 0; round < options.rounds; round++) {
    for (let n = 0; n < options.warmup; n++) await run();
    const samplesMs = [];
    for (let n = 0; n < options.samples; n++) {
      const start = performance.now();
      await run();
      samplesMs.push(performance.now() - start);
    }
    rounds.push({ ...summarize(samplesMs), samplesMs });
  }
  return { ...summarize(rounds.flatMap((round) => round.samplesMs)), rounds };
}
