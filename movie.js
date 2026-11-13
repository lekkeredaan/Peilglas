/* ══════════════════════════════════════════════════════════════
   PEILGLAS — aftermovie
   Wordt helemaal op de telefoon gemaakt: de scènes worden op een canvas (720 x 1280) getekend
   en tegelijk opgenomen. Geen geluid. Opbouw: titel, foto's van de avond, cijfers, eindstand, slot.
   Kan de telefoon geen video opnemen, dan speelt de film alleen af en is de eindstand als
   afbeelding te bewaren.
   ══════════════════════════════════════════════════════════════ */
(function () {
  const W = 720, H = 1280;
  const C = { ink: '#24103F', mist: '#F3EEFA', amber: '#FFB000', soft: '#FFE9B8', teal: '#2FE0CC', tealDeep: '#0A6F65', dark: '#150A26', lilac: '#C9B8E8', white: '#fff' };
  const F = { display: w => `${w} %px Unbounded, sans-serif`, body: w => `${w} %px "Instrument Sans", sans-serif`, mono: () => '500 %px "DM Mono", monospace' };
  const font = (f, size) => f.replace('%', size);
  const num = x => String(x).replace('.', ',');
  const ease = p => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  let result = null; // { blob, type, url }

  function text(ctx, str, x, y, f, size, color, align) {
    ctx.font = font(f, size); ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  }
  // Past de lettergrootte aan tot de tekst binnen de breedte valt.
  function fit(ctx, str, x, y, f, size, maxW, color, align) {
    let s = size;
    ctx.font = font(f, s);
    while (s > 24 && ctx.measureText(str).width > maxW) { s -= 4; ctx.font = font(f, s); }
    text(ctx, str, x, y, f, s, color, align);
  }
  function wrap(ctx, str, x, y, f, size, maxW, lineH, color, align) {
    ctx.font = font(f, size);
    const words = String(str).split(' '); let line = '', yy = y;
    for (const w of words) {
      if (line && ctx.measureText(line + ' ' + w).width > maxW) { text(ctx, line, x, yy, f, size, color, align); line = w; yy += lineH; }
      else line = line ? line + ' ' + w : w;
    }
    if (line) text(ctx, line, x, yy, f, size, color, align);
    return yy;
  }
  function ruler(ctx, color, alpha) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
    for (let y = 20; y < H; y += 40) ctx.fillRect(W - 34, y, y % 200 === 20 ? 34 : 20, 4);
    ctx.restore();
  }
  // Het glas uit het logo, met een peil (0..1) en een golvend oppervlak.
  function glass(ctx, cx, top, scale, level, time, line) {
    ctx.save(); ctx.translate(cx - 60 * scale, top); ctx.scale(scale, scale);
    const inside = new Path2D('M16 10 L104 10 L91 150 Q90 157 83 157 L37 157 Q30 157 29 150 Z');
    ctx.save(); ctx.clip(inside);
    const y = 157 - level * 147;
    ctx.beginPath(); ctx.moveTo(0, 170);
    for (let x = 0; x <= 120; x += 6) ctx.lineTo(x, y + 2 * Math.sin(x * 0.09 + time * 3));
    ctx.lineTo(120, 170); ctx.closePath(); ctx.fillStyle = C.amber; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = line;
    ctx.stroke(new Path2D('M12 8 L108 8 L94 150 Q93 160 83 160 L37 160 Q27 160 26 150 Z'));
    ctx.restore();
  }
  function dashed(ctx, y, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.setLineDash([22, 20]);
    ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke(); ctx.restore();
  }

  // ── Scènes ──
  function titleScene(game, s) {
    const date = new Date(game.createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
    const rounds = Object.keys(game.rounds || {}).length;
    return { dur: 2.6, draw(ctx, p, t) {
      ctx.fillStyle = C.mist; ctx.fillRect(0, 0, W, H); ruler(ctx, C.ink, 0.22);
      glass(ctx, W / 2, 190, 3.2, 0.08 + 0.62 * ease(p * 1.4), t, C.ink);
      text(ctx, 'EEN AVOND', 60, 860, F.mono(), 30, '#5B4A78');
      fit(ctx, 'PEILGLAS', 56, 960, F.display(900), 104, W - 120, C.ink);
      text(ctx, date, 60, 1030, F.body(600), 40, '#5B4A78');
      text(ctx, `${s.list.length} ${s.list.length === 1 ? 'speler' : 'spelers'} · ${rounds} ${rounds === 1 ? 'mikronde' : 'mikrondes'} · ${s.totalDrinks} ${s.totalDrinks === 1 ? 'glas' : 'glazen'}`, 60, 1090, F.mono(), 28, '#5B4A78');
    } };
  }
  function photoScene(ph) {
    return { dur: 1.15, draw(ctx, p) {
      const img = ph.img, z = 1 + 0.08 * p;
      const sc = Math.max(W / img.width, H / img.height) * z;
      const w = img.width * sc, h = img.height * sc;
      ctx.fillStyle = C.dark; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      ruler(ctx, C.white, 0.4);
      ctx.fillStyle = C.amber; ctx.fillRect(0, H - 230, W, 230);
      dashed(ctx, H - 230, C.teal);
      text(ctx, ph.name.toUpperCase(), 56, H - 150, F.mono(), 30, C.ink);
      fit(ctx, ph.caption, 56, H - 76, F.display(700), 54, W - 112, C.ink);
    } };
  }
  function statScene(st) {
    return { dur: 2.3, draw(ctx, p, t) {
      ctx.fillStyle = C.dark; ctx.fillRect(0, 0, W, H); ruler(ctx, C.mist, 0.25);
      const lift = 150 + 90 * ease(p * 1.6);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) ctx.lineTo(x, H - lift + 8 * Math.sin(x * 0.012 + t * 2.4));
      ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = C.amber; ctx.fill();
      text(ctx, st.label, 60, 430, F.mono(), 32, C.lilac);
      let value = st.value;
      if (typeof st.count === 'number') value = st.format(Math.round(st.count * ease(p * 1.8) * (st.decimals ? 10 : 1)) / (st.decimals ? 10 : 1));
      fit(ctx, value, 56, 590, F.display(900), 150, W - 112, st.teal ? C.teal : C.amber);
      wrap(ctx, st.sub, 60, 680, F.body(600), 42, W - 120, 54, '#E4DAF5');
    } };
  }
  function rankScene(s) {
    const rows = s.list.slice(0, 6), max = Math.max(1, ...rows.map(r => r.points));
    return { dur: 3.4, draw(ctx, p) {
      ctx.fillStyle = C.mist; ctx.fillRect(0, 0, W, H); ruler(ctx, C.ink, 0.22);
      text(ctx, 'EINDSTAND MIKKERS', 60, 200, F.mono(), 32, '#5B4A78');
      rows.forEach((r, i) => {
        const y = 310 + i * 150, grow = ease(p * 2 - i * 0.12);
        text(ctx, String(i + 1), 60, y, F.mono(), 34, '#5B4A78');
        fit(ctx, r.name, 110, y, F.display(700), 46, 380, C.ink);
        text(ctx, String(Math.round(r.points * grow)), W - 70, y, F.display(900), 46, C.ink, 'right');
        ctx.fillStyle = C.white; ctx.fillRect(60, y + 24, W - 130, 30);
        ctx.fillStyle = C.amber; ctx.fillRect(60, y + 24, (W - 130) * (r.points / max) * grow, 30);
      });
    } };
  }
  function endScene() {
    return { dur: 2.0, draw(ctx, p, t) {
      ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H); ruler(ctx, C.mist, 0.25);
      glass(ctx, W / 2, 260, 2.4, 0.55, t, C.mist);
      dashed(ctx, 260 + (157 - 0.55 * 147) * 2.4, C.teal);
      fit(ctx, 'PEILGLAS', W / 2, 860, F.display(900), 88, W - 120, C.mist, 'center');
      text(ctx, 'Mik je slok. De camera meet de rest.', W / 2, 930, F.body(600), 36, C.lilac, 'center');
      text(ctx, 'peilglas.ravotters.nl', W / 2, 1010, F.mono(), 32, C.amber, 'center');
    } };
  }

  function statList(s) {
    const out = [];
    const parts = [['bier', 'bier'], ['wijn', 'wijn'], ['fris', 'fris'], ['water', 'water'], ['overig', 'anders']].filter(([k]) => s.kinds[k]).map(([k, n]) => `${s.kinds[k]} ${n}`);
    if (s.totalDrinks) out.push({ label: 'GLAZEN GETELD', count: s.totalDrinks, format: v => String(v), sub: parts.join(' · ') });
    if (s.totalCl) out.push({ label: 'SAMEN GEDRONKEN', count: Math.round(s.totalCl / 10) / 10, decimals: true, format: v => `${num(v)} l`, sub: 'Ongeveer, volgens de drankjesteller. Water en fris tellen mee.' });
    if (s.top) out.push({ label: 'MEESTE MIKPUNTEN', value: s.top.name, sub: `${s.top.points} punten in ${s.top.turns} ${s.top.turns === 1 ? 'beurt' : 'beurten'}.`, teal: true });
    if (s.sharp && (!s.top || s.sharp.pid !== s.top.pid)) out.push({ label: 'SCHERPSTE MIKKER', value: s.sharp.name, sub: `Gemiddeld ${num(s.sharp.avgDev)}% naast de streep.`, teal: true });
    if (s.best) out.push({ label: 'BESTE SLOK VAN DE AVOND', value: s.best.name, sub: `${num(s.best.value)}% gedronken bij een doel van ${num(s.best.target)}%. Dat is ${num(s.best.dev)}% ernaast.`, teal: true });
    if (s.most) out.push({ label: 'DE PINEUT', value: s.most.name, sub: `${s.most.drinks} ${s.most.drinks === 1 ? 'glas' : 'glazen'} geteld. Water telt net zo hard.` });
    if (s.soft) out.push({ label: 'WATERKAMPIOEN', value: s.soft.name, sub: `${s.soft.soft} keer water of fris. Verstandig.` });
    return out;
  }

  // Welke foto's komen in de film? Glazen van de teller en na-foto's van mikbeurten, hooguit twaalf.
  function photoList(game) {
    const all = [];
    const nameOf = pid => (game.players[pid] || {}).name || '';
    for (const d of Object.values(game.drinks || {})) if (d.photo) all.push({ id: d.photo, at: d.at, name: nameOf(d.pid), caption: d.label });
    for (const r of Object.values(game.rounds || {})) for (const [pid, a] of Object.entries(r.attempts || {})) {
      if (a.pa) all.push({ id: a.pa, at: a.at, name: nameOf(pid), caption: `${num(a.value)}${r.unit === 'cl' ? ' cl' : '%'} · doel ${num(a.target)}` });
    }
    all.sort((a, b) => a.at - b.at);
    const MAX = 12;
    if (all.length <= MAX) return all;
    return Array.from({ length: MAX }, (_, i) => all[Math.round(i * (all.length - 1) / (MAX - 1))]);
  }
  async function loadPhoto(code, ph) {
    try {
      const r = await fetch(`${PG.DB_URL}/photos/${code}/${ph.id}.json`, { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (!j || !j.d) return null;
      const img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/jpeg;base64,' + j.d; });
      return { ...ph, img };
    } catch (e) { return null; }
  }

  function recorderFor(canvas) {
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') return null;
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const type = types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
    if (!type) return null;
    try {
      const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 4000000 });
      return { rec, type };
    } catch (e) { return null; }
  }

  function play(canvas, scenes, onProgress) {
    const ctx = canvas.getContext('2d');
    const total = scenes.reduce((a, s) => a + s.dur, 0);
    return new Promise(done => {
      let start = null;
      function frame(now) {
        if (start === null) start = now;
        const t = (now - start) / 1000;
        let acc = 0, sc = scenes[scenes.length - 1], local = 1;
        for (const s of scenes) { if (t < acc + s.dur) { sc = s; local = (t - acc) / s.dur; break; } acc += s.dur; }
        ctx.save(); sc.draw(ctx, Math.min(1, local), t); ctx.restore();
        onProgress && onProgress(Math.min(1, t / total));
        if (t >= total) return done();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  async function fontsReady() {
    try {
      await Promise.all(['900 80px Unbounded', '700 40px Unbounded', '600 40px "Instrument Sans"', '500 30px "DM Mono"'].map(f => document.fonts.load(f)));
    } catch (e) { /* dan met de standaardletter */ }
  }

  // Stilstaand voorblad, zolang de film nog niet is gemaakt.
  PG.moviePoster = async function (canvas, game, s) {
    await fontsReady();
    titleScene(game, s).draw(canvas.getContext('2d'), 1, 0);
  };

  PG.runMovie = async function (btn, game, code) {
    const $ = id => document.getElementById(id);
    const note = $('movieNote');
    btn.disabled = true;
    try {
      const s = PG.stats(game);
      note.textContent = 'Foto\'s van de avond ophalen.';
      await fontsReady();
      const photos = (await Promise.all(photoList(game).map(ph => loadPhoto(code, ph)))).filter(Boolean);
      const scenes = [titleScene(game, s), ...photos.map(photoScene), ...statList(s).map(statScene), rankScene(s), endScene()];

      // Na een eerdere keer staat er een video; zet het canvas terug.
      let canvas = $('movieCanvas');
      if (!canvas) { $('movieBox').innerHTML = '<canvas id="movieCanvas" width="720" height="1280"></canvas>'; canvas = $('movieCanvas'); }
      if (result) { URL.revokeObjectURL(result.url); result = null; }

      const r = recorderFor(canvas);
      const chunks = [];
      let stopped = null;
      if (r) {
        r.rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        stopped = new Promise(ok => { r.rec.onstop = ok; });
        r.rec.start(500);
      }
      await play(canvas, scenes, p => { btn.textContent = `Film maken: ${Math.round(p * 100)}%`; note.textContent = 'Houd dit scherm open tot de film klaar is.'; });
      if (r) { r.rec.stop(); await stopped; }

      const blob = chunks.length ? new Blob(chunks, { type: r.type.split(';')[0] }) : null;
      if (blob && blob.size > 20000) {
        const ext = r.type.startsWith('video/mp4') ? 'mp4' : 'webm';
        result = { blob, type: blob.type, url: URL.createObjectURL(blob), name: `peilglas-aftermovie.${ext}` };
        $('movieBox').innerHTML = `<video id="movieVideo" src="${result.url}" controls playsinline loop muted></video>`;
        const dl = $('btnDownload');
        dl.href = result.url; dl.download = result.name; dl.textContent = 'Filmpje downloaden'; dl.hidden = false;
        let canShare = false;
        try { canShare = !!navigator.canShare && navigator.canShare({ files: [new File([blob], result.name, { type: result.type })] }); } catch (e) { canShare = false; }
        $('btnShare').hidden = !canShare;
        btn.textContent = 'Opnieuw maken'; btn.className = 'link light';
        note.textContent = ext === 'mp4' ? 'Klaar. Bewaar het filmpje op je telefoon.' : 'Klaar. Dit toestel maakt een webm-bestand; niet elke app speelt dat af.';
      } else {
        // Opnemen lukt hier niet: de eindstand als afbeelding aanbieden.
        const dl = $('btnDownload');
        dl.href = canvas.toDataURL('image/png'); dl.download = 'peilglas-avond.png'; dl.textContent = 'Slotbeeld bewaren als afbeelding'; dl.hidden = false;
        btn.textContent = 'Opnieuw afspelen';
        note.textContent = 'Je telefoon kan het filmpje niet opslaan. Je kunt het wel opnieuw afspelen, of een schermopname maken terwijl het speelt.';
      }
    } catch (e) {
      note.textContent = 'De film maken is niet gelukt. Probeer het opnieuw.';
      btn.textContent = 'Aftermovie maken';
    } finally { btn.disabled = false; }
  };

  PG.shareMovie = async function () {
    if (!result) return;
    try { await navigator.share({ files: [new File([result.blob], result.name, { type: result.type })], title: 'Peilglas aftermovie' }); } catch (e) { /* delen afgebroken */ }
  };
})();
