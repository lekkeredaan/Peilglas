/* Lokale testserver (niet voor productie).
     node dev-server.js            -> http://localhost:5175
   Met een sleutel in ANTHROPIC_API_KEY meet de AI echt; met PG_FAKE=1 komt er een vaste nepmeting. */
if (process.argv.includes('--nep')) process.env.PG_FAKE = '1';
const http = require('http');
const fs = require('fs');
const path = require('path');
const routes = { '/api/measure': require('./api/measure') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = Number(process.env.PORT || 5175);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (routes[url.pathname]) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (e) { /* ongeldige JSON */ }
    const r = {
      status(c) { res.statusCode = c; return r; },
      json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return r; },
    };
    return routes[url.pathname]({ method: req.method, body, headers: req.headers, query: Object.fromEntries(url.searchParams) }, r);
  }
  let name = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([\\/])+/, '');
  if (!path.extname(name)) name += '.html'; // net als cleanUrls op Vercel
  const file = path.join(__dirname, name);
  if (!file.startsWith(__dirname) || !TYPES[path.extname(file)] || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Niet gevonden'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)]);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Peilglas lokaal op http://localhost:${PORT}`));
