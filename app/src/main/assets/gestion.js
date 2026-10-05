'use strict';

/* =========================================================================
 * Gestión de vallas:
 *  - Catálogo: editar las vallas existentes y añadir nuevas (con foto y GPS).
 *  - Trabajos: desbrozar, instalar/desinstalar, retirar o cambiar lona,
 *    arreglos… con Excel para compartir con quien hace el trabajo.
 * Usa las utilidades y datos de app.js (store, VALLAS_DB, openPicker…).
 * ========================================================================= */

const TR_TIPOS = ['Desbrozar', 'Instalar lona', 'Desinstalar lona', 'Retirar lona', 'Cambio de lona',
  'Arreglo / reparación', 'Revisión', 'Otro'];
const TR_ABIERTOS = ['Pendiente', 'En curso'];

let trabajos = store.load('trabajos') || [];
let trFilter = 'abiertos';
let trPersona = '';
let catZona = 'Todas';
let catMuni = '';
let vallaEditing = null;   // código de la valla que se edita (null = nueva)
let vfFoto = '';           // foto de la ficha de valla
let trEditing = null;      // id del trabajo que se edita (null = nuevo)
let trCodes = [];          // vallas del trabajo en edición
let trSnap = {};           // datos guardados de esas vallas (por si ya no están en el catálogo)
let tfState = {};          // selección única: prioridad, material, estado
let txEstado = 'abiertos';
let txPersona = '';

/* ------------------------------------------------------------- navegación */

function openTab(tab) {
  if (tab === 'catalogo') openCatalog();
  else if (tab === 'trabajos') openTrabajos();
  else { show('list'); renderList(); }
}

const baseHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#tr-export-modal').hidden) { $('#tr-export-modal').hidden = true; return true; }
  const v = currentView();
  if (v === 'valla-form') { openCatalog(); return true; }
  if (v === 'trabajo-form') { openTrabajos(); return true; }
  return baseHandleBack();
};

function isoPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function chipsHtml(values, attr, active, labelFn) {
  return values.map(v => `<button type="button" class="chip${v === active ? ' active' : ''}" ${attr}="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</button>`).join('');
}

function vallaThumb(v) {
  return v && v.foto ? `<img src="${esc(v.foto)}" alt="" loading="lazy">` : '<div class="nofoto">Sin foto</div>';
}

/* ------------------------------------------------------------- catálogo */

function openCatalog() {
  renderCatFilters();
  renderCatalog();
  show('catalogo');
}

function renderCatFilters() {
  const zonas = [...new Set(VALLAS_DB.map(v => v.zona).filter(Boolean))];
  if (catZona !== 'Todas' && !zonas.includes(catZona)) catZona = 'Todas';
  $('#cat-zonas').innerHTML = chipsHtml(['Todas', ...zonas], 'data-cat-zona', catZona);
  if (catZona === 'Todas') { $('#cat-munis').innerHTML = ''; catMuni = ''; return; }
  const munis = [...new Set(VALLAS_DB.filter(v => v.zona === catZona).map(v => v.municipio).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (!munis.includes(catMuni)) catMuni = '';
  $('#cat-munis').innerHTML = munis.length > 1
    ? chipsHtml(['', ...munis], 'data-cat-muni', catMuni, m => m || 'Todos los municipios') : '';
}

function renderCatalog() {
  const q = $('#cat-search').value.trim().toLowerCase();
  const items = VALLAS_DB.filter(v =>
    (catZona === 'Todas' || v.zona === catZona) && (!catMuni || v.municipio === catMuni) &&
    (!q || q.split(/\s+/).every(w => [v.codigo, v.direccion, v.municipio, v.zona, v.medida].join(' ').toLowerCase().includes(w))));
  const nuevas = VALLAS_DB.filter(v => v._nueva).length;
  const editadas = VALLAS_DB.filter(v => v._editada).length;
  const borradas = Object.values(vallasUser).filter(u => u._borrada).length;
  $('#cat-stats').textContent = `${items.length} de ${VALLAS_DB.length} vallas` +
    [nuevas && `${nuevas} añadida${nuevas > 1 ? 's' : ''}`, editadas && `${editadas} editada${editadas > 1 ? 's' : ''}`,
      borradas && `${borradas} eliminada${borradas > 1 ? 's' : ''}`].filter(Boolean).map(t => ' · ' + t).join('');
  $('#cat-grid').innerHTML = items.length ? items.map(v => `
    <div class="valla" data-cat-valla="${esc(v.codigo)}">
      ${v._nueva || v._editada ? `<div class="badges"><span class="badge ${v._nueva ? 'ok' : 'volver'}">${v._nueva ? 'Nueva' : 'Editada'}</span></div>` : ''}
      ${vallaThumb(v)}
      <div class="valla-body">
        <div class="valla-code">${esc(v.codigo)}</div>
        <div class="valla-dir">${esc(v.direccion)}</div>
        <div class="valla-meta">${[v.municipio, v.medida, v.categoria && 'Cat. ' + v.categoria].filter(Boolean).map(esc).join(' · ')}</div>
        ${v.lat !== '' && v.lat != null ? `<button type="button" class="valla-map" data-map="${esc(v.codigo)}">📍 Ver en mapa</button>` : ''}
      </div>
    </div>`).join('') : '<div class="empty">No hay vallas que coincidan.</div>';
}

/* --- ficha de valla --- */

function parseCoords(text) {
  const m = String(text || '').replace(/%2C/gi, ',').match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

function normCodigo(s) {
  const t = String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d+\w*$/.test(t)) return 'OOH-' + t;
  const m = t.match(/^OOH-?(\w+)$/);
  return m ? 'OOH-' + m[1] : t;
}

function renderVfPhoto() {
  $('#vf-photo').innerHTML = vfFoto ? `<img src="${esc(vfFoto)}" alt="">` : 'Sin foto';
  $('#vf-photo-remove').hidden = !vfFoto;
}

function renderVfChips() {
  const form = $('#valla-form');
  const zona = form.elements.zona.value.trim();
  const zonas = [...new Set(VALLAS_DB.map(v => v.zona).filter(Boolean))];
  $('#vf-zonas').innerHTML = chipsHtml(zonas, 'data-value', zona);
  const munis = [...new Set(VALLAS_DB.filter(v => !zona || v.zona === zona).map(v => v.municipio).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const muni = form.elements.municipio.value.trim();
  $('#vf-munis').innerHTML = munis.length <= 30 ? chipsHtml(munis, 'data-value', muni) : '';
  $('#dl-munis').innerHTML = [...new Set(VALLAS_DB.map(v => v.municipio).filter(Boolean))]
    .map(m => `<option value="${esc(m)}">`).join('');
  $$('#valla-form [data-vf-fill]').forEach(g => {
    const v = (form.elements[g.dataset.vfFill].value || '').trim().toLowerCase();
    $$('.chip', g).forEach(c => c.classList.toggle('active', !!v && c.dataset.value.toLowerCase() === v));
  });
  $$('#valla-form [data-vf] .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.value === form.elements.categoria.value));
}

function openVallaForm(code) {
  vallaEditing = code || null;
  const form = $('#valla-form');
  form.reset();
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  const v = code ? (VALLAS_DB.find(x => x.codigo === code) || {}) : {
    zona: catZona !== 'Todas' ? catZona : '', municipio: catMuni,
    provincia: (VALLAS_DB.find(x => x.zona === catZona) || {}).provincia || '', medida: '800x300',
  };
  for (const k of ['codigo', 'direccion', 'zona', 'municipio', 'provincia', 'medida', 'categoria']) {
    form.elements[k].value = v[k] || '';
  }
  form.elements.coords.value = v.lat !== '' && v.lat != null ? `${v.lat}, ${v.lng}` : '';
  const isBase = !!code && VALLAS_BASE.some(b => b.codigo === code);
  form.elements.codigo.readOnly = isBase;
  vfFoto = v.foto || '';
  renderVfPhoto();
  renderVfChips();
  $('#valla-form-title').textContent = code ? `Editar ${code}` : 'Nueva valla';
  $('#vf-delete').hidden = !code;
  $('#vf-restore').hidden = !(isBase && vallasUser[code]);
  $('#vf-origin').textContent = !code ? ''
    : isBase ? (vallasUser[code] ? 'Valla del catálogo, modificada en la tablet.' : 'Valla del catálogo original.')
      : 'Valla añadida en la tablet.';
  $('#vf-coords-hint').textContent = '';
  $('#vf-location').textContent = '📍 Usar mi ubicación';
  show('valla-form');
}

function saveValla() {
  const form = $('#valla-form');
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  const codigo = normCodigo(form.elements.codigo.value);
  const direccion = form.elements.direccion.value.trim().toUpperCase();
  const coordsTxt = form.elements.coords.value.trim();
  const coords = coordsTxt ? parseCoords(coordsTxt) : null;
  const bad = [];
  if (!codigo) bad.push('codigo');
  if (!direccion) bad.push('direccion');
  if (coordsTxt && !coords) bad.push('coords');
  const otra = VALLAS_DB.find(v => v.codigo === codigo);
  if (codigo && otra && codigo !== vallaEditing) bad.push('codigo');
  if (bad.length) {
    bad.forEach(n => form.elements[n].classList.add('invalid'));
    toast(bad.includes('coords') ? 'Coordenadas no válidas (ej. 43.33, -8.39)'
      : otra && codigo !== vallaEditing ? `Ya existe una valla ${codigo}` : 'Falta el código o la dirección');
    return;
  }
  const rec = {
    codigo, direccion,
    zona: form.elements.zona.value.trim().toUpperCase(),
    municipio: form.elements.municipio.value.trim(),
    provincia: form.elements.provincia.value.trim(),
    medida: form.elements.medida.value.trim(),
    categoria: form.elements.categoria.value.trim().toUpperCase(),
    lat: coords ? coords.lat : '', lng: coords ? coords.lng : '',
    foto: vfFoto,
  };
  if (vallaEditing && vallaEditing !== codigo) delete vallasUser[vallaEditing];   // cambio de código (solo vallas añadidas)
  vallasUser[codigo] = rec;
  saveCatalog();
  toast(vallaEditing ? 'Valla guardada' : 'Valla añadida');
  openCatalog();
}

function deleteValla() {
  if (!vallaEditing) return;
  if (!confirm(`¿Eliminar la valla ${vallaEditing} del catálogo?`)) return;
  if (VALLAS_BASE.some(b => b.codigo === vallaEditing)) vallasUser[vallaEditing] = { _borrada: true };
  else delete vallasUser[vallaEditing];
  saveCatalog();
  toast('Valla eliminada');
  openCatalog();
}

function restoreValla() {
  if (!vallaEditing || !confirm('¿Deshacer los cambios y volver a los datos originales de esta valla?')) return;
  delete vallasUser[vallaEditing];
  saveCatalog();
  openVallaForm(vallaEditing);
}

/* --- foto y ubicación (respuestas de Android) --- */

window.onPhotoResult = function (json) {
  let r;
  try { r = JSON.parse(json); } catch (e) { return; }
  if (r.tag === 'valla') { vfFoto = r.url; renderVfPhoto(); toast('Foto añadida'); }
};
window.onPhotoError = function (msg) { if (msg) toast('⚠ ' + msg); };

window.onLocationStart = function () { $('#vf-location').textContent = '⏳ Buscando ubicación…'; };
window.onLocation = function (json) {
  let r;
  try { r = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
  $('#vf-location').textContent = '📍 Usar mi ubicación';
  $('#valla-form').elements.coords.value = `${r.lat}, ${r.lng}`;
  $('#vf-coords-hint').textContent = r.acc ? `Ubicación actual (precisión ±${r.acc} m)` : 'Ubicación actual';
};
window.onLocationError = function (msg) {
  $('#vf-location').textContent = '📍 Usar mi ubicación';
  toast('⚠ ' + (msg || 'No se pudo obtener la ubicación'));
};

function vfLocation() {
  if (NATIVE) { window.Android.getLocation(); return; }
  if (!navigator.geolocation) { toast('Ubicación no disponible'); return; }
  window.onLocationStart();
  navigator.geolocation.getCurrentPosition(
    p => window.onLocation({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, acc: Math.round(p.coords.accuracy) }),
    e => window.onLocationError(e.message), { enableHighAccuracy: true, timeout: 20000 });
}

function vfMap() {
  const c = parseCoords($('#valla-form').elements.coords.value);
  if (!c) { toast('Escribe primero las coordenadas'); return; }
  if (NATIVE) window.Android.openMap(String(c.lat), String(c.lng), $('#valla-form').elements.codigo.value || 'Valla');
  else window.open(`https://www.google.com/maps?q=${c.lat},${c.lng}`);
}

/* ------------------------------------------------------------- trabajos */

function saveTrabajos() {
  if (!store.save('trabajos', trabajos)) toast('⚠ No se pudieron guardar los trabajos');
}

function personas() {
  return [...new Set(trabajos.map(t => (t.asignado || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function trMatches(t, estado, persona) {
  if (estado === 'abiertos' && !TR_ABIERTOS.includes(t.estado)) return false;
  if (estado === 'Hecho' && t.estado !== 'Hecho') return false;
  if (persona && (t.asignado || '').trim() !== persona) return false;
  return true;
}

function trSort(a, b) {
  const da = a.estado === 'Hecho', db = b.estado === 'Hecho';
  if (da !== db) return da ? 1 : -1;
  if (da) return (b.fechaHecho || '').localeCompare(a.fechaHecho || '');
  const ua = a.prioridad === 'Urgente', ub = b.prioridad === 'Urgente';
  if (ua !== ub) return ua ? -1 : 1;
  return (a.fechaPrevista || '9999').localeCompare(b.fechaPrevista || '9999') || a.num - b.num;
}

function openTrabajos() {
  renderTrabajos();
  show('trabajos');
}

function renderTrabajos() {
  const ps = personas();
  if (trPersona && !ps.includes(trPersona)) trPersona = '';
  $('#tr-personas').innerHTML = ps.length ? chipsHtml(['', ...ps], 'data-tr-persona', trPersona, p => p || 'Todas las personas') : '';
  $$('#tr-estados .chip').forEach(c => c.classList.toggle('active', c.dataset.trEstado === trFilter));
  const q = $('#tr-search').value.trim().toLowerCase();
  const items = trabajos.filter(t => trMatches(t, trFilter, trPersona) && (!q || q.split(/\s+/).every(w =>
    [t.tipos.join(' '), t.asignado, t.campana, t.descripcion, ...t.vallas.map(v => `${v.codigo} ${v.direccion} ${v.municipio}`)]
      .join(' ').toLowerCase().includes(w)))).sort(trSort);
  const abiertos = trabajos.filter(t => TR_ABIERTOS.includes(t.estado)).length;
  $('#tr-stats').textContent = `${items.length} trabajo${items.length === 1 ? '' : 's'} · ${abiertos} pendiente${abiertos === 1 ? '' : 's'} en total`;
  const hoy = todayISO();
  $('#tr-list').innerHTML = items.length ? items.map(t => {
    const atrasado = t.estado !== 'Hecho' && t.fechaPrevista && t.fechaPrevista < hoy;
    const badges = [
      `<span class="badge estado-${esc(t.estado.split(' ')[0])}">${esc(t.estado)}</span>`,
      t.prioridad === 'Urgente' ? '<span class="badge urgente">Urgente</span>' : '',
      t.fechaPrevista ? `<span class="badge${atrasado ? ' pend' : ''}">${atrasado ? 'Atrasado · ' : ''}${t.fechaPrevista === hoy ? 'Hoy' : fmtDate(t.fechaPrevista)}</span>` : '',
      t.estado === 'Hecho' && t.fechaHecho ? `<span class="badge ok">Hecho ${fmtDate(t.fechaHecho)}</span>` : '',
    ].join('');
    const vallas = t.vallas.map(v => `<b>${esc(v.codigo)}</b> ${esc(v.municipio || '')}`).join(' · ');
    return `<article class="job${t.prioridad === 'Urgente' && t.estado !== 'Hecho' ? ' urgente' : ''}${t.estado === 'Hecho' ? ' hecho' : ''}" data-tr="${t.id}">
      <div class="job-main">
        <div class="job-title">#${t.num} · ${esc(t.tipos.join(' + '))}</div>
        <div class="job-vallas">${vallas}</div>
        <div class="job-meta">${[t.asignado && '👷 ' + t.asignado, t.campana && 'Campaña: ' + t.campana, t.material].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="badges">${badges}</div>
      </div>
      ${t.estado !== 'Hecho' ? `<div class="lead-actions"><button class="act" data-tr-done="${t.id}">✓ Hecho</button></div>` : ''}
    </article>`;
  }).join('') : `<div class="empty">${trabajos.length ? 'No hay trabajos con este filtro.' : 'Aún no hay trabajos.<br>Pulsa <b>＋ Nuevo trabajo</b> para crear uno.'}</div>`;
}

function markDone(id) {
  const t = trabajos.find(x => x.id === id);
  if (!t) return;
  t.estado = 'Hecho';
  t.fechaHecho = t.fechaHecho || todayISO();
  t.modificado = new Date().toISOString();
  saveTrabajos();
  toast(`Trabajo #${t.num} hecho`);
  renderTrabajos();
}

/* --- ficha de trabajo --- */

function renderTf() {
  const form = $('#trabajo-form');
  $$('#trabajo-form [data-tf]').forEach(g => $$('.chip', g).forEach(c =>
    c.classList.toggle('active', tfState[g.dataset.tf] === c.dataset.value)));
  const asig = form.elements.asignado.value.trim();
  $('#tf-personas').innerHTML = chipsHtml(personas(), 'data-value', asig);
  $('#tf-vallas').innerHTML = trCodes.length ? trCodes.map(code => {
    const v = VALLAS_DB.find(x => x.codigo === code) || trSnap[code] || { codigo: code, direccion: '' };
    return `<div class="vsel">
      ${v.foto ? `<img src="${esc(v.foto)}" alt="">` : ''}
      <div class="vsel-info"><b>${esc(v.codigo)}</b><span>${esc(v.direccion)}${v.municipio ? ' · ' + esc(v.municipio) : ''}</span></div>
      ${v.lat !== '' && v.lat != null ? `<button type="button" class="act" data-map="${esc(code)}">📍</button>` : ''}
      <button type="button" class="vsel-x" data-tf-unvalla="${esc(code)}" aria-label="Quitar">✕</button>
    </div>`;
  }).join('') : '<p class="hint">Todavía no has elegido ninguna valla.</p>';
}

function openTrabajoForm(id, preset) {
  trEditing = id || null;
  const form = $('#trabajo-form');
  form.reset();
  const t = id ? trabajos.find(x => x.id === id) : Object.assign({
    tipos: [], vallas: [], fechaPrevista: isoPlus(1), prioridad: 'Normal', estado: 'Pendiente',
    asignado: trPersona || '',
  }, preset || {});
  $('#tf-tipos').innerHTML = TR_TIPOS.map(x =>
    `<button type="button" class="chip${t.tipos.includes(x) ? ' active' : ''}" data-tf-tipo="${esc(x)}">${esc(x)}</button>`).join('');
  for (const k of ['fechaPrevista', 'asignado', 'campana', 'descripcion', 'fechaHecho', 'obs']) form.elements[k].value = t[k] || '';
  tfState = { prioridad: t.prioridad || 'Normal', material: t.material || '', estado: t.estado || 'Pendiente' };
  trCodes = t.vallas.map(v => v.codigo);
  trSnap = {};
  t.vallas.forEach(v => { trSnap[v.codigo] = v; });
  renderTf();
  $('#trabajo-form-title').textContent = id ? `Trabajo #${t.num}` : 'Nuevo trabajo';
  $('#tf-delete').hidden = !id;
  show('trabajo-form');
}

function saveTrabajo() {
  const form = $('#trabajo-form');
  const tipos = $$('#tf-tipos .chip.active').map(c => c.dataset.tfTipo);
  if (!tipos.length) { toast('Marca qué hay que hacer'); return; }
  if (!trCodes.length) { toast('Elige al menos una valla'); return; }
  const data = {
    tipos,
    vallas: trCodes.map(code => {
      const v = VALLAS_DB.find(x => x.codigo === code) || trSnap[code] || { codigo: code };
      return { codigo: v.codigo, direccion: v.direccion || '', municipio: v.municipio || '', provincia: v.provincia || '',
        zona: v.zona || '', medida: v.medida || '', lat: v.lat == null ? '' : v.lat, lng: v.lng == null ? '' : v.lng, foto: v.foto || '' };
    }),
    prioridad: tfState.prioridad || 'Normal',
    material: tfState.material || '',
    estado: tfState.estado || 'Pendiente',
  };
  for (const k of ['fechaPrevista', 'asignado', 'campana', 'descripcion', 'fechaHecho', 'obs']) data[k] = form.elements[k].value.trim();
  if (data.estado === 'Hecho' && !data.fechaHecho) data.fechaHecho = todayISO();
  if (data.estado !== 'Hecho') data.fechaHecho = '';
  const now = new Date().toISOString();
  if (trEditing) {
    Object.assign(trabajos.find(x => x.id === trEditing), data, { modificado: now });
  } else {
    const num = trabajos.reduce((m, x) => Math.max(m, x.num || 0), 0) + 1;
    trabajos.push(Object.assign({ id: uid(), num, creado: now, modificado: now }, data));
  }
  saveTrabajos();
  toast('Trabajo guardado');
  openTrabajos();
}

function deleteTrabajo() {
  const t = trabajos.find(x => x.id === trEditing);
  if (!t || !confirm(`¿Eliminar el trabajo #${t.num}?`)) return;
  trabajos = trabajos.filter(x => x.id !== trEditing);
  saveTrabajos();
  toast('Trabajo eliminado');
  openTrabajos();
}

/* --- Excel de trabajos --- */

function trExportList() {
  return trabajos.filter(t => trMatches(t, txEstado, txPersona)).sort(trSort);
}

/** Una fila por valla y trabajo (columnas de XlsxWriter.TCOLS). */
function trabajoRows(list) {
  const rows = [];
  for (const t of list) {
    for (const v of t.vallas) {
      const cat = VALLAS_DB.find(x => x.codigo === v.codigo) || {};
      rows.push({
        num: `#${t.num}`, fechaPrevista: t.fechaPrevista || '', prioridad: t.prioridad || '',
        tipos: t.tipos.join(' + '), codigo: v.codigo, direccion: v.direccion || cat.direccion || '',
        municipio: v.municipio || cat.municipio || '', medida: v.medida || cat.medida || '',
        lat: v.lat === '' || v.lat == null ? '' : String(v.lat), lng: v.lng === '' || v.lng == null ? '' : String(v.lng),
        campana: t.campana || '', material: t.material || '', descripcion: t.descripcion || '',
        asignado: t.asignado || '', estado: t.estado || '', fechaHecho: t.fechaHecho || '', obs: t.obs || '',
        foto: cat.foto || v.foto || '',
      });
    }
  }
  return rows;
}

function openExport() {
  txPersona = trPersona;
  renderExport();
  $('#tr-export-modal').hidden = false;
}

function renderExport() {
  const ps = personas();
  $$('#tx-estado .chip').forEach(c => c.classList.toggle('active', c.dataset.txEstado === txEstado));
  $('#tx-personas').innerHTML = chipsHtml(['', ...ps], 'data-tx-persona', txPersona, p => p || 'Todas');
  const list = trExportList();
  const filas = list.reduce((n, t) => n + t.vallas.length, 0);
  $('#tx-stats').textContent = `${list.length} trabajo${list.length === 1 ? '' : 's'} · ${filas} valla${filas === 1 ? '' : 's'}`;
}

function doExport(mode) {
  const list = trExportList();
  if (!list.length) { toast('No hay trabajos con ese filtro'); return; }
  if (!NATIVE) { toast('El Excel solo se genera en la tablet'); return; }
  const quien = (txPersona || 'todos').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_');
  const err = window.Android.exportTrabajos(JSON.stringify(trabajoRows(list)), `Trabajos_${quien}_${todayISO()}`, mode);
  if (err) { toast('⚠ ' + err); return; }
  $('#tr-export-modal').hidden = true;
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-cat-valla], [data-tr]');
  if (!t) return;

  if (t.dataset.tab) { openTab(t.dataset.tab); return; }

  // Catálogo
  if (t.dataset.catZona) { catZona = t.dataset.catZona; catMuni = ''; renderCatFilters(); renderCatalog(); return; }
  if (t.dataset.catMuni !== undefined && t.closest('#cat-munis')) { catMuni = t.dataset.catMuni; renderCatFilters(); renderCatalog(); return; }
  if (t.matches('[data-cat-valla]')) { openVallaForm(t.dataset.catValla); return; }
  const vfFill = t.closest('[data-vf-fill]');
  if (vfFill && t.classList.contains('chip')) {
    $(`#valla-form [name="${vfFill.dataset.vfFill}"]`).value = t.dataset.value;
    renderVfChips();
    return;
  }
  const vf = t.closest('[data-vf]');
  if (vf && t.classList.contains('chip')) {
    const el = $(`#valla-form [name="${vf.dataset.vf}"]`);
    el.value = el.value === t.dataset.value ? '' : t.dataset.value;
    renderVfChips();
    return;
  }

  // Trabajos
  if (t.dataset.trDone) { markDone(t.dataset.trDone); return; }
  if (t.matches('[data-tr]')) { openTrabajoForm(t.dataset.tr); return; }
  if (t.dataset.trEstado) { trFilter = t.dataset.trEstado; renderTrabajos(); return; }
  if (t.dataset.trPersona !== undefined && t.closest('#tr-personas')) { trPersona = t.dataset.trPersona; renderTrabajos(); return; }
  if (t.dataset.tfTipo) { t.classList.toggle('active'); return; }
  if (t.dataset.tfUnvalla) { trCodes = trCodes.filter(c => c !== t.dataset.tfUnvalla); renderTf(); return; }
  const tf = t.closest('[data-tf]');
  if (tf && t.classList.contains('chip')) {
    const k = tf.dataset.tf;
    tfState[k] = tfState[k] === t.dataset.value && k === 'material' ? '' : t.dataset.value;
    if (k === 'estado' && tfState.estado === 'Hecho' && !$('#trabajo-form').elements.fechaHecho.value) {
      $('#trabajo-form').elements.fechaHecho.value = todayISO();
    }
    renderTf();
    return;
  }
  const tfFill = t.closest('[data-tf-fill]');
  if (tfFill && t.classList.contains('chip')) {
    $(`#trabajo-form [name="${tfFill.dataset.tfFill}"]`).value = t.dataset.value;
    renderTf();
    return;
  }
  const tfDate = t.closest('[data-tf-date]');
  if (tfDate && t.classList.contains('chip')) {
    $(`#trabajo-form [name="${tfDate.dataset.tfDate}"]`).value = isoPlus(Number(t.dataset.offset || 0));
    return;
  }
  if (t.dataset.txEstado) { txEstado = t.dataset.txEstado; renderExport(); return; }
  if (t.dataset.txPersona !== undefined) { txPersona = t.dataset.txPersona; renderExport(); return; }

  switch (t.dataset.g) {
    case 'valla-new': openVallaForm(null); break;
    case 'valla-save': saveValla(); break;
    case 'valla-delete': deleteValla(); break;
    case 'valla-restore': restoreValla(); break;
    case 'vf-photo-camera':
      if (NATIVE) window.Android.pickPhoto('camera', 'valla'); else toast('La cámara solo funciona en la tablet');
      break;
    case 'vf-photo-gallery':
      if (NATIVE) window.Android.pickPhoto('gallery', 'valla'); else toast('Solo disponible en la tablet');
      break;
    case 'vf-photo-remove': vfFoto = ''; renderVfPhoto(); break;
    case 'vf-location': vfLocation(); break;
    case 'vf-map': vfMap(); break;
    case 'tr-new': openTrabajoForm(null); break;
    case 'tr-save': saveTrabajo(); break;
    case 'tr-delete': deleteTrabajo(); break;
    case 'tf-pick': openPicker(trCodes, codes => { trCodes = codes; renderTf(); }, 'trabajo-form'); break;
    case 'tr-export': openExport(); break;
    case 'tx-cancel': $('#tr-export-modal').hidden = true; break;
    case 'tx-open': doExport('open'); break;
    case 'tx-share': doExport('share'); break;
  }
});

$('#cat-search').addEventListener('input', renderCatalog);
$('#tr-search').addEventListener('input', renderTrabajos);
$('#tr-export-modal').addEventListener('click', e => { if (e.target.id === 'tr-export-modal') e.target.hidden = true; });
$('#valla-form').addEventListener('input', e => {
  if (['zona', 'municipio', 'provincia', 'medida'].includes(e.target.name)) renderVfChips();
});
$('#trabajo-form').addEventListener('input', e => { if (e.target.name === 'asignado') renderTf(); });
