/* PortoValla Operadores · renovaciones de contratos
   - Importa el Excel de renovaciones de la oficina (COMERCIAL, INICIO CONT., VENCIMIENTO,
     CLIENTE - CAMPAÑA, ESTADO RENOVACION, OBSERVACIONES, DISPO, OOH, ZONA, EMPLAZAMIENTO,
     SOPORTE, TAMAÑO, COORDENADAS) en Clientes: solo las filas de mi código de comercial
     (Ajustes, p. ej. GAL-GON), con vista previa y fusión de clientes duplicados.
   - Cada contrato guarda su estilo de renovación (tácita, no tácita, confirmar…) y el estado
     de la gestión (pendiente, renovado, no renueva) con su historial.
   - Las renovaciones pendientes salen en Clientes → Renovaciones y en la Agenda/avisos con
     los días de antelación de Ajustes. Al gestionarlas se actualiza el contrato del cliente. */

const RENOV_ESTILOS = ['TACITA', 'NO TACITA', 'CONFIRMAR RENOVACION', 'CONFIRMAR FIRMA', 'NO RENUEVA'];
const RENOV_ESTILO_TXT = { TACITA: 'Tácita', 'NO TACITA': 'No tácita', 'CONFIRMAR RENOVACION': 'Confirmar renovación',
  'CONFIRMAR FIRMA': 'Confirmar firma', 'NO RENUEVA': 'No renueva' };
const PROV_PREFIJO = { AC: 'Coruña', LU: 'Lugo', PO: 'Pontevedra', OU: 'Ourense', VA: 'Valladolid', ZA: 'Zamora', PA: 'Palencia',
  BU: 'Burgos', SO: 'Soria', LE: 'León', AS: 'Asturias', O: 'Asturias', SA: 'Salamanca', SG: 'Segovia', AV: 'Ávila', MA: 'Madrid', M: 'Madrid' };

function miComercial() { return String(settings.miComercial || 'GAL-GON').trim().toUpperCase(); }
function diasAvisoRenov() { return Number(settings.avisoContratoDias) || 30; }

function normEstilo(s) {
  const t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/^NO T(ACITA)?$/.test(t)) return 'NO TACITA';
  if (/NO RENUEVA/.test(t)) return 'NO RENUEVA';
  if (/CONFIRMAR FIRMA/.test(t)) return 'CONFIRMAR FIRMA';
  if (/CONFIRMAR/.test(t)) return 'CONFIRMAR RENOVACION';
  if (/TACITA/.test(t)) return t.startsWith('NO') ? 'NO TACITA' : 'TACITA';
  return t;
}

/** Estado de la gestión: 'Pendiente', 'Renovado' o 'No renueva'. */
function renovEstado(ct) {
  if (ct.renovEstado) return ct.renovEstado;
  return ct.renovEstilo === 'NO RENUEVA' ? 'No renueva' : 'Pendiente';
}

/** Contratos con renovación que mirar: los que tienen fin y no se han dado por renovados ni han vencido hace tiempo. */
function renovacionesPendientes() {
  const hace30 = isoAddDays(todayISO(), -30);
  return contratos.filter(ct => ct.hasta && renovEstado(ct) === 'Pendiente' && ct.hasta >= hace30)
    .sort((a, b) => a.hasta.localeCompare(b.hasta));
}

/** Fecha en la que avisar: la pospuesta a mano o «días de antelación» antes del vencimiento. */
function renovAviso(ct) {
  return ct.renovAvisar || isoAddDays(ct.hasta, -diasAvisoRenov());
}

function renovBadge(ct) {
  const est = renovEstado(ct);
  const estilo = ct.renovEstilo ? RENOV_ESTILO_TXT[ct.renovEstilo] || ct.renovEstilo : '';
  if (est === 'Renovado') return '<span class="badge ok">🔁 Renovado</span>';
  if (est === 'No renueva') return '<span class="badge pend">✖ No renueva</span>';
  if (!ct.hasta) return estilo ? `<span class="badge">${esc(estilo)}</span>` : '';
  const n = diasHasta(ct.hasta);
  return `<span class="badge ${n < 0 ? 'pend' : n <= diasAvisoRenov() ? 'volver' : ''}">🔁 ${estilo ? esc(estilo) + ' · ' : ''}${n < 0 ? 'venció' : 'vence'} ${esc(cuandoText(ct.hasta))}</span>`;
}

/* ------------------------------------------------------------- lectura del Excel */

function hNorm(h) {
  return String(h || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Busca la hoja de renovaciones y devuelve sus filas como objetos. */
function leerRenovaciones(book) {
  for (const [nombre, rows] of Object.entries(book)) {
    const hi = rows.findIndex(r => r && r.some(h => hNorm(h).startsWith('VENCIMIENTO')) && r.some(h => hNorm(h) === 'OOH'));
    if (hi < 0) continue;
    const hdr = rows[hi].map(hNorm);
    const col = pref => hdr.findIndex(h => h.startsWith(pref));
    const c = {
      comercial: col('COMERCIAL'), zonaComercial: col('ZONA COMERCIAL'), desde: col('INICIO'), hasta: col('VENCIMIENTO'),
      cliente: col('CLIENTE'), estilo: col('ESTADO RENOV'), obs: col('OBSERVACIONES'), dispo: col('DISPO'), ooh: hdr.findIndex(h => h === 'OOH'),
      zona: hdr.findIndex(h => h === 'ZONA'), emplazamiento: col('EMPLAZAMIENTO'), soporte: col('SOPORTE'), tamano: col('TAMA'), coords: col('COORDENADAS'),
    };
    const v = (r, k) => (c[k] >= 0 && r[c[k]] != null ? String(r[c[k]]).trim() : '');
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      if (!r || !v(r, 'ooh') || !v(r, 'cliente')) continue;
      const cc = v(r, 'cliente');
      const i = cc.indexOf(':');
      const obs = v(r, 'obs');
      const pvs = (obs.match(/\bPVS\s*-?\s*([0-9]{2,}[A-Z0-9.]*)/i) || [])[1] || '';
      const precio = (obs.match(/\bPVS\s*-?\s*[0-9]{2,}[A-Z0-9.]*\s*,\s*(\d{1,4}(?:[.,]\d{1,2})?)/i) || [])[1] || '';
      out.push({
        comercial: v(r, 'comercial').toUpperCase(), zonaComercial: v(r, 'zonaComercial'),
        desde: fromCell('date', v(r, 'desde')), hasta: fromCell('date', v(r, 'hasta')),
        clienteCampana: cc, cliente: (i > 0 ? cc.slice(0, i) : cc).trim().toUpperCase(), campana: i > 0 ? cc.slice(i + 1).trim() : '',
        estilo: normEstilo(v(r, 'estilo')), obs, dispo: v(r, 'dispo'), codigo: normCodigo(v(r, 'ooh')), zona: v(r, 'zona'),
        emplazamiento: v(r, 'emplazamiento'), soporte: v(r, 'soporte'), tamano: v(r, 'tamano'), coords: v(r, 'coords'),
        pvs: pvs ? 'PVS-' + pvs.toUpperCase() : '', precio,
      });
    }
    return { hoja: nombre, filas: out };
  }
  return null;
}

/** Clientes parecidos (para fusionar): mismo nombre, uno contiene al otro o comparten la mayoría de palabras. */
function clientesParecidos(nombre, excluirId) {
  const n = normName(nombre);
  if (!n) return [];
  const ws = new Set(n.split(' ').filter(w => w.length > 2));
  return clientes.filter(c => c.id !== excluirId).map(c => {
    const m = normName(c.nombre);
    if (!m) return null;
    if (m === n) return { c, score: 1 };
    if ((` ${m} `).includes(` ${n} `) || (` ${n} `).includes(` ${m} `)) return { c, score: 0.85 };
    const wm = new Set(m.split(' ').filter(w => w.length > 2));
    const comunes = [...ws].filter(w => wm.has(w)).length;
    const score = comunes / Math.max(1, Math.min(ws.size, wm.size));
    return score >= 0.5 && comunes ? { c, score: score * 0.8 } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------- vista previa de la importación */

let rvImport = null;   // { hoja, filas, comercial, destinos: {clienteNombre: id|'nuevo'} }

function abrirImportRenov(datos) {
  const comerciales = [...new Set(datos.filas.map(f => f.comercial).filter(Boolean))].sort();
  const mio = miComercial();
  rvImport = { hoja: datos.hoja, filas: datos.filas, comercial: comerciales.includes(mio) ? mio : '', destinos: {}, comerciales };
  renderImportRenov();
  $('#renov-import-modal').hidden = false;
}

function filasImport() {
  return rvImport.filas.filter(f => !rvImport.comercial || f.comercial === rvImport.comercial);
}

function renderImportRenov() {
  const filas = filasImport();
  $('#ri-info').textContent = `${rvImport.filas.length} renovaciones en el fichero (hoja ${rvImport.hoja}). `
    + (rvImport.comercial ? `${filas.length} de ${rvImport.comercial}.` : `Se importarán todas (${filas.length}).`);
  $('#ri-comerciales').innerHTML = [...rvImport.comerciales, ''].map(c => {
    const n = rvImport.filas.filter(f => !c || f.comercial === c).length;
    return `<button type="button" class="chip${rvImport.comercial === c ? ' active' : ''}" data-ri-com="${esc(c)}">${esc(c || 'Todos')} (${n})</button>`;
  }).join('');
  const grupos = {};
  filas.forEach(f => { (grupos[f.cliente] = grupos[f.cliente] || []).push(f); });
  $('#ri-clientes').innerHTML = Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([nombre, fs]) => {
    const cands = clientesParecidos(nombre).slice(0, 3);
    // Mismo nombre (o uno contiene al otro) → se propone fusionar; si solo se parece, se propone cliente nuevo
    if (!(nombre in rvImport.destinos)) rvImport.destinos[nombre] = cands.length && cands[0].score >= 0.85 ? cands[0].c.id : 'nuevo';
    const dest = rvImport.destinos[nombre];
    const opciones = cands.map(({ c, score }) => `<button type="button" class="chip${dest === c.id ? ' active' : ''}" data-ri-dest="${esc(nombre)}" data-id="${c.id}">🔀 Fusionar con ${esc(c.nombre)}${score >= 1 ? '' : ' (parecido)'}</button>`)
      .concat(`<button type="button" class="chip${dest === 'nuevo' ? ' active' : ''}" data-ri-dest="${esc(nombre)}" data-id="nuevo">＋ Cliente nuevo</button>`).join('');
    return `<div class="ri-cliente">
      <b>${esc(nombre)}</b>
      <div class="ri-filas">${fs.map(f => `<span>${esc(f.codigo)} · vence ${esc(fmtDate(f.hasta))} · ${esc(RENOV_ESTILO_TXT[f.estilo] || f.estilo || '—')}${f.pvs ? ' · ' + esc(f.pvs) : ''}${f.campana ? ' · ' + esc(f.campana) : ''}</span>`).join('')}</div>
      <div class="chips small">${opciones}</div>
    </div>`;
  }).join('') || '<p class="hint">No hay filas para este comercial.</p>';
}

/** Provincia / municipio / zona del catálogo a partir de «LU: Barreiros». */
function zonaDeRenov(z) {
  const m = String(z || '').match(/^\s*([A-Z]{1,2})\s*:\s*(.+)$/i);
  if (!m) return { provincia: '', municipio: String(z || '').trim(), zona: '' };
  const provincia = PROV_PREFIJO[m[1].toUpperCase()] || m[1].toUpperCase();
  const municipio = m[2].trim();
  const zona = provincia === 'Coruña' ? (/^a coru[nñ]a$/i.test(municipio) ? 'A CORUÑA' : 'PUEBLOS A CORUÑA') : provincia.toUpperCase();
  return { provincia, municipio, zona };
}

function aplicarImportRenov() {
  const filas = filasImport();
  if (!filas.length) { toast('No hay nada que importar'); return; }
  const now = new Date().toISOString();
  const r = { clientesNuevos: 0, fusionados: new Set(), nuevos: 0, actualizados: 0, vallas: 0 };
  const idPorNombre = {};
  for (const f of filas) {
    // Cliente: fusionar con el elegido o crear uno nuevo
    let cli = idPorNombre[f.cliente] && clienteById(idPorNombre[f.cliente]);
    if (!cli) {
      const dest = rvImport.destinos[f.cliente];
      cli = dest && dest !== 'nuevo' ? clienteById(dest) : null;
      if (cli) r.fusionados.add(cli.id);
      else {
        cli = { id: uid(), creado: now, modificado: now, nombre: f.cliente, cif: '', contacto: '', telefono: '', correo: '', direccion: '',
          poblacion: '', provincia: '', notas: '' };
        clientes.push(cli);
        r.clientesNuevos++;
      }
      idPorNombre[f.cliente] = cli.id;
    }
    if (!cli.comercial && f.comercial) cli.comercial = f.comercial;
    // Valla: si no está en el catálogo se añade con los datos del fichero
    if (!VALLAS_DB.some(v => v.codigo === f.codigo)) {
      const z = zonaDeRenov(f.zona);
      const co = parseCoords(f.coords);
      vallasUser[f.codigo] = { codigo: f.codigo, direccion: f.emplazamiento.replace(/_{2,}/g, ' ').toUpperCase(), zona: z.zona,
        municipio: z.municipio, provincia: z.provincia, medida: f.tamano, categoria: '', lat: co ? co.lat : '', lng: co ? co.lng : '',
        foto: '', origen: 'Excel de renovaciones' };
      r.vallas++;
    }
    // Contrato: mismo PVS, o misma valla del mismo cliente con el mismo vencimiento (o sin fechas) → se actualiza
    const datos = {
      clienteId: cli.id, codigo: f.codigo, desde: f.desde, hasta: f.hasta, campana: f.campana,
      renovEstilo: f.estilo, renovObs: f.obs, comercial: f.comercial, zonaComercial: f.zonaComercial, dispo: f.dispo,
    };
    let ct = (f.pvs && contratos.find(x => x.pvs === f.pvs && x.codigo === f.codigo))
      || contratos.find(x => x.clienteId === cli.id && x.codigo === f.codigo && (x.hasta === f.hasta || !x.hasta || !f.hasta));
    if (ct) {
      Object.assign(ct, datos, { modificado: now });
      if (!ct.pvs && f.pvs) ct.pvs = f.pvs;
      if (!ct.precioMes && f.precio) ct.precioMes = f.precio;
      if (f.estilo === 'NO RENUEVA' && !ct.renovEstado) ct.renovEstado = 'No renueva';
      r.actualizados++;
    } else {
      contratos.push(Object.assign({ id: uid(), creado: now, modificado: now, pvs: f.pvs, precioMes: f.precio, notas: '',
        renovEstado: f.estilo === 'NO RENUEVA' ? 'No renueva' : '', renovHist: [{ fecha: todayISO(), accion: 'Importado', nota: `Excel de renovaciones (${f.estilo || 'sin estilo'})` }] }, datos));
      r.nuevos++;
    }
  }
  saveClientes();
  saveContratos();
  if (r.vallas) saveCatalog();
  $('#renov-import-modal').hidden = true;
  rvImport = null;
  cliFiltro = 'renovaciones';
  openClientes();
  toast(`Renovaciones importadas: ${r.nuevos} contrato${r.nuevos === 1 ? '' : 's'} nuevo${r.nuevos === 1 ? '' : 's'}, ${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'} · `
    + `${r.clientesNuevos} cliente${r.clientesNuevos === 1 ? '' : 's'} nuevo${r.clientesNuevos === 1 ? '' : 's'}, ${r.fusionados.size} fusionado${r.fusionados.size === 1 ? '' : 's'}`
    + (r.vallas ? ` · ${r.vallas} valla${r.vallas === 1 ? '' : 's'} añadida${r.vallas === 1 ? '' : 's'} al catálogo` : ''));
}

/* El importador de Clientes reconoce también el Excel de renovaciones (abre la vista previa). */
const importarClientesBase = IMPORTERS.clientes;
IMPORTERS.clientes = function (book) {
  const datos = leerRenovaciones(book);
  if (datos && datos.filas.length) { abrirImportRenov(datos); return null; }
  return importarClientesBase(book);
};

/* ------------------------------------------------------------- lista de renovaciones (Clientes) */

function renderRenovaciones() {
  const hoy = todayISO();
  const pend = renovacionesPendientes();
  const hechas = contratos.filter(ct => ['Renovado', 'No renueva'].includes(renovEstado(ct)) && ct.hasta && ct.hasta >= isoAddDays(hoy, -120))
    .sort((a, b) => b.hasta.localeCompare(a.hasta));
  const fila = ct => {
    const c = clienteById(ct.clienteId) || {};
    const v = VALLAS_DB.find(x => x.codigo === ct.codigo) || {};
    return `<article class="job renov-item" data-renov="${ct.id}">
      ${v.foto ? `<img class="lead-thumb" src="${esc(v.foto)}" alt="">` : ''}
      <div class="job-main">
        <div class="job-title">${esc(c.nombre || '?')}${ct.campana ? ` · <span class="hint-inline">${esc(ct.campana)}</span>` : ''}</div>
        <div class="job-meta">${[ct.codigo, v.direccion || '', v.municipio, ct.pvs, ct.precioMes && `${fmtMoney(parseMoney(ct.precioMes))}/mes`].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="badges">${renovBadge(ct)}${ct.renovAvisar ? `<span class="badge">⏰ avisar ${esc(fmtDate(ct.renovAvisar))}</span>` : ''}</div>
      </div>
      <div class="g-importe">${esc(fmtDate(ct.hasta))}<span>${esc(cuandoText(ct.hasta))}</span></div>
    </article>`;
  };
  const urg = pend.filter(ct => renovAviso(ct) <= hoy);
  const luego = pend.filter(ct => renovAviso(ct) > hoy);
  $('#cli-stats').textContent = `${pend.length} renovacion${pend.length === 1 ? '' : 'es'} pendiente${pend.length === 1 ? '' : 's'} · `
    + `${urg.length} para gestionar ya (aviso ${diasAvisoRenov()} días antes)`;
  $('#cli-list').innerHTML = (pend.length || hechas.length) ? (
    (urg.length ? `<div class="week atrasado-h">Para gestionar ya (${urg.length})</div>` + urg.map(fila).join('') : '')
    + (luego.length ? `<div class="week">Más adelante (${luego.length})</div>` + luego.map(fila).join('') : '')
    + (hechas.length ? `<div class="week">Gestionadas (${hechas.length})</div>` + hechas.map(fila).join('') : '')
  ) : `<div class="empty">No hay renovaciones.<br>Importa el Excel de renovaciones con el icono ⇅ de Clientes.</div>`;
}

/* ------------------------------------------------------------- gestionar una renovación */

let rvCtx = null;   // { id, accion }

function openRenov(id) {
  const ct = contratos.find(x => x.id === id);
  if (!ct) return;
  rvCtx = { id, accion: '' };
  const c = clienteById(ct.clienteId) || {};
  const v = VALLAS_DB.find(x => x.codigo === ct.codigo) || {};
  $('#rv-title').textContent = `Renovación ${ct.codigo}`;
  $('#rv-info').innerHTML = `<b>${esc(c.nombre || '?')}</b>${ct.campana ? ' · ' + esc(ct.campana) : ''}<br>
    ${esc([v.direccion, v.municipio].filter(Boolean).join(' · '))}<br>
    ${[ct.pvs && `PVS ${ct.pvs}`, ct.desde && `desde ${fmtDate(ct.desde)}`, ct.hasta && `<b>vence ${fmtDate(ct.hasta)}</b> (${cuandoText(ct.hasta)})`,
      ct.precioMes && `${fmtMoney(parseMoney(ct.precioMes))}/mes`, ct.dispo && `Dispo: ${ct.dispo}`].filter(Boolean).join(' · ')}`;
  $$('#rv-estilos .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.value === ct.renovEstilo));
  $('#rv-obs').value = ct.renovObs || '';
  $('#rv-nota').value = '';
  $('#rv-avisar').value = ct.renovAvisar || '';
  $('#rv-nuevo-hasta').value = ct.hasta ? addMonthsISO(isoAddDays(ct.hasta, 1), 12) : '';
  $('#rv-nuevo-pvs').value = '';
  $('#rv-nuevo-precio').value = ct.precioMes || '';
  $('#rv-retirar').checked = true;
  $('#rv-hist').innerHTML = (ct.renovHist || []).slice().reverse().map(h =>
    `<div class="row-item"><div class="ri-main"><b>${esc(fmtDate(h.fecha))} · ${esc(h.accion)}</b><span>${esc(h.nota || '')}</span></div></div>`).join('')
    || '<p class="hint">Sin gestiones todavía.</p>';
  renderRenovAccion();
  $('#renov-modal').hidden = false;
}

function renderRenovAccion() {
  $$('#rv-acciones .btn').forEach(b => b.classList.toggle('primary', b.dataset.rvAccion === rvCtx.accion));
  $('#rv-renovado').hidden = rvCtx.accion !== 'Renovado';
  $('#rv-norenueva').hidden = rvCtx.accion !== 'No renueva';
  $('#rv-pendiente').hidden = rvCtx.accion !== 'Pendiente';
}

function saveRenov() {
  const ct = contratos.find(x => x.id === rvCtx.id);
  if (!ct) return;
  const now = new Date().toISOString();
  const nota = $('#rv-nota').value.trim();
  const estilo = ($('#rv-estilos .chip.active') || {}).dataset;
  if (estilo && estilo.value) ct.renovEstilo = estilo.value;
  ct.renovObs = $('#rv-obs').value.trim();
  ct.renovHist = ct.renovHist || [];
  const acc = rvCtx.accion;
  let msg = 'Renovación guardada';
  if (acc === 'Renovado') {
    const hasta = $('#rv-nuevo-hasta').value;
    if (!hasta || (ct.hasta && hasta <= ct.hasta)) { toast('Indica la nueva fecha de fin (posterior al vencimiento)'); return; }
    const pvs = $('#rv-nuevo-pvs').value.trim().toUpperCase();
    const precio = $('#rv-nuevo-precio').value.trim();
    const nuevo = { id: uid(), clienteId: ct.clienteId, codigo: ct.codigo, desde: ct.hasta ? isoAddDays(ct.hasta, 1) : todayISO(), hasta,
      pvs: pvs || ct.pvs || '', precioMes: precio, campana: ct.campana || '', notas: '', comercial: ct.comercial || '', zonaComercial: ct.zonaComercial || '',
      renovEstilo: ct.renovEstilo === 'NO RENUEVA' ? '' : ct.renovEstilo || '', renovEstado: '', renovObs: '', creado: now, modificado: now,
      renovHist: [{ fecha: todayISO(), accion: 'Renovación', nota: `Viene del contrato ${ct.pvs || ''} que vencía el ${fmtDate(ct.hasta)}` }] };
    contratos.push(nuevo);
    ct.renovEstado = 'Renovado';
    ct.renovAvisar = '';
    ct.renovHist.push({ fecha: todayISO(), accion: 'Renovado', nota: [`hasta ${fmtDate(hasta)}`, pvs && `nuevo ${pvs}`, precio && `${fmtMoney(parseMoney(precio))}/mes`, nota].filter(Boolean).join(' · ') });
    msg = `Renovado hasta el ${fmtDate(hasta)}`;
  } else if (acc === 'No renueva') {
    ct.renovEstado = 'No renueva';
    ct.renovAvisar = '';
    ct.renovHist.push({ fecha: todayISO(), accion: 'No renueva', nota });
    msg = 'Marcado: no renueva';
    if ($('#rv-retirar').checked) {
      const v = VALLAS_DB.find(x => x.codigo === ct.codigo) || { codigo: ct.codigo };
      const c = clienteById(ct.clienteId) || {};
      crearTrabajo({ clase: 'Trabajo', tipos: ['Retirar lona'], vallas: [Object.assign({}, v)], campana: c.nombre || '',
        fechaPrevista: ct.hasta ? isoAddDays(ct.hasta, 1) : isoPlus(1), descripcion: `Fin de contrato sin renovación (${c.nombre || ''}${ct.pvs ? ', ' + ct.pvs : ''}).`, leadId: '' });
      saveTrabajos();
      msg += ' · trabajo de retirar lona creado';
    }
  } else if (acc === 'Pendiente') {
    ct.renovEstado = '';
    ct.renovAvisar = $('#rv-avisar').value;
    ct.renovHist.push({ fecha: todayISO(), accion: 'Gestión', nota: [nota, ct.renovAvisar && `volver a avisar el ${fmtDate(ct.renovAvisar)}`].filter(Boolean).join(' · ') });
  } else if (nota) {
    ct.renovHist.push({ fecha: todayISO(), accion: 'Nota', nota });
  }
  ct.modificado = now;
  saveContratos();
  $('#renov-modal').hidden = true;
  rvCtx = null;
  toast(msg);
  if (currentView() === 'cliente-form') renderCf();
  else if (currentView() === 'agenda') renderAgenda();
  else renderClientes();
  if (typeof agendaTick === 'function') agendaTick();
}

/* ------------------------------------------------------------- fusionar clientes */

function abrirFusion() {
  const c = clienteById(cliEditing);
  if (!c) { toast('Guarda primero el cliente'); return; }
  $('#fu-actual').textContent = c.nombre;
  $('#fu-search').value = '';
  renderFusion();
  $('#fusion-modal').hidden = false;
}

function renderFusion() {
  const c = clienteById(cliEditing);
  const q = $('#fu-search').value.trim();
  const lista = q ? clientes.filter(x => x.id !== c.id && normName(x.nombre).includes(normName(q))).map(x => ({ c: x, score: 0 }))
    : clientesParecidos(c.nombre, c.id);
  $('#fu-lista').innerHTML = lista.slice(0, 20).map(({ c: x }) => {
    const n = contratos.filter(ct => ct.clienteId === x.id).length;
    return `<div class="row-item"><div class="ri-main"><b>${esc(x.nombre)}</b><span>${[x.cif, x.contacto, x.poblacion, n && `${n} contrato${n > 1 ? 's' : ''}`].filter(Boolean).map(esc).join(' · ')}</span></div>
      <button type="button" class="act" data-fu-con="${x.id}">🔀 Fusionar aquí</button></div>`;
  }).join('') || '<p class="hint">No hay clientes parecidos. Busca por nombre.</p>';
}

/** Pasa todo lo del cliente `otroId` al cliente que se está viendo y borra el duplicado. */
function fusionarClientes(otroId) {
  const c = clienteById(cliEditing), o = clienteById(otroId);
  if (!c || !o || c.id === o.id) return;
  if (!confirm(`¿Fusionar «${o.nombre}» dentro de «${c.nombre}»? Sus contratos, visitas, trabajos y documentos pasarán a «${c.nombre}» y se borrará el duplicado.`)) return;
  for (const k of ['cif', 'contacto', 'telefono', 'correo', 'direccion', 'poblacion', 'provincia', 'comercial']) if (!c[k] && o[k]) c[k] = o[k];
  if (o.notas) c.notas = [c.notas, o.notas].filter(Boolean).join('\n');
  for (const k of ['visitas', 'vallasInteres', 'articulosInteres', 'fotos']) c[k] = (c[k] || []).concat(o[k] || []);
  contratos.forEach(ct => { if (ct.clienteId === o.id) ct.clienteId = c.id; });
  leads.forEach(l => { if (l.clienteId === o.id) l.clienteId = c.id; });
  trabajos.forEach(t => { if (t.clienteId === o.id) { t.clienteId = c.id; t.clienteNombre = c.nombre; } });
  documentos.forEach(d => { if (d.clienteId === o.id) d.clienteId = c.id; });
  clientes = clientes.filter(x => x.id !== o.id);
  c.modificado = new Date().toISOString();
  saveClientes(); saveContratos(); saveDocumentos(); saveTrabajos(); store.save('leads', leads);
  $('#fusion-modal').hidden = true;
  toast(`«${o.nombre}» fusionado en «${c.nombre}»`);
  openClienteForm(c.id);
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-renov]');
  if (!t) return;
  if (t.matches('[data-renov]') && !t.closest('button')) { openRenov(t.dataset.renov); return; }
  if (t.dataset.riCom !== undefined) { rvImport.comercial = t.dataset.riCom; renderImportRenov(); return; }
  if (t.dataset.riDest) { rvImport.destinos[t.dataset.riDest] = t.dataset.id; renderImportRenov(); return; }
  if (t.dataset.rvAccion) { rvCtx.accion = rvCtx.accion === t.dataset.rvAccion ? '' : t.dataset.rvAccion; renderRenovAccion(); return; }
  if (t.closest('#rv-estilos') && t.classList.contains('chip')) {
    $$('#rv-estilos .chip').forEach(ch => ch.classList.toggle('active', ch === t && !t.classList.contains('active')));
    return;
  }
  if (t.dataset.rvMeses) { const ct = contratos.find(x => x.id === rvCtx.id); $('#rv-nuevo-hasta').value = addMonthsISO(isoAddDays(ct.hasta || todayISO(), 1), Number(t.dataset.rvMeses)); return; }
  if (t.dataset.rvAvisarDias) { $('#rv-avisar').value = isoPlus(Number(t.dataset.rvAvisarDias)); return; }
  if (t.dataset.fuCon) { fusionarClientes(t.dataset.fuCon); return; }
  if (t.dataset.ctRenov) { openRenov(t.dataset.ctRenov); return; }
  if (t.dataset.agRenov) { openRenov(t.dataset.agRenov); return; }
  switch (t.dataset.rv) {
    case 'import-ok': aplicarImportRenov(); break;
    case 'import-cancel': $('#renov-import-modal').hidden = true; rvImport = null; break;
    case 'save': saveRenov(); break;
    case 'cancel': $('#renov-modal').hidden = true; rvCtx = null; break;
    case 'fusion': abrirFusion(); break;
    case 'fusion-cancel': $('#fusion-modal').hidden = true; break;
  }
});
$('#fu-search').addEventListener('input', renderFusion);
['renov-modal', 'renov-import-modal', 'fusion-modal'].forEach(id =>
  $('#' + id).addEventListener('click', e => { if (e.target.id === id) e.target.hidden = true; }));

const renovHandleBack = window.handleBack;
window.handleBack = function () {
  for (const id of ['renov-modal', 'renov-import-modal', 'fusion-modal']) {
    if (!$('#' + id).hidden) { $('#' + id).hidden = true; return true; }
  }
  return renovHandleBack();
};
