/* ══════════════════════════════════════════════════════════════
   PEILGLAS — camera met kader
   PG.camera({ step, title, hint, glass, ghost }) geeft { full, thumb } terug (jpeg als data-url),
   of null als de speler sluit. Het kader heeft de vorm van het gekozen glas; bij de tweede foto
   schijnt de eerste er vaag doorheen, zodat beide foto's gelijk genomen worden.
   Zonder cameratoegang opent de gewone fotokiezer van de telefoon.
   ══════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  let stream = null, finish = null;

  // Van een beeld (video of afbeelding) naar een jpeg van hooguit `max` px, optioneel bijgesneden.
  function toJpeg(source, sw, sh, max, quality, crop) {
    const c = crop || { x: 0, y: 0, w: sw, h: sh };
    const scale = Math.min(1, max / Math.max(c.w, c.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(c.w * scale); canvas.height = Math.round(c.h * scale);
    canvas.getContext('2d').drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }
  const both = (source, w, h, crop) => ({ full: toJpeg(source, w, h, 1280, 0.85, crop), thumb: toJpeg(source, w, h, 520, 0.7, crop) });

  function setFrame(glassId, showFrame) {
    $('frame').style.display = showFrame ? '' : 'none';
    $('tagRim').hidden = $('tagBottom').hidden = !showFrame;
    if (!showFrame) return;
    const g = PG.glass(glassId);
    $('frameShape').setAttribute('d', g.d + ' Z');
    $('frameExtra').setAttribute('d', g.id === 'wijnglas' ? g.extra : '');
    for (const [line, tag, y] of [['frameRim', 'tagRim', g.rim], ['frameBottom', 'tagBottom', g.bottom]]) {
      $(line).setAttribute('y1', y); $(line).setAttribute('y2', y);
      $(tag).style.top = (6 + 88 * y / 56) + '%';
    }
  }

  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; $('video').srcObject = null;
    $('cam').hidden = true;
  }
  function done(value) {
    stop();
    const f = finish; finish = null;
    if (f) f(value);
  }

  $('shutter').onclick = () => {
    const v = $('video');
    if (!v.videoWidth) return;
    // Alleen het zichtbare deel bewaren (de video vult het vlak en wordt aan de randen afgesneden).
    const box = $('view').getBoundingClientRect();
    const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
    const w = box.width / scale, h = box.height / scale;
    done(both(v, v.videoWidth, v.videoHeight, { x: (v.videoWidth - w) / 2, y: (v.videoHeight - h) / 2, w, h }));
  };
  $('camClose').onclick = () => done(null);
  $('camFile').onclick = () => { stop(); $('camInput').click(); };
  $('camInput').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return done(null);
    const img = new Image();
    img.onload = () => { const out = both(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(img.src); done(out); };
    img.onerror = () => done(null);
    img.src = URL.createObjectURL(f);
  };
  // Fotokiezer gesloten zonder foto: de belofte niet laten hangen.
  $('camInput').addEventListener('cancel', () => done(null));

  PG.camera = function (opts) {
    if (finish) done(null);
    return new Promise(async resolve => {
      finish = resolve;
      $('camStep').textContent = opts.step || '';
      $('camTitle').textContent = opts.title || '';
      $('camHint').textContent = opts.hint || '';
      $('camHint').hidden = !opts.hint;
      setFrame(opts.glass || 'auto', opts.frame !== false);
      const ghost = $('ghost');
      ghost.hidden = !opts.ghost;
      if (opts.ghost) ghost.src = opts.ghost;
      // Geen camera of geen toestemming: het scherm blijft open en de speler kiest zelf een foto.
      // (De fotokiezer vanzelf openen mag van telefoons alleen direct na een tik.)
      const noCamera = () => {
        $('camHint').hidden = false;
        $('camHint').textContent = 'De camera kan hier niet open. Tik op "Foto kiezen" om een foto te maken of te kiezen.';
        $('shutter').disabled = true;
        $('cam').hidden = false;
      };
      $('shutter').disabled = false;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return noCamera();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        $('video').srcObject = stream;
        $('cam').hidden = false;
      } catch (e) {
        noCamera();
      }
    });
  };
})();
