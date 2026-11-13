/* ══════════════════════════════════════════════════════════════
   PEILGLAS — spelserver (Vercel-functie)
   Alle acties lopen hierlangs: POST /api/game  { action, code, token, ... }
   De telefoons lezen de stand van de avond (games/<code>) rechtstreeks uit Firebase.

   Mikspellen:
   - streep    iedereen hetzelfde doel in procenten van het glas
   - doelbord  doel in centiliters, punten in ringen
   - bod       iedereen zet eerst zijn eigen doel vast
   - duel      twee spelers, zelfde doel, wie het dichtst zit krijgt de bonus
   Het gaat om precisie, niet om hoeveelheid: doelen blijven klein en overslaan kan altijd.
   ══════════════════════════════════════════════════════════════ */
const db = require('../lib/db');
const ai = require('../lib/measure');
const { checkAccess, clientInfo } = require('../lib/access');

const MAX_PLAYERS = 20;
const MAX_AI_PER_GAME = Number(process.env.PG_MAX_AI_PER_GAME || 250);
const MAX_AI_PER_DAY = Number(process.env.PG_MAX_AI_PER_DAY || 2500);
const OPEN_END_MS = 60 * 60 * 1000;         // na een uur mag iedereen de avond afsluiten
const MAX_TRIES = 3;                       // per speler per ronde (foto's opnieuw)
const MAX_PHOTO = 1_800_000, MAX_THUMB = 160_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MODES = {
  streep:   { name: 'Op de streep', unit: 'pct', targets: [10, 15, 20, 25, 30] },
  doelbord: { name: 'Doelbord',     unit: 'cl',  targets: [3, 4, 5, 6, 8] },
  bod:      { name: 'Eigen bod',    unit: 'pct', targets: [0] },
  duel:     { name: 'Duel',         unit: 'pct', targets: [10, 15, 20, 25] },
};
const RINGS = [[0.5, 100], [1, 80], [2, 55], [3, 30], [5, 10]]; // doelbord: afwijking in cl -> punten

class Oops extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const need = (cond, msg, status) => { if (!cond) throw new Oops(msg, status); };
const cleanName = s => String(s ?? '').replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const cleanCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const validToken = t => typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t);
const today = () => new Date().toISOString().slice(0, 10);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const round1 = x => Math.round(x * 10) / 10;

function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
function cleanImage(value, max) {
  let s = String(value || ''), type = 'image/jpeg';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(s);
  if (m) { type = m[1]; s = s.slice(m[0].length); }
  if (s.length < 1000 || s.length > max || !/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  return { data: s, type };
}

async function load(body) {
  const code = cleanCode(body.code);
  need(code.length === 6, 'Die code klopt niet.');
  need(validToken(body.token), 'Sessie ongeldig. Herlaad de pagina.');
  const pid = db.pidOf(body.token);
  const game = await db.get(`games/${code}`);
  need(game, 'Deze avond bestaat niet (meer).', 404);
  need(game.players?.[pid], 'Je doet niet mee aan deze avond.', 403);
  return { code, pid, game, isHost: game.hostPid === pid };
}

// AI-gebruik begrenzen: per avond en per dag.
async function spendAI(code, game) {
  need(ai.hasAI() || process.env.PG_FAKE === '1', 'De AI is nog niet ingesteld op de server.', 503);
  const used = Number(game.aiCalls || 0);
  need(used < MAX_AI_PER_GAME, 'Deze avond heeft het maximum aantal metingen bereikt.', 429);
  const dayPath = `${db.indexPath()}/daily/${today()}`;
  const day = Number(await db.get(dayPath)) || 0;
  need(day < MAX_AI_PER_DAY, 'Het is vandaag erg druk. Probeer het morgen opnieuw.', 429);
  await Promise.all([db.put(dayPath, day + 1), db.put(`games/${code}/aiCalls`, used + 1)]);
}

function aiError(e) {
  if (e instanceof Oops) return e;
  console.error('AI mislukt:', e.status || '', e.message);
  const busy = e.status === 429 || e.status >= 500;
  return new Oops(busy ? 'De AI is even druk. Probeer het over een paar tellen opnieuw.' : 'Het meten is niet gelukt. Probeer het opnieuw.', busy ? 503 : 500);
}

const everyoneDone = round => (round.who || []).every(p => round.attempts?.[p]);

// Sluit een ronde af; bij een duel krijgt wie het dichtst zat de bonus.
async function finish(code, rid, round) {
  const updates = { [`rounds/${rid}/done`]: true };
  if (round.mode === 'duel') {
    const [a, b] = round.who;
    const A = round.attempts?.[a], B = round.attempts?.[b];
    const ok = x => x && !x.skip;
    if (ok(A) && ok(B)) {
      if (Math.abs(A.dev - B.dev) < 0.5) { updates[`rounds/${rid}/attempts/${a}/bonus`] = 25; updates[`rounds/${rid}/attempts/${b}/bonus`] = 25; }
      else updates[`rounds/${rid}/attempts/${A.dev < B.dev ? a : b}/bonus`] = 50;
    } else if (ok(A) || ok(B)) updates[`rounds/${rid}/attempts/${ok(A) ? a : b}/bonus`] = 50;
  }
  await db.patch(`games/${code}`, updates);
}

function newRound(mode, n, of, who, by) {
  const m = MODES[mode];
  return { mode, n, of, unit: m.unit, target: pick(m.targets), who, by, at: Date.now(), done: false };
}

const actions = {
  // ── Avond starten en meedoen ──
  // Klopt de toegangscode? (alleen controleren, er wordt niets aangemaakt)
  async checkCode(body, client) { return checkAccess(body.access, client); },

  async create(body, client) {
    need(validToken(body.token), 'Sessie ongeldig. Herlaad de pagina.');
    const name = cleanName(body.name);
    need(name.length >= 1, 'Vul je naam in.');
    const access = await checkAccess(body.access, client); // alleen wie de avond start heeft een code nodig
    const pid = db.pidOf(body.token);
    let code = '';
    for (let i = 0; i < 6; i++) { code = genCode(); if (!(await db.get(`games/${code}/createdAt`))) break; code = ''; }
    need(code, 'Er kon geen code worden gemaakt. Probeer het opnieuw.', 500);
    const now = Date.now();
    await db.put(`games/${code}`, { createdAt: now, hostPid: pid, phase: 'open', players: { [pid]: { name, at: now } } });
    await db.put(`${db.indexPath()}/codes/${code}`, now);
    return { code, pid, accessExpiresAt: access.expiresAt };
  },

  async join(body) {
    const code = cleanCode(body.code);
    need(code.length === 6, 'Een code heeft 6 tekens.');
    need(validToken(body.token), 'Sessie ongeldig. Herlaad de pagina.');
    const name = cleanName(body.name);
    need(name.length >= 1, 'Vul je naam in.');
    const pid = db.pidOf(body.token);
    const game = await db.get(`games/${code}`);
    need(game, 'Deze code bestaat niet. Controleer de letters en cijfers.', 404);
    if (!game.players?.[pid]) {
      need(game.phase === 'open', 'Deze avond is al afgesloten.');
      const players = Object.values(game.players || {});
      need(players.length < MAX_PLAYERS, 'Deze avond zit vol.');
      need(!players.some(p => p.name.toLowerCase() === name.toLowerCase()), 'Die naam is al bezet. Kies een andere.');
      await db.put(`games/${code}/players/${pid}`, { name, at: Date.now() });
    }
    return { code, pid };
  },

  // ── Mikspel ──
  async startGame(body) {
    const { code, pid, game } = await load(body);
    need(game.phase === 'open', 'Deze avond is afgesloten.');
    const cur = game.cur && game.rounds?.[game.cur];
    need(!cur || cur.done, 'Er loopt al een mikspel.');
    const mode = String(body.mode);
    need(MODES[mode], 'Onbekend mikspel.');
    let who = Object.keys(game.players);
    let of = [1, 3, 5].includes(Number(body.rounds)) ? Number(body.rounds) : 3;
    if (mode === 'duel') {
      const other = String(body.opponent || '');
      need(game.players[other] && other !== pid, 'Kies een tegenstander voor het duel.');
      who = [pid, other];
    }
    const rid = newId();
    await db.patch(`games/${code}`, { [`rounds/${rid}`]: newRound(mode, 1, of, who, pid), cur: rid });
    return { rid };
  },

  async nextRound(body) {
    const { code, pid, game } = await load(body);
    const cur = game.cur && game.rounds?.[game.cur];
    need(cur && cur.done, 'De ronde is nog niet klaar.');
    need(cur.n < cur.of, 'Dit mikspel is afgelopen.');
    const rid = newId();
    const who = cur.mode === 'duel' ? cur.who : Object.keys(game.players);
    const next = newRound(cur.mode, cur.n + 1, cur.of, who, pid);
    if (next.target === cur.target && MODES[cur.mode].targets.length > 1) next.target = pick(MODES[cur.mode].targets.filter(t => t !== cur.target));
    await db.patch(`games/${code}`, { [`rounds/${rid}`]: next, cur: rid });
    return { rid };
  },

  async stopGame(body) { // terug naar de stand
    const { code, game } = await load(body);
    const cur = game.cur && game.rounds?.[game.cur];
    if (cur && !cur.done) await finish(code, game.cur, cur);
    await db.patch(`games/${code}`, { cur: null });
    return {};
  },

  async closeRound(body) {
    const { code, game } = await load(body);
    const rid = game.cur, cur = rid && game.rounds?.[rid];
    need(cur, 'Er loopt geen ronde.');
    if (!cur.done) await finish(code, rid, cur);
    return {};
  },

  async bid(body) { // Eigen bod: eerst je doel vastzetten
    const { code, pid, game } = await load(body);
    const rid = game.cur, cur = rid && game.rounds?.[rid];
    need(cur && !cur.done && cur.mode === 'bod', 'Er loopt geen ronde met een eigen bod.');
    need(!cur.bids?.[pid], 'Je bod staat al vast.');
    const bid = Math.round(Number(body.bid));
    need(bid >= 5 && bid <= 40, 'Kies een bod tussen 5 en 40 procent.');
    await db.put(`games/${code}/rounds/${rid}/bids/${pid}`, bid);
    return { bid };
  },

  async skip(body) {
    const { code, pid, game } = await load(body);
    const rid = game.cur, cur = rid && game.rounds?.[rid];
    need(cur && !cur.done, 'Er loopt geen ronde.');
    need(cur.who.includes(pid), 'Je doet niet mee aan deze ronde.');
    need(!cur.attempts?.[pid] || cur.attempts[pid].skip, 'Je beurt is al gemeten.');
    await db.put(`games/${code}/rounds/${rid}/attempts/${pid}`, { skip: true, at: Date.now() });
    const fresh = await db.get(`games/${code}/rounds/${rid}`);
    if (fresh && !fresh.done && everyoneDone(fresh)) await finish(code, rid, fresh);
    return {};
  },

  async attempt(body) {
    const { code, pid, game } = await load(body);
    need(game.phase === 'open', 'Deze avond is afgesloten.');
    const rid = game.cur, cur = rid && game.rounds?.[rid];
    need(cur && !cur.done, 'Deze ronde is al afgesloten.');
    need(cur.who.includes(pid), 'Je doet niet mee aan deze ronde.');
    const prev = cur.attempts?.[pid];
    const tries = (prev && prev.tries) || 0;
    need(tries < MAX_TRIES, 'Je hebt deze ronde al drie keer gemeten.');
    const before = cleanImage(body.before, MAX_PHOTO), after = cleanImage(body.after, MAX_PHOTO);
    need(before && after, 'Er zijn twee foto\'s nodig (voor en na).');
    let target = cur.target;
    if (cur.mode === 'bod') { target = cur.bids?.[pid]; need(target, 'Zet eerst je bod vast.'); }

    await spendAI(code, game);
    let r;
    try { r = await ai.measure(before, after, String(body.glass || 'auto')); } catch (e) { throw aiError(e); }
    need(r.usable, (r.sameGlass ? '' : 'De twee foto\'s lijken niet van hetzelfde glas. ') + (r.note || 'Het peil was niet te lezen.') + ' Maak de foto\'s opnieuw.');
    need(r.drunkPct > -3, 'Op de tweede foto lijkt er meer in je glas te zitten dan op de eerste. Maak de na-foto opnieuw.');
    const drunkPct = Math.max(0, r.drunkPct);
    let value, dev, points, margin;
    if (cur.unit === 'cl') {
      need(r.glassCl, 'Voor centiliters moeten we weten welk glas het is. Kies je glas en maak de na-foto opnieuw.');
      need(r.beforeFill / 100 * r.glassCl >= target, `Er zit te weinig in je glas voor ${target} cl. Vul bij of sla deze ronde over.`);
      value = Math.max(0, r.drunkCl); dev = round1(Math.abs(value - target)); margin = r.marginCl;
      points = (RINGS.find(([max]) => dev <= max) || [0, 0])[1];
    } else {
      need(r.beforeFill >= target, `Er zit te weinig in je glas voor ${target}%. Vul bij of sla deze ronde over.`);
      value = drunkPct; dev = round1(Math.abs(value - target)); margin = r.marginPct;
      points = Math.max(0, Math.round(100 - 4 * dev));
    }
    const result = {
      value: round1(value), target, dev, points, margin, sure: r.certainty,
      beforeFill: r.beforeFill, afterFill: r.afterFill, pct: round1(drunkPct), cl: r.drunkCl == null ? null : Math.max(0, r.drunkCl),
      glass: r.glass, drink: r.drink, note: r.note, tries: tries + 1, at: Date.now(),
    };
    const tb = cleanImage(body.thumbBefore, MAX_THUMB), ta = cleanImage(body.thumbAfter, MAX_THUMB);
    const saves = [];
    if (tb) { result.pb = `${rid}${pid}b`; saves.push(db.put(`photos/${code}/${result.pb}`, { d: tb.data, pid, at: result.at, kind: 'voor' })); }
    if (ta) { result.pa = `${rid}${pid}a`; saves.push(db.put(`photos/${code}/${result.pa}`, { d: ta.data, pid, at: result.at, kind: 'na' })); }
    await Promise.all(saves);
    await db.put(`games/${code}/rounds/${rid}/attempts/${pid}`, result);
    const fresh = await db.get(`games/${code}/rounds/${rid}`);
    if (fresh && !fresh.done && everyoneDone(fresh)) await finish(code, rid, fresh);
    return { result };
  },

  // ── Drankjesteller ──
  async drink(body) {
    const { code, pid, game } = await load(body);
    need(game.phase === 'open', 'Deze avond is afgesloten.');
    const photo = cleanImage(body.photo, MAX_PHOTO);
    need(photo, 'Maak eerst een foto van je glas.');
    await spendAI(code, game);
    let d;
    try { d = await ai.recogniseDrink(photo); } catch (e) { throw aiError(e); }
    need(d.isDrink, (d.note || 'Hier staat geen drankje op.') + ' Maak een foto van je glas.');
    const id = newId(), at = Date.now();
    const entry = { pid, kind: d.kind, label: d.label, cl: d.cl, glass: d.glass, note: d.note, at };
    const thumb = cleanImage(body.thumb, MAX_THUMB);
    if (thumb) { entry.photo = `d${id}`; await db.put(`photos/${code}/${entry.photo}`, { d: thumb.data, pid, at, kind: 'glas' }); }
    await db.put(`games/${code}/drinks/${id}`, entry);
    return { id, drink: entry };
  },

  async drinkFix(body) { // de AI zat ernaast: soort aanpassen of het glas weghalen
    const { code, pid, game } = await load(body);
    const id = String(body.id || '');
    const d = game.drinks?.[id];
    need(d && d.pid === pid, 'Dat drankje is niet van jou.');
    if (body.remove) {
      await db.del(`games/${code}/drinks/${id}`);
      if (d.photo) await db.del(`photos/${code}/${d.photo}`);
      return {};
    }
    need(ai.DRINKS.includes(body.kind), 'Onbekend soort drankje.');
    const names = { bier: 'bier', wijn: 'wijn', fris: 'fris', water: 'water', cocktail: 'cocktail', sterk: 'sterk', warm: 'koffie of thee', anders: 'iets anders' };
    await db.patch(`games/${code}/drinks/${id}`, { kind: body.kind, label: names[body.kind], fixed: true });
    return {};
  },

  // ── Avond afsluiten ──
  async endEvening(body) {
    const { code, game, isHost } = await load(body);
    need(isHost || Date.now() - Number(game.createdAt || 0) >= OPEN_END_MS, 'Het eerste uur kan alleen wie de avond startte hem afsluiten.', 403);
    const cur = game.cur && game.rounds?.[game.cur];
    if (cur && !cur.done) await finish(code, game.cur, cur);
    await db.patch(`games/${code}`, { phase: 'ended', endedAt: Date.now(), cur: null });
    return {};
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Alleen POST' });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body || '{}'); } catch (e) { body = null; }
  const fn = body && actions[body.action];
  if (!fn) return res.status(400).json({ ok: false, error: 'Onbekende actie' });
  try {
    const out = await fn(body, clientInfo(req));
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof Oops || e.expose) return res.status(e.status || 400).json({ ok: false, error: e.message });
    console.error(body.action, 'mislukt:', e.message);
    return res.status(500).json({ ok: false, error: 'Er ging iets mis op de server. Probeer het opnieuw.' });
  }
};
module.exports.MODES = MODES;
