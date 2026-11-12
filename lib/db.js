/* ══════════════════════════════════════════════════════════════
   PEILGLAS — database-laag voor de serverfuncties
   Praat via REST met Firebase Realtime Database.

   - games/<code>           de avond: spelers, mikspellen, drankjes (leesbaar voor wie de code kent)
   - photos/<code>/<id>     verkleinde foto's voor de aftermovie
   - index/<sleutel>        lijst van uitgegeven codes en dagtellers; <sleutel> wordt berekend
                            met PG_SERVER_SECRET, dat alleen de server kent.

   PG_MEMORY=1 (alleen lokaal testen): alles in het geheugen, geen Firebase nodig.
   ══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');

const DB_URL = (process.env.FIREBASE_DB_URL || 'https://peilglas-default-rtdb.europe-west1.firebasedatabase.app').replace(/\/+$/, '');
const MEMORY = process.env.PG_MEMORY === '1';
const mem = global.__pgMem || (global.__pgMem = {});

function serverSecret() {
  const s = process.env.PG_SERVER_SECRET || (MEMORY ? 'alleen-voor-lokaal-testen' : '');
  if (!s) throw new Error('PG_SERVER_SECRET ontbreekt');
  return s;
}
const hmac = text => crypto.createHmac('sha256', serverSecret()).update(text).digest('hex');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const indexPath = () => `index/${hmac('index')}`;
// Een speler bewijst wie hij is met zijn geheime token; zijn openbare id is daarvan afgeleid.
const pidOf = token => sha256('speler:' + token).slice(0, 12);

// ── Geheugen-variant ──
function memWalk(path, create) {
  const keys = path.split('/').filter(Boolean);
  let node = mem;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') {
      if (!create) return [null, null];
      node[keys[i]] = {};
    }
    node = node[keys[i]];
  }
  return [node, keys[keys.length - 1]];
}
function memSet(path, val) {
  const [node, key] = memWalk(path, true);
  if (val === null || val === undefined) delete node[key];
  else node[key] = JSON.parse(JSON.stringify(val));
}
function memGet(path) {
  const [node, key] = memWalk(path, false);
  const v = node ? node[key] : null;
  return v === undefined ? null : JSON.parse(JSON.stringify(v ?? null));
}

// ── REST ──
async function rest(method, path, body) {
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Database ${method} mislukt (${r.status})`);
  return r.json();
}

async function get(path) { return MEMORY ? memGet(path) : rest('GET', path); }
async function put(path, val) { if (MEMORY) { memSet(path, val); return; } await rest('PUT', path, val); }
async function del(path) { if (MEMORY) { memSet(path, null); return; } await rest('DELETE', path); }
// Meerdere plekken tegelijk bijwerken; sleutels mogen paden zijn ("players/abc/name").
async function patch(path, updates) {
  if (MEMORY) { for (const [k, v] of Object.entries(updates)) memSet(`${path}/${k}`, v); return; }
  await rest('PATCH', path, updates);
}

module.exports = { get, put, del, patch, indexPath, pidOf, MEMORY, memGet };
