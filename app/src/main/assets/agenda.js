/* PortoValla Operadores · agenda, avisos, revisiones de vallas y «vallas cerca de mí»
   - Cada valla puede tener una revisión periódica (desbrozar, revisión, limpieza) cada mes,
     trimestre, semestre, año o nunca. Un trabajo hecho de ese tipo cuenta como revisión.
   - La agenda junta lo que vence: trabajos con fecha, contratos que terminan, revisiones de
     vallas, conteos de tráfico caducados y próximos contactos de patrimonio.
   - Los avisos se pasan a Android (setAlerts), que muestra una notificación diaria. */

const REV_MESES = { Mensual: 1, Trimestral: 3, Semestral: 6, Anual: 12, Nunca: 0 };
const REV_MOTIVOS = ['Desbrozar', 'Revisión', 'Limpieza'];
const REV_TIPOS_TRABAJO = ['Desbrozar', 'Revisión', 'Arreglo / reparación'];

/** código → { cada, motivo, ultima } */
let vallasMant = store.load('vallas_mant') || {};
let vmState = { cada: 'Nunca', motivo: 'Desbrozar' };

function saveMant() { store.save('vallas_mant', vallasMant); }

function isoAddDays(iso, days) {
  const d = parseISO(iso);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function diasHasta(iso) {
  const d = parseISO(iso), h = parseISO(todayISO());
  return d && h ? Math.round((d - h) / 86400000) : null;
}

function cuandoText(iso) {
  const n = diasHasta(iso);
  if (n === null) return '';
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

/* ------------------------------------------------------------- revisiones de vallas */

/** Fecha de la próxima revisión (o '' si no se revisa). Sin revisión anterior → hoy. */
function proximaRevision(code) {
  const m = vallasMant[code];
  const meses = m ? REV_MESES[m.cada] || 0 : 0;
  if (!meses) return '';
  return m.ultima ? addMonthsISO(m.ultima, meses) : todayISO();
}

function revisionBadge(code) {
  const f = proximaRevision(code);
  if (!f) return '';
  const n = diasHasta(f);
  if (n > 7) return '';
  const m = vallasMant[code];
  return `<span class="badge ${n < 0 ? 'pend' : 'volver'}">🌿 ${esc(m.motivo || 'Revisar')} ${n < 0 ? 'atrasado' : cuandoText(f)}</span>`;
}

/** Los trabajos hechos de desbroce/revisión/arreglo cuentan como última revisión de sus vallas. */
function mantSyncTrabajos() {
  let cambios = false;
  for (const t of trabajos) {
    if (t.estado !== 'Hecho' || !t.fechaHecho || !(t.tipos || []).some(x => REV_TIPOS_TRABAJO.includes(x))) continue;
    for (const v of t.vallas || []) {
      const m = vallasMant[v.codigo];
      if (!m) continue;
      if (!m.ultima || m.ultima < t.fechaHecho) { m.ultima = t.fechaHecho; cambios = true; }
    }
  }
  if (cambios) saveMant();
}

function mantLoad(code) {
  const m = vallasMant[code] || {};
  vmState = { cada: m.cada || 'Nunca', motivo: m.motivo || 'Desbrozar' };
  $('#valla-form').elements.vm_ultima.value = m.ultima || '';
  renderMant();
}

function renderMant() {
  $$('[data-vm-cada] .chip').forEach(c => c.classList.toggle('active', c.dataset.value === vmState.cada));
  $$('[data-vm-motivo] .chip').forEach(c => c.classList.toggle('active', c.dataset.value === vmState.motivo));
  const meses = REV_MESES[vmState.cada] || 0;
  $('#vm-detalle').hidden = !meses;
  const ultima = $('#valla-form').elements.vm_ultima.value;
  const prox = meses ? (ultima ? addMonthsISO(ultima, meses) : todayISO()) : '';
  const info = $('#vm-proxima');
  if (!prox) { info.textContent = ''; info.className = 'hint'; return; }
  const n = diasHasta(prox);
  info.className = n < 0 ? 'aviso' : n <= 7 ? 'aviso' : 'envio-info';
  info.textContent = !ultima ? `Sin revisión registrada: ${vmState.motivo.toLowerCase()} pendiente.`
    : n < 0 ? `⚠ Revisión atrasada (${vmState.motivo.toLowerCase()}): tocaba el ${fmtDate(prox)}, ${cuandoText(prox)}.`
      : `Próxima revisión (${vmState.motivo.toLowerCase()}): ${fmtDate(prox)} · ${cuandoText(prox)}.`;
}

function mantSave(codigo, anterior) {
  if (anterior && anterior !== codigo) delete vallasMant[anterior];
  const ultima = $('#valla-form').elements.vm_ultima.value;
  if (vmState.cada === 'Nunca' && !ultima) delete vallasMant[codigo];
  else vallasMant[codigo] = { cada: vmState.cada, motivo: vmState.motivo, ultima };
  saveMant();
}

/** Abre un trabajo de revisión para la valla. */
function trabajoRevision(code) {
  const v = VALLAS_DB.find(x => x.codigo === code);
  if (!v) return;
  const m = vallasMant[code] || {};
  const tipo = m.motivo === 'Revisión' ? 'Revisión' : m.motivo === 'Limpieza' ? 'Otro' : 'Desbrozar';
  const prev = trabajos.find(t => t.estado !== 'Hecho' && (t.tipos || []).includes(tipo) && (t.vallas || []).some(x => x.codigo === code));
  if (prev) { openTrabajoForm(prev.id); toast(`Ya hay un trabajo abierto (#${prev.num})`); return; }
  openTrabajoForm(null, {
    tipos: [tipo],
    vallas: [Object.assign({}, v)],
    fechaPrevista: proximaRevision(code) > todayISO() ? proximaRevision(code) : isoPlus(1),
    descripcion: `${m.motivo || 'Revisión'} periódica (${(m.cada || '').toLowerCase()}) de la valla ${code}.`,
  });
}

/* ------------------------------------------------------------- vallas cerca de mí */

let miPos = null;          // { lat, lng, acc, hora }
let cercaKm = 10;

function distanciaKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distancia desde mi posición a la valla (km) o null. */
function distanciaValla(v) {
  if (!miPos || !v || v.lat === '' || v.lat == null) return null;
  return distanciaKm(miPos, { lat: Number(v.lat), lng: Number(v.lng) });
}

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}

function distanciaBadge(v) {
  const d = distanciaValla(v);
  return d === null ? '' : `<span class="badge dist">📍 ${fmtKm(d)}</span>`;
}

/** Pide la posición GPS y vuelve a pintar el catálogo. */
function buscarCercaDeMi() {
  const btn = $('#cat-cerca-btn');
  btn.textContent = '⏳ Buscando tu posición…';
  requestLocationFor({
    btn: '#cat-cerca-btn',
    done: r => {
      miPos = { lat: r.lat, lng: r.lng, acc: r.acc, hora: Date.now() };
      catCerca = true;
      renderCatalog();
      const n = VALLAS_DB.filter(v => { const d = distanciaValla(v); return d !== null && d <= cercaKm; }).length;
      toast(`${n} valla${n === 1 ? '' : 's'} a menos de ${cercaKm} km`);
    },
  });
}

function renderCercaUi() {
  $('#cat-cerca-btn').textContent = catCerca ? '📍 Cerca de mí ✓' : '📍 Vallas cerca de mí';
  $('#cat-cerca-btn').classList.toggle('active', catCerca);
  $('#cat-radios').hidden = !catCerca;
  $$('#cat-radios .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.km) === cercaKm));
  $('#cat-cerca-info').textContent = catCerca && miPos
    ? `Tu posición${miPos.acc ? ` (±${miPos.acc} m)` : ''} · actualizada ${new Date(miPos.hora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    : '';
}

/* ------------------------------------------------------------- agenda */

function diasAvisoContrato() { return Number(settings.avisoContratoDias) || 30; }

/**
 * Todo lo que tiene fecha: { fecha, aviso (cuándo avisar), tipo, icono, titulo, texto, abrir: [tipo, id] }.
 */
function agendaItems() {
  const hoy = todayISO();
  const out = [];
  // Trabajos y ventas abiertos con fecha prevista
  for (const t of trabajos) {
    if (t.estado === 'Hecho' || !t.fechaPrevista) continue;
    const venta = t.clase === 'Venta';
    out.push({ fecha: t.fechaPrevista, aviso: isoAddDays(t.fechaPrevista, -1), tipo: 'trabajo', icono: venta ? '🛒' : '🛠',
      titulo: `${venta ? 'Venta' : 'Trabajo'} #${t.num} · ${venta ? (t.lineas || []).map(x => x.articulo).join(', ') : (t.tipos || []).join(' + ')}`,
      texto: [(t.vallas || []).map(v => v.codigo).join(', '), t.clienteNombre || t.campana, t.asignado && '👷 ' + t.asignado,
        t.prioridad === 'Urgente' && '⚠ Urgente'].filter(Boolean).join(' · '),
      abrir: ['trabajo', t.id] });
  }
  // Contratos en vigor que terminan
  for (const ct of contratos) {
    if (!ct.hasta || contratoEstado(ct, hoy) !== 'Activo') continue;
    const c = clienteById(ct.clienteId);
    out.push({ fecha: ct.hasta, aviso: isoAddDays(ct.hasta, -diasAvisoContrato()), tipo: 'contrato', icono: '📄',
      titulo: `Vence el contrato de ${ct.codigo}`, texto: [c ? c.nombre : '', ct.campana, ct.precioMes && `${fmtMoney(parseMoney(ct.precioMes))}/mes`].filter(Boolean).join(' · '),
      abrir: ['cliente', ct.clienteId] });
  }
  // Revisiones periódicas de vallas
  for (const code of Object.keys(vallasMant)) {
    const f = proximaRevision(code);
    if (!f || !VALLAS_DB.some(v => v.codigo === code)) continue;
    const v = VALLAS_DB.find(x => x.codigo === code);
    const m = vallasMant[code];
    out.push({ fecha: f, aviso: f, tipo: 'revision', icono: '🌿', titulo: `${m.motivo || 'Revisar'} ${code}`,
      texto: [v.direccion, v.municipio, m.ultima ? `última: ${fmtDate(m.ultima)}` : 'sin revisión registrada', `cada ${String(m.cada).toLowerCase()}`].filter(Boolean).join(' · '),
      abrir: ['valla', code], extra: 'revision' });
  }
  // Conteos de tráfico caducados
  for (const code of Object.keys(vallasTrafico)) {
    const c = ultimoConteo(code);
    if (!c || !VALLAS_DB.some(v => v.codigo === code)) continue;
    const f = addMonthsISO(c.fecha, recontarMeses());
    out.push({ fecha: f, aviso: f, tipo: 'trafico', icono: '⏱', titulo: `Medir el tráfico de ${code}`,
      texto: `último conteo: ${fmtDate(c.fecha)} · ${fmtInt(Number(c.impactos) || 0)} impactos/día`, abrir: ['valla', code] });
  }
  // Próximos contactos de patrimonio
  for (const n of negociaciones) {
    if (!n.proximo || ['Ganada', 'Perdida'].includes(n.estado)) continue;
    out.push({ fecha: n.proximo, aviso: n.proximo, tipo: 'patrimonio', icono: '🏠', titulo: `Contactar con ${n.propietario || 'propietario'}`,
      texto: [n.direccion, n.municipio, n.telefono].filter(Boolean).join(' · '), abrir: ['neg', n.id] });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Lo que hay que mirar ya: atrasado o con aviso vencido. */
function agendaPendientes(items) {
  const hoy = todayISO(), semana = isoAddDays(hoy, 6);
  return (items || agendaItems()).filter(i => i.fecha <= semana || i.aviso <= hoy);
}

let agendaFiltro = '';

function openAgenda() {
  renderAgenda();
  show('agenda');
}
window.openAgenda = openAgenda;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function agendaItemHtml(i) {
  const n = diasHasta(i.fecha);
  return `<div class="agenda-item ag-${i.tipo}${n < 0 ? ' atrasado' : ''}" data-ag-open="${esc(i.abrir.join(':'))}">
    <div class="ag-ico">${i.icono}</div>
    <div class="ri-main"><b>${esc(i.titulo)}</b><span>${esc(i.texto)}</span>
      <span class="ag-cuando">${esc(fmtDate(i.fecha))} · ${esc(cuandoText(i.fecha))}</span></div>
    ${i.tipo === 'trabajo' ? `<button type="button" class="act" data-tr-done="${esc(i.abrir[1])}">✓ Hecho</button>` : ''}
    ${i.extra === 'revision' ? `<button type="button" class="act" data-ag-rev="${esc(i.abrir[1])}">🛠 Crear trabajo</button>` : ''}
  </div>`;
}

function renderAgenda() {
  const hoy = todayISO();
  const all = agendaItems();
  const tipos = { trabajo: 'Trabajos', contrato: 'Contratos', revision: 'Revisiones', trafico: 'Tráfico', patrimonio: 'Patrimonio' };
  const pend = agendaPendientes(all);
  $('#ag-tipos').innerHTML = [['', `Todo (${pend.length})`], ...Object.entries(tipos).map(([k, v]) => [k, `${v} (${pend.filter(i => i.tipo === k).length})`])]
    .map(([k, label]) => `<button class="chip${agendaFiltro === k ? ' active' : ''}" data-ag-tipo="${k}">${esc(label)}</button>`).join('');
  const items = all.filter(i => !agendaFiltro || i.tipo === agendaFiltro);
  const atrasado = items.filter(i => i.fecha < hoy);
  const semana = [];
  for (let d = 0; d < 7; d++) {
    const f = isoAddDays(hoy, d);
    const del = items.filter(i => i.fecha === f);
    const dt = parseISO(f);
    semana.push(`<div class="week">${d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : DIAS[dt.getDay()]} · ${esc(fmtDate(f))}</div>`
      + (del.length ? del.map(agendaItemHtml).join('') : '<p class="hint ag-libre">Nada previsto.</p>'));
  }
  // Más adelante: lo que ya hay que avisar (contratos) y lo de los próximos 30 días
  const fin = isoAddDays(hoy, 6), mes = isoAddDays(hoy, 30);
  const luego = items.filter(i => i.fecha > fin && (i.fecha <= mes || i.aviso <= hoy));
  $('#agenda-list').innerHTML =
    (atrasado.length ? `<div class="week atrasado-h">⚠ Atrasado (${atrasado.length})</div>` + atrasado.map(agendaItemHtml).join('') : '')
    + semana.join('')
    + (luego.length ? `<div class="week">Próximas semanas</div>` + luego.map(agendaItemHtml).join('') : '');
  $('#agenda-stats').textContent = `${atrasado.length} atrasado${atrasado.length === 1 ? '' : 's'} · `
    + `${items.filter(i => i.fecha >= hoy && i.fecha <= fin).length} esta semana · ${luego.length} más adelante`;
}

/* ------------------------------------------------------------- avisos (notificaciones) */

let agendaTimer = null;

/** Recalcula el número de la barra inferior y pasa los avisos a Android (como mucho cada 2 s). */
function agendaTick() {
  clearTimeout(agendaTimer);
  agendaTimer = setTimeout(() => {
    const all = agendaItems();
    const n = agendaPendientes(all).filter(i => i.fecha <= todayISO() || i.aviso <= todayISO()).length;
    const badge = $('#nav-agenda-count');
    if (badge) badge.textContent = n ? String(n > 99 ? '99+' : n) : '';
    if (NATIVE && window.Android.setAlerts) {
      const alerts = all.map(i => ({ id: i.tipo + ':' + i.abrir[1] + ':' + i.fecha, fecha: i.aviso < i.fecha ? i.aviso : i.fecha,
        titulo: `${i.icono} ${i.titulo}`, texto: `${fmtDate(i.fecha)} · ${i.texto}` }));
      try { window.Android.setAlerts(JSON.stringify(alerts), Number(settings.avisoHora) || 9, settings.avisosOff ? false : true); } catch (e) { /* versión antigua */ }
    }
  }, 600);
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-ag-open]');
  if (!t) return;
  if (t.dataset.agTipo !== undefined) { agendaFiltro = t.dataset.agTipo; renderAgenda(); return; }
  if (t.dataset.agRev) { trabajoRevision(t.dataset.agRev); return; }
  if (t.dataset.trDone && currentView() === 'agenda') { setTimeout(renderAgenda, 50); return; }
  if (t.matches('[data-ag-open]') && !t.closest('button')) {
    const [kind, id] = t.dataset.agOpen.split(/:(.*)/s);
    if (kind === 'trabajo') openTrabajoForm(id);
    else if (kind === 'cliente') openClienteForm(id);
    else if (kind === 'valla') openVallaForm(id);
    else if (kind === 'neg') openNegForm(id);
    return;
  }
  if (t.dataset.vm === 'hoy') { $('#valla-form').elements.vm_ultima.value = todayISO(); renderMant(); return; }
  if (t.dataset.vm === 'trabajo') {
    const code = normCodigo($('#valla-form').elements.codigo.value);
    saveValla();
    if (currentView() !== 'valla-form' && code) trabajoRevision(code);
    return;
  }
  const cada = t.closest('[data-vm-cada]');
  if (cada && t.classList.contains('chip')) { vmState.cada = t.dataset.value; renderMant(); return; }
  const mot = t.closest('[data-vm-motivo]');
  if (mot && t.classList.contains('chip')) { vmState.motivo = t.dataset.value; renderMant(); return; }
  if (t.id === 'cat-cerca-btn') {
    if (catCerca) { catCerca = false; renderCatalog(); } else buscarCercaDeMi();
    return;
  }
  if (t.dataset.km) { cercaKm = Number(t.dataset.km); renderCatalog(); return; }
  if (t.id === 'cat-cerca-refresh') { buscarCercaDeMi(); return; }
  if (t.dataset.action === 'test-alert') {
    if (!NATIVE || !window.Android.testAlert) { toast('Los avisos solo funcionan en la tablet'); return; }
    agendaTick();
    setTimeout(() => window.Android.testAlert(), 800);
  }
});

$('#valla-form').addEventListener('input', e => { if (e.target.name === 'vm_ultima') renderMant(); });

mantSyncTrabajos();
agendaTick();
