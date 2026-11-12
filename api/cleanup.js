/* ══════════════════════════════════════════════════════════════
   PEILGLAS — opruimtaak (Vercel-functie, 1x per dag via cron)
   Gooit avonden weg die ouder zijn dan 48 uur: de stand én alle foto's.
   De server houdt zelf een lijstje bij van uitgegeven codes.
   Beveiligd met CRON_SECRET (Vercel stuurt die zelf mee). ?dry=1 = alleen tellen.
   ══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const db = require('../lib/db');

const KEEP_MS = 48 * 60 * 60 * 1000;
const MAX_REMOVE = 300;

function allowed(req) {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers?.authorization || ''), want = `Bearer ${secret}`;
  if (!secret || given.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

module.exports = async function handler(req, res) {
  if (!allowed(req)) return res.status(401).json({ ok: false, error: 'Niet toegestaan' });
  const dry = req.query?.dry === '1';
  try {
    const index = (await db.get(db.indexPath())) || {};
    const now = Date.now();
    const old = Object.entries(index.codes || {}).filter(([, at]) => now - Number(at) > KEEP_MS).map(([c]) => c).slice(0, MAX_REMOVE);
    let removed = 0, failed = 0;
    if (!dry) {
      for (const code of old) {
        try {
          await db.del(`photos/${code}`);
          await db.del(`games/${code}`);
          await db.del(`${db.indexPath()}/codes/${code}`);
          removed++;
        } catch (e) { failed++; }
      }
      const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      for (const day of Object.keys(index.daily || {})) if (day < cutoff) await db.del(`${db.indexPath()}/daily/${day}`).catch(() => {});
    }
    const out = { ok: true, dry, avonden: Object.keys(index.codes || {}).length, expired: old.length, removed, failed };
    console.log('cleanup', JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    console.error('cleanup mislukt:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
