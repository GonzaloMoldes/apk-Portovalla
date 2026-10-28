/* PortoValla Operadores · propietario de la finca y lista de espera de cada valla
   - Datos del propietario del terreno donde está la valla (si la valla salió de una
     negociación de patrimonio, se proponen sus datos).
   - Lista de espera: clientes y visitas interesados en la valla para cuando quede libre.
     También se proponen los que la tuvieron en un presupuesto. La agenda avisa cuando la
     valla va a quedar libre y tiene interesados. */

const PROP_CAMPOS = ['nombre', 'contacto', 'telefono', 'correo', 'renta', 'vence', 'notas'];

let vallasProp = store.load('vallas_prop') || {};       // código → datos del propietario
let vallasEspera = store.load('vallas_espera') || {};   // código → [{ id, tipo, refId, nombre, fecha, nota }]

function saveProp() { store.save('vallas_prop', vallasProp); }
function saveEspera() { store.save('vallas_espera', vallasEspera); }

/* ------------------------------------------------------------- propietario */

function propLoad(code) {
  const f = $('#valla-form').elements;
  const p = vallasProp[code] || {};
  const n = code ? negDeValla(code) : null;
  // Si no hay datos guardados y la valla viene de una negociación, se proponen los suyos
  const desdeNeg = !vallasProp[code] && n;
  const src = desdeNeg ? { nombre: n.propietario, contacto: n.contacto, telefono: n.telefono, correo: n.correo,
    renta: n.precioAcordado || n.precioOfrecido || '', notas: '' } : p;
  for (const k of PROP_CAMPOS) f['p_' + k].value = src[k] || '';
  $('#vp-neg').innerHTML = n ? `De la negociación <b>#${n.num} · ${esc(n.propietario)}</b> (${esc(n.estado)})
    <button type="button" class="act" data-vp-neg="${n.id}">Ver negociación</button>` : '';
  renderPropContacto();
}

function renderPropContacto() {
  const f = $('#valla-form').elements;
  $('#vp-contacto').innerHTML = contactoBtns({ correo: f.p_correo.value.trim(), telefono: f.p_telefono.value.trim() });
}

function propSave(codigo, anterior) {
  if (anterior && anterior !== codigo) {
    if (vallasProp[anterior]) { vallasProp[codigo] = vallasProp[anterior]; delete vallasProp[anterior]; }
    if (vallasEspera[anterior]) { vallasEspera[codigo] = vallasEspera[anterior]; delete vallasEspera[anterior]; saveEspera(); }
  }
  const f = $('#valla-form').elements;
  const d = {};
  for (const k of PROP_CAMPOS) d[k] = (f['p_' + k].value || '').trim();
  d.nombre = d.nombre.toUpperCase();
  d.correo = d.correo.toLowerCase();
  if (PROP_CAMPOS.some(k => d[k])) vallasProp[codigo] = d; else delete vallasProp[codigo];
  saveProp();
}

/* ------------------------------------------------------------- lista de espera */

function esperaDe(code) { return vallasEspera[code] || []; }

/** Datos de contacto de un interesado (de su cliente o su visita). */
function contactoInteresado(it) {
  if (it.tipo === 'cliente') return clienteById(it.refId) || {};
  return leads.find(l => l.id === it.refId) || {};
}

/** Interesados que la tuvieron en un presupuesto y aún no están en la lista. */
function interesadosSugeridos(code) {
  const ya = new Set(esperaDe(code).map(x => x.tipo + ':' + x.refId));
  const out = [];
  for (const c of clientes) {
    if ((c.vallasInteres || []).some(v => v.codigo === code) && !ya.has('cliente:' + c.id)) out.push({ tipo: 'cliente', refId: c.id, nombre: c.nombre });
  }
  for (const l of leads) {
    if (l.clienteId && out.some(o => o.refId === l.clienteId)) continue;
    if (((l.presupuesto || {}).vallas || []).some(v => v.codigo === code) && !ya.has('visita:' + l.id)) out.push({ tipo: 'visita', refId: l.id, nombre: l.razonSocial });
  }
  return out;
}

function renderEspera() {
  const code = vallaEditing;
  const box = $('#ve-lista');
  if (!code) { box.innerHTML = '<p class="hint">Guarda la valla para tener lista de espera.</p>'; $('#ve-add').hidden = true; $('#ve-sug').innerHTML = ''; return; }
  $('#ve-add').hidden = false;
  const lista = esperaDe(code);
  const d = vallaDisponibilidad(code);
  $('#ve-estado').textContent = d.estado === 'Ocupada'
    ? `Ahora ocupada${d.cliente ? ' por ' + d.cliente : ''}${d.hasta ? ' hasta el ' + fmtDate(d.hasta) : ''}.` : `Ahora: ${d.estado}.`;
  box.innerHTML = lista.length ? lista.map((it, i) => {
    const o = contactoInteresado(it);
    return `<div class="row-item espera-item">
      <div class="ri-main"><b>${i + 1}. ${esc(it.nombre)} <span class="badge">${it.tipo === 'cliente' ? 'Cliente' : 'Visita'}</span></b>
        <span>${esc([`desde ${fmtDate(it.fecha)}`, it.nota, o.telefono, o.correo].filter(Boolean).join(' · '))}</span>
        ${contactoBtns({ correo: o.correo, telefono: o.telefono })}</div>
      <button type="button" class="vsel-x" data-ve-del="${esc(it.id)}" aria-label="Quitar" title="Quitar">${icon('close')}</button>
    </div>`;
  }).join('') : '<p class="hint">Nadie en espera.</p>';
  const sug = interesadosSugeridos(code);
  $('#ve-sug').innerHTML = sug.length ? `<label class="lbl">La tuvieron en un presupuesto</label>` + sug.map(s =>
    `<div class="row-item"><div class="ri-main"><b>${esc(s.nombre)}</b><span>${s.tipo === 'cliente' ? 'Cliente' : 'Visita'}</span></div>
      <button type="button" class="act" data-ve-sug="${s.tipo}:${esc(s.refId)}">＋ A la lista</button></div>`).join('') : '';
}

function addEspera(tipo, refId, nota) {
  const code = vallaEditing;
  if (!code) return;
  const nombre = tipo === 'cliente' ? (clienteById(refId) || {}).nombre : (leads.find(l => l.id === refId) || {}).razonSocial;
  const list = vallasEspera[code] || (vallasEspera[code] = []);
  if (list.some(x => x.tipo === tipo && x.refId === refId)) { toast('Ya está en la lista de espera'); return; }
  list.push({ id: uid(), tipo, refId, nombre: nombre || '?', fecha: todayISO(), nota: nota || '' });
  saveEspera();
  renderEspera();
  toast(`${nombre} en lista de espera de ${code}`);
}

/* --- buscador de interesados --- */

function abrirBuscaInteresado() {
  $('#ve-buscar').value = '';
  $('#ve-nota').value = '';
  renderBuscaInteresado();
  $('#espera-modal').hidden = false;
  setTimeout(() => $('#ve-buscar').focus(), 50);
}

function renderBuscaInteresado() {
  const q = ddNorm($('#ve-buscar').value.trim());
  const ok = s => !q || q.split(/\s+/).every(w => ddNorm(s).includes(w));
  const items = [
    ...clientes.map(c => ({ tipo: 'cliente', refId: c.id, nombre: c.nombre, sub: [c.contacto, c.poblacion].filter(Boolean).join(' · '), t: c.modificado || c.creado || '' })),
    ...leads.filter(l => !l.clienteId).map(l => ({ tipo: 'visita', refId: l.id, nombre: l.razonSocial, sub: [l.contacto, l.poblacion, fmtDate(l.fecha)].filter(Boolean).join(' · '), t: l.modificado || l.fecha || '' })),
  ].filter(x => x.nombre && ok(`${x.nombre} ${x.sub}`)).sort((a, b) => b.t.localeCompare(a.t));
  $('#ve-resultados').innerHTML = items.map(x => `<button type="button" class="lc-item" data-ve-elegir="${x.tipo}:${esc(x.refId)}">
    <b>${esc(x.nombre)} <span class="badge">${x.tipo === 'cliente' ? 'Cliente' : 'Visita'}</span></b><span>${esc(x.sub)}</span></button>`).join('')
    || '<p class="hint">No hay clientes ni visitas que coincidan.</p>';
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.vpNeg) { openNegForm(t.dataset.vpNeg); return; }
  if (t.id === 've-add') { abrirBuscaInteresado(); return; }
  if (t.dataset.veElegir) {
    const [tipo, ...r] = t.dataset.veElegir.split(':');
    addEspera(tipo, r.join(':'), $('#ve-nota').value.trim());
    $('#espera-modal').hidden = true;
    return;
  }
  if (t.dataset.veSug) { const [tipo, ...r] = t.dataset.veSug.split(':'); addEspera(tipo, r.join(':'), 'Lo tuvo en un presupuesto'); return; }
  if (t.dataset.veDel) {
    const code = vallaEditing;
    const it = esperaDe(code).find(x => x.id === t.dataset.veDel);
    if (!it || !confirm(`¿Quitar a ${it.nombre} de la lista de espera?`)) return;
    vallasEspera[code] = esperaDe(code).filter(x => x.id !== it.id);
    if (!vallasEspera[code].length) delete vallasEspera[code];
    saveEspera();
    renderEspera();
    return;
  }
  if (t.id === 've-cerrar') { $('#espera-modal').hidden = true; }
});
$('#ve-buscar').addEventListener('input', renderBuscaInteresado);
$('#espera-modal').addEventListener('click', e => { if (e.target.id === 'espera-modal') e.target.hidden = true; });
$('#valla-form').addEventListener('input', e => { if (['p_correo', 'p_telefono'].includes(e.target.name)) renderPropContacto(); });

const fincasHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#espera-modal').hidden) { $('#espera-modal').hidden = true; return true; }
  return fincasHandleBack();
};
