/* PortoValla Operadores · más filtros en Trabajos
   Por tipo de trabajo (o artículo vendido), por fecha (hoy, esta semana, este mes,
   atrasados o un rango), por cliente y por firma de conformidad. Se combinan con los
   filtros de estado, clase, revisión y persona y con la búsqueda. La fecha de un trabajo
   es la de realizado si está hecho y la prevista si no. */

const TRF_PERIODOS = [['', 'Cualquier fecha'], ['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'],
  ['atrasados', 'Atrasados'], ['rango', 'Entre fechas…']];

let trfTipo = '';
let trfCliente = '';
let trfPeriodo = '';
let trfDesde = '';
let trfHasta = '';
let trfFirma = '';          // '' · firmados · sinfirmar

/** Fecha con la que se filtra: realizado si está hecho, prevista si no. */
function fechaTrabajo(t) {
  return t.estado === 'Hecho' ? t.fechaHecho || t.fechaPrevista || '' : t.fechaPrevista || '';
}

/** Tipos de un trabajo (o los artículos de una venta). */
function tiposTrabajo(t) {
  return t.clase === 'Venta' ? (t.lineas || []).map(l => l.articulo).filter(Boolean) : t.tipos || [];
}

function rangoPeriodo() {
  const hoy = todayISO();
  if (trfPeriodo === 'hoy') return [hoy, hoy];
  if (trfPeriodo === 'semana') {
    const dia = (parseISO(hoy).getDay() + 6) % 7;      // lunes = 0
    const lunes = isoAddDays(hoy, -dia);
    return [lunes, isoAddDays(lunes, 6)];
  }
  if (trfPeriodo === 'mes') return [hoy.slice(0, 8) + '01', hoy.slice(0, 8) + '31'];
  if (trfPeriodo === 'rango') return [trfDesde || '0000-00-00', trfHasta || '9999-12-31'];
  return null;
}

function pasaFiltrosTr(t) {
  if (trfTipo && !tiposTrabajo(t).includes(trfTipo)) return false;
  if (trfCliente && (t.clienteNombre || '').trim() !== trfCliente) return false;
  if (trfFirma === 'firmados' && !t.firma) return false;
  if (trfFirma === 'sinfirmar' && t.firma) return false;
  if (trfPeriodo === 'atrasados') return t.estado !== 'Hecho' && !!t.fechaPrevista && t.fechaPrevista < todayISO();
  const r = rangoPeriodo();
  if (r) {
    const f = fechaTrabajo(t);
    if (!f || f < r[0] || f > r[1]) return false;
  }
  return true;
}

function nFiltrosTr() {
  return [trfTipo, trfCliente, trfPeriodo, trfFirma].filter(Boolean).length;
}

/** Pinta los grupos de filtros con las opciones que hay en los trabajos. */
function renderTrFiltros() {
  const cuenta = (fn, v) => trabajos.filter(t => fn(t, v)).length;
  const tipos = [...new Set(trabajos.flatMap(tiposTrabajo))].sort((a, b) => {
    const ia = TR_TIPOS.indexOf(a), ib = TR_TIPOS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'es');
  });
  if (trfTipo && !tipos.includes(trfTipo)) trfTipo = '';
  const clientes = [...new Set(trabajos.map(t => (t.clienteNombre || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  if (trfCliente && !clientes.includes(trfCliente)) trfCliente = '';
  $('#trf-tipos').innerHTML = chipsHtml(['', ...tipos], 'data-trf-tipo', trfTipo,
    v => v ? `${v} (${cuenta((t, x) => tiposTrabajo(t).includes(x), v)})` : 'Todos los tipos');
  $('#trf-clientes').innerHTML = clientes.length ? chipsHtml(['', ...clientes], 'data-trf-cliente', trfCliente,
    v => v ? `${v} (${cuenta((t, x) => (t.clienteNombre || '').trim() === x, v)})` : 'Todos los clientes')
    : '<span class="hint">Ningún trabajo tiene cliente.</span>';
  $('#trf-periodos').innerHTML = TRF_PERIODOS.map(([v, l]) =>
    `<button type="button" class="chip${v === trfPeriodo ? ' active' : ''}" data-trf-periodo="${v}">${l}</button>`).join('');
  $('#trf-rango').hidden = trfPeriodo !== 'rango';
  $('#trf-desde').value = trfDesde;
  $('#trf-hasta').value = trfHasta;
  $$('#trf-firmas .chip').forEach(c => c.classList.toggle('active', c.dataset.trfFirma === trfFirma));
  const n = nFiltrosTr();
  $('#trf-resumen').textContent = n ? `Filtros (${n} activo${n > 1 ? 's' : ''})` : 'Filtrar por tipo, fecha, cliente o firma';
  $('#trf-quitar').hidden = !n;
  $('#trf-activos').innerHTML = n ? [
    trfTipo && `🛠 ${esc(trfTipo)}`,
    trfPeriodo && `📅 ${esc(trfPeriodo === 'rango' ? [trfDesde && 'desde ' + fmtDate(trfDesde), trfHasta && 'hasta ' + fmtDate(trfHasta)].filter(Boolean).join(' ') || 'entre fechas'
      : TRF_PERIODOS.find(p => p[0] === trfPeriodo)[1].toLowerCase())}`,
    trfCliente && `👤 ${esc(trfCliente)}`,
    trfFirma && (trfFirma === 'firmados' ? '✍ firmados' : '✍ sin firmar'),
  ].filter(Boolean).map(x => `<span class="badge">${x}</span>`).join('') : '';
}

function quitarFiltrosTr() {
  trfTipo = trfCliente = trfPeriodo = trfDesde = trfHasta = trfFirma = '';
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.trfTipo !== undefined) { trfTipo = t.dataset.trfTipo; renderTrabajos(); return; }
  if (t.dataset.trfCliente !== undefined) { trfCliente = t.dataset.trfCliente; renderTrabajos(); return; }
  if (t.dataset.trfPeriodo !== undefined) { trfPeriodo = t.dataset.trfPeriodo; renderTrabajos(); return; }
  if (t.dataset.trfFirma !== undefined) { trfFirma = t.dataset.trfFirma; renderTrabajos(); return; }
  if (t.id === 'trf-quitar') { quitarFiltrosTr(); renderTrabajos(); }
});
['trf-desde', 'trf-hasta'].forEach(id => $('#' + id).addEventListener('change', () => {
  trfDesde = $('#trf-desde').value;
  trfHasta = $('#trf-hasta').value;
  renderTrabajos();
}));
