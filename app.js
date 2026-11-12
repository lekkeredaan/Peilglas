/* ══════════════════════════════════════════════════════════════
   PEILGLAS — het spel in de browser
   - Start: avond starten of meedoen met een code.
   - De avond: stand van de mikkers, drankjesteller, mikspel starten.
   - Mikspel: iedereen op zijn eigen telefoon een voor- en na-foto; de server meet en telt.
   - Einde: aftermovie (zie movie.js).
   Alle acties gaan naar /api/game; de stand wordt elke 2 seconden uit de database gelezen.
   ══════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = x => String(x).replace('.', ',');
  const POLL_MS = 2000;

  const MODES = {
    streep:   { name: 'Op de streep', how: 'Iedereen krijgt hetzelfde doel. Drink precies dat deel van je glas.' },
    doelbord: { name: 'Doelbord',     how: 'Mik op een aantal centiliters. Hoe dichter bij de roos, hoe meer punten.' },
    bod:      { name: 'Eigen bod',    how: 'Zet eerst vast hoeveel je gaat drinken. Daarna moet je het waarmaken.' },
    duel:     { name: 'Duel',         how: 'Jij tegen één ander, zelfde doel. Wie het dichtst zit, pakt de bonus.' },
  };
  const KINDS = { bier: 'Bier', wijn: 'Wijn', fris: 'Fris', water: 'Water', cocktail: 'Cocktail', sterk: 'Sterk', warm: 'Koffie of thee', anders: 'Iets anders' };
  const ICON = {
    camera: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    target: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    skip: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l8 7-8 7z"/><path d="M18 5v14"/></svg>',
    bier: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l-2 17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"/><path d="M7 9h10"/></svg>',
    wijn: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10c0 6-2 9-5 9s-5-3-5-9z"/><path d="M12 12v8"/><path d="M8 21h8"/></svg>',
    fris: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10l-1 15H8z"/><path d="M12 6l3-4"/></svg>',
    water: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/></svg>',
    overig: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1 6c3 1 4 4 4 7v5H5v-5c0-3 1-6 4-7z"/></svg>',
  };

  // ── Opslag op dit toestel ──
  const store = {
    get(key, session) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)); } catch (e) { return null; } },
    set(key, val, session) { try { const s = session ? sessionStorage : localStorage; if (val == null) s.removeItem(key); else s.setItem(key, JSON.stringify(val)); } catch (e) { /* vol of geblokkeerd */ } },
  };
  let session = store.get('pg.session');           // { code, token, pid }
  let game = null, lastJson = '', pollTimer = null, pollBusy = false;
  let roundView = false;                            // kijkt deze speler naar het mikspel?
  let turn = store.get('pg.turn', true) || {};      // { rid, before: { full, thumb }, error }
  let sheetState = null, endedFor = null;
  const myGlass = () => store.get('pg.glass') || 'auto';

  function newToken() {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function api(action, data) {
    let r;
    try {
      r = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code: session && session.code, token: session && session.token, ...data }) });
    } catch (e) { throw new Error('Geen verbinding. Controleer je internet en probeer het opnieuw.'); }
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) throw new Error((j && j.error) || 'Er ging iets mis. Probeer het opnieuw.');
    return j;
  }

  // ── Kleine hulpjes voor het scherm ──
  let toastTimer = null;
  function toast(msg) {
    $('toast').textContent = msg; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }
  function busy(text) { $('busyText').textContent = text || ''; $('busy').hidden = !text; }
  function openSheet(html) { $('sheetCard').innerHTML = html; $('sheet').hidden = false; }
  function closeSheet() { $('sheet').hidden = true; sheetState = null; }
  async function guard(el, fn) { // knop even uit, fout als melding
    if (el && el.disabled) return;
    if (el) el.disabled = true;
    try { await fn(); } catch (e) { toast(e.message); } finally { if (el) el.disabled = false; }
  }

  function show(view) {
    for (const v of ['start', 'evening', 'round', 'ended']) $(v).hidden = v !== view;
    PG.animPaused = view !== 'start';
    document.querySelector('meta[name=theme-color]').content = view === 'ended' ? '#150A26' : '#F3EEFA';
  }

  // ── Cijfers van de avond ──
  function stats(g) {
    const P = {};
    for (const [pid, p] of Object.entries(g.players || {})) P[pid] = { pid, name: p.name, points: 0, turns: 0, devSum: 0, devN: 0, drinks: 0, soft: 0, cl: 0 };
    let best = null;
    for (const r of Object.values(g.rounds || {})) {
      for (const [pid, a] of Object.entries(r.attempts || {})) {
        const p = P[pid];
        if (!p || a.skip) continue;
        p.points += (a.points || 0) + (a.bonus || 0); p.turns++;
        if (r.unit === 'pct') {
          p.devSum += a.dev; p.devN++;
          if (!best || a.dev < best.dev) best = { name: p.name, dev: a.dev, value: a.value, target: a.target };
        }
      }
    }
    const kinds = { bier: 0, wijn: 0, fris: 0, water: 0, overig: 0 };
    let totalCl = 0, totalDrinks = 0;
    const drinks = Object.entries(g.drinks || {}).map(([id, d]) => ({ id, ...d })).sort((a, b) => a.at - b.at);
    for (const d of drinks) {
      const p = P[d.pid];
      totalDrinks++; totalCl += d.cl || 0;
      kinds[kinds[d.kind] !== undefined ? d.kind : 'overig']++;
      if (p) { p.drinks++; p.cl += d.cl || 0; if (d.kind === 'water' || d.kind === 'fris') p.soft++; }
    }
    const list = Object.values(P).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    for (const p of list) p.avgDev = p.devN ? Math.round(p.devSum / p.devN * 10) / 10 : null;
    const sharp = list.filter(p => p.devN >= 2).sort((a, b) => a.avgDev - b.avgDev)[0] || null;
    const most = list.filter(p => p.drinks > 0).sort((a, b) => b.drinks - a.drinks)[0] || null;
    const soft = list.filter(p => p.soft > 0).sort((a, b) => b.soft - a.soft)[0] || null;
    return { list, kinds, totalCl, totalDrinks, drinks, best, sharp, most, soft, top: list[0] && list[0].points > 0 ? list[0] : null };
  }
  PG.stats = stats;

  // ── Verversen ──
  async function poll() {
    if (pollBusy || !session) return;
    pollBusy = true;
    try {
      const r = await fetch(`${PG.DB_URL}/games/${session.code}.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error('lezen mislukt');
      const g = await r.json();
      if (!g || !g.players || !g.players[session.pid]) { leave('Deze avond bestaat niet meer.'); return; }
      const json = JSON.stringify(g);
      if (json !== lastJson) { lastJson = json; game = g; render(); }
    } catch (e) { /* even geen verbinding: volgende keer opnieuw */ }
    finally { pollBusy = false; }
  }
  function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(poll, POLL_MS); poll(); }
  function leave(msg) {
    clearInterval(pollTimer); pollTimer = null;
    session = null; game = null; lastJson = ''; roundView = false; endedFor = null;
    store.set('pg.session', null); setTurn({});
    closeSheet(); show('start'); paintStart();
    if (msg) toast(msg);
  }
  function setTurn(t) { turn = t; store.set('pg.turn', t && t.rid ? t : null, true); }

  // ── Start ──
  function paintStart() {
    const s = store.get('pg.session');
    $('btnResume').hidden = !s;
    if (s) $('btnResume').textContent = `Verder met avond ${s.code}`;
    const code = new URLSearchParams(location.search).get('code');
    if (code && !$('joinCode').value) $('joinCode').value = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }
  function startErr(msg) { $('startErr').textContent = msg || ''; $('startErr').hidden = !msg; }

  function askName(title, button, onName) {
    sheetState = { kind: 'name', onName };
    openSheet(`<h2>${esc(title)}</h2>
      <form id="nameForm" autocomplete="off">
        <label class="label" for="nameInput">Hoe heet je?</label>
        <input id="nameInput" class="textinput" type="text" maxlength="16" placeholder="Je naam" value="${esc(store.get('pg.name') || '')}" autocapitalize="words">
        <p class="err" id="nameErr" hidden role="alert"></p>
        <button type="submit" class="btn">${esc(button)}</button>
      </form>`);
    $('nameInput').focus();
    $('nameForm').onsubmit = async e => {
      e.preventDefault();
      const name = $('nameInput').value.trim();
      const btn = e.target.querySelector('button');
      if (!name) { $('nameErr').textContent = 'Vul je naam in.'; $('nameErr').hidden = false; return; }
      btn.disabled = true;
      try { store.set('pg.name', name); await onName(name); closeSheet(); }
      catch (err) { $('nameErr').textContent = err.message; $('nameErr').hidden = false; }
      finally { btn.disabled = false; }
    };
  }
  async function enter(action, data) {
    const token = newToken();
    session = { token };
    try {
      const j = await api(action, data);
      session = { code: j.code, token, pid: j.pid };
      store.set('pg.session', session);
      history.replaceState(null, '', location.pathname);
      lastJson = ''; startPolling();
    } catch (e) { session = null; throw e; }
  }
  $('btnCreate').onclick = () => { startErr(''); askName('Avond starten', 'Start de avond', name => enter('create', { name })); };
  $('joinForm').onsubmit = e => {
    e.preventDefault(); startErr('');
    const code = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) return startErr('Een code heeft 6 tekens.');
    askName(`Meedoen met ${code}`, 'Doe mee', name => enter('join', { code, name }));
  };
  $('btnResume').onclick = () => { session = store.get('pg.session'); if (session) { lastJson = ''; startPolling(); } };

  // ── Tekenen ──
  function render() {
    if (!game) return;
    const cur = game.cur && game.rounds && game.rounds[game.cur];
    if (turn.rid && turn.rid !== game.cur) setTurn({});
    if (!cur) roundView = false;
    if (game.phase === 'ended') { show('ended'); if (endedFor !== session.code) { endedFor = session.code; renderEnded(); } return; }
    if (cur && roundView) { renderRound(cur); show('round'); }
    else { renderEvening(cur); show('evening'); }
  }

  function renderEvening(cur) {
    const s = stats(game), me = session.pid, isHost = game.hostPid === me;
    const max = Math.max(1, ...s.list.map(p => p.points));
    const rows = s.list.map((p, i) => `
      <div class="rank">
        <div class="rank-top"><span><span class="pos">${i + 1}</span>${esc(p.name)}${p.pid === me ? ' <span class="you">jij</span>' : ''}</span><span class="pts">${p.points}</span></div>
        <div class="bar"><i style="width:${Math.round(p.points / max * 100)}%"></i></div>
        <div class="rank-sub">${p.turns ? `${p.turns} ${p.turns === 1 ? 'beurt' : 'beurten'}${p.avgDev != null ? ` · gemiddeld ${num(p.avgDev)} ernaast` : ''}` : 'nog geen beurt'}${p.drinks ? ` · ${p.drinks} ${p.drinks === 1 ? 'glas' : 'glazen'}` : ''}</div>
      </div>`).join('');
    const last = s.drinks[s.drinks.length - 1];
    const tile = (key, label, teal) => `<div class="tile${teal ? ' teal' : ''}">${ICON[key]}<b>${s.kinds[key]}</b><span>${label}</span></div>`;
    let banner = '';
    if (cur) {
      const inIt = cur.who.includes(me), mine = cur.attempts && cur.attempts[me];
      banner = `<section class="card amber">
        <div class="label">Mikspel bezig</div>
        <div class="banner-title">${esc(MODES[cur.mode].name)} · ronde ${cur.n} van ${cur.of}</div>
        <button type="button" class="btn dark" data-act="to-round">${cur.done ? 'Bekijk de uitslag' : inIt && !mine ? 'Doe mee' : 'Kijk mee'}</button>
      </section>`;
    }
    $('evening').innerHTML = `
      <div class="top"><h1>Stand van de avond</h1><button type="button" class="chip code" data-act="share" aria-label="Code delen">${esc(session.code)}</button></div>
      ${banner}
      <section class="card">
        <div class="label">Beste mikkers</div>
        ${rows}
        ${s.list.length < 2 ? `<p class="fine">Je bent nog alleen. Deel de code <b>${esc(session.code)}</b> zodat de rest mee kan doen.</p>` : ''}
      </section>
      <section class="card dark">
        <div class="split"><div class="label">Drankjesteller</div><div class="total"><b>${s.totalDrinks}</b> ${s.totalDrinks === 1 ? 'glas' : 'glazen'}</div></div>
        <div class="tiles">${tile('bier', 'Bier')}${tile('wijn', 'Wijn')}${tile('fris', 'Fris', true)}${tile('water', 'Water', true)}</div>
        ${s.kinds.overig ? `<div class="fine light">En ${s.kinds.overig} keer iets anders.</div>` : ''}
        <div class="fine light">${last ? `Laatste: ${esc((game.players[last.pid] || {}).name || 'iemand')} telde ${esc(last.label)}. ${esc(last.note || '')}` : 'Nog niets geteld. Maak een foto van je glas, ook als het water is.'}</div>
      </section>
      <div class="actions">
        <button type="button" class="btn" data-act="drink">${ICON.camera}Nieuw glas tellen</button>
        <div class="two">
          <button type="button" class="btn line" data-act="new-game"${cur ? ' disabled' : ''}>Mikspel starten</button>
          <button type="button" class="btn line" data-act="my-drinks">Mijn glazen</button>
        </div>
        ${isHost ? '<button type="button" class="link" data-act="end">Avond afsluiten en aftermovie maken</button>' : '<p class="fine center">Wie de avond startte, sluit hem af. Dan komt de aftermovie.</p>'}
      </div>
      <p class="fine">Foto's worden na 48 uur automatisch gewist. Overslaan mag altijd.</p>`;
  }

  // Glas met voor- en na-peil en de doelstreep.
  function resultGlass(a, round) {
    const y = fill => 157 - Math.max(0, Math.min(100, fill)) / 100 * 147;
    const g = PG.glass(a.glass);
    const targetFill = round.unit === 'cl' ? a.beforeFill - (g.cl ? a.target / g.cl * 100 : 0) : a.beforeFill - a.target;
    return `<svg class="rglass" viewBox="-6 -6 132 182" role="img" aria-label="Glas: voor de slok ${num(a.beforeFill)} procent vol, erna ${num(a.afterFill)} procent">
      <defs><clipPath id="rin"><path d="M16 10 L104 10 L91 150 Q90 157 83 157 L37 157 Q30 157 29 150 Z"/></clipPath></defs>
      <g clip-path="url(#rin)">
        <rect x="0" y="${y(a.beforeFill)}" width="120" height="170" fill="#FFE9B8"/>
        <rect x="0" y="${y(a.afterFill)}" width="120" height="170" fill="#FFB000"/>
      </g>
      <path d="M12 8 L108 8 L94 150 Q93 160 83 160 L37 160 Q27 160 26 150 Z" fill="none" stroke="#24103F" stroke-width="6" stroke-linejoin="round"/>
      <line x1="-4" x2="124" y1="${y(targetFill)}" y2="${y(targetFill)}" stroke="#0A6F65" stroke-width="5" stroke-linecap="round" stroke-dasharray="10 9"/>
    </svg>`;
  }
  const unitOf = round => round.unit === 'cl' ? ' cl' : '%';
  function verdict(a, round) {
    if (round.unit === 'cl') return ({ 100: 'Roos. Midden in het bord.', 80: 'Binnenring. Netjes.', 55: 'Middenring. Kan ermee door.', 30: 'Buitenring. Net op het bord.', 10: 'Op het randje van het bord.' })[a.points] || 'Naast het bord.';
    if (a.dev <= 1) return 'Op de streep. Niets op aan te merken.';
    if (a.dev <= 3) return 'Bijna op de streep. Netjes.';
    if (a.dev <= 6) return 'Net ernaast. Het scheelt een slokje.';
    if (a.dev <= 12) return 'Ruim ernaast.';
    return a.value > a.target ? 'Dat was geen slok, dat was een besluit.' : 'Dat was meer nippen dan drinken.';
  }
  function resultCard(a, round) {
    const u = unitOf(round), level = ({ 'zeker': 4, 'redelijk zeker': 3, 'onzeker': 2 })[a.sure] || 1;
    return `<section class="card result">
        ${resultGlass(a, round)}
        <div class="result-side">
          <div class="label">Gedronken</div>
          <div class="bigval">${num(a.value)}${u.trim()}</div>
          <div class="legend"><span class="dash"></span><b>Doel ${num(a.target)}${u}</b></div>
          <div class="legend"><span class="sw soft"></span>Jouw slok</div>
          <div class="legend"><span class="sw"></span>Wat er nog in zit</div>
        </div>
      </section>
      <section class="card dark verdict">
        <div><div class="verdict-title">${num(a.dev)}${round.unit === 'cl' ? ' cl' : ' punt'} ernaast.</div><div class="fine light">${esc(verdict(a, round))}</div></div>
        <div class="score"><b>+${a.points + (a.bonus || 0)}</b><span>punten</span></div>
      </section>
      <section class="card sure">
        <div class="split"><span class="label">Zekerheid</span><span class="label ink">${esc(a.sure)} · ± ${num(a.margin)}</span></div>
        <div class="sure-bar">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</div>
        ${a.note ? `<div class="fine">${esc(a.note)}</div>` : ''}
      </section>`;
  }

  function renderRound(cur) {
    const me = session.pid, m = MODES[cur.mode], u = unitOf(cur);
    const mine = cur.attempts && cur.attempts[me];
    const inIt = cur.who.includes(me);
    const myBid = cur.bids && cur.bids[me];
    const target = cur.mode === 'bod' ? myBid : cur.target;
    const goalText = cur.mode === 'bod'
      ? (myBid ? `Jouw bod: drink precies ${myBid}% van je glas` : 'Zet je eigen doel vast')
      : cur.unit === 'cl' ? `Drink precies ${cur.target} cl` : `Drink precies ${cur.target}% van je glas`;

    // Mijn deel
    let panel = '';
    if (cur.done) {
      panel = mine && !mine.skip ? resultCard(mine, cur) : '';
    } else if (!inIt) {
      panel = `<section class="card"><p class="lead">Je kijkt deze ronde toe.</p><p class="fine">${cur.mode === 'duel' ? 'Dit is een duel tussen twee spelers.' : 'Je doet mee vanaf de volgende ronde.'}</p></section>`;
    } else if (mine && mine.skip) {
      panel = '<section class="card"><p class="lead">Je slaat deze ronde over.</p><p class="fine">Helemaal goed. Je doet de volgende ronde gewoon weer mee.</p></section>';
    } else if (mine) {
      panel = resultCard(mine, cur) + (mine.tries < 3 && turn.before ? '<button type="button" class="link" data-act="shot-after">Meting klopt niet? Na-foto opnieuw</button>' : '');
    } else if (cur.mode === 'bod' && !myBid) {
      const bid = (sheetState && sheetState.bid) || turn.bid || 20;
      turn.bid = bid;
      panel = `<section class="card">
          <div class="label">Jouw bod</div>
          <div class="stepper"><button type="button" class="round-btn" data-act="bid-down" aria-label="Minder">−</button><div class="bigval" id="bidVal">${bid}%</div><button type="button" class="round-btn" data-act="bid-up" aria-label="Meer">+</button></div>
          <p class="fine center">Zoveel van je glas ga je drinken. Kies iets wat bij je past; klein mag.</p>
          <button type="button" class="btn" data-act="bid-set">Bod vastzetten</button>
        </section>
        <button type="button" class="link" data-act="skip">${ICON.skip}Beurt overslaan</button>`;
    } else {
      const g = PG.glass(myGlass());
      const glassChip = `<button type="button" class="glasschip" data-act="glass">${PG.glassIcon(g)}<span><small>Jouw glas</small>${esc(g.name)}${g.cl ? ` · ${g.cl} cl` : ''}</span><em>Wijzig</em></button>`;
      const err = turn.error ? `<p class="err" role="alert">${esc(turn.error)}</p>` : '';
      if (!turn.before) {
        panel = `<section class="card">
            <div class="steps"><span class="on">1 Foto voor</span><span>2 Slok</span><span>3 Foto na</span></div>
            ${glassChip}${err}
            <button type="button" class="btn" data-act="shot-before">${ICON.camera}Foto van je glas maken</button>
          </section>
          <button type="button" class="link" data-act="skip">${ICON.skip}Beurt overslaan</button>`;
      } else {
        panel = `<section class="card">
            <div class="steps"><span class="done">1 Foto voor</span><span class="on">2 Slok</span><span class="on">3 Foto na</span></div>
            <div class="sip"><img src="${turn.before.thumb}" alt="Je glas voor de slok"><div><p class="lead">Neem nu je slok.</p><p class="fine">Mik op ${num(target)}${u}. Zet je glas daarna op dezelfde plek terug.</p></div></div>
            ${err}
            <button type="button" class="btn" data-act="shot-after">${ICON.camera}Foto na de slok maken</button>
            <button type="button" class="link" data-act="shot-before">Voor-foto opnieuw</button>
          </section>
          <button type="button" class="link" data-act="skip">${ICON.skip}Beurt overslaan</button>`;
      }
    }

    // Iedereen in deze ronde
    const order = cur.who.map(pid => ({ pid, name: (game.players[pid] || {}).name || '?', a: cur.attempts && cur.attempts[pid] }));
    if (cur.done) order.sort((x, y) => ((y.a && !y.a.skip ? y.a.points + (y.a.bonus || 0) : -1) - (x.a && !x.a.skip ? x.a.points + (x.a.bonus || 0) : -1)));
    const people = order.map(o => {
      let right = '<span class="state">bezig</span>';
      if (o.a && o.a.skip) right = '<span class="state">overgeslagen</span>';
      else if (o.a) right = `<span class="state done">${num(o.a.value)}${u.trim()} · ${num(o.a.dev)} ernaast</span><span class="pts">+${o.a.points + (o.a.bonus || 0)}</span>`;
      else if (cur.done) right = '<span class="state">niet gemeten</span>';
      else if (cur.mode === 'bod' && cur.bids && cur.bids[o.pid]) right = `<span class="state">mikt op ${cur.bids[o.pid]}%</span>`;
      return `<div class="person"><span class="pname">${esc(o.name)}${o.pid === me ? ' <span class="you">jij</span>' : ''}${o.a && o.a.bonus ? ' <span class="you teal">duelbonus</span>' : ''}</span>${right}</div>`;
    }).join('');

    let foot = '';
    if (cur.done) {
      foot = cur.n < cur.of
        ? '<button type="button" class="btn" data-act="next-round">Volgende ronde</button><button type="button" class="link" data-act="stop-game">Terug naar de stand</button>'
        : '<button type="button" class="btn" data-act="stop-game">Terug naar de stand</button>';
    } else {
      const waiting = cur.who.filter(pid => !(cur.attempts && cur.attempts[pid])).length;
      foot = `${(mine || !inIt) && waiting ? `<button type="button" class="btn line" data-act="close-round">Niet langer wachten: ronde afsluiten</button>` : ''}
        <button type="button" class="link" data-act="to-evening">Naar de stand</button>`;
    }

    $('round').innerHTML = `
      <div class="top"><div class="label">${esc(m.name)} · ronde ${cur.n} van ${cur.of}</div><span class="chip">${esc((game.players[me] || {}).name || '')}</span></div>
      <div class="goalcard"><div class="label teal">${cur.done ? 'Uitslag van deze ronde' : 'Het doel'}</div><h1>${esc(goalText)}</h1></div>
      ${panel}
      <section class="card">
        <div class="label">${cur.done ? 'Uitslag' : 'Wie is er klaar?'}</div>
        ${people}
      </section>
      <div class="actions">${foot}</div>`;
  }

  // ── Einde: aftermovie ──
  function renderEnded() {
    const s = stats(game);
    const stat = (value, label, teal) => `<div class="stat"><b class="${teal ? 'teal' : ''}">${esc(value)}</b><span>${esc(label)}</span></div>`;
    const cards = [stat(String(s.totalDrinks), s.totalDrinks === 1 ? 'glas geteld' : 'glazen geteld')];
    if (s.totalCl) cards.push(stat(`${num(Math.round(s.totalCl / 10) / 10)} l`, 'samen gedronken (ongeveer)'));
    if (s.top) cards.push(stat(s.top.name, `meeste mikpunten: ${s.top.points}`, true));
    if (s.sharp) cards.push(stat(s.sharp.name, `scherpste mikker: gemiddeld ${num(s.sharp.avgDev)} ernaast`, true));
    if (s.best) cards.push(stat(`${num(s.best.dev)} punt`, `beste slok, van ${s.best.name}`, true));
    if (s.most) cards.push(stat(s.most.name, `meeste glazen geteld: ${s.most.drinks}`));
    if (s.soft) cards.push(stat(s.soft.name, 'waterkampioen'));
    const max = Math.max(1, ...s.list.map(p => p.points));
    $('ended').innerHTML = `
      <div><div class="label">De avond zit erop</div><h1>Jullie aftermovie</h1></div>
      <div class="moviebox" id="movieBox">
        <canvas id="movieCanvas" width="720" height="1280"></canvas>
      </div>
      <div class="actions">
        <button type="button" class="btn" id="btnMovie" data-act="movie">Aftermovie maken</button>
        <a class="btn" id="btnDownload" hidden>Filmpje downloaden</a>
        <button type="button" class="btn line light" id="btnShare" data-act="movie-share" hidden>Delen met de groep</button>
        <p class="fine light center" id="movieNote">Het filmpje wordt op je eigen telefoon gemaakt en duurt ongeveer een halve minuut. Houd dit scherm open.</p>
      </div>
      <div class="stats">${cards.join('')}</div>
      <section class="card ink">
        <div class="label">Eindstand mikkers</div>
        ${s.list.map((p, i) => `<div class="rank"><div class="rank-top"><span><span class="pos">${i + 1}</span>${esc(p.name)}</span><span class="pts">${p.points}</span></div><div class="bar"><i style="width:${Math.round(p.points / max * 100)}%"></i></div></div>`).join('')}
      </section>
      <p class="fine light center">Foto's verdwijnen 48 uur na de start van de avond van onze server. Bewaar het filmpje dus op je telefoon.</p>
      <button type="button" class="link light" data-act="home">Terug naar het begin</button>`;
    PG.moviePoster && PG.moviePoster($('movieCanvas'), game, s);
  }

  // ── Schuifbladen ──
  function gameSheet() {
    const st = sheetState, others = Object.entries(game.players).filter(([pid]) => pid !== session.pid);
    const modes = Object.entries(MODES).map(([id, m]) => `
      <button type="button" class="option${st.mode === id ? ' on' : ''}" data-act="pick-mode" data-id="${id}"${id === 'duel' && !others.length ? ' disabled' : ''}>
        <b>${esc(m.name)}</b><span>${esc(m.how)}</span>
      </button>`).join('');
    const extra = st.mode === 'duel'
      ? `<div class="label">Tegen wie?</div><div class="chips">${others.map(([pid, p]) => `<button type="button" class="pill${st.opponent === pid ? ' on' : ''}" data-act="pick-opp" data-id="${pid}">${esc(p.name)}</button>`).join('')}</div>`
      : '';
    openSheet(`<h2>Mikspel starten</h2>
      <div class="options">${modes}</div>
      ${extra}
      <div class="label">Aantal rondes</div>
      <div class="chips">${[1, 3, 5].map(n => `<button type="button" class="pill${st.rounds === n ? ' on' : ''}" data-act="pick-rounds" data-id="${n}">${n}</button>`).join('')}</div>
      <button type="button" class="btn" data-act="start-game"${st.mode === 'duel' && !st.opponent ? ' disabled' : ''}>Start ${esc(MODES[st.mode].name)}</button>
      <button type="button" class="link" data-act="sheet-close">Annuleren</button>`);
    sheetState = st;
  }
  function glassSheet() {
    const cur = myGlass();
    openSheet(`<h2>Welk glas heb je?</h2>
      <div class="glasses">${PG.GLASSES.map(g => `<button type="button" class="glassopt${g.id === cur ? ' on' : ''}" data-act="pick-glass" data-id="${g.id}">${PG.glassIcon(g)}<span>${esc(g.name)}<small>${esc(g.sub)}</small></span></button>`).join('')}</div>
      <p class="fine">Weet je het niet? Kies "Weet ik niet", dan kijkt de AI zelf.</p>`);
  }
  function drinksSheet() {
    const mine = stats(game).drinks.filter(d => d.pid === session.pid).reverse();
    const time = at => new Date(at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    openSheet(`<h2>Mijn glazen</h2>
      ${mine.length ? mine.map(d => `<div class="person"><span class="pname">${esc(d.label)} <span class="state">${time(d.at)} · ongeveer ${d.cl} cl</span></span><button type="button" class="pill" data-act="fix-drink" data-id="${d.id}">Klopt niet</button></div>`).join('') : '<p class="fine">Je hebt nog niets geteld.</p>'}
      <button type="button" class="link" data-act="sheet-close">Sluiten</button>`);
  }
  function fixSheet(id, fresh) {
    const d = game.drinks && game.drinks[id];
    const label = d ? d.label : (fresh && fresh.label) || 'drankje';
    openSheet(`<h2>Wat was het dan?</h2>
      <p class="fine">De AI dacht: ${esc(label)}.</p>
      <div class="chips">${Object.entries(KINDS).map(([k, name]) => `<button type="button" class="pill" data-act="fix-kind" data-id="${id}" data-kind="${k}">${esc(name)}</button>`).join('')}</div>
      <button type="button" class="link" data-act="fix-remove" data-id="${id}">Dit glas niet tellen</button>
      <button type="button" class="link" data-act="sheet-close">Annuleren</button>`);
  }
  function confirmSheet(title, text, button, act) {
    openSheet(`<h2>${esc(title)}</h2><p class="fine">${esc(text)}</p>
      <button type="button" class="btn" data-act="${act}">${esc(button)}</button>
      <button type="button" class="link" data-act="sheet-close">Annuleren</button>`);
  }

  // ── Foto's en beurten ──
  async function shotBefore() {
    const shot = await PG.camera({ step: 'Foto 1 van 2', title: 'Eerst je glas voor de slok', glass: myGlass(), hint: 'Zet het glas rechtop op tafel en vul het kader van rand tot bodem. Schuim telt niet mee.' });
    if (!shot) return;
    setTurn({ rid: game.cur, before: shot, bid: turn.bid });
    renderRound(game.rounds[game.cur]);
  }
  async function shotAfter() {
    if (!turn.before) return shotBefore();
    const shot = await PG.camera({ step: 'Foto 2 van 2', title: 'Nu hetzelfde glas na de slok', glass: myGlass(), ghost: turn.before.thumb, hint: 'Zet het glas op dezelfde plek. Je ziet je eerste foto er vaag doorheen: leg ze over elkaar.' });
    if (!shot) return;
    busy('De AI meet je slok. Dit duurt een paar tellen.');
    try {
      await api('attempt', { before: turn.before.full, after: shot.full, thumbBefore: turn.before.thumb, thumbAfter: shot.thumb, glass: myGlass() });
      setTurn({ rid: turn.rid, before: turn.before });
    } catch (e) {
      setTurn({ rid: turn.rid, before: turn.before, error: e.message });
    }
    busy('');
    await poll();
    if (game && game.cur && roundView) renderRound(game.rounds[game.cur]);
  }
  async function countDrink() {
    const shot = await PG.camera({ step: 'Drankjesteller', title: 'Maak een foto van je nieuwe glas', frame: false, hint: 'Zorg dat het glas goed in beeld is. Water en fris tellen ook.' });
    if (!shot) return;
    busy('De AI kijkt wat er in je glas zit.');
    try {
      const j = await api('drink', { photo: shot.full, thumb: shot.thumb });
      busy('');
      await poll();
      openSheet(`<h2>Geteld: ${esc(j.drink.label)}</h2>
        <p class="lead">Ongeveer ${j.drink.cl} cl.</p>
        <p class="fine">${esc(j.drink.note || '')}</p>
        <button type="button" class="btn" data-act="sheet-close">Klopt</button>
        <button type="button" class="link" data-act="fix-drink" data-id="${j.id}">Klopt niet</button>`);
    } catch (e) { busy(''); toast(e.message); }
  }

  // ── Knoppen ──
  const acts = {
    'sheet-close': () => closeSheet(),
    'to-round': () => { roundView = true; render(); window.scrollTo(0, 0); },
    'to-evening': () => { roundView = false; render(); window.scrollTo(0, 0); },
    share: async () => {
      const url = `${location.origin}/?code=${session.code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Peilglas', text: `Doe mee met Peilglas. Code: ${session.code}`, url });
        else { await navigator.clipboard.writeText(url); toast('Link gekopieerd.'); }
      } catch (e) { /* delen afgebroken */ }
    },
    drink: () => countDrink(),
    'my-drinks': () => drinksSheet(),
    'fix-drink': el => fixSheet(el.dataset.id),
    'fix-kind': el => guard(el, async () => { await api('drinkFix', { id: el.dataset.id, kind: el.dataset.kind }); closeSheet(); await poll(); toast('Aangepast.'); }),
    'fix-remove': el => guard(el, async () => { await api('drinkFix', { id: el.dataset.id, remove: true }); closeSheet(); await poll(); toast('Dit glas telt niet mee.'); }),
    'new-game': () => { sheetState = { kind: 'game', mode: 'streep', rounds: 3, opponent: null }; gameSheet(); },
    'pick-mode': el => { sheetState.mode = el.dataset.id; gameSheet(); },
    'pick-opp': el => { sheetState.opponent = el.dataset.id; gameSheet(); },
    'pick-rounds': el => { sheetState.rounds = Number(el.dataset.id); gameSheet(); },
    'start-game': el => guard(el, async () => {
      const st = sheetState;
      await api('startGame', { mode: st.mode, rounds: st.rounds, opponent: st.opponent });
      closeSheet(); roundView = true; await poll(); window.scrollTo(0, 0);
    }),
    glass: () => glassSheet(),
    'pick-glass': el => { store.set('pg.glass', el.dataset.id); closeSheet(); render(); },
    'shot-before': () => shotBefore(),
    'shot-after': () => shotAfter(),
    'bid-down': () => { turn.bid = Math.max(5, (turn.bid || 20) - 5); $('bidVal').textContent = turn.bid + '%'; },
    'bid-up': () => { turn.bid = Math.min(40, (turn.bid || 20) + 5); $('bidVal').textContent = turn.bid + '%'; },
    'bid-set': el => guard(el, async () => { await api('bid', { bid: turn.bid || 20 }); await poll(); }),
    skip: el => guard(el, async () => { await api('skip'); setTurn({}); await poll(); }),
    'close-round': el => guard(el, async () => { await api('closeRound'); await poll(); }),
    'next-round': el => guard(el, async () => { await api('nextRound'); setTurn({}); await poll(); window.scrollTo(0, 0); }),
    'stop-game': el => guard(el, async () => { await api('stopGame'); roundView = false; await poll(); window.scrollTo(0, 0); }),
    end: () => confirmSheet('Avond afsluiten?', 'Daarna kan niemand meer mikken of glazen tellen. Iedereen krijgt de eindstand en de aftermovie te zien.', 'Ja, sluit de avond af', 'end-yes'),
    'end-yes': el => guard(el, async () => { await api('endEvening'); closeSheet(); await poll(); window.scrollTo(0, 0); }),
    movie: el => PG.runMovie && PG.runMovie(el, game, session.code),
    'movie-share': () => PG.shareMovie && PG.shareMovie(),
    home: () => leave(''),
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = acts[el.dataset.act];
    if (fn) fn(el);
  });
  $('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  PG.toast = toast; PG.busy = busy;

  // ── Begin ──
  paintStart();
  if (session && session.code) startPolling();
})();
