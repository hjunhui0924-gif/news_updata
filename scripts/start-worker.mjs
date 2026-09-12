// Match next start: production startup must enforce the live-mode configuration boundary.
process.env.NODE_ENV = 'production';
await import('../dist/worker/main.js');
