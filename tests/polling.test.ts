import { it, expect, vi, afterEach } from 'vitest';
import { startPolling, pollDelay } from '../src/components/polling';
afterEach(() => vi.useRealTimers());
function context() {
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const window = new EventTarget();
  let online = true;
  return {
    document,
    window,
    online: () => online,
    setOnline: (value: boolean) => {
      online = value;
      window.dispatchEvent(new Event(value ? 'online' : 'offline'));
    },
  };
}
it('bounds backoff and never overlaps slow polls', async () => {
  vi.useFakeTimers();
  expect(pollDelay(true, 0)).toBe(1500);
  expect(pollDelay(false, 10)).toBe(120000);
  const env = context();
  let release!: () => void;
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const polling = startPolling({ ...env, run, active: () => true, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(1500);
  await vi.advanceTimersByTimeAsync(20000);
  expect(run).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(1500);
  expect(run).toHaveBeenCalledTimes(2);
  polling.stop();
});
it('pauses and aborts when hidden/offline and resumes once when visible/online', async () => {
  vi.useFakeTimers();
  const env = context();
  const signals: AbortSignal[] = [];
  const run = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
  });
  const polling = startPolling({ ...env, run, active: () => false, onError: vi.fn() });
  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).not.toHaveBeenCalled();
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(1);
  env.setOnline(false);
  expect(signals[0].aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).toHaveBeenCalledTimes(1);
  env.setOnline(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  polling.stop();
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).toHaveBeenCalledTimes(2);
});
it('backs off failed polls, keeps one error and clears it on recovery', async () => {
  vi.useFakeTimers();
  const env = context();
  const onError = vi.fn();
  const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const polling = startPolling({ ...env, run, active: () => false, onError });
  await vi.advanceTimersByTimeAsync(30000);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(59999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  expect(onError.mock.calls.map(([message]) => message)).toEqual(['offline', '']);
  polling.stop();
});
it('resumes after a slow abort settles without overlapping the old request', async () => {
  vi.useFakeTimers();
  const env = context();
  let running = 0;
  let maxRunning = 0;
  const run = vi.fn(async (signal: AbortSignal) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    try {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => setTimeout(resolve, 10), { once: true });
      });
    } finally {
      running--;
    }
  });
  const polling = startPolling({ ...env, run, active: () => true, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(1500);
  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent(new Event('visibilitychange'));
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(11);
  expect(run).toHaveBeenCalledTimes(2);
  expect(maxRunning).toBe(1);
  polling.stop();
  await vi.advanceTimersByTimeAsync(10);
});
