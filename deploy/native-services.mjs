import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function nativeServices(project, user, node) {
  // These values become systemd syntax, so reject expansions, newlines and escaping.
  for (const path of [project, node]) {
    if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('/../') || path.endsWith('/..'))
      throw new Error(
        'Native service paths must be absolute Linux paths without spaces or expansions.',
      );
  }
  if (!/^[a-z_][a-z0-9_-]*$/.test(user) || user === 'root')
    throw new Error('Use an existing, non-root Linux service user.');
  return Object.fromEntries(
    ['migrate', 'web', 'worker'].map((name) => {
      const migration = name === 'migrate';
      return [
        `newsroom-${name}.service`,
        `[Unit]
Description=Newsroom native ${name}
After=network-online.target postgresql.service${migration ? '' : ' newsroom-migrate.service'}
Wants=network-online.target
Requires=postgresql.service${migration ? '' : ' newsroom-migrate.service'}
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=${migration ? 'oneshot' : 'simple'}
User=${user}
WorkingDirectory=${project}
EnvironmentFile=/etc/newsroom/runtime.env
ExecStart=${node} ${project}/deploy/native-run.mjs ${name}
${
  migration
    ? 'RemainAfterExit=yes'
    : `ExecStartPost=${node} ${project}/deploy/native-run.mjs check-${name}
Restart=on-failure
RestartSec=5`
}
TimeoutStartSec=180
TimeoutStopSec=60
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${project}/.next

[Install]
WantedBy=multi-user.target
`,
      ];
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [project, user, node] = process.argv.slice(2);
    const units = nativeServices(project, user, node);
    const output = resolve(project, 'work/native-services');
    await mkdir(output, { recursive: true });
    for (const [name, content] of Object.entries(units))
      await writeFile(resolve(output, name), content);
    console.log('Generated native systemd units.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
