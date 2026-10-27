/* PortoValla Operadores · contacto rápido y cliente en las visitas
   - Botones de acción (✉ email, WhatsApp, ☎ llamar, 📍 mapa) en las tarjetas y fichas de
     Clientes y Patrimonio, como en Visitas, sin tener que entrar a copiar los datos.
   - En una visita de tipo «Cliente», buscador con desplegable de los clientes ya dados de
     alta: al elegir uno se rellenan sus datos y la visita queda unida a su ficha. */

/** Botones de contacto para un registro con correo / teléfono (y coordenadas, opcional). */
function contactoBtns(o, extra) {
  const tel = normPhone(o.telefono);
  const btns = [
    validEmail(o.correo) ? `<button type="button" class="act mail" data-qa="mail" data-to="${esc(o.correo)}">✉ Email</button>` : '',
    isMobile(o.telefono) ? `<button type="button" class="act wa" data-qa="wa" data-to="${esc(tel)}">WhatsApp</button>` : '',
    tel ? `<button type="button" class="act" data-qa="tel" data-to="${esc(tel)}">☎ Llamar</button>` : '',
    o.lat !== '' && o.lat != null && !isNaN(Number(o.lat))
      ? `<button type="button" class="act" data-qa="map" data-lat="${esc(o.lat)}" data-lng="${esc(o.lng)}" data-label="${esc(o.label || '')}">📍 Mapa</button>` : '',
  ].join('') + (extra || '');
  return btns ? `<div class="lead-actions qa-row">${btns}</div>` : '';
}

/** Botones de contacto de una ficha, con los datos que hay escritos en ese momento. */
function renderFichaContacto(formSel, boxSel) {
  const f = $(formSel).elements;
  const o = { correo: (f.correo.value || '').trim(), telefono: (f.telefono.value || '').trim() };
  if (f.coords) {
    const c = parseCoords(f.coords.value);
    if (c) Object.assign(o, c);
  }
  $(boxSel).innerHTML = contactoBtns(o) || '<p class="hint">Escribe el correo o el teléfono para tener aquí los botones de contacto.</p>';
}

function accionContacto(t) {
  const to = t.dataset.to || '';
  switch (t.dataset.qa) {
    case 'mail':
      if (NATIVE) window.Android.sendEmail(to, '', '');
      else window.open(`mailto:${encodeURIComponent(to)}`);
      break;
    case 'wa':
      if (NATIVE) window.Android.sendWhatsApp(to, '');
      else window.open(`https://api.whatsapp.com/send?phone=${to}`);
      break;
    case 'tel':
      if (NATIVE) window.Android.call(to);
      else window.open(`tel:+${to}`);
      break;
    case 'map':
      if (NATIVE) window.Android.openMap(String(t.dataset.lat), String(t.dataset.lng), t.dataset.label || '');
      else window.open(`https://maps.google.com/?q=${t.dataset.lat},${t.dataset.lng}`);
      break;
  }
}

/* ------------------------------------------------------------- cliente de la visita */

let lcResultados = [];

function clienteBuscaTexto(c) {
  const cts = contratos.filter(ct => ct.clienteId === c.id);
  return [c.nombre, c.cif, c.contacto, c.poblacion, c.telefono, c.correo, ...cts.map(ct => `${ct.codigo} ${ct.pvs || ''}`)].join(' ').toLowerCase();
}

/** Muestra el buscador si la visita es a un cliente. */
function renderLeadCliPick() {
  const form = $('#lead-form');
  const box = $('#lead-cli-pick');
  if (!box) return;
  const esCliente = form.elements.tipo.value === 'Cliente';
  box.hidden = !esCliente;
  if (!esCliente) return;
  const id = form.elements.clienteId.value;
  const c = id ? clienteById(id) : null;
  $('#lc-elegido').innerHTML = c
    ? `✓ Visita unida al cliente <b>${esc(c.nombre)}</b> <button type="button" class="act" data-lc-quitar="1">Cambiar</button>`
    : clientes.length ? 'Busca y elige el cliente (o escribe los datos si es nuevo).' : 'Aún no hay clientes dados de alta: escribe sus datos y se creará al guardar.';
  $('#lc-buscar').hidden = !!c;
  if (!c) renderLcResultados();
  else $('#lc-resultados').innerHTML = '';
}

function renderLcResultados() {
  const q = $('#lc-buscar').value.trim().toLowerCase();
  lcResultados = clientes.filter(c => !q || q.split(/\s+/).every(w => clienteBuscaTexto(c).includes(w)))
    .sort((a, b) => q ? a.nombre.localeCompare(b.nombre, 'es') : (b.modificado || b.creado || '').localeCompare(a.modificado || a.creado || '') || a.nombre.localeCompare(b.nombre, 'es'));   // sin buscar: los últimos primero
  $('#lc-resultados').innerHTML = lcResultados.map(c => {
    const r = clienteResumen(c);
    return `<button type="button" class="lc-item" data-lc="${c.id}"><b>${esc(c.nombre)}</b>
      <span>${[c.contacto, c.poblacion, c.telefono, r.activos.length && `${r.activos.length} valla${r.activos.length > 1 ? 's' : ''}`].filter(Boolean).map(esc).join(' · ')}</span></button>`;
  }).join('') || (q ? '<p class="hint">Ningún cliente coincide. Escribe sus datos abajo y se creará al guardar.</p>' : '');
}

function elegirClienteVisita(id) {
  const c = clienteById(id);
  if (!c) return;
  const f = $('#lead-form').elements;
  f.clienteId.value = c.id;
  f.razonSocial.value = c.nombre;
  for (const k of ['contacto', 'telefono', 'correo', 'poblacion', 'provincia']) if (c[k]) f[k].value = c[k];
  if (typeof syncFillChips === 'function') syncFillChips();
  $('#lc-buscar').value = '';
  renderLeadCliPick();
  toast(`Datos de ${c.nombre} rellenados`);
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.qa) { e.stopPropagation(); accionContacto(t); return; }
  if (t.dataset.lc) { elegirClienteVisita(t.dataset.lc); return; }
  if (t.dataset.lcQuitar) { $('#lead-form').elements.clienteId.value = ''; renderLeadCliPick(); $('#lc-buscar').focus(); return; }
}, true);

$('#lc-buscar').addEventListener('input', renderLcResultados);
$('#lead-form').addEventListener('input', e => {
  // Si se cambia a mano el nombre, la visita deja de estar unida al cliente elegido
  if (e.target.name === 'razonSocial') {
    const f = $('#lead-form').elements;
    const c = f.clienteId.value && clienteById(f.clienteId.value);
    if (c && normName(c.nombre) !== normName(e.target.value)) { f.clienteId.value = ''; renderLeadCliPick(); }
  }
});
$('#cli-form').addEventListener('input', e => { if (['correo', 'telefono'].includes(e.target.name)) renderFichaContacto('#cli-form', '#cf-contacto'); });
$('#neg-form').addEventListener('input', e => { if (['correo', 'telefono', 'coords'].includes(e.target.name)) renderFichaContacto('#neg-form', '#nf-contacto'); });
