/* ══════════════════════════════════════════════════════════════
   PEILGLAS — startscherm
   1. Leeftijdsvraag (antwoord wordt op dit toestel onthouden).
   2. De animatie "de perfecte slok": het glas schenkt in, het peil zakt in
      een paar slokken naar de doelstreep, schiet er net voorbij, golft terug
      en blijft op de streep staan. Daarna opnieuw met een ander doel.
   Wie op zijn telefoon "minder beweging" aan heeft staan, ziet een stilstaand beeld.
   ══════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);

  // ── 18+ ──
  let adult = false;
  try { adult = localStorage.getItem('pg.adult') === '1'; } catch (e) { /* geen opslag: gewoon elke keer vragen */ }
  if (!adult) $('gate').hidden = false;
  $('gateYes').onclick = () => {
    try { localStorage.setItem('pg.adult', '1'); } catch (e) { /* niet erg */ }
    $('gate').hidden = true;
  };
  $('gateNo').onclick = () => {
    $('gateTitle').textContent = 'Dan is dit spel niet voor jou.';
    $('gateText').textContent = 'Peilglas is alleen voor wie 18 jaar of ouder is. Tot later.';
    $('gateYes').hidden = true; $('gateNo').hidden = true;
  };

  // ── Animatie ──
  const BOTTOM = 157, RIM = 10, FULL = 0.9;          // binnenkant van het glas in de tekening
  const yOf = level => BOTTOM - level * (BOTTOM - RIM);
  const liquid = $('liquid'), foam = $('foam'), target = $('target'), bubblesEl = $('bubbles');
  const s = { level: FULL, amp: 1.2, foam: 4, time: 0, start: FULL, goal: 30, counting: false };

  function surface(base, t, amp, phase) {
    let d = '';
    for (let x = 0; x <= 120; x += 6) {
      const y = base + amp * Math.sin(x * 0.085 + t * 3.1 + phase) + amp * 0.45 * Math.sin(x * 0.19 - t * 4.3 + phase);
      d += (x ? ' L' : 'M') + x + ' ' + y.toFixed(2);
    }
    return d + ' L120 170 L0 170 Z';
  }
  function draw() {
    const y = yOf(s.level);
    liquid.setAttribute('d', surface(y, s.time, s.amp, 0));
    foam.setAttribute('d', surface(y - s.foam, s.time * 0.6, s.amp * 0.5 + 0.8, 1.7));
    if (s.counting) $('count').textContent = Math.max(0, Math.round((s.start - s.level) * 100)) + '%';
  }
  function setTarget(level, goal) {
    const y = yOf(level);
    target.setAttribute('y1', y); target.setAttribute('y2', y);
    $('goal').textContent = goal + '%';
  }

  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) { // stilstaand beeld: de slok staat precies op de streep
    s.level = FULL - 0.3; s.amp = 0; s.foam = 3;
    setTarget(s.level, 30); draw();
    $('count').textContent = '30%'; $('hit').classList.add('on');
    return;
  }

  // Belletjes
  const NS = 'http://www.w3.org/2000/svg';
  const bubbles = Array.from({ length: 9 }, () => {
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('fill', '#fff'); el.setAttribute('opacity', '.6');
    bubblesEl.appendChild(el);
    const b = { el, x: 0, y: 0, r: 1, v: 0, w: 0 };
    reset(b, true);
    return b;
  });
  function reset(b, anywhere) {
    b.x = 36 + Math.random() * 50; b.r = 1 + Math.random() * 1.8; b.v = 14 + Math.random() * 20; b.w = Math.random() * 6;
    b.y = anywhere ? BOTTOM - Math.random() * 120 : BOTTOM + Math.random() * 10;
  }
  function moveBubbles(dt) {
    const top = yOf(s.level) + 3;
    for (const b of bubbles) {
      b.y -= b.v * dt;
      if (b.y < top) reset(b, false);
      b.el.setAttribute('cx', (b.x + Math.sin(s.time * 2 + b.w) * 1.5).toFixed(1));
      b.el.setAttribute('cy', b.y.toFixed(1));
      b.el.setAttribute('r', b.r.toFixed(1));
    }
  }

  // Eigen klok: staat stil als het tabblad niet zichtbaar is.
  const tweens = [];
  let last = 0;
  function frame(now) {
    if (window.PG && PG.animPaused) { last = now; return requestAnimationFrame(frame); } // startscherm niet in beeld
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now; s.time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt * 1000;
      const p = Math.min(1, tw.t / tw.dur);
      if (tw.key) s[tw.key] = tw.from + (tw.to - tw.from) * tw.ease(p);
      if (p >= 1) { tweens.splice(i, 1); tw.done(); }
    }
    s.amp += (1.2 - s.amp) * Math.min(1, dt * 2.2); // golven komen vanzelf tot rust
    moveBubbles(dt); draw();
    requestAnimationFrame(frame);
  }
  const ease = {
    out: p => 1 - Math.pow(1 - p, 3),
    inOut: p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
    settle: p => 1 - Math.cos(p * Math.PI * 2.5) * Math.exp(-p * 4.5), // dempende golf rond het eindpunt
  };
  const tween = (key, to, dur, fn) => new Promise(done => tweens.push({ key, from: s[key], to, dur, ease: fn || ease.inOut, t: 0, done }));
  const wait = ms => new Promise(done => tweens.push({ key: null, dur: ms, t: 0, ease: p => p, done }));

  async function pour() {
    s.amp = 6; s.foam = 6;
    tween('foam', 18, 1100, ease.out);
    await tween('level', FULL, 1500, ease.out);
    await tween('foam', 4, 1300, ease.inOut);
  }

  async function run() {
    s.level = 0.03; s.counting = false;
    target.classList.add('off');
    const goals = [30, 20, 45, 25, 50, 35];
    for (let round = 0; ; round++) {
      $('count').textContent = '0%';
      await pour();
      const goal = goals[round % goals.length];
      s.start = s.level; s.goal = goal;
      const end = s.start - goal / 100;
      setTarget(end, goal);
      target.classList.remove('off', 'hit');
      $('count').textContent = '0%'; s.counting = true;
      await wait(900);
      const sips = goal >= 40 ? [0.4, 0.75] : [0.55];
      for (const part of sips) {
        s.amp = 4.5;
        await tween('level', s.start - (goal / 100) * part, 520);
        await wait(480);
      }
      s.amp = 5;
      await tween('level', end - 0.03, 420);            // net te ver
      await tween('level', end, 900, ease.settle);       // en terug op de streep
      s.counting = false; $('count').textContent = goal + '%';
      target.classList.add('hit'); $('hit').classList.add('on');
      await wait(2400);
      $('hit').classList.remove('on'); target.classList.add('off');
      await wait(400);
    }
  }

  requestAnimationFrame(now => { last = now; requestAnimationFrame(frame); });
  run();
})();
