/* PEILGLAS — de glazen: vorm, inhoud en tekening. Gebruikt door het spel (index.html). */
/* Glazen. d = omtrek zonder bovenrand (in een vak van 40 x 56), rim/bottom = y van de rand en de binnenbodem,
   liquid = y van het vloeistofoppervlak in het plaatje, foam = schuimbollen [x, y, straal], extra = losse lijnen. */
const GLASSES = [
  { id: 'auto', name: 'Weet ik niet', sub: 'AI herkent het', d: 'M6 8 L11.5 49 Q11.9 52 15 52 L25 52 Q28.1 52 28.5 49 L34 8', rim: 8, bottom: 47, dashed: true,
    extra: 'M16 24 Q16 18.5 20 18.5 Q24 18.5 24 22.5 Q24 25.5 20 27.5 L20 31 M20 36.5 L20 37.5' },
  { id: 'fluitje', cl: 20, name: 'Fluitje', sub: '20 cl', d: 'M11 3 L13.5 49 Q13.7 52 16.5 52 L23.5 52 Q26.3 52 26.5 49 L29 3', rim: 3, bottom: 47, liquid: 12,
    foam: [[15, 2.5, 4], [20.5, 0.5, 4.5], [25.5, 2.5, 3.5]], shine: 'M16 18 L17 38' },
  { id: 'vaasje', cl: 25, name: 'Vaasje', sub: '25 cl', d: 'M6 8 L11.5 49 Q11.9 52 15 52 L25 52 Q28.1 52 28.5 49 L34 8', rim: 8, bottom: 47, liquid: 18,
    foam: [[10.5, 7, 4.5], [20, 4.5, 5.5], [29.5, 7, 4.5]], shine: 'M12 24 L14.5 41' },
  { id: 'pint', cl: 50, name: 'Pint', sub: '50 cl', d: 'M7 2 Q5.5 10 8 15 Q9.5 18 10 23 L12 50 Q12.2 53 15 53 L25 53 Q27.8 53 28 50 L30 23 Q30.5 18 32 15 Q34.5 10 33 2', rim: 2, bottom: 48, liquid: 11,
    foam: [[11.5, 1.5, 4.5], [20, -0.5, 5.5], [28.5, 1.5, 4.5]], shine: 'M13.5 22 L15 42' },
  { id: 'longdrink', cl: 27, name: 'Longdrink', sub: '27 cl', d: 'M10 2 L10 49 Q10 53 14 53 L26 53 Q30 53 30 49 L30 2', rim: 2, bottom: 47, liquid: 12,
    ice: [[13.5, 17, -12], [19.5, 26, 14]], straw: 'M28 -4 L21.5 40' },
  { id: 'waterglas', cl: 20, name: 'Waterglas', sub: '20 cl', d: 'M6 20 L9 49 Q9.3 53 13 53 L27 53 Q30.7 53 31 49 L34 20', rim: 20, bottom: 48, liquid: 28, shine: 'M11.5 32 L13 44' },
  { id: 'wijnglas', cl: 35, name: 'Wijnglas', sub: '35 cl', d: 'M10 4 Q6 27 20 31 Q34 27 30 4', rim: 4, bottom: 31, liquid: 15, noBase: true,
    extra: 'M20 31 L20 50 M12 52 L28 52', shine: 'M13 18 Q13.5 23 16.5 26' },
  { id: 'anders', name: 'Ander glas', sub: 'inhoud onbekend', d: 'M6 8 L11.5 49 Q11.9 52 15 52 L25 52 Q28.1 52 28.5 49 L34 8', rim: 8, bottom: 47, dashed: true,
    extra: 'M14 30 L14 31 M20 30 L20 31 M26 30 L26 31' },
];
const INK = '#24103F';
function glassIcon(g) {
  const line = `fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  const clip = 'clip-' + g.id;
  let out = `<svg viewBox="0 -6 40 62" aria-hidden="true"><defs><clipPath id="${clip}"><path d="${g.d} Z"/></clipPath></defs>`;
  if (g.foam) out += g.foam.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`).join('');
  out += `<g clip-path="url(#${clip})"><rect x="0" y="-6" width="40" height="62" fill="${g.dashed ? 'none' : '#F3EEFA'}"/>`;
  if (g.liquid) {
    if (g.foam) out += `<rect x="0" y="-6" width="40" height="${g.liquid + 6}" fill="#fff"/>`;
    out += `<rect x="0" y="${g.liquid}" width="40" height="${g.bottom - g.liquid}" fill="#FFB000"/>`;
    if (!g.noBase) out += `<rect x="0" y="${g.bottom - 1.25}" width="40" height="2.5" fill="${INK}"/>`;
    if (g.ice) out += g.ice.map(([x, y, a]) => `<rect x="${x}" y="${y}" width="7.5" height="7.5" rx="1.8" fill="#FFE9B8" stroke="#fff" stroke-width="1.6" transform="rotate(${a} ${x + 3.75} ${y + 3.75})"/>`).join('');
    if (g.shine) out += `<path d="${g.shine}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".85"/>`;
  }
  out += '</g>';
  if (g.straw) out += `<path d="${g.straw}" ${line}/>`;
  out += `<path d="${g.d}${g.foam ? '' : ' Z'}" ${line}${g.dashed ? ' stroke-dasharray="4 5"' : ''}/>`;
  if (g.extra) out += `<path d="${g.extra}" ${line}/>`;
  return out + '</svg>';
}
const $ = id => document.getElementById(id);
const shots = [null, null];
let current = 0, stream = null;
window.PG = window.PG || {};
PG.GLASSES = GLASSES;
PG.glass = id => GLASSES.find(g => g.id === id) || GLASSES[0];
PG.glassIcon = glassIcon;
