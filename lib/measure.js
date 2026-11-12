/* ══════════════════════════════════════════════════════════════
   PEILGLAS — meten met twee foto's (Claude API)
   De AI kijkt alleen: waar staat de vloeistof in het glas (0 = bodem,
   1 = rand), los van schuim. Het omrekenen naar volume doet deze code
   zelf, met de vorm van het gekozen glas (tapse glazen bevatten bovenin
   meer dan onderin).

   De sleutel staat alleen op de server (Vercel: ANTHROPIC_API_KEY).
   PG_FAKE=1 (alleen lokaal): vaste nepmeting, om de pagina te testen.
   ══════════════════════════════════════════════════════════════ */

const MODEL = process.env.PG_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.PG_EFFORT || 'medium';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TIMEOUT_MS = Number(process.env.PG_TIMEOUT_MS || 90000);

/* Glazen: inhoud in cl (ongeveer, tot de rand) en vorm.
   taper = binnenbreedte bij de bodem gedeeld door de breedte bij de rand. */
const GLASSES = {
  fluitje:   { label: 'Fluitje',    cl: 20, taper: 0.78 },
  vaasje:    { label: 'Vaasje',     cl: 25, taper: 0.72 },
  pint:      { label: 'Pint',       cl: 50, taper: 0.72 },
  longdrink: { label: 'Longdrink',  cl: 27, taper: 1.0 },
  waterglas: { label: 'Waterglas',  cl: 20, taper: 0.85 },
  wijnglas:  { label: 'Wijnglas',   cl: 35, bowl: true },
  anders:    { label: 'Ander glas', cl: null, taper: null },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : lo));

// Straal van het glas op hoogte x (0 = bodem, 1 = rand), in willekeurige eenheid.
function radiusAt(x, shape) {
  if (shape.bowl) { // kelk: het breedst op 60% hoogte, naar boven weer smaller
    const d = (x - 0.6) / 0.62;
    return Math.sqrt(Math.max(0.02, 1 - d * d));
  }
  return shape.taper + (1 - shape.taper) * x;
}

// Welk deel van de totale inhoud zit er onder hoogte h?
function volumeFraction(h, shape) {
  const N = 400;
  let below = 0, total = 0;
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N, a = radiusAt(x, shape) ** 2;
    total += a;
    if (x <= h) below += a;
  }
  return below / total;
}

const LEVEL = {
  type: 'object', additionalProperties: false,
  required: ['level', 'uncertainty', 'foam'],
  properties: {
    level: { type: 'number', description: 'Height of the liquid surface (below any foam) as a fraction of the inner height of the glass: 0 = inner bottom, 1 = rim.' },
    uncertainty: { type: 'number', description: 'Plus/minus error on level, as a fraction (0.03 = three percent of the glass height).' },
    foam: { type: 'boolean' },
  },
};
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['usable', 'sameGlass', 'transparent', 'before', 'after', 'glassKind', 'taper', 'drink', 'note'],
  properties: {
    usable: { type: 'boolean', description: 'False if a level cannot be read at all in one of the photos.' },
    sameGlass: { type: 'boolean' },
    transparent: { type: 'boolean' },
    before: LEVEL, after: LEVEL,
    glassKind: { type: 'string', enum: Object.keys(GLASSES) },
    taper: { type: 'number', description: 'Inner width at the bottom divided by inner width at the rim (1 = straight sides).' },
    drink: { type: 'string', enum: ['bier', 'wijn', 'fris', 'water', 'cocktail', 'anders', 'onbekend'] },
    note: { type: 'string', description: 'One short Dutch sentence for the player about what made the reading easy or hard. No emoji.' },
  },
};

const PROMPT = `These two photos belong to a party game in which a player tries to drink an exact share of a drink. Photo 1 was taken before the sip, photo 2 after it. Both should show the same glass standing upright on a table, taken from the same position.

Your job is only to read the liquid level in each photo as accurately as you can. The volume is calculated afterwards from your readings, so do not correct for the shape of the glass yourself.

For each photo:
- Find the rim of the glass and the inner bottom (where the liquid can actually reach; a thick glass base does not count).
- Find the top of the liquid itself. Foam is not liquid: if there is a foam head, the level is where the liquid ends and the foam begins. Foam that clings to the glass wall above the liquid does not count either.
- Report the level as a fraction of the inner height: 0 is the inner bottom, 1 is the rim. An empty glass is 0.
- If the camera looks down at the glass, the liquid surface shows as an ellipse; use the middle of that ellipse, and judge heights along the side of the glass.
- Give an honest plus/minus for each reading. A sharp side view of a clear glass is about 0.02 to 0.04. Dark rooms, reflections, condensation, an opaque or coloured glass, a view from above, or a glass that is partly out of frame make it larger.

Also report: whether both photos show the same glass, whether the glass is transparent, which kind of glass it is, how tapered it is (inner width at the bottom divided by inner width at the rim), and what kind of drink it most likely is. Water and soft drinks are normal answers here.

If you cannot read a level at all in one of the photos, set usable to false and say in the note what the player should do differently.`;

let client = null;
function hasAI() { return !!process.env.ANTHROPIC_API_KEY; }
function getClient() {
  if (!client) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.Anthropic || sdk.default || sdk;
    client = new Anthropic({ maxRetries: 1 });
  }
  return client;
}

const image = (b64, mediaType) => ({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: b64 } });

async function readLevels(before, after, chosenLabel) {
  if (process.env.PG_FAKE === '1') {
    return { usable: true, sameGlass: true, transparent: true, before: { level: 0.9, uncertainty: 0.03, foam: true }, after: { level: 0.6, uncertainty: 0.03, foam: false }, glassKind: 'vaasje', taper: 0.72, drink: 'bier', note: 'Nepmeting voor lokaal testen.' };
  }
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 6000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Photo 1 (before the sip):' }, image(before.data, before.type),
        { type: 'text', text: 'Photo 2 (after the sip):' }, image(after.data, after.type),
        { type: 'text', text: PROMPT + (chosenLabel ? `\n\nThe player says the glass is a: ${chosenLabel}.` : '') },
      ],
    }],
  }, { timeout: TIMEOUT_MS });
  if (response.stop_reason === 'refusal') throw new Error('De AI wilde deze foto\'s niet beoordelen.');
  if (response.stop_reason === 'max_tokens') throw new Error('Het AI-antwoord werd afgekapt.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return JSON.parse(text);
}

/* Van twee peilstanden naar een uitslag.
   glassId: gekozen glas, of 'auto' om de AI te laten herkennen. */
function compute(raw, glassId) {
  const kind = glassId && glassId !== 'auto' && GLASSES[glassId] ? glassId : (GLASSES[raw.glassKind] ? raw.glassKind : 'anders');
  const glass = GLASSES[kind];
  const shape = glass.bowl ? { bowl: true } : { taper: clamp(glass.taper ?? raw.taper, 0.4, 1.15) };
  const h1 = clamp(raw.before?.level, 0, 1), h2 = clamp(raw.after?.level, 0, 1);
  const e1 = clamp(raw.before?.uncertainty, 0.01, 0.5), e2 = clamp(raw.after?.uncertainty, 0.01, 0.5);
  const v = h => volumeFraction(clamp(h, 0, 1), shape);
  const v1 = v(h1), v2 = v(h2);
  const spread = (h, e) => (v(h + e) - v(h - e)) / 2;
  const margin = Math.sqrt(spread(h1, e1) ** 2 + spread(h2, e2) ** 2);
  const drunk = v1 - v2;
  const pct = x => Math.round(x * 1000) / 10;
  return {
    usable: !!raw.usable && !!raw.sameGlass,
    glass: kind, glassLabel: glass.label, glassCl: glass.cl,
    recognised: raw.glassKind, drink: raw.drink,
    transparent: !!raw.transparent, sameGlass: !!raw.sameGlass,
    beforeLevel: pct(h1), afterLevel: pct(h2),
    beforeFill: pct(v1), afterFill: pct(v2),
    foamBefore: !!raw.before?.foam, foamAfter: !!raw.after?.foam,
    drunkPct: pct(drunk),                         // deel van het hele glas
    drunkOfContent: v1 > 0.02 ? pct(drunk / v1) : null, // deel van wat erin zat
    drunkCl: glass.cl ? Math.round(drunk * glass.cl * 10) / 10 : null,
    marginPct: pct(margin),
    marginCl: glass.cl ? Math.round(margin * glass.cl * 10) / 10 : null,
    certainty: margin <= 0.04 ? 'zeker' : margin <= 0.07 ? 'redelijk zeker' : margin <= 0.12 ? 'onzeker' : 'erg onzeker',
    note: String(raw.note || '').slice(0, 240),
  };
}

async function measure(before, after, glassId) {
  const chosen = glassId && glassId !== 'auto' && GLASSES[glassId] ? GLASSES[glassId].label : '';
  const raw = await readLevels(before, after, chosen);
  return compute(raw, glassId);
}

module.exports = { measure, compute, volumeFraction, hasAI, GLASSES };
