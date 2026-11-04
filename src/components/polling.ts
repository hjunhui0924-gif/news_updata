export function pollDelay(active: boolean, failures: number) {
  return Math.min(120000, (active ? 1500 : 30000) * 2 ** Math.min(failures, 7));
}
export function startPolling(options: {
  run: (signal: AbortSignal) => Promise<void>;
  active: () => boolean;
  onError: (message: string) => void;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  online: () => boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let running = false;
  let stopped = false;
  let failures = 0;
  let wakeAfterRun = false;
  const visible = () => options.document.visibilityState !== 'hidden' && options.online();
  function schedule(delay = pollDelay(options.active(), failures)) {
    clearTimeout(timer);
    if (!stopped && visible()) timer = setTimeout(() => void run(), delay);
  }
  async function run() {
    if (stopped || !visible()) return;
    if (running) {
      wakeAfterRun = true;
      return;
    }
    running = true;
    controller = new AbortController();
    try {
      await options.run(controller.signal);
      failures = 0;
      if (!controller.signal.aborted) options.onError('');
    } catch (error) {
      if (!controller.signal.aborted) {
        failures++;
        options.onError(error instanceof Error ? error.message : '后台刷新暂时失败，将自动重试。');
      }
    } finally {
      running = false;
      if (wakeAfterRun) {
        wakeAfterRun = false;
        schedule(0);
      } else schedule();
    }
  }
  function wake() {
    clearTimeout(timer);
    if (!visible()) {
      controller?.abort();
      return;
    }
    schedule(0);
  }
  options.document.addEventListener('visibilitychange', wake);
  options.window.addEventListener('online', wake);
  options.window.addEventListener('offline', wake);
  schedule();
  return {
    retry: wake,
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      options.document.removeEventListener('visibilitychange', wake);
      options.window.removeEventListener('online', wake);
      options.window.removeEventListener('offline', wake);
    },
  };
}
