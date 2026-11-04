export function workerIsOnline(value: unknown, now = Date.now()): value is string {
  if (typeof value !== 'string') return false;
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= -5000 && age < 60000;
}
