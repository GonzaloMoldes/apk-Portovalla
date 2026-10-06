'use strict';

/* =========================================================================
 * Clientes: datos, vallas contratadas (contratos), historial de documentos
 * (PDF de presupuestos) y relación con visitas, trabajos y ventas.
 * También calcula la disponibilidad de cada valla.
 * ========================================================================= */

let clientes = store.load('clientes') || [];
let contratos = store.load('contratos') || [];
let documentos = store.load('documentos') || [];
let cliFiltro = 'todos';
let cliEditing = null;     // id del cliente en la ficha
let ctCtx = null;          // contrato en edición: { codes, id }

function saveClientes() { store.save('clientes', clientes); }
function saveContratos() { store.save('contratos', contratos); }
function saveDocumentos() { store.save('documentos', documentos); }

function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\b(S\.?L\.?U?|S\.?A\.?)\b/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
}

function clienteById(id) { return clientes.find(c => c.id === id) || null; }

function clienteByNombre(nombre) {
  const n = normName(nombre);
  return n ? clientes.find(c => normName(c.nombre) === n) || null : null;
}

/* ------------------------------------------------------------- contratos y disponibilidad */

function contratoEstado(ct, hoy) {
  hoy = hoy || todayISO();
  if (ct.desde && ct.desde > hoy) return 'Futuro';
  if (ct.hasta && ct.hasta < hoy) return 'Vencido';
  return 'Activo';
}

function contratoActivo(codigo) {
  const hoy = todayISO();
  return contratos.filter(ct => ct.codigo === codigo && contratoEstado(ct, hoy) === 'Activo')
    .sort((a, b) => (b.desde || '').localeCompare(a.desde || ''))[0] || null;
}

/**
 * Disponibilidad de una valla: un contrato en vigor manda (Ocupada por ese cliente);
 * si no, lo marcado a mano en la ficha de la valla (Disponible por defecto).
 */
function vallaDisponibilidad(codigo) {
  const ct = contratoActivo(codigo);
  if (ct) {
    const c = clienteById(ct.clienteId);
    return { estado: 'Ocupada', cliente: c ? c.nombre : '', clienteId: ct.clienteId, hasta: ct.hasta || '', contratoId: ct.id };
  }
  const d = (typeof vallasDispo !== 'undefined' && vallasDispo[codigo]) || {};
  const estado = d.estado || 'Disponible';
  return { estado, cliente: estado === 'Ocupada' ? d.ocupadaPor || '' : '', clienteId: '', hasta: estado === 'Ocupada' ? d.hasta || '' : '' };
}

function dispoBadge(codigo, cls) {
  const d = vallaDisponibilidad(codigo);
  const icon = { Disponible: '🟢', Ocupada: '🔴', Consultar: '🟡' }[d.estado] || '';
  const extra = d.estado === 'Ocupada'
    ? [d.cliente, d.hasta && `hasta ${fmtDate(d.hasta)}`].filter(Boolean).join(' · ') : '';
  return `<span class="badge dispo-${esc(d.estado)}${cls ? ' ' + cls : ''}">${icon} ${esc(d.estado)}${extra ? ' · ' + esc(extra) : ''}</span>`;
}

/* ------------------------------------------------------------- documentos (historial de PDF) */

/** Guarda en el historial un PDF generado. Se asocia al cliente (si lo hay) y a la visita. */
function registrarDocumento(doc) {
  const d = Object.assign({ id: uid(), fecha: new Date().toISOString(), tipo: 'Presupuesto' }, doc);
  // Si ya existe el mismo fichero (se regenera), se actualiza
  const prev = documentos.find(x => x.uri && x.uri === d.uri);
  if (prev) Object.assign(prev, d, { id: prev.id });
  else documentos.push(d);
  saveDocumentos();
  return d;
}

function docsDeCliente(c) {
  const leadIds = new Set(leads.filter(l => l.clienteId === c.id).map(l => l.id));
  const n = normName(c.nombre);
  return documentos.filter(d => d.clienteId === c.id || (d.leadId && leadIds.has(d.leadId))
    || (!d.clienteId && n && normName(d.empresa) === n))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
}

function abrirDoc(id, mode) {
  const d = documentos.find(x => x.id === id);
  if (!d) return;
  if (!NATIVE) { toast('Solo disponible en la tablet'); return; }
  window.Android.openDoc(d.uri, 'application/pdf', mode);
}

/* ------------------------------------------------------------- lista */

function openClientes() {
  renderClientes();
  show('clientes');
}

function clienteResumen(c) {
  const hoy = todayISO();
  const cts = contratos.filter(ct => ct.clienteId === c.id);
  const activos = cts.filter(ct => contratoEstado(ct, hoy) === 'Activo');
  const mensual = activos.reduce((s, ct) => s + parseMoney(ct.precioMes), 0);
  const en30 = addMonthsISO(hoy, 1);
  const vencen = activos.filter(ct => ct.hasta && ct.hasta <= en30);
  return { cts, activos, mensual, vencen };
}

function renderClientes() {
  $$('#cli-filtros .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.cliFiltro === cliFiltro));
  const q = $('#cli-search').value.trim().toLowerCase();
  const items = clientes.map(c => ({ c, r: clienteResumen(c) })).filter(({ c, r }) =>
    (cliFiltro !== 'activos' || r.activos.length) && (cliFiltro !== 'vencen' || r.vencen.length) &&
    (!q || q.split(/\s+/).every(w => [c.nombre, c.contacto, c.poblacion, c.cif, c.telefono, ...r.cts.map(ct => ct.codigo)]
      .join(' ').toLowerCase().includes(w))))
    .sort((a, b) => (a.c.nombre || '').localeCompare(b.c.nombre || '', 'es'));
  const conVallas = clientes.filter(c => clienteResumen(c).activos.length).length;
  $('#cli-stats').textContent = `${items.length} de ${clientes.length} clientes · ${conVallas} con vallas contratadas`;
  $('#cli-list').innerHTML = items.length ? items.map(({ c, r }) => {
    const docs = docsDeCliente(c).length;
    const badges = [
      r.activos.length ? `<span class="badge dispo-Ocupada">🪧 ${r.activos.length} valla${r.activos.length > 1 ? 's' : ''}</span>` : '',
      r.mensual ? `<span class="badge budget-b">${fmtMoney(r.mensual)}/mes</span>` : '',
      r.vencen.length ? `<span class="badge pend">${r.vencen.length} vence${r.vencen.length > 1 ? 'n' : ''} pronto</span>` : '',
      docs ? `<span class="badge">📄 ${docs} PDF</span>` : '',
    ].join('');
    return `<article class="job" data-cli="${c.id}">
      <div class="job-main">
        <div class="job-title">${esc(c.nombre)}</div>
        <div class="job-meta">${[c.contacto, c.telefono, c.correo, c.poblacion].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="badges">${badges}</div>
      </div>
    </article>`;
  }).join('') : `<div class="empty">${clientes.length ? 'No hay clientes con este filtro.'
    : 'Aún no hay clientes.<br>Pulsa <b>＋ Nuevo cliente</b> o el botón <b>👤 Cliente</b> de una visita.'}</div>`;
}

/* ------------------------------------------------------------- ficha */

const CF_FIELDS = ['nombre', 'cif', 'contacto', 'telefono', 'correo', 'direccion', 'poblacion', 'provincia', 'notas'];

function openClienteForm(id, preset) {
  cliEditing = id || null;
  const form = $('#cli-form');
  form.reset();
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  const c = id ? clienteById(id) : Object.assign({}, preset || {});
  for (const k of CF_FIELDS) form.elements[k].value = c[k] || '';
  $('#cli-form-title').textContent = id ? c.nombre : 'Nuevo cliente';
  $('#cf-delete').hidden = !id;
  renderCf();
  show('cliente-form');
}

function renderCf() {
  const form = $('#cli-form');
  $$('#cli-form [data-cf-fill]').forEach(g => {
    const v = (form.elements[g.dataset.cfFill].value || '').trim().toLowerCase();
    $$('.chip', g).forEach(ch => ch.classList.toggle('active', !!v && ch.dataset.value.toLowerCase() === v));
  });
  const c = cliEditing ? clienteById(cliEditing) : null;
  const hoy = todayISO();
  // Contratos
  const cts = c ? contratos.filter(ct => ct.clienteId === c.id)
    .sort((a, b) => (contratoEstado(a, hoy) === 'Activo' ? 0 : 1) - (contratoEstado(b, hoy) === 'Activo' ? 0 : 1)
      || (b.desde || '').localeCompare(a.desde || '')) : [];
  $('#cf-contratos').innerHTML = cts.length ? cts.map(ct => {
    const v = VALLAS_DB.find(x => x.codigo === ct.codigo) || { codigo: ct.codigo, direccion: '(ya no está en el catálogo)' };
    const est = contratoEstado(ct, hoy);
    return `<div class="row-item" data-ct="${ct.id}">
      ${v.foto ? `<img src="${esc(v.foto)}" alt="">` : ''}
      <div class="ri-main"><b>${esc(ct.codigo)} · ${esc(v.direccion || '')}</b>
        <span>${[ct.desde && `desde ${fmtDate(ct.desde)}`, ct.hasta ? `hasta ${fmtDate(ct.hasta)}` : 'sin fecha de fin',
          ct.precioMes && `${fmtMoney(parseMoney(ct.precioMes))}/mes`, ct.campana].filter(Boolean).map(esc).join(' · ')}</span></div>
      <span class="badge ${est === 'Activo' ? 'dispo-Ocupada' : est === 'Futuro' ? 'budget-b' : ''}">${est}</span>
    </div>`;
  }).join('') : '<p class="hint">Sin vallas contratadas.</p>';
  const r = c ? clienteResumen(c) : { activos: [], mensual: 0 };
  $('#cf-contratos-total').textContent = r.activos.length
    ? `${r.activos.length} valla${r.activos.length > 1 ? 's' : ''} en vigor${r.mensual ? ` · ${fmtMoney(r.mensual)}/mes` : ''}` : '';
  // Documentos
  const docs = c ? docsDeCliente(c) : [];
  $('#cf-docs').innerHTML = docs.length ? docs.map(d => `<div class="row-item">
      <div class="ri-main"><b>📄 ${esc(d.titulo || d.fichero || 'Documento')}</b>
        <span>${esc([d.tipo, fmtDate((d.fecha || '').slice(0, 10)), d.fichero].filter(Boolean).join(' · '))}</span></div>
      <button type="button" class="act" data-doc-open="${d.id}">Abrir</button>
      <button type="button" class="act" data-doc-share="${d.id}">Enviar</button>
    </div>`).join('') : '<p class="hint">Aún no hay documentos. Los PDF de presupuesto de este cliente se guardan aquí.</p>';
  // Relacionados
  const n = c ? normName(c.nombre) : '';
  const vis = c ? leads.filter(l => l.clienteId === c.id || (!l.clienteId && n && normName(l.razonSocial) === n)) : [];
  const trs = c ? trabajos.filter(t => t.clienteId === c.id || (n && normName(t.clienteNombre || t.campana) === n)) : [];
  $('#cf-relacionados').innerHTML = (vis.length || trs.length) ? [
    ...vis.map(l => `<div class="row-item" data-rel-lead="${l.id}"><div class="ri-main"><b>📋 Visita ${esc(fmtDate(l.fecha))}</b>
      <span>${esc([l.tipo, l.situacion].filter(Boolean).join(' · '))}</span></div></div>`),
    ...trs.map(t => `<div class="row-item" data-rel-tr="${t.id}"><div class="ri-main"><b>${t.clase === 'Venta' ? '🛒 Venta' : '🛠 Trabajo'} #${t.num}</b>
      <span>${esc([t.clase === 'Venta' ? (t.lineas || []).map(x => x.articulo).join(', ') : t.tipos.join(' + '), t.estado,
        t.importe && fmtMoney(parseMoney(t.importe))].filter(Boolean).join(' · '))}</span></div></div>`),
  ].join('') : '<p class="hint">Sin visitas, trabajos ni ventas asociadas.</p>';
}

function readCf() {
  const form = $('#cli-form');
  const d = {};
  for (const k of CF_FIELDS) d[k] = (form.elements[k].value || '').trim();
  d.nombre = d.nombre.toUpperCase();
  d.cif = d.cif.toUpperCase();
  d.correo = d.correo.toLowerCase();
  return d;
}

/** Guarda la ficha y devuelve el cliente (o null si falta el nombre). */
function saveCliente(silent) {
  const form = $('#cli-form');
  const d = readCf();
  if (!d.nombre) {
    form.elements.nombre.classList.add('invalid');
    form.elements.nombre.focus();
    toast('Falta el nombre del cliente');
    return null;
  }
  const now = new Date().toISOString();
  let c;
  if (cliEditing) {
    c = clienteById(cliEditing);
    Object.assign(c, d, { modificado: now });
  } else {
    const dup = clienteByNombre(d.nombre);
    if (dup && !confirm(`Ya existe el cliente ${dup.nombre}. ¿Crear otro con el mismo nombre?`)) return null;
    c = Object.assign({ id: uid(), creado: now, modificado: now }, d);
    clientes.push(c);
    cliEditing = c.id;
  }
  saveClientes();
  if (!silent) toast('Cliente guardado');
  return c;
}

function deleteCliente() {
  const c = clienteById(cliEditing);
  if (!c) return;
  const n = contratos.filter(ct => ct.clienteId === c.id).length;
  if (!confirm(`¿Eliminar el cliente ${c.nombre}${n ? ` y sus ${n} contrato${n > 1 ? 's' : ''} de vallas` : ''}?`)) return;
  clientes = clientes.filter(x => x.id !== c.id);
  contratos = contratos.filter(ct => ct.clienteId !== c.id);
  saveClientes();
  saveContratos();
  toast('Cliente eliminado');
  openClientes();
}

/* ------------------------------------------------------------- contratos (ventana) */

function openContrato(codes, id) {
  const ct = id ? contratos.find(x => x.id === id) : null;
  ctCtx = { codes: ct ? [ct.codigo] : codes, id: id || null };
  $('#ct-title').textContent = ct ? `Contrato ${ct.codigo}` : `Contratar ${codes.length} valla${codes.length > 1 ? 's' : ''}`;
  $('#ct-vallas').textContent = ctCtx.codes.map(code => {
    const d = vallaDisponibilidad(code);
    const otro = d.estado === 'Ocupada' && d.clienteId !== cliEditing;
    return code + (otro ? ` (⚠ ocupada${d.cliente ? ' por ' + d.cliente : ''})` : '');
  }).join(', ');
  $('#ct-desde').value = ct ? ct.desde || '' : todayISO();
  $('#ct-hasta').value = ct ? ct.hasta || '' : '';
  $('#ct-precio').value = ct ? ct.precioMes || '' : '';
  $('#ct-campana').value = ct ? ct.campana || '' : '';
  $('#ct-notas').value = ct ? ct.notas || '' : '';
  $('#ct-delete').hidden = !ct;
  $('#ct-fin').hidden = !ct || contratoEstado(ct) !== 'Activo';
  $('#contrato-modal').hidden = false;
}

function saveContrato() {
  if (!ctCtx) return;
  const data = {
    desde: $('#ct-desde').value, hasta: $('#ct-hasta').value, precioMes: $('#ct-precio').value.trim(),
    campana: $('#ct-campana').value.trim(), notas: $('#ct-notas').value.trim(),
  };
  if (data.hasta && data.desde && data.hasta < data.desde) { toast('La fecha de fin es anterior a la de inicio'); return; }
  const now = new Date().toISOString();
  if (ctCtx.id) {
    Object.assign(contratos.find(x => x.id === ctCtx.id), data, { modificado: now });
  } else {
    for (const codigo of ctCtx.codes) {
      contratos.push(Object.assign({ id: uid(), clienteId: cliEditing, codigo, creado: now, modificado: now }, data));
    }
  }
  saveContratos();
  $('#contrato-modal').hidden = true;
  ctCtx = null;
  toast('Contrato guardado');
  renderCf();
}

function contratar() {
  const c = saveCliente(true);
  if (!c) return;
  openPicker([], codes => { if (codes.length) setTimeout(() => openContrato(codes), 50); }, 'cliente-form');
}

/** Crea el contrato desde la ficha de una valla (Ocupada por un cliente de la lista). */
function contratoDesdeValla(codigo, clienteId, hasta) {
  if (contratoActivo(codigo)) return;
  contratos.push({ id: uid(), clienteId, codigo, desde: todayISO(), hasta: hasta || '', precioMes: '', campana: '',
    notas: 'Creado desde la ficha de la valla', creado: new Date().toISOString() });
  saveContratos();
}

function finalizarContrato(id, fecha) {
  const ct = contratos.find(x => x.id === id);
  if (!ct) return;
  ct.hasta = fecha || todayISO();
  ct.modificado = new Date().toISOString();
  saveContratos();
}

/* ------------------------------------------------------------- desde una visita */

function clienteFromLead(lead) {
  if (!lead) return;
  let c = lead.clienteId ? clienteById(lead.clienteId) : clienteByNombre(lead.razonSocial);
  if (c) {
    if (lead.clienteId !== c.id) { lead.clienteId = c.id; store.save('leads', leads); }
    openClienteForm(c.id);
    return;
  }
  openClienteForm(null, {
    nombre: (lead.razonSocial || '').toUpperCase(), contacto: lead.contacto || '', telefono: lead.telefono || '',
    correo: lead.correo || '', poblacion: lead.poblacion || '', provincia: lead.provincia || '',
  });
  pendingLeadLink = lead.id;
  toast('Revisa los datos y guarda el cliente');
}
let pendingLeadLink = '';

/* ------------------------------------------------------------- navegación y eventos */

const patrimonioHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#contrato-modal').hidden) { $('#contrato-modal').hidden = true; return true; }
  if (currentView() === 'cliente-form') { openClientes(); return true; }
  return patrimonioHandleBack();
};

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-cli], [data-ct], [data-rel-lead], [data-rel-tr]');
  if (!t) return;
  if (t.matches('[data-cli]')) { openClienteForm(t.dataset.cli); return; }
  if (t.matches('[data-ct]')) { openContrato([], t.dataset.ct); return; }
  if (t.matches('[data-rel-lead]')) { openForm(t.dataset.relLead); return; }
  if (t.matches('[data-rel-tr]')) { openTrabajoForm(t.dataset.relTr); return; }
  if (t.dataset.cliFiltro) { cliFiltro = t.dataset.cliFiltro; renderClientes(); return; }
  if (t.dataset.docOpen) { abrirDoc(t.dataset.docOpen, 'open'); return; }
  if (t.dataset.docShare) { abrirDoc(t.dataset.docShare, 'share'); return; }
  if (t.dataset.leadCliente) { clienteFromLead(leads.find(l => l.id === t.dataset.leadCliente)); return; }
  if (t.dataset.ctDesde !== undefined) { $('#ct-desde').value = todayISO(); return; }
  if (t.dataset.ctMeses) {
    const base = $('#ct-desde').value || todayISO();
    $('#ct-hasta').value = addMonthsISO(base, Number(t.dataset.ctMeses));
    return;
  }
  const fill = t.closest('[data-cf-fill]');
  if (fill && t.classList.contains('chip')) {
    $(`#cli-form [name="${fill.dataset.cfFill}"]`).value = t.dataset.value;
    renderCf();
    return;
  }
  switch (t.dataset.c) {
    case 'cli-new': openClienteForm(null); break;
    case 'cli-save': {
      const c = saveCliente(false);
      if (c && pendingLeadLink) {
        const l = leads.find(x => x.id === pendingLeadLink);
        if (l) { l.clienteId = c.id; store.save('leads', leads); }
        pendingLeadLink = '';
      }
      if (c) openClientes();
      break;
    }
    case 'cli-delete': deleteCliente(); break;
    case 'cf-contratar': contratar(); break;
    case 'ct-save': saveContrato(); break;
    case 'ct-cancel': $('#contrato-modal').hidden = true; ctCtx = null; break;
    case 'ct-fin': finalizarContrato(ctCtx.id); $('#contrato-modal').hidden = true; toast('Contrato finalizado hoy'); renderCf(); break;
    case 'ct-delete':
      if (ctCtx && confirm('¿Eliminar este contrato?')) {
        contratos = contratos.filter(x => x.id !== ctCtx.id);
        saveContratos();
        $('#contrato-modal').hidden = true;
        renderCf();
      }
      break;
  }
});

$('#cli-search').addEventListener('input', renderClientes);
$('#cli-form').addEventListener('input', e => { if (e.target.name === 'provincia') renderCf(); });
$('#contrato-modal').addEventListener('click', e => { if (e.target.id === 'contrato-modal') e.target.hidden = true; });
