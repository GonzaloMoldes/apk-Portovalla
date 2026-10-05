'use strict';

/* =========================================================================
 * Patrimonio: negociaciones con propietarios para instalar vallas en su
 * finca (ubicación, tráfico, tiempo de visión, precio por valla…).
 * Si se gana, las vallas pasan al catálogo y se crea el trabajo de montaje.
 * Usa app.js (store, utilidades) y gestion.js (catálogo y trabajos).
 * ========================================================================= */

const NEG_ESTADOS = ['Contacto inicial', 'En negociación', 'Oferta enviada', 'Ganada', 'Perdida'];
const NEG_CERRADAS = ['Ganada', 'Perdida'];
const NF_CHOICES = ['soporte', 'nVallas', 'caras', 'iluminacion', 'sentido', 'duracion', 'pago', 'estado'];
const NF_FIELDS = ['propietario', 'contacto', 'telefono', 'correo', 'direccion', 'municipio', 'provincia', 'zona',
  'medida', 'vehiculosMin', 'personasMin', 'tiempoVision', 'distancia', 'precioPedido', 'precioOfrecido',
  'precioAcordado', 'proximo', 'notas'];
const LOC_NEG = { form: '#neg-form', btn: '#nf-location', hint: '#nf-coords-hint' };
// Estimación de impactos: ocupantes por vehículo y horas de tráfico al día
const OCUPACION = 1.3;
const HORAS_DIA = 14;

let negociaciones = store.load('negociaciones') || [];
let negFilter = 'abiertas';
let negEditing = null;
let negFotos = [];
let nfState = {};
let negLeadId = '';

/* ------------------------------------------------------------- cálculos */

function fmtInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function num(v) {
  return parseMoney(v);   // admite "1.250", "12,5"…
}

/** Impactos al día estimados: (vehículos × ocupación + personas) por minuto × 60 × horas. */
function impactosDia(n) {
  const v = num(n.vehiculosMin), p = num(n.personasMin);
  if (!v && !p) return 0;
  return Math.round((v * OCUPACION + p) * 60 * HORAS_DIA);
}

/** Precio por valla y año que se usa para los totales: el acordado, o si no el ofrecido. */
function precioBase(n) {
  return num(n.precioAcordado) || num(n.precioOfrecido);
}

function totalContrato(n) {
  const p = precioBase(n);
  const vallas = Number(n.nVallas) || 1;
  const anos = Number(n.duracion) || 1;
  return p ? Math.round(p * vallas * anos * 100) / 100 : 0;
}

/** Coste por cada 1.000 impactos de lo que se paga al propietario. */
function costeMil(n) {
  const imp = impactosDia(n), p = precioBase(n);
  if (!imp || !p) return 0;
  return p / (imp * 365) * 1000;
}

/* ------------------------------------------------------------- navegación */

const trabajosHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#count-modal').hidden) { stopCount(false); return true; }
  if (currentView() === 'neg-form') { openPatrimonio(); return true; }
  return trabajosHandleBack();
};

function saveNegs() {
  if (!store.save('negociaciones', negociaciones)) toast('⚠ No se pudieron guardar las negociaciones');
}

/* ------------------------------------------------------------- lista */

function openPatrimonio() {
  renderNegs();
  show('patrimonio');
}

function negMatches(n) {
  if (negFilter === 'abiertas') return !NEG_CERRADAS.includes(n.estado);
  if (negFilter === 'todas') return true;
  return n.estado === negFilter;
}

function renderNegs() {
  $$('#neg-estados .chip').forEach(c => c.classList.toggle('active', c.dataset.negEstado === negFilter));
  const q = $('#neg-search').value.trim().toLowerCase();
  const items = negociaciones.filter(n => negMatches(n) && (!q || q.split(/\s+/).every(w =>
    [n.propietario, n.contacto, n.direccion, n.municipio, n.notas, n.soporte].join(' ').toLowerCase().includes(w))))
    .sort((a, b) => (a.proximo || '9999').localeCompare(b.proximo || '9999') || b.num - a.num);
  const abiertas = negociaciones.filter(n => !NEG_CERRADAS.includes(n.estado)).length;
  const ganadas = negociaciones.filter(n => n.estado === 'Ganada').length;
  $('#neg-stats').textContent = `${items.length} negociación${items.length === 1 ? '' : 'es'} · ${abiertas} en curso · ${ganadas} ganada${ganadas === 1 ? '' : 's'}`;
  const hoy = todayISO();
  $('#neg-list').innerHTML = items.length ? items.map(n => {
    const imp = impactosDia(n);
    const precio = num(n.precioAcordado) ? `${fmtMoney(num(n.precioAcordado))}/año acordado`
      : num(n.precioOfrecido) ? `${fmtMoney(num(n.precioOfrecido))}/año ofrecido` : '';
    const atrasado = n.proximo && n.proximo < hoy && !NEG_CERRADAS.includes(n.estado);
    const badges = [
      `<span class="badge neg-${esc((n.estado || '').split(' ')[0])}">${esc(n.estado)}</span>`,
      imp ? `<span class="badge">${fmtInt(imp)} impactos/día</span>` : '',
      precio ? `<span class="badge budget-b">${esc(precio)}</span>` : '',
      n.proximo && !NEG_CERRADAS.includes(n.estado)
        ? `<span class="badge${atrasado ? ' pend' : ''}">${atrasado ? 'Llamar ya · ' : 'Próximo: '}${fmtDate(n.proximo)}</span>` : '',
      n.vallasCreadas && n.vallasCreadas.length ? `<span class="badge ok">${esc(n.vallasCreadas.join(', '))}</span>` : '',
    ].join('');
    return `<article class="job" data-neg="${n.id}">
      ${n.fotos && n.fotos.length ? `<img class="lead-thumb" src="${esc(n.fotos[0])}" alt="">` : ''}
      <div class="job-main">
        <div class="job-title">#${n.num} · ${esc(n.propietario || '(sin nombre)')}</div>
        <div class="job-vallas">${esc([n.direccion, n.municipio].filter(Boolean).join(' · '))}</div>
        <div class="job-meta">${[n.soporte, n.nVallas && `${n.nVallas} valla${n.nVallas > 1 ? 's' : ''}`, n.medida, n.contacto, n.telefono]
          .filter(Boolean).map(esc).join(' · ')}</div>
        <div class="badges">${badges}</div>
      </div>
    </article>`;
  }).join('') : `<div class="empty">${negociaciones.length ? 'No hay negociaciones con este filtro.'
    : 'Aún no hay negociaciones.<br>Pulsa <b>＋ Nueva negociación</b> o el botón <b>🏠 Negociación</b> de una visita a un propietario.'}</div>`;
}

/* ------------------------------------------------------------- ficha */

function renderNegFotos() { $('#neg-fotos').innerHTML = photoStrip(negFotos, 'neg'); }
PHOTO_HANDLERS.neg = url => { negFotos.push(url); renderNegFotos(); toast('Foto añadida'); };

function renderNf() {
  const form = $('#neg-form');
  $$('#neg-form [data-nf]').forEach(g => $$('.chip', g).forEach(c =>
    c.classList.toggle('active', String(nfState[g.dataset.nf] || '') === c.dataset.value)));
  const zonas = [...new Set(VALLAS_DB.map(v => v.zona).filter(Boolean))];
  $('#nf-zonas').innerHTML = chipsHtml(zonas, 'data-value', form.elements.zona.value.trim());
  $$('#neg-form [data-nf-fill]').forEach(g => {
    const v = (form.elements[g.dataset.nfFill].value || '').trim().toLowerCase();
    $$('.chip', g).forEach(c => c.classList.toggle('active', !!v && c.dataset.value.toLowerCase() === v));
  });
  const n = readNf();
  const imp = impactosDia(n);
  const cm = costeMil(n);
  $('#nf-impactos').textContent = imp
    ? `≈ ${fmtInt(imp)} impactos al día${cm ? ` · coste propietario ${cm.toFixed(3).replace('.', ',')} € por 1.000 impactos` : ''}`
    : '';
  const t = totalContrato(n);
  $('#nf-total').textContent = t
    ? `Total contrato: ${fmtMoney(t)} (${fmtMoney(precioBase(n))} × ${Number(n.nVallas) || 1} valla${Number(n.nVallas) > 1 ? 's' : ''} × ${Number(n.duracion) || 1} año${Number(n.duracion) > 1 ? 's' : ''})`
    : '';
  $('#nf-win').hidden = nfState.estado !== 'Ganada';
}

function readNf() {
  const form = $('#neg-form');
  const d = {};
  for (const k of NF_FIELDS) d[k] = (form.elements[k].value || '').trim();
  for (const k of NF_CHOICES) d[k] = nfState[k] || '';
  return d;
}

function openNegForm(id, preset) {
  negEditing = id || null;
  const form = $('#neg-form');
  form.reset();
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  const n = id ? negociaciones.find(x => x.id === id) : Object.assign({
    estado: 'Contacto inicial', nVallas: '1', caras: 'Una cara', soporte: 'Valla en suelo', medida: '800x300',
    duracion: '3', pago: 'Anual', proximo: isoPlus(7), fotos: [],
  }, preset || {});
  for (const k of NF_FIELDS) form.elements[k].value = n[k] || '';
  form.elements.coords.value = n.lat !== '' && n.lat != null ? `${n.lat}, ${n.lng}` : '';
  nfState = {};
  for (const k of NF_CHOICES) nfState[k] = n[k] || '';
  negFotos = Array.isArray(n.fotos) ? n.fotos.slice() : [];
  negLeadId = n.leadId || '';
  $('#dl-munis').innerHTML = [...new Set(VALLAS_DB.map(v => v.municipio).filter(Boolean))]
    .map(m => `<option value="${esc(m)}">`).join('');
  renderNegFotos();
  renderNf();
  $('#neg-form-title').textContent = id ? `Negociación #${n.num}` : 'Nueva negociación';
  $('#nf-delete').hidden = !id;
  $('#nf-coords-hint').textContent = '';
  $('#nf-location').textContent = '📍 Usar mi ubicación';
  $('#nf-ganada-info').textContent = n.vallasCreadas && n.vallasCreadas.length
    ? `Vallas añadidas al catálogo: ${n.vallasCreadas.join(', ')}` : '';
  show('neg-form');
}

/** Guarda la ficha. Devuelve la negociación o null si falta algo. */
function saveNeg(silent) {
  const form = $('#neg-form');
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  const d = readNf();
  const coordsTxt = form.elements.coords.value.trim();
  const coords = coordsTxt ? parseCoords(coordsTxt) : null;
  const bad = [];
  if (!d.propietario) bad.push('propietario');
  if (!d.direccion) bad.push('direccion');
  if (coordsTxt && !coords) bad.push('coords');
  if (bad.length) {
    bad.forEach(k => form.elements[k].classList.add('invalid'));
    form.elements[bad[0]].focus();
    toast(bad.includes('coords') ? 'Coordenadas no válidas (ej. 43.33, -8.39)' : 'Falta el propietario o la dirección');
    return null;
  }
  d.propietario = d.propietario.toUpperCase();
  d.direccion = d.direccion.toUpperCase();
  d.zona = d.zona.toUpperCase();
  d.correo = d.correo.toLowerCase();
  d.lat = coords ? coords.lat : '';
  d.lng = coords ? coords.lng : '';
  d.fotos = negFotos.slice();
  d.leadId = negLeadId;
  const now = new Date().toISOString();
  let n;
  if (negEditing) {
    n = negociaciones.find(x => x.id === negEditing);
    Object.assign(n, d, { modificado: now });
  } else {
    const next = negociaciones.reduce((m, x) => Math.max(m, x.num || 0), 0) + 1;
    n = Object.assign({ id: uid(), num: next, fecha: todayISO(), creado: now, modificado: now, vallasCreadas: [] }, d);
    negociaciones.push(n);
    negEditing = n.id;
  }
  saveNegs();
  if (!silent) toast('Negociación guardada');
  return n;
}

function deleteNeg() {
  const n = negociaciones.find(x => x.id === negEditing);
  if (!n || !confirm(`¿Eliminar la negociación #${n.num} (${n.propietario})?`)) return;
  negociaciones = negociaciones.filter(x => x.id !== negEditing);
  saveNegs();
  toast('Negociación eliminada');
  openPatrimonio();
}

/* ------------------------------------------------------------- ganada → patrimonio + trabajo */

/** Siguientes códigos OOH libres. */
function nextCodes(count) {
  const used = new Set(VALLAS_DB.map(v => v.codigo).concat(Object.keys(vallasUser)));
  let max = 0;
  for (const c of used) {
    const m = /^OOH-(\d+)$/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const out = [];
  for (let i = max + 1; out.length < count; i++) if (!used.has(`OOH-${i}`)) out.push(`OOH-${i}`);
  return out;
}

function winNeg() {
  if (nfState.estado !== 'Ganada') return;
  const n = saveNeg(true);
  if (!n) return;
  const cuantas = Number(n.nVallas) || 1;

  let codes = (n.vallasCreadas || []).filter(c => VALLAS_DB.some(v => v.codigo === c));
  if (codes.length) {
    if (!confirm(`Las vallas ${codes.join(', ')} ya están en el catálogo. ¿Crear otro trabajo de montaje con ellas?`)) return;
  } else {
    const resp = prompt(`Códigos para ${cuantas === 1 ? 'la valla nueva' : `las ${cuantas} vallas nuevas`} (separados por comas):`,
      nextCodes(cuantas).join(', '));
    if (resp == null) return;
    codes = resp.split(/[,;\s]+/).filter(Boolean).map(normCodigo);
    if (!codes.length) { toast('Escribe al menos un código'); return; }
    const repetidos = codes.filter((c, i) => codes.indexOf(c) !== i || VALLAS_DB.some(v => v.codigo === c));
    if (repetidos.length) { toast(`Ya existe: ${[...new Set(repetidos)].join(', ')}`); return; }
    codes.forEach((codigo, i) => {
      vallasUser[codigo] = {
        codigo,
        direccion: n.direccion + (codes.length > 1 ? ` (Nº${i + 1})` : ''),
        zona: n.zona || '', municipio: n.municipio || '', provincia: n.provincia || '',
        medida: n.medida || '', categoria: '', lat: n.lat, lng: n.lng,
        foto: (n.fotos && n.fotos[0]) || '',
        origen: `Negociación #${n.num} · ${n.propietario}`,
      };
    });
    saveCatalog();
    n.vallasCreadas = codes;
    n.modificado = new Date().toISOString();
    saveNegs();
    toast(`${codes.length} valla${codes.length > 1 ? 's' : ''} añadida${codes.length > 1 ? 's' : ''} al catálogo`);
  }

  const contacto = [n.contacto, n.telefono].filter(Boolean).join(', ');
  openTrabajoForm(null, {
    tipos: ['Montaje de valla'],
    vallas: codes.map(c => VALLAS_DB.find(v => v.codigo === c)).filter(Boolean),
    campana: `Nuevo emplazamiento · ${n.propietario}`,
    fechaPrevista: isoPlus(7),
    descripcion: [
      `Montar ${codes.length} × ${(n.soporte || 'valla').toLowerCase()}${n.medida ? ` de ${n.medida}` : ''}${n.caras ? ` (${n.caras.toLowerCase()})` : ''} en ${n.direccion}${n.municipio ? `, ${n.municipio}` : ''}.`,
      `Propietario: ${n.propietario}${contacto ? ` (${contacto})` : ''}.`,
      n.iluminacion === 'Sí' ? 'Con iluminación.' : '',
    ].filter(Boolean).join(' '),
  });
}

/* ------------------------------------------------------------- desde una visita a propietario */

function negFromLead(lead) {
  if (!lead) return;
  const prev = negociaciones.find(n => n.leadId === lead.id);
  if (prev) { openNegForm(prev.id); return; }
  openNegForm(null, {
    propietario: lead.razonSocial || '', contacto: lead.contacto || '', telefono: lead.telefono || '',
    correo: lead.correo || '', municipio: lead.poblacion || '', provincia: lead.provincia || '',
    fotos: Array.isArray(lead.fotos) ? lead.fotos.slice() : [],
    notas: lead.situacion || '', leadId: lead.id,
    estado: 'En negociación',
  });
  toast('Completa la ubicación, el tráfico y el precio');
}

/* ------------------------------------------------------------- contador de tráfico */

let count = null;   // { cars, people, start, timer }

function startCount() {
  count = { cars: 0, people: 0, start: Date.now(), timer: null };
  $('#count-cars').textContent = '0';
  $('#count-people').textContent = '0';
  $('#count-time').textContent = '60';
  $('#count-modal').hidden = false;
  count.timer = setInterval(() => {
    const left = 60 - Math.floor((Date.now() - count.start) / 1000);
    $('#count-time').textContent = String(Math.max(0, left));
    if (left <= 0) stopCount(true);
  }, 250);
}

/** Termina el conteo; si save, pasa los resultados (por minuto) a la ficha. */
function stopCount(save) {
  if (!count) { $('#count-modal').hidden = true; return; }
  clearInterval(count.timer);
  const secs = Math.max(1, Math.min(60, (Date.now() - count.start) / 1000));
  if (save) {
    const form = $('#neg-form');
    const factor = 60 / secs;
    form.elements.vehiculosMin.value = String(Math.round(count.cars * factor));
    form.elements.personasMin.value = String(Math.round(count.people * factor));
    toast(secs < 59 ? `Contado ${Math.round(secs)} s; calculado por minuto` : 'Tráfico de 1 minuto guardado');
    renderNf();
  }
  count = null;
  $('#count-modal').hidden = true;
}

/* ------------------------------------------------------------- Excel */

function negRows(list) {
  return list.map(n => ({
    num: `#${n.num}`, fecha: n.fecha || '', estado: n.estado || '', propietario: n.propietario || '',
    contacto: n.contacto || '', telefono: n.telefono || '', correo: n.correo || '', direccion: n.direccion || '',
    municipio: n.municipio || '', provincia: n.provincia || '',
    lat: n.lat === '' || n.lat == null ? '' : String(n.lat), lng: n.lng === '' || n.lng == null ? '' : String(n.lng),
    soporte: n.soporte || '', nVallas: n.nVallas || '', medida: n.medida || '', caras: n.caras || '',
    iluminacion: n.iluminacion || '', vehiculosMin: n.vehiculosMin || '', personasMin: n.personasMin || '',
    tiempoVision: n.tiempoVision || '', distancia: n.distancia || '', sentido: n.sentido || '',
    impactos: impactosDia(n) ? String(impactosDia(n)) : '',
    precioPedido: n.precioPedido || '', precioOfrecido: n.precioOfrecido || '', precioAcordado: n.precioAcordado || '',
    duracion: n.duracion || '', pago: n.pago || '',
    totalContrato: totalContrato(n) ? String(totalContrato(n)) : '',
    proximo: n.proximo || '', notas: n.notas || '',
    vallasCreadas: (n.vallasCreadas || []).join(', '),
    foto: (n.fotos && n.fotos[0]) || '',
  }));
}

function exportNegs() {
  const list = negociaciones.filter(negMatches).sort((a, b) => a.num - b.num);
  if (!list.length) { toast('No hay negociaciones con este filtro'); return; }
  if (!NATIVE) { toast('El Excel solo se genera en la tablet'); return; }
  const nombre = { abiertas: 'en_curso', Ganada: 'ganadas', Perdida: 'perdidas', todas: 'todas' }[negFilter] || 'todas';
  const err = window.Android.exportTable('patrimonio', JSON.stringify(negRows(list)), `Patrimonio_${nombre}_${todayISO()}`, 'share');
  if (err) toast('⚠ ' + err);
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-neg]');
  if (!t) return;
  if (t.matches('[data-neg]')) { openNegForm(t.dataset.neg); return; }
  if (t.dataset.negEstado) { negFilter = t.dataset.negEstado; renderNegs(); return; }
  if (t.dataset.negLead) { negFromLead(leads.find(l => l.id === t.dataset.negLead)); return; }
  if (t.dataset.fotoX && t.dataset.fotoX.startsWith('neg:')) {
    negFotos.splice(Number(t.dataset.fotoX.split(':')[1]), 1);
    renderNegFotos();
    return;
  }
  const nf = t.closest('[data-nf]');
  if (nf && t.classList.contains('chip')) {
    const k = nf.dataset.nf;
    nfState[k] = nfState[k] === t.dataset.value && k !== 'estado' ? '' : t.dataset.value;
    renderNf();
    return;
  }
  const fill = t.closest('[data-nf-fill]');
  if (fill && t.classList.contains('chip')) {
    $(`#neg-form [name="${fill.dataset.nfFill}"]`).value = t.dataset.value;
    renderNf();
    return;
  }
  const nd = t.closest('[data-nf-date]');
  if (nd && t.classList.contains('chip')) {
    $(`#neg-form [name="${nd.dataset.nfDate}"]`).value = isoPlus(Number(t.dataset.offset || 0));
    return;
  }
  switch (t.dataset.p) {
    case 'neg-new': openNegForm(null); break;
    case 'neg-save': if (saveNeg(false)) openPatrimonio(); break;
    case 'neg-delete': deleteNeg(); break;
    case 'neg-win': winNeg(); break;
    case 'neg-export': exportNegs(); break;
    case 'nf-location': requestLocationFor(LOC_NEG); break;
    case 'nf-map': mapFromForm('#neg-form', $('#neg-form').elements.propietario.value || 'Emplazamiento'); break;
    case 'nf-photo-camera': pickPhoto('camera', 'neg'); break;
    case 'nf-photo-gallery': pickPhoto('gallery', 'neg'); break;
    case 'nf-count': startCount(); break;
    case 'count-car': if (count) $('#count-cars').textContent = String(++count.cars); break;
    case 'count-person': if (count) $('#count-people').textContent = String(++count.people); break;
    case 'count-stop': stopCount(true); break;
    case 'count-cancel': stopCount(false); break;
  }
});

$('#neg-search').addEventListener('input', renderNegs);
$('#neg-form').addEventListener('input', renderNf);
