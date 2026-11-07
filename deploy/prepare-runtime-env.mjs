import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep the existing server:init HTTPS arguments/default Docker target compatible.
const args = process.argv.slice(2);
const index = args.indexOf('--runtime');
let runtime = process.env.APP_RUNTIME ?? 'docker';
if (index !== -1) {
  runtime = args[index + 1];
  args.splice(index, 2);
}
if (!['native', 'docker'].includes(runtime) || args.includes('--runtime')) {
  console.error('Use --runtime native or --runtime docker.');
  process.exit(1);
}
const script = runtime === 'native' ? './prepare-native-env.mjs' : './prepare-env.mjs';
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL(script, import.meta.url)), ...args],
  {
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (result.error) console.error('Unable to start the selected configuration generator.');
process.exitCode = result.status ?? 1;
