const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const html = path.join(__dirname, 'index.html');
http.createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.url !== '/' && request.url !== '/index.html') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(html).pipe(response);
}).listen(3004, '127.0.0.1', () => console.log('UI concept: http://127.0.0.1:3004 (sample data only)'));
