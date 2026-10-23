/* PortoValla Operadores · visitas a las vallas y rutas semanales
   - Cada valla guarda cuándo se visitó: «✓ Visitada hoy» a mano, y también cuenta como
     visita hacerle una foto, contar el tráfico, revisarla, medir la visión o revisar un
     trabajo suyo.
   - Filtro de vallas sin visitar en los últimos N días (Ajustes, 30 por defecto).
   - Ruta semanal (Ajustes): qué provincia toca cada día (por defecto L·X·V Coruña, M·J Lugo).
     La agenda propone las vallas de esa provincia sin visitar y avisa el día anterior. */

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const RUTA_DEFECTO = { 1: 'Coruña', 2: 'Lugo', 3: 'Coruña', 4: 'Lugo', 5: 'Coruña' };

/** código → [{ fecha, nota }] (visitas apuntadas a mano) */
let vallasVisitas = store.load('vallas_visitas') || {};
let catRuta = null;        // { prov, fecha } catálogo filtrado por la ruta de un día

function saveVisitas() { store.save('vallas_visitas', vallasVisitas); }

// Ruta por defecto si nunca se ha configurado
for (let d = 0; d < 7; d++) if (settings['ruta' + d] === undefined) settings['ruta' + d] = RUTA_DEFECTO[d] || '';

function diasVisita() { return Number(settings.visitaDias) || 30; }
function rutaDe(fecha) { const d = parseISO(fecha); return d ? String(settings['ruta' + d.getDay()] || '').trim() : ''; }

/** Fecha de la última visita a la valla (la más reciente de todo lo que implica ir a verla). */
function ultimaVisitaValla(code) {
  const fechas = [];
  (vallasVisitas[code] || []).forEach(v => fechas.push(v.fecha));
  (vallasFotos[code] || []).forEach(f => fechas.push(f.fecha));
  (vallasTrafico[code] || []).forEach(c => fechas.push(c.fecha));
  if (vallasMant[code] && vallasMant[code].ultima) fechas.push(vallasMant[code].ultima);
  if (vallasVision[code] && vallasVision[code].fecha) fechas.push(vallasVision[code].fecha);
  for (const t of trabajos) {
    if ((t.vallas || []).some(v => v.codigo === code)) (t.revisiones || []).forEach(r => fechas.push(r.fecha));
  }
  return fechas.filter(Boolean).sort().pop() || '';
}

/** ¿Lleva más de N días sin visitar (a fecha `ref`, hoy por defecto)? */
function sinVisitar(code, ref) {
  const u = ultimaVisitaValla(code);
  return !u || u <= isoAddDays(ref || todayISO(), -diasVisita());
}

function visitaBadge(code) {
  const u = ultimaVisitaValla(code);
  if (!sinVisitar(code)) return `<span class="badge ok">🚶 visitada ${esc(cuandoText(u))}</span>`;
  return `<span class="badge volver">🚶 ${u ? `sin visitar desde ${esc(fmtDate(u))}` : 'sin visitas registradas'}</span>`;
}

function marcarVisitada(code, nota) {
  const hoy = todayISO();
  const list = vallasVisitas[code] || (vallasVisitas[code] = []);
  if (!list.some(v => v.fecha === hoy)) list.push({ fecha: hoy, nota: nota || '' });
  saveVisitas();
}

/* ------------------------------------------------------------- filtros del catálogo */

/** Por revisar: le toca en ≤ 7 días, o no tiene ninguna revisión apuntada (salvo «Nunca»). */
function porRevisar(code) {
  const m = vallasMant[code];
  if (m && m.cada === 'Nunca') return false;
  const f = proximaRevision(code);
  if (f) return diasHasta(f) <= 7;
  return !(m && m.ultima);
}

/** Por recontar: el último conteo es antiguo o nunca se ha medido el tráfico. */
function porRecontar(code) { return conteoVencido(code) || !ultimoConteo(code); }

function vallasDeRuta(prov, fecha) {
  return VALLAS_DB.filter(v => normName(v.provincia) === normName(prov) && sinVisitar(v.codigo, fecha));
}

/** Catálogo con las vallas a visitar en la ruta de un día. */
function openRuta(prov, fecha) {
  catRuta = { prov, fecha: fecha || todayISO() };
  catTrafico = '';
  catZona = 'Todas'; catMuni = '';
  openCatalog();
}

function renderRutaUi() {
  const hoy = todayISO(), man = isoAddDays(hoy, 1);
  const ph = rutaDe(hoy), pm = rutaDe(man);
  $('#cat-rutas').innerHTML = [
    ph ? `<button class="chip ruta${catRuta && catRuta.fecha === hoy ? ' active' : ''}" data-ruta="${esc(ph)}|${hoy}">🚗 Ruta de hoy · ${esc(ph)} (${vallasDeRuta(ph, hoy).length})</button>` : '',
    pm ? `<button class="chip ruta${catRuta && catRuta.fecha === man ? ' active' : ''}" data-ruta="${esc(pm)}|${man}">🚗 Mañana · ${esc(pm)} (${vallasDeRuta(pm, man).length})</button>` : '',
  ].join('');
  $('#cat-ruta-info').hidden = !catRuta;
  if (catRuta) {
    const d = parseISO(catRuta.fecha);
    $('#cat-ruta-info').innerHTML = `🚗 <b>Ruta del ${DIAS_SEMANA[d.getDay()].toLowerCase()} ${esc(fmtDate(catRuta.fecha))} · ${esc(catRuta.prov)}</b>: vallas sin visitar en más de ${diasVisita()} días. Pulsa «✓ Visitada» al pasar por cada una.
      <button type="button" class="act" data-ruta-x="1">Quitar</button>`;
  }
}

/* ------------------------------------------------------------- ficha de la valla */

function renderVisitasValla() {
  const box = $('#vv-visitas');
  if (!box) return;
  const code = vallaEditing;
  if (!code) { box.innerHTML = '<p class="hint">Guarda la valla para apuntar visitas.</p>'; $('#vv-visitada').hidden = true; return; }
  $('#vv-visitada').hidden = false;
  const u = ultimaVisitaValla(code);
  const lista = (vallasVisitas[code] || []).slice().reverse();
  box.innerHTML = `<p class="${sinVisitar(code) ? 'aviso' : 'envio-info'}">${u ? `Última visita: ${esc(fmtDate(u))} (${esc(cuandoText(u))})` : 'Sin visitas registradas'}${sinVisitar(code) ? ` · toca visitarla (cada ${diasVisita()} días)` : ''}.</p>`
    + (lista.length ? `<div class="hint">Visitas apuntadas: ${lista.slice(0, 8).map(v => esc(fmtDate(v.fecha))).join(' · ')}${lista.length > 8 ? '…' : ''}</div>` : '');
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.visitada) {
    e.stopPropagation();
    marcarVisitada(t.dataset.visitada);
    toast(`${t.dataset.visitada} visitada hoy`);
    if (currentView() === 'catalogo') renderCatalog();
    return;
  }
  if (t.id === 'vv-visitada' && vallaEditing) { marcarVisitada(vallaEditing); renderVisitasValla(); toast('Visita apuntada'); return; }
  if (t.dataset.ruta) {
    const [prov, fecha] = t.dataset.ruta.split('|');
    if (catRuta && catRuta.fecha === fecha) catRuta = null; else { catRuta = { prov, fecha }; catTrafico = ''; }
    renderCatalog();
    return;
  }
  if (t.dataset.rutaX) { catRuta = null; renderCatalog(); return; }
}, true);
