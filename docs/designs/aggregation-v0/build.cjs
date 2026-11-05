const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const requireFromProject = createRequire(path.join(root, 'package.json'));
const requireFromTsup = createRequire(requireFromProject.resolve('tsup'));
const esbuild = requireFromTsup('esbuild');

async function build() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'prototype.tsx')],
    bundle: true, write: false, minify: true, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    target: ['chrome120', 'safari17'], legalComments: 'inline',
  });
  const css = fs.readFileSync(path.join(__dirname, 'prototype.css'), 'utf8');
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>知更 · 聚合阅读平台 UI 草图</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  fs.writeFileSync(path.join(__dirname, 'index.html'), html);
  console.log(`Built self-contained React prototype (${Math.round(Buffer.byteLength(html) / 1024)} KiB); no CDN or API requests.`);
}
build().catch((error) => { console.error(error.message); process.exitCode = 1; });
