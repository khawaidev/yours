#!/usr/bin/env node
'use strict';

/*
 * Zero-dependency static server for local frontend development.
 *
 *   npm run dev     (from the `yours` folder)
 *   npm start
 *
 * Defaults to port 5501 to match .vscode/settings.json (Live Server).
 * Override with PORT=xxxx.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5501);
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf'
};

function resolveFile(pathname) {
  // Normalize and keep every request inside the frontend root.
  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(ROOT, '.' + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) return { filePath, stat };
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      const indexStat = fs.statSync(indexPath);
      if (indexStat.isFile()) return { filePath: indexPath, stat: indexStat };
    }
  } catch (err) {
    // Not found — caller returns 404.
  }
  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }

  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad Request');
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const resolved = resolveFile(pathname);
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found: ' + pathname);
  }

  const ext = path.extname(resolved.filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': resolved.stat.size,
    'Cache-Control': 'no-store',
    // Lets sw.js control the whole scope when served from a subfolder.
    'Service-Worker-Allowed': '/'
  });

  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(resolved.filePath).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=5502 npm run dev`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Yours frontend running at http://localhost:${PORT}`);
});
