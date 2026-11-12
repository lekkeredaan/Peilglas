/* ══════════════════════════════════════════════════════════════
   PEILGLAS — /api/measure (meettest)
   POST { before: <jpeg base64>, after: <jpeg base64>, glass: 'vaasje' | 'auto' | ... }
   Antwoord: { ok, result } met het gedronken deel, de marge en de zekerheid.
   Foto's worden hier niet bewaard: ze gaan naar de AI en zijn daarna weg.
   ══════════════════════════════════════════════════════════════ */
const { measure, hasAI } = require('../lib/measure');

const MAX_B64 = 1_800_000;            // ruim 1,3 MB per foto
const PER_HOUR = Number(process.env.PG_TEST_PER_HOUR || 60);
const calls = global.__pgCalls || (global.__pgCalls = []);

function cleanImage(value) {
  let s = String(value || '');
  let type = 'image/jpeg';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(s);
  if (m) { type = m[1]; s = s.slice(m[0].length); }
  if (s.length < 2000 || s.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  return { data: s, type };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Alleen POST' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const before = cleanImage(body.before), after = cleanImage(body.after);
  if (!before || !after) return res.status(400).json({ ok: false, error: 'Er zijn twee foto\'s nodig (voor en na).' });
  if (!hasAI() && process.env.PG_FAKE !== '1') return res.status(503).json({ ok: false, error: 'De AI-sleutel is nog niet ingesteld op de server.' });

  const now = Date.now();
  while (calls.length && now - calls[0] > 3600000) calls.shift();
  if (calls.length >= PER_HOUR) return res.status(429).json({ ok: false, error: 'Even pauze: er is het afgelopen uur al veel gemeten. Probeer het straks opnieuw.' });
  calls.push(now);

  try {
    const result = await measure(before, after, String(body.glass || 'auto'));
    return res.status(200).json({ ok: true, result, ms: Date.now() - now });
  } catch (e) {
    console.error('meten mislukt:', e.status || '', e.message);
    const busy = e.status === 429 || e.status >= 500;
    return res.status(busy ? 503 : 500).json({ ok: false, error: busy ? 'De AI is even druk. Probeer het over een paar tellen opnieuw.' : 'Het meten is niet gelukt. Probeer het opnieuw met twee nieuwe foto\'s.' });
  }
};
