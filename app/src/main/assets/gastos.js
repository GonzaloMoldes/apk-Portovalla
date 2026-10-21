/* PortoValla Operadores · gastos (combustible, comida…)
   Cada ticket se fotografía o se elige de la galería: la foto se guarda en la app y el
   texto leído (ticket.js) rellena el gasto. La lista se agrupa por meses con su resumen y
   se puede filtrar por periodo y tipo y exportar a Excel (con las fotos) para dirección. */

const GASTO_ICONO = { Combustible: '⛽', Comida: '🍽', 'Parking / peaje': '🅿', Alojamiento: '🏨', Otro: '🧾' };
const GF_FIELDS = ['fecha', 'local', 'empresa', 'cif', 'direccion', 'total', 'base', 'ivaPct', 'iva', 'litros', 'precioLitro',
  'matricula', 'km', 'motivo', 'notas'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let gastos = store.load('gastos') || [];
let gastoEditing = null;
let gfState = { tipo: '', pago: '' };
let gfFoto = '';
let gfTexto = '';
let gPeriodo = 'mes';
let gDesde = '';
let gHasta = '';
let gTipo = '';

function saveGastos() {
  if (!store.save('gastos', gastos)) toast('⚠ No se pudieron guardar los gastos');
}

/* ------------------------------------------------------------- periodos */

function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** [desde, hasta] del periodo elegido (ISO; '' = sin límite). */
function gastosRango() {
  const h = new Date();
  const y = h.getFullYear(), m = h.getMonth();
  switch (gPeriodo) {
    case 'mes': return [isoDate(new Date(y, m, 1)), isoDate(new Date(y, m + 1, 0))];
    case 'mesAnt': return [isoDate(new Date(y, m - 1, 1)), isoDate(new Date(y, m, 0))];
    case 'trimestre': { const q = Math.floor(m / 3) * 3; return [isoDate(new Date(y, q, 1)), isoDate(new Date(y, q + 3, 0))]; }
    case 'ano': return [`${y}-01-01`, `${y}-12-31`];
    case 'rango': return [gDesde, gHasta];
    default: return ['', ''];
  }
}

function rangoTexto() {
  const [d, h] = gastosRango();
  if (!d && !h) return 'Todos los gastos';
  if (d && h) return `Del ${fmtDate(d)} al ${fmtDate(h)}`;
  return d ? `Desde el ${fmtDate(d)}` : `Hasta el ${fmtDate(h)}`;
}

function gastosFiltrados() {
  const [d, h] = gastosRango();
  const q = ($('#g-search').value || '').trim().toLowerCase();
  return gastos.filter(g => (!d || g.fecha >= d) && (!h || g.fecha <= h) && (!gTipo || g.tipo === gTipo)
    && (!q || q.split(/\s+/).every(w => [g.local, g.empresa, g.cif, g.direccion, g.motivo, g.notas, g.matricula, g.tipo]
      .join(' ').toLowerCase().includes(w))))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''));
}

function sumar(list, k) {
  return Math.round(list.reduce((s, g) => s + parseMoney(g[k]), 0) * 100) / 100;
}

function mesTexto(ym) {
  const [y, m] = ym.split('-');
  return `${MESES_LARGO[Number(m) - 1]} ${y}`;
}

/** Resumen por mes: { '2026-10': { total, iva, base, litros, n, porTipo: {tipo: total} } } */
function resumenMensual(list) {
  const out = {};
  for (const g of list) {
    const ym = (g.fecha || '').slice(0, 7) || 'sin fecha';
    const r = out[ym] || (out[ym] = { total: 0, iva: 0, base: 0, litros: 0, n: 0, porTipo: {} });
    const t = parseMoney(g.total);
    r.total += t; r.iva += parseMoney(g.iva); r.base += parseMoney(g.base); r.litros += parseMoney(g.litros); r.n++;
    r.porTipo[g.tipo || 'Otro'] = (r.porTipo[g.tipo || 'Otro'] || 0) + t;
  }
  return out;
}

/* ------------------------------------------------------------- lista */

function openGastos() {
  renderGastos();
  show('gastos');
}

function renderGastos() {
  $$('#g-periodos .chip').forEach(c => c.classList.toggle('active', c.dataset.gPeriodo === gPeriodo));
  $('#g-rango').hidden = gPeriodo !== 'rango';
  $('#g-tipos').innerHTML = [['', 'Todos'], ...TICKET_TIPOS.map(t => [t, `${GASTO_ICONO[t]} ${t}`])]
    .map(([v, l]) => `<button class="chip${gTipo === v ? ' active' : ''}" data-g-tipo="${esc(v)}">${esc(l)}</button>`).join('');
  const list = gastosFiltrados();
  const total = sumar(list, 'total');
  const porTipo = {};
  list.forEach(g => { porTipo[g.tipo || 'Otro'] = (porTipo[g.tipo || 'Otro'] || 0) + parseMoney(g.total); });
  const litros = sumar(list, 'litros');
  $('#g-resumen').innerHTML = `
    <div class="g-res-head"><span>${esc(rangoTexto())}</span><b>${fmtMoney(total)}</b></div>
    <div class="g-res-tipos">${Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([t, v]) =>
      `<div><span>${GASTO_ICONO[t] || '🧾'} ${esc(t)}</span><b>${fmtMoney(v)}</b></div>`).join('') || '<div class="hint">Sin gastos en este periodo.</div>'}</div>
    <div class="g-res-pie">${list.length} ticket${list.length === 1 ? '' : 's'} · IVA ${fmtMoney(sumar(list, 'iva'))}
      · base ${fmtMoney(sumar(list, 'base'))}${litros ? ` · ${String(Math.round(litros * 100) / 100).replace('.', ',')} litros` : ''}</div>`;
  // Agrupado por meses
  const res = resumenMensual(list);
  let html = '', ultimo = '';
  for (const g of list) {
    const ym = (g.fecha || '').slice(0, 7) || 'sin fecha';
    if (ym !== ultimo) {
      const r = res[ym];
      html += `<div class="g-mes"><div class="g-mes-head"><b>${esc(ym === 'sin fecha' ? 'Sin fecha' : mesTexto(ym))}</b><b>${fmtMoney(r.total)}</b></div>
        <div class="g-mes-tipos">${Object.entries(r.porTipo).map(([t, v]) => `${GASTO_ICONO[t] || '🧾'} ${esc(t)} ${fmtMoney(v)}`).join(' · ')}</div></div>`;
      ultimo = ym;
    }
    html += `<article class="job gasto" data-gasto="${g.id}">
      ${g.foto ? `<img class="lead-thumb" src="${esc(g.foto)}" alt="">` : `<div class="g-ico">${GASTO_ICONO[g.tipo] || '🧾'}</div>`}
      <div class="job-main">
        <div class="job-title">${esc(g.local || g.empresa || '(sin nombre)')}</div>
        <div class="job-meta">${[fmtDate(g.fecha), g.tipo, g.litros && `${g.litros} L`, g.matricula, g.motivo].filter(Boolean).map(esc).join(' · ')}</div>
        ${!g.foto ? '<div class="badges"><span class="badge pend">Sin foto del ticket</span></div>' : ''}
      </div>
      <div class="g-importe">${fmtMoney(parseMoney(g.total))}${parseMoney(g.iva) ? `<span>IVA ${fmtMoney(parseMoney(g.iva))}</span>` : ''}</div>
    </article>`;
  }
  $('#g-list').innerHTML = html || `<div class="empty">${gastos.length ? 'No hay gastos con este filtro.'
    : 'Aún no hay gastos.<br>Pulsa <b>＋ Ticket</b> para escanear el primero.'}</div>`;
}

/* ------------------------------------------------------------- ficha */

function openGastoForm(id, preset) {
  gastoEditing = id || null;
  const form = $('#gasto-form');
  form.reset();
  const g = id ? gastos.find(x => x.id === id) : Object.assign({ fecha: todayISO() }, preset || {});
  for (const k of GF_FIELDS) form.elements[k].value = g[k] || '';
  gfState = { tipo: g.tipo || '', pago: g.pago || '' };
  gfFoto = g.foto || '';
  gfTexto = g.ocrTexto || '';
  renderGf();
  $('#gasto-form-title').textContent = id ? 'Gasto' : 'Nuevo gasto';
  $('#gf-delete').hidden = !id;
  show('gasto-form');
}

function renderGf() {
  $$('#gf-tipos .chip').forEach(c => c.classList.toggle('active', c.dataset.value === gfState.tipo));
  $$('#gf-pago .chip').forEach(c => c.classList.toggle('active', c.dataset.value === gfState.pago));
  $('#gf-combustible').hidden = gfState.tipo !== 'Combustible';
  $('#gf-foto').innerHTML = gfFoto ? `<img src="${esc(gfFoto)}" alt="Ticket" data-gf-ver="1">` : '<span>Sin foto del ticket</span>';
  $('#gf-foto-quitar').hidden = !gfFoto;
  $('#gf-ocr').hidden = !gfTexto;
  $('#gf-ocr-texto').textContent = gfTexto;
}

/** Rellena la ficha con lo leído del ticket (sin pisar lo que ya esté escrito, salvo que esté vacío). */
function aplicarTicket(d, sobrescribir) {
  const form = $('#gasto-form');
  for (const k of GF_FIELDS) {
    if (d[k] && (sobrescribir || !form.elements[k].value)) form.elements[k].value = d[k];
  }
  if (d.tipo && (sobrescribir || !gfState.tipo)) gfState.tipo = d.tipo;
  if (d.pago && (sobrescribir || !gfState.pago)) gfState.pago = d.pago;
  renderGf();
}

/** Recalcula IVA y base cuando cambian el total, el tipo de IVA, la cuota o la base. */
function recalcIva(campo) {
  const f = $('#gasto-form').elements;
  const total = parseMoney(f.total.value), pct = parseMoney(f.ivaPct.value);
  const fmt = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  if (!total) return;
  if (campo === 'iva') { f.base.value = fmt(total - parseMoney(f.iva.value)); return; }
  if (campo === 'base') { f.iva.value = fmt(total - parseMoney(f.base.value)); return; }
  if (pct) {
    const iva = total * pct / (100 + pct);
    f.iva.value = fmt(iva);
    f.base.value = fmt(total - iva);
  }
}

function saveGasto() {
  const form = $('#gasto-form');
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  const d = {};
  for (const k of GF_FIELDS) d[k] = (form.elements[k].value || '').trim();
  const bad = [];
  if (!d.fecha) bad.push('fecha');
  if (!parseMoney(d.total)) bad.push('total');
  if (bad.length || !gfState.tipo) {
    bad.forEach(n => form.elements[n].classList.add('invalid'));
    toast(!gfState.tipo ? 'Elige el tipo de gasto' : bad.includes('total') ? 'Falta el importe total' : 'Falta la fecha');
    return;
  }
  d.cif = d.cif.toUpperCase().replace(/[\s.\-]/g, '');
  d.matricula = d.matricula.toUpperCase();
  Object.assign(d, { tipo: gfState.tipo, pago: gfState.pago, foto: gfFoto, ocrTexto: gfTexto });
  if (d.tipo !== 'Combustible') { d.litros = ''; d.precioLitro = ''; }
  const now = new Date().toISOString();
  if (gastoEditing) {
    const g = gastos.find(x => x.id === gastoEditing);
    if (g.foto && g.foto !== d.foto && NATIVE && window.Android.deletePhoto) window.Android.deletePhoto(g.foto);
    Object.assign(g, d, { modificado: now });
  } else {
    gastos.push(Object.assign({ id: uid(), creado: now, modificado: now }, d));
  }
  saveGastos();
  toast(`Gasto guardado · ${fmtMoney(parseMoney(d.total))}`);
  // Si el gasto queda fuera del periodo que se está viendo, se pasa a ver todos
  const [desde, hasta] = gastosRango();
  if ((desde && d.fecha < desde) || (hasta && d.fecha > hasta)) gPeriodo = 'todo';
  openGastos();
}

function deleteGasto() {
  const g = gastos.find(x => x.id === gastoEditing);
  if (!g || !confirm(`¿Eliminar el gasto de ${g.local || 'este ticket'} (${fmtMoney(parseMoney(g.total))}) y la foto del ticket?`)) return;
  if (g.foto && NATIVE && window.Android.deletePhoto) window.Android.deletePhoto(g.foto);
  gastos = gastos.filter(x => x.id !== gastoEditing);
  saveGastos();
  toast('Gasto eliminado');
  openGastos();
}

/* ------------------------------------------------------------- escanear ticket */

let ticketNuevo = false;   // el escaneo viene del botón «＋ Ticket» (abre una ficha nueva)

function escanearTicket(source, nuevo) {
  ticketNuevo = !!nuevo;
  if (!NATIVE) { toast('El escaneo de tickets solo funciona en la tablet'); if (nuevo) openGastoForm(null); return; }
  window.Android.scanTicket(source);
}

window.onTicketStart = function () { toast('Leyendo el ticket…'); };
window.onTicketError = function (msg) { toast('⚠ ' + (msg || 'No se pudo leer el ticket')); };
window.onTicketResult = function (json) {
  let r;
  try { r = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
  const d = parseTicket(r);
  if (ticketNuevo || currentView() !== 'gasto-form') openGastoForm(null);
  ticketNuevo = false;
  if (gfFoto && gfFoto !== r.url && NATIVE && window.Android.deletePhoto && !gastos.some(g => g.foto === gfFoto)) {
    window.Android.deletePhoto(gfFoto);   // foto anterior de esta ficha que no se llegó a guardar
  }
  gfFoto = r.url || gfFoto;
  gfTexto = d.texto || '';
  aplicarTicket(d, true);
  const leidos = ['total', 'fecha', 'local', 'cif'].filter(k => d[k]).length;
  toast(d.total ? `Ticket leído: ${d.total} €${d.tipo ? ' · ' + d.tipo : ''}. Revisa los datos.`
    : leidos ? 'Ticket leído en parte: revisa y completa los datos' : 'No se pudo leer el texto: rellena los datos a mano (la foto queda guardada)');
};

/* ------------------------------------------------------------- Excel para dirección */

const GASTO_COLS = [
  ['FECHA', 'fecha', 'date', 11], ['TIPO', 'tipo', 'text', 14, TICKET_TIPOS.join(',')], ['LOCAL', 'local', 'text', 26],
  ['RAZÓN SOCIAL', 'empresa', 'text', 26], ['CIF', 'cif', 'text', 12], ['DIRECCIÓN', 'direccion', 'wrap', 30],
  ['BASE', 'base', 'money', 11], ['% IVA', 'ivaPct', 'number', 7], ['IVA', 'iva', 'money', 10], ['TOTAL', 'total', 'money', 11],
  ['LITROS', 'litros', 'number', 9], ['€ / LITRO', 'precioLitro', 'number', 9], ['MATRÍCULA', 'matricula', 'text', 11],
  ['KM', 'km', 'number', 9], ['FORMA DE PAGO', 'pago', 'text', 12, 'Tarjeta,Efectivo'], ['MOTIVO / CLIENTE', 'motivo', 'wrap', 24],
  ['NOTAS', 'notas', 'wrap', 24], ['FOTO TICKET', 'foto', 'photo', 26], ['ID', 'id', 'text', 14],
];

const RESUMEN_COLS = [
  ['MES', 'mes', 'text', 16], ...TICKET_TIPOS.map(t => [t.toUpperCase(), 't_' + t, 'money', 13]),
  ['TOTAL', 'total', 'money', 13], ['BASE', 'base', 'money', 12], ['IVA', 'iva', 'money', 11], ['LITROS', 'litros', 'number', 10],
  ['Nº TICKETS', 'n', 'number', 10],
];

function resumenRows(list) {
  const res = resumenMensual(list);
  const r2 = n => String(Math.round(n * 100) / 100);
  const rows = Object.keys(res).sort().map(ym => {
    const r = res[ym];
    const o = { mes: ym === 'sin fecha' ? 'Sin fecha' : mesTexto(ym), total: r2(r.total), base: r2(r.base), iva: r2(r.iva),
      litros: r.litros ? r2(r.litros) : '', n: String(r.n) };
    TICKET_TIPOS.forEach(t => { o['t_' + t] = r.porTipo[t] ? r2(r.porTipo[t]) : ''; });
    return o;
  });
  if (rows.length > 1) {
    const tot = { mes: 'TOTAL', total: r2(sumar(list, 'total')), base: r2(sumar(list, 'base')), iva: r2(sumar(list, 'iva')),
      litros: sumar(list, 'litros') ? r2(sumar(list, 'litros')) : '', n: String(list.length) };
    TICKET_TIPOS.forEach(t => { const v = list.filter(g => g.tipo === t).reduce((s, g) => s + parseMoney(g.total), 0); tot['t_' + t] = v ? r2(v) : ''; });
    rows.push(tot);
  }
  return rows;
}

/** Excel del periodo y tipo filtrados: hoja RESUMEN por meses y hoja GASTOS con la foto de cada ticket. */
function exportGastos(mode) {
  const list = gastosFiltrados().slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  if (!list.length) { toast('No hay gastos en el periodo elegido'); return; }
  const [d, h] = gastosRango();
  const nombre = 'Gastos_' + (d || h ? `${d || 'inicio'}_a_${h || todayISO()}` : `hasta_${todayISO()}`)
    + (gTipo ? '_' + gTipo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]+/g, '_') : '')
    + (settings.comercial ? '_' + settings.comercial.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]+/g, '_') : '');
  exportBook(nombre, 'Gastos', mode, [
    { name: 'RESUMEN', cols: RESUMEN_COLS, rows: resumenRows(list) },
    { name: 'GASTOS', cols: GASTO_COLS, rows: list },
  ]);
}

/* Importar / exportar desde el menú ⇅ (como el resto de áreas) */
AREA_INFO.gastos = ['Gastos', 'Exporta los gastos del periodo y tipo filtrados (resumen por meses y una fila por ticket con su foto). Importa un Excel de gastos (actualiza por ID).'];
EXPORTERS.gastos = mode => exportGastos(mode);
IMPORTERS.gastos = book => {
  const res = { nuevos: 0, actualizados: 0 };
  const sh = sheetsWith(book, 'TOTAL').find(([, rows]) => rows[0].some(x => normHeader(x) === 'LOCAL'));
  if (!sh) throw new Error('No encuentro la hoja de gastos (columnas FECHA, LOCAL, TOTAL…)');
  const now = new Date().toISOString();
  for (const o of sheetToObjects(sh[1], GASTO_COLS)) {
    if (!o.fecha || !o.total) continue;
    delete o.foto;
    const g = o.id && gastos.find(x => x.id === o.id);
    if (g) { mergeInto(g, o); g.modificado = now; res.actualizados++; }
    else { gastos.push(Object.assign({ id: o.id || uid(), creado: now, modificado: now, foto: '' }, o)); res.nuevos++; }
  }
  saveGastos();
  return res;
};

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-gasto], [data-gf-ver]');
  if (!t) return;
  if (t.matches('[data-gasto]')) { openGastoForm(t.dataset.gasto); return; }
  if (t.matches('[data-gf-ver]')) { $('#foto-grande img').src = gfFoto; $('#foto-grande').hidden = false; return; }
  if (t.dataset.gPeriodo) { gPeriodo = t.dataset.gPeriodo; renderGastos(); return; }
  if (t.dataset.gTipo !== undefined) { gTipo = t.dataset.gTipo; renderGastos(); return; }
  const tipo = t.closest('#gf-tipos');
  if (tipo && t.classList.contains('chip')) {
    gfState.tipo = t.dataset.value;
    const f = $('#gasto-form').elements;
    if (!f.ivaPct.value) { f.ivaPct.value = { Combustible: '21', Comida: '10', Alojamiento: '10', 'Parking / peaje': '21' }[gfState.tipo] || ''; recalcIva(); }
    renderGf();
    return;
  }
  const pago = t.closest('#gf-pago');
  if (pago && t.classList.contains('chip')) { gfState.pago = gfState.pago === t.dataset.value ? '' : t.dataset.value; renderGf(); return; }
  const iva = t.closest('#gf-ivas');
  if (iva && t.classList.contains('chip')) { $('#gasto-form').elements.ivaPct.value = t.dataset.value; recalcIva(); return; }
  const gfDate = t.closest('[data-gf-date]');
  if (gfDate && t.classList.contains('chip')) { $('#gasto-form').elements.fecha.value = isoPlus(Number(t.dataset.offset || 0)); return; }
  switch (t.dataset.gx) {
    case 'nuevo-camara': escanearTicket('camera', true); break;
    case 'nuevo-galeria': escanearTicket('gallery', true); break;
    case 'nuevo-manual': openGastoForm(null); break;
    case 'nuevo': $('#ticket-modal').hidden = false; break;
    case 'ticket-cerrar': $('#ticket-modal').hidden = true; break;
    case 'scan-camara': escanearTicket('camera', false); break;
    case 'scan-galeria': escanearTicket('gallery', false); break;
    case 'foto-quitar':
      if (gfFoto && !gastos.some(g => g.foto === gfFoto) && NATIVE && window.Android.deletePhoto) window.Android.deletePhoto(gfFoto);
      gfFoto = ''; renderGf(); break;
    case 'releer':
      if (gfTexto) { aplicarTicket(parseTicket({ text: gfTexto }), true); toast('Datos vueltos a leer del ticket'); }
      break;
    case 'save': saveGasto(); break;
    case 'delete': deleteGasto(); break;
    case 'export': exportGastos('share'); break;
    case 'export-open': exportGastos('open'); break;
    case 'foto-cerrar': $('#foto-grande').hidden = true; break;
  }
  if (t.dataset.gx && t.dataset.gx.startsWith('nuevo-')) $('#ticket-modal').hidden = true;
});

$('#g-search').addEventListener('input', renderGastos);
$('#g-desde').addEventListener('change', e => { gDesde = e.target.value; renderGastos(); });
$('#g-hasta').addEventListener('change', e => { gHasta = e.target.value; renderGastos(); });
$('#gasto-form').addEventListener('input', e => {
  if (['total', 'ivaPct'].includes(e.target.name)) recalcIva();
  if (e.target.name === 'iva') recalcIva('iva');
  if (e.target.name === 'base') recalcIva('base');
  if (['litros', 'precioLitro'].includes(e.target.name)) {
    const f = $('#gasto-form').elements;
    if (e.target.name === 'precioLitro' && parseMoney(f.total.value) && parseMoney(f.precioLitro.value) && !f.litros.value) {
      f.litros.value = String(Math.round(parseMoney(f.total.value) / parseMoney(f.precioLitro.value) * 100) / 100).replace('.', ',');
    }
  }
});
$('#ticket-modal').addEventListener('click', e => { if (e.target.id === 'ticket-modal') e.target.hidden = true; });
$('#foto-grande').addEventListener('click', () => { $('#foto-grande').hidden = true; });

const gastosHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#foto-grande').hidden) { $('#foto-grande').hidden = true; return true; }
  if (!$('#ticket-modal').hidden) { $('#ticket-modal').hidden = true; return true; }
  if (currentView() === 'gasto-form') { openGastos(); return true; }
  return gastosHandleBack();
};
