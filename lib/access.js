/* ══════════════════════════════════════════════════════════════
   PEILGLAS — toegangscode
   Wie een avond start (of de meettest gebruikt) heeft een toegangscode nodig. Meedoen kan zonder.
   De code wordt gecontroleerd bij ravotters.nl, net als bij de andere spellen: daar staan de
   gekochte codes en daar wordt ook de mastercode herkend. Er staat hier dus geen enkele code in.
   Een code werkt 72 uur vanaf het eerste gebruik.
   Lokaal testen (database in het geheugen, geen PG_CODE_API): alleen TEST-0000 werkt.
   ══════════════════════════════════════════════════════════════ */
const db = require('./db');

const CODE_API = process.env.PG_CODE_API || 'https://www.ravotters.nl/api/codes/verify';
const GAME_SLUG = 'peilglas';
const REMEMBER_MS = 10 * 60 * 1000;   // een goedgekeurde code tien minuten onthouden (minder verkeer naar ravotters.nl)
const seen = global.__pgAccess || (global.__pgAccess = new Map());

function fail(msg, status) { const e = new Error(msg); e.status = status; e.expose = true; throw e; }

// Wie vraagt het (adres + Vercels schatting van de plaats)? Gaat mee naar ravotters.nl, zodat het
// raadslot en de mastercode-melding naar de speler kijken en niet naar deze server.
function clientInfo(req) {
  const h = (req && req.headers) || {};
  const dec = v => { try { return v ? decodeURIComponent(v) : null; } catch (e) { return v || null; } };
  const lat = parseFloat(h['x-vercel-ip-latitude']), lon = parseFloat(h['x-vercel-ip-longitude']);
  return {
    ip: String(h['x-forwarded-for'] || '').split(',')[0].trim() || null,
    geo: Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, city: dec(h['x-vercel-ip-city']), region: dec(h['x-vercel-ip-country-region']), country: h['x-vercel-ip-country'] || null }
      : null,
  };
}

async function checkAccess(raw, client) {
  const access = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
  if (!access) fail('Vul je toegangscode in.', 400);
  if (db.MEMORY && !process.env.PG_CODE_API) {
    if (access !== 'TEST-0000') fail('Deze toegangscode bestaat niet. Controleer de code uit je mail.', 403);
    return { expiresAt: new Date(Date.now() + 72 * 3600e3).toISOString() };
  }
  const now = Date.now();
  const known = seen.get(access);
  if (known && known.until > now && (!known.expiresAt || new Date(known.expiresAt).getTime() > now)) return { expiresAt: known.expiresAt };
  let j = null;
  try {
    const r = await fetch(CODE_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: access, gameSlug: GAME_SLUG, ip: (client && client.ip) || undefined, geo: (client && client.geo) || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    j = await r.json();
  } catch (e) { j = null; }
  if (!j || typeof j.valid !== 'boolean') fail('De toegangscode kon niet gecontroleerd worden. Probeer het zo opnieuw.', 503);
  if (!j.valid) {
    if (j.reason === 'too_many_attempts') fail('Te veel foute pogingen. Wacht tien minuten en probeer het dan opnieuw.', 429);
    fail(j.reason === 'expired'
      ? 'Deze toegangscode is verlopen. Een code werkt 72 uur vanaf het eerste gebruik.'
      : 'Deze toegangscode bestaat niet. Controleer de code uit je mail.', 403);
  }
  if (seen.size > 500) seen.clear();
  seen.set(access, { until: now + REMEMBER_MS, expiresAt: j.expiresAt || null });
  return { expiresAt: j.expiresAt || null };
}

module.exports = { checkAccess, clientInfo, GAME_SLUG };
