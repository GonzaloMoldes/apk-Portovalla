/* PortoValla Operadores · cronómetro del tiempo de visión
   Se pulsa cuando un coche (o una persona) empieza a ver la valla y otra vez cuando ya la ha
   pasado: ese tiempo es la visión. Se pueden tomar varias medidas y se guarda la media.
   Con la velocidad aproximada del tráfico se estima también la distancia desde la que se ve.
   Sirve en la ficha de la valla y en la de la negociación de patrimonio. */

/** código → { tiempoVision (s), distancia (m), fecha, medidas: [s…] } */
let vallasVision = store.load('vallas_vision') || {};
let crono = null;   // { form, medidas: [], inicio, timer, velocidad }

function saveVision() { store.save('vallas_vision', vallasVision); }

function fmtSeg(s) { return (Math.round(s * 10) / 10).toFixed(1).replace('.', ',') + ' s'; }

function visionBadge(code) {
  const v = vallasVision[code];
  if (!v || (!v.tiempoVision && !v.distancia)) return '';
  return `<span class="badge vision" title="Tiempo de visión y distancia desde la que se ve">👀 ${[v.tiempoVision && `${String(v.tiempoVision).replace('.', ',')} s`,
    v.distancia && `${v.distancia} m`].filter(Boolean).join(' · ')}</span>`;
}

/* ------------------------------------------------------------- cronómetro */

function abrirCrono(formSel) {
  crono = { form: formSel, medidas: [], inicio: 0, timer: null, velocidad: crono && crono.velocidad || 50 };
  renderCrono();
  $('#crono-modal').hidden = false;
}

function cronoPulsar() {
  if (!crono) return;
  if (!crono.inicio) {
    crono.inicio = performance.now();
    crono.timer = setInterval(() => {
      $('#crono-tiempo').textContent = fmtSeg((performance.now() - crono.inicio) / 1000);
    }, 100);
  } else {
    const s = (performance.now() - crono.inicio) / 1000;
    clearInterval(crono.timer);
    crono.inicio = 0;
    if (s >= 0.3) crono.medidas.push(Math.round(s * 10) / 10);
    else toast('Demasiado corto: vuelve a medir');
  }
  renderCrono();
}

function cronoMedia() {
  const m = crono.medidas;
  return m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length * 10) / 10 : 0;
}

function renderCrono() {
  const corriendo = !!crono.inicio;
  const btn = $('#crono-btn');
  btn.classList.toggle('on', corriendo);
  btn.innerHTML = corriendo ? '■<span>Ya no se ve</span>' : '▶<span>Empieza a verse</span>';
  if (!corriendo) $('#crono-tiempo').textContent = crono.medidas.length ? fmtSeg(crono.medidas[crono.medidas.length - 1]) : '0,0 s';
  $('#crono-medidas').innerHTML = crono.medidas.map((s, i) =>
    `<span class="chip crono-m">${fmtSeg(s)} <button type="button" class="crono-x" data-crono-x="${i}" aria-label="Quitar">✕</button></span>`).join('')
    || '<span class="hint">Cada vez que pase un vehículo: pulsa al empezar a ver la valla y otra vez al dejar de verla.</span>';
  const media = cronoMedia();
  const dist = Math.round(crono.velocidad / 3.6 * media);
  $$('#crono-vel .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.vel) === crono.velocidad));
  $('#crono-media').textContent = media
    ? `Media de ${crono.medidas.length} medida${crono.medidas.length > 1 ? 's' : ''}: ${fmtSeg(media)} · a ${crono.velocidad} km/h se ve desde unos ${dist} m`
    : '';
  $('#crono-guardar').disabled = !media;
}

function cronoGuardar() {
  const media = cronoMedia();
  if (!media) return;
  const f = $(crono.form).elements;
  f.tiempoVision.value = String(media).replace('.', ',');
  if ($('#crono-dist').checked) f.distancia.value = String(Math.round(crono.velocidad / 3.6 * media));
  if (crono.form === '#valla-form') vfMedidas = crono.medidas.slice();
  cerrarCrono();
  f.tiempoVision.dispatchEvent(new Event('input', { bubbles: true }));
  toast(`Tiempo de visión: ${fmtSeg(media)}`);
}

function cerrarCrono() {
  if (crono && crono.timer) clearInterval(crono.timer);
  if (crono) crono.inicio = 0;
  $('#crono-modal').hidden = true;
}

/* ------------------------------------------------------------- ficha de valla */

let vfMedidas = [];

function visionLoad(code) {
  const v = vallasVision[code] || {};
  const f = $('#valla-form').elements;
  f.tiempoVision.value = v.tiempoVision ? String(v.tiempoVision).replace('.', ',') : '';
  f.distancia.value = v.distancia || '';
  vfMedidas = (v.medidas || []).slice();
  renderVisionInfo(v);
}

function renderVisionInfo(v) {
  $('#vv-info').textContent = v && v.fecha ? `Medido el ${fmtDate(v.fecha)}${v.medidas && v.medidas.length ? ` (media de ${v.medidas.length} pasadas)` : ''}.` : '';
}

function visionSave(codigo, anterior) {
  if (anterior && anterior !== codigo) { vallasVision[codigo] = vallasVision[anterior]; delete vallasVision[anterior]; }
  const f = $('#valla-form').elements;
  const t = parseMoney(f.tiempoVision.value), d = Math.round(parseMoney(f.distancia.value));
  const prev = vallasVision[codigo] || {};
  if (!t && !d) { delete vallasVision[codigo]; saveVision(); return; }
  const cambia = t !== Number(prev.tiempoVision || 0) || d !== Number(prev.distancia || 0);
  vallasVision[codigo] = { tiempoVision: t || '', distancia: d || '', fecha: cambia ? todayISO() : prev.fecha || todayISO(),
    medidas: cambia ? vfMedidas : prev.medidas || [] };
  saveVision();
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.crono) { abrirCrono(t.dataset.crono); return; }
  if (t.id === 'crono-btn') { cronoPulsar(); return; }
  if (t.dataset.cronoX !== undefined) { crono.medidas.splice(Number(t.dataset.cronoX), 1); renderCrono(); return; }
  if (t.dataset.vel) { crono.velocidad = Number(t.dataset.vel); renderCrono(); return; }
  if (t.id === 'crono-guardar') { cronoGuardar(); return; }
  if (t.id === 'crono-cancelar') { cerrarCrono(); return; }
  const vvFill = t.closest('[data-vv-fill]');
  if (vvFill && t.classList.contains('chip')) { $('#valla-form').elements[vvFill.dataset.vvFill].value = t.dataset.value; return; }
});
$('#crono-modal').addEventListener('click', e => { if (e.target.id === 'crono-modal') cerrarCrono(); });

const visionHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#crono-modal').hidden) { cerrarCrono(); return true; }
  return visionHandleBack();
};
