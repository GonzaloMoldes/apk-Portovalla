/* PortoValla Operadores · revisión de los trabajos
   Historial de comprobaciones de cada trabajo: si se hizo bien, con incidencias o no se
   hizo, con fecha, nota y foto (obligatoria). Filtro de revisados / sin revisar en
   Trabajos y columnas de la última revisión en el Excel. */

const REV_RESULTADOS = { Correcto: '✅', 'Con incidencias': '⚠️', 'No realizado': '❌' };

let trRev = '';            // filtro: '' · revisados · sinrevisar
let revCtx = null;         // { trabajoId, resultado, fotos: [] }

function revisionesDe(t) { return (t && t.revisiones) || []; }
function ultimaRevisionTr(t) { const r = revisionesDe(t); return r.length ? r[r.length - 1] : null; }

function revisionBadgeTr(t) {
  const r = ultimaRevisionTr(t);
  if (r) {
    const cls = r.resultado === 'Correcto' ? 'ok' : r.resultado === 'No realizado' ? 'pend' : 'volver';
    return `<span class="badge ${cls}">🔎 ${REV_RESULTADOS[r.resultado] || ''} ${esc(r.resultado)} · ${esc(fmtDate(r.fecha))}</span>`;
  }
  return t.estado === 'Hecho' ? '<span class="badge rev-pend">🔎 Sin revisar</span>' : '';
}

function pasaFiltroRevision(t) {
  if (trRev === 'revisados') return revisionesDe(t).length > 0;
  if (trRev === 'sinrevisar') return !revisionesDe(t).length;
  return true;
}

/* ------------------------------------------------------------- historial en la ficha del trabajo */

function renderTfRevisiones() {
  const box = $('#tf-revisiones');
  if (!box) return;
  const t = trEditing ? trabajos.find(x => x.id === trEditing) : null;
  $('#tf-rev-nueva').hidden = !t;
  $('#tf-rev-hint').hidden = !!t;
  const revs = revisionesDe(t).slice().reverse();
  box.innerHTML = revs.length ? revs.map(r => `<div class="rev-item rev-${esc((r.resultado || '').split(' ')[0])}">
      <div class="rev-head"><b>${REV_RESULTADOS[r.resultado] || ''} ${esc(r.resultado)}</b><span>${esc(fmtDate(r.fecha))}${r.hora ? ' · ' + esc(r.hora) : ''}</span>
        <button type="button" class="vsel-x" data-rev-del="${esc(r.id)}" aria-label="Borrar revisión" title="Borrar revisión">${icon('close')}</button></div>
      ${r.nota ? `<div class="rev-nota">${esc(r.nota)}</div>` : ''}
      ${(r.fotos || []).length ? `<div class="photo-strip">${r.fotos.map(f => `<div class="photo-thumb"><img src="${esc(f)}" alt="" data-rev-ver="${esc(f)}"></div>`).join('')}</div>` : ''}
    </div>`).join('') : '<p class="hint">Todavía no se ha revisado este trabajo.</p>';
}

/* ------------------------------------------------------------- nueva revisión */

function abrirRevision(id) {
  const t = trabajos.find(x => x.id === id);
  if (!t) return;
  revCtx = { trabajoId: id, resultado: '', fotos: [] };
  $('#rev-title').textContent = `Revisión del trabajo #${t.num}`;
  $('#rev-info').textContent = [t.clase === 'Venta' ? (t.lineas || []).map(x => x.articulo).join(', ') : (t.tipos || []).join(' + '),
    (t.vallas || []).map(v => v.codigo).join(', '), t.asignado && `👷 ${t.asignado}`, `estado: ${t.estado}`].filter(Boolean).join(' · ');
  $('#rev-fecha').value = todayISO();
  $('#rev-nota').value = '';
  renderRevision();
  $('#rev-modal').hidden = false;
}

function renderRevision() {
  $$('#rev-resultados .chip').forEach(c => c.classList.toggle('active', c.dataset.value === revCtx.resultado));
  $('#rev-fotos').innerHTML = photoStrip(revCtx.fotos, 'revision');
}

PHOTO_HANDLERS.revision = url => { if (revCtx) { revCtx.fotos.push(url); renderRevision(); toast('Foto añadida'); } };

function guardarRevision() {
  const t = trabajos.find(x => x.id === revCtx.trabajoId);
  if (!t) return;
  if (!revCtx.resultado) { toast('Elige cómo está el trabajo'); return; }
  if (!revCtx.fotos.length) { toast('La revisión necesita al menos una foto'); return; }
  const ahora = new Date();
  const r = { id: uid(), fecha: $('#rev-fecha').value || todayISO(), hora: `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`,
    resultado: revCtx.resultado, nota: $('#rev-nota').value.trim(), fotos: revCtx.fotos.slice() };
  t.revisiones = revisionesDe(t).concat(r).sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
  let msg = 'Revisión guardada';
  if (r.resultado === 'No realizado' && t.estado === 'Hecho') {
    t.estado = 'Pendiente';
    t.fechaHecho = '';
    msg += ' · el trabajo vuelve a pendiente';
  } else if (r.resultado !== 'No realizado' && t.estado !== 'Hecho' && confirm('¿Marcar el trabajo como hecho?')) {
    t.estado = 'Hecho';
    t.fechaHecho = t.fechaHecho || r.fecha;
    msg += ' · trabajo hecho';
  }
  t.modificado = ahora.toISOString();
  saveTrabajos();
  $('#rev-modal').hidden = true;
  revCtx = null;
  toast(msg);
  if (currentView() === 'trabajo-form') {
    // El estado puede haber cambiado: se refleja en la ficha
    if (typeof tfState !== 'undefined') { tfState.estado = t.estado; $('#trabajo-form').elements.fechaHecho.value = t.fechaHecho || ''; renderTf(); }
    renderTfRevisiones();
  } else renderTrabajos();
}

function borrarRevision(id) {
  const t = trabajos.find(x => revisionesDe(x).some(r => r.id === id));
  const r = t && t.revisiones.find(x => x.id === id);
  if (!r || !confirm(`¿Borrar la revisión del ${fmtDate(r.fecha)} (${r.resultado})?`)) return;
  t.revisiones = t.revisiones.filter(x => x.id !== id);
  if (NATIVE && window.Android.deletePhoto) (r.fotos || []).forEach(f => window.Android.deletePhoto(f));
  saveTrabajos();
  renderTfRevisiones();
}

/* ------------------------------------------------------------- columnas del Excel */

function revisionCols(t) {
  const r = ultimaRevisionTr(t);
  return {
    revResultado: r ? r.resultado : (t.estado === 'Hecho' ? 'Sin revisar' : ''), revFecha: r ? r.fecha : '',
    revNota: r ? r.nota || '' : '', revN: revisionesDe(t).length ? String(revisionesDe(t).length) : '',
    revFoto: r && r.fotos && r.fotos[0] ? r.fotos[0] : '',
  };
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-rev-ver]');
  if (!t) return;
  if (t.dataset.revVer) { $('#foto-grande img').src = t.dataset.revVer; $('#foto-grande').hidden = false; return; }
  if (t.dataset.trRevisar) { e.stopPropagation(); abrirRevision(t.dataset.trRevisar); return; }
  if (t.dataset.trRev !== undefined) { trRev = t.dataset.trRev; renderTrabajos(); return; }
  if (t.id === 'tf-rev-nueva') { abrirRevision(trEditing); return; }
  if (t.dataset.revDel) { borrarRevision(t.dataset.revDel); return; }
  if (t.closest('#rev-resultados') && t.classList.contains('chip')) { revCtx.resultado = t.dataset.value; renderRevision(); return; }
  if (t.dataset.fotoX && t.dataset.fotoX.startsWith('revision:') && revCtx) {
    revCtx.fotos.splice(Number(t.dataset.fotoX.split(':')[1]), 1);
    renderRevision();
    return;
  }
  switch (t.dataset.rv2) {
    case 'camara': pickPhoto('camera', 'revision'); break;
    case 'galeria': pickPhoto('gallery', 'revision'); break;
    case 'guardar': guardarRevision(); break;
    case 'cancelar': $('#rev-modal').hidden = true; revCtx = null; break;
  }
}, true);
$('#rev-modal').addEventListener('click', e => { if (e.target.id === 'rev-modal') { e.target.hidden = true; revCtx = null; } });

const revisionesHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#rev-modal').hidden) { $('#rev-modal').hidden = true; revCtx = null; return true; }
  return revisionesHandleBack();
};
