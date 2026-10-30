/* PortoValla Operadores · firma manuscrita de conformidad en los trabajos
   Quien recibe el trabajo (por ejemplo, el cliente al que se le devuelve una lona) firma
   con el dedo en la pantalla, con su nombre y DNI. La firma queda guardada en el trabajo,
   sale en el Excel y en un PDF de conformidad que se guarda en sus documentos y se puede
   enviar por email o WhatsApp. */

let tfFirma = null;          // { imagen, nombre, dni, fecha } del trabajo que se edita
let fmTrazos = 0;            // trazos dibujados en el panel
let fmCaja = null;           // zona con tinta: { x0, y0, x1, y1 } en píxeles del lienzo
let fmUltimo = null;         // último punto del trazo en curso

/* ------------------------------------------------------------- ficha del trabajo */

/** Al abrir el trabajo (gestion.js → openTrabajoForm). */
function firmaLoad(t) {
  tfFirma = t && t.firma ? Object.assign({}, t.firma) : null;
  renderTfFirma();
}

function fmtFechaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : `${fmtDate(iso.slice(0, 10))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderTfFirma() {
  const box = $('#tf-firma');
  if (!box) return;
  if (!tfFirma) {
    box.innerHTML = `<p class="hint">Sin firmar. Cuando entregues el trabajo, pide a quien lo recibe que firme aquí su conformidad.</p>
      <button type="button" class="btn primary" data-firma="firmar">✍ Firmar conformidad</button>`;
    return;
  }
  box.innerHTML = `<div class="firma-guardada">
      <img src="${esc(tfFirma.imagen)}" alt="Firma">
      <div><b>${esc(tfFirma.nombre)}</b>${tfFirma.dni ? `<span>DNI / NIF ${esc(tfFirma.dni)}</span>` : ''}
        <span>Firmado el ${esc(fmtFechaHora(tfFirma.fecha))}</span></div>
    </div>
    <div class="scan-row">
      <button type="button" class="btn" data-firma="pdf">📄 PDF de conformidad</button>
      <button type="button" class="btn" data-firma="mail">✉ Enviar por email</button>
      <button type="button" class="btn" data-firma="wa">Enviar por WhatsApp</button>
    </div>
    <div class="scan-row">
      <button type="button" class="btn" data-firma="firmar">Repetir la firma</button>
      <button type="button" class="btn danger" data-firma="quitar">Quitar la firma</button>
    </div>`;
}

/** Texto de lo que se entrega, para el panel de firma y el PDF. */
function firmaQueSeEntrega() {
  const venta = tfClase === 'Venta';
  const que = venta ? tfLineas.map(l => `${l.cantidad && l.cantidad !== '1' ? l.cantidad + ' × ' : ''}${l.articulo}`).join(', ')
    : $$('#tf-tipos .chip.active').map(c => c.dataset.tfTipo).join(' + ');
  return [que, trCodes.length ? `vallas ${trCodes.join(', ')}` : ''].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------- panel de firma */

function abrirFirma() {
  const f = $('#trabajo-form').elements;
  const cli = tfClienteId ? clienteById(tfClienteId) : null;
  $('#fm-que').textContent = firmaQueSeEntrega() || 'Trabajo';
  $('#fm-nombre').value = tfFirma ? tfFirma.nombre : (cli && cli.contacto) || f.clienteNombre.value.trim();
  $('#fm-dni').value = tfFirma ? tfFirma.dni || '' : '';
  $('#firma-modal').hidden = false;
  requestAnimationFrame(prepararLienzo);
}

function cerrarFirma() { $('#firma-modal').hidden = true; }

function prepararLienzo() {
  const cv = $('#fm-canvas');
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = cv.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.6 * dpr;
  ctx.strokeStyle = '#10223c';
  borrarLienzo();
}

function borrarLienzo() {
  const cv = $('#fm-canvas');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  fmTrazos = 0;
  fmCaja = null;
  $('#fm-guia').hidden = false;
}

function puntoLienzo(e) {
  const cv = $('#fm-canvas');
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
}

function ampliarCaja(p) {
  if (!fmCaja) fmCaja = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  fmCaja.x0 = Math.min(fmCaja.x0, p.x); fmCaja.y0 = Math.min(fmCaja.y0, p.y);
  fmCaja.x1 = Math.max(fmCaja.x1, p.x); fmCaja.y1 = Math.max(fmCaja.y1, p.y);
}

function trazoInicio(e) {
  e.preventDefault();
  const cv = $('#fm-canvas');
  if (cv.setPointerCapture) try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
  fmUltimo = puntoLienzo(e);
  ampliarCaja(fmUltimo);
  const ctx = cv.getContext('2d');
  ctx.beginPath();
  ctx.arc(fmUltimo.x, fmUltimo.y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  fmTrazos++;
  $('#fm-guia').hidden = true;
}

function trazoMovimiento(e) {
  if (!fmUltimo) return;
  e.preventDefault();
  const ctx = $('#fm-canvas').getContext('2d');
  const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (eventos.length ? eventos : [e])) {
    const p = puntoLienzo(ev);
    const medio = { x: (fmUltimo.x + p.x) / 2, y: (fmUltimo.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(fmUltimo.mx == null ? fmUltimo.x : fmUltimo.mx, fmUltimo.my == null ? fmUltimo.y : fmUltimo.my);
    ctx.quadraticCurveTo(fmUltimo.x, fmUltimo.y, medio.x, medio.y);
    ctx.stroke();
    ampliarCaja(p);
    fmUltimo = { x: p.x, y: p.y, mx: medio.x, my: medio.y };
  }
}

function trazoFin() { fmUltimo = null; }

/** Imagen JPEG de la firma, recortada a la zona con tinta y con fondo blanco. */
function imagenFirma() {
  const cv = $('#fm-canvas');
  const m = 12 * (window.devicePixelRatio || 1);
  const x0 = Math.max(0, Math.floor(fmCaja.x0 - m)), y0 = Math.max(0, Math.floor(fmCaja.y0 - m));
  const x1 = Math.min(cv.width, Math.ceil(fmCaja.x1 + m)), y1 = Math.min(cv.height, Math.ceil(fmCaja.y1 + m));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = Math.min(1, 900 / w);
  const out = document.createElement('canvas');
  out.width = Math.round(w * k);
  out.height = Math.round(h * k);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(cv, x0, y0, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85);
}

function guardarFirma() {
  const nombre = $('#fm-nombre').value.trim();
  if (!nombre) { toast('Escribe el nombre de quien recibe'); $('#fm-nombre').focus(); return; }
  if (!fmTrazos || !fmCaja || (fmCaja.x1 - fmCaja.x0 < 8 && fmCaja.y1 - fmCaja.y0 < 8)) { toast('Falta la firma'); return; }
  const data = imagenFirma();
  const imagen = NATIVE && window.Android.saveFirma ? window.Android.saveFirma(data, `trabajo_${trEditing || 'nuevo'}`) || data : data;
  const anterior = tfFirma && tfFirma.imagen;
  tfFirma = { imagen, nombre: nombre.toUpperCase(), dni: $('#fm-dni').value.trim().toUpperCase(), fecha: new Date().toISOString() };
  if (anterior && anterior !== imagen && anterior.startsWith('file://') && NATIVE && window.Android.deletePhoto) window.Android.deletePhoto(anterior);
  cerrarFirma();
  // Con la firma, el trabajo suele quedar hecho
  let hecho = false;
  if (tfState.estado !== 'Hecho' && confirm('Firma guardada. ¿Marcar el trabajo como hecho?')) {
    tfState.estado = 'Hecho';
    const f = $('#trabajo-form').elements;
    if (!f.fechaHecho.value) f.fechaHecho.value = todayISO();
    renderTf();
    hecho = true;
  }
  persistirFirma(hecho);
  renderTfFirma();
  toast(`Firmado por ${tfFirma.nombre}`);
}

/** Si el trabajo ya existe, la firma (y el «hecho») se guardan al momento. */
function persistirFirma(hecho) {
  const t = trEditing && trabajos.find(x => x.id === trEditing);
  if (!t) return;
  if (tfFirma) t.firma = Object.assign({}, tfFirma); else delete t.firma;
  if (hecho) { t.estado = 'Hecho'; t.fechaHecho = $('#trabajo-form').elements.fechaHecho.value || todayISO(); }
  t.modificado = new Date().toISOString();
  saveTrabajos();
}

/* ------------------------------------------------------------- PDF de conformidad */

function conformidadDoc(t) {
  const venta = t.clase === 'Venta';
  const cli = t.clienteId ? clienteById(t.clienteId) : null;
  const fecha = (t.firma.fecha || '').slice(0, 10) || todayISO();
  const que = venta ? (t.lineas || []).map(l => [`${l.cantidad || 1} × ${l.articulo}`, [l.descripcion, l.medida].filter(Boolean).join(' · ')])
    : [['Trabajo', t.tipos.join(' + ')]];
  const resumen = [
    ...que,
    ...(t.vallas.length ? [['Vallas', t.vallas.map(v => v.codigo).join(', ')]] : []),
    ...(t.material ? [['Material', t.material]] : []),
    ...(t.campana ? [['Campaña', t.campana]] : []),
  ];
  const vallas = t.vallas.filter(v => v.direccion).slice(0, 6).map(v => ({
    codigo: v.codigo, direccion: v.direccion, lineas: [[v.municipio, v.provincia].filter(Boolean).join(', ')].filter(Boolean),
    mapa: v.lat !== '' && v.lat != null ? `https://maps.google.com/?q=${v.lat},${v.lng}` : '',
    foto: (VALLAS_DB.find(x => x.codigo === v.codigo) || {}).foto || v.foto || '', precio: '' }));
  return {
    fichero: `Conformidad_${venta ? 'venta' : 'trabajo'}_${t.num}_${fecha}.pdf`,
    carpeta: 'Trabajos',
    logo: 'logo.png',
    titulo: venta ? 'Conformidad de entrega' : 'Conformidad del trabajo',
    subtitulo: [settings.miEmpresa, `${venta ? 'Venta' : 'Trabajo'} nº ${t.num}`, fmtDate(fecha)].filter(Boolean).join(' · '),
    datos: [
      ['Cliente', t.clienteNombre || '—'], ['Contacto', cli ? [cli.contacto, cli.telefono].filter(Boolean).join(' · ') || '—' : '—'],
      [venta ? 'Venta' : 'Trabajo', `nº ${t.num}`], ['Realizado por', t.asignado || settings.comercial || '—'],
    ],
    tituloResumen: venta ? 'Qué se entrega' : 'Qué se ha hecho',
    resumen,
    ultimoEsTotal: false,
    tituloVallas: 'Vallas',
    vallas,
    tituloFotos: 'Fotos de referencia',
    fotos: fotosDelTrabajo(t),
    nota: [t.descripcion, t.obs && `Observaciones: ${t.obs}`].filter(Boolean).join('\n'),
    firma: {
      titulo: 'Conformidad de quien recibe',
      texto: `${t.firma.nombre} declara recibir de conformidad ${venta ? 'el material' : 'el trabajo'} descrito en este documento.`,
      imagen: t.firma.imagen, nombre: t.firma.nombre, dni: t.firma.dni || '', fecha: fmtFechaHora(t.firma.fecha),
    },
    pie: [settings.miEmpresa, settings.comercial, settings.miTelefono, settings.miEmail].filter(Boolean).join(' · '),
  };
}

/** Fotos para el PDF: las de referencia del trabajo (las del Excel) y las de las revisiones. */
function fotosDelTrabajo(t) {
  const out = (t.fotos || []).filter(Boolean).map((f, i, a) => ({ foto: f, pie: `Foto de referencia${a.length > 1 ? ' ' + (i + 1) : ''}` }));
  for (const r of (typeof revisionesDe === 'function' ? revisionesDe(t) : [])) {
    for (const f of [].concat(r.fotos || r.foto || []).filter(Boolean)) {
      out.push({ foto: f, pie: [`Revisión ${fmtDate((r.fecha || '').slice(0, 10))}`, r.resultado].filter(Boolean).join(' · ') });
    }
  }
  return out.slice(0, 12);
}

/** Crea el PDF del trabajo guardado y lo apunta en sus documentos (y en los del cliente). */
function generarConformidad() {
  const t = trEditing && trabajos.find(x => x.id === trEditing);
  if (!t) { toast('Guarda primero el trabajo'); return null; }
  if (!t.firma) { toast('Falta la firma'); return null; }
  if (!NATIVE) { toast('El PDF solo se genera en la tablet'); return null; }
  const doc = conformidadDoc(t);
  const err = window.Android.budgetPdf(JSON.stringify(doc));
  if (err) { toast('⚠ No se pudo crear el PDF: ' + err); return null; }
  let info = {};
  try { info = JSON.parse(window.Android.lastPdfInfo() || '{}'); } catch (e) { info = {}; }
  registrarDocumento({ tipo: 'Conformidad', titulo: `Conformidad firmada · ${t.clase === 'Venta' ? 'venta' : 'trabajo'} #${t.num} · ${t.firma.nombre}`,
    fichero: info.name || doc.fichero, uri: info.uri || '', trabajoId: t.id, clienteId: t.clienteId || '', empresa: t.clienteNombre || '' });
  renderAnexos('trabajo', t.id);
  return t;
}

function enviarConformidad(canal) {
  const t = generarConformidad();
  if (!t) return;
  const cli = t.clienteId ? clienteById(t.clienteId) : null;
  const saludo = cli && cli.contacto ? `Hola ${cli.contacto.split(' ')[0]}` : 'Hola';
  const que = t.clase === 'Venta' ? 'la entrega' : `el trabajo nº ${t.num}`;
  if (canal === 'mail') {
    if (!cli || !validEmail(cli.correo)) { toast('El cliente no tiene un correo válido: envíalo desde Documentos'); return; }
    window.Android.sendEmailPdf(cli.correo, `Conformidad de ${que} – ${settings.miEmpresa || 'Porto Valla'}`,
      `${saludo}:\n\nLe adjunto el documento de conformidad de ${que}, firmado por ${t.firma.nombre} el ${fmtFechaHora(t.firma.fecha)}.\n\nUn saludo,\n${settings.comercial || ''}\n${settings.miEmpresa || ''}\n${settings.miTelefono || ''}`);
  } else {
    const tel = cli && normPhone(cli.telefono);
    if (!tel) { toast('El cliente no tiene teléfono: envíalo desde Documentos'); return; }
    window.Android.sendWhatsAppPdf(tel, `${saludo}, le envío la conformidad de ${que} firmada. Un saludo, ${settings.comercial || ''} (${settings.miEmpresa || 'Porto Valla'}).`);
  }
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  switch (t.dataset.firma) {
    case 'firmar': abrirFirma(); return;
    case 'pdf': if (generarConformidad()) { window.Android.viewPdf(); toast('Conformidad guardada en los documentos'); } return;
    case 'mail': case 'wa': enviarConformidad(t.dataset.firma); return;
    case 'quitar':
      if (!confirm('¿Quitar la firma de este trabajo?')) return;
      if (tfFirma && tfFirma.imagen.startsWith('file://') && NATIVE && window.Android.deletePhoto) window.Android.deletePhoto(tfFirma.imagen);
      tfFirma = null;
      persistirFirma(false);
      renderTfFirma();
      return;
  }
  if (t.id === 'fm-borrar') borrarLienzo();
  else if (t.id === 'fm-cancelar') cerrarFirma();
  else if (t.id === 'fm-guardar') guardarFirma();
});

(function () {
  const cv = $('#fm-canvas');
  cv.addEventListener('pointerdown', trazoInicio);
  cv.addEventListener('pointermove', trazoMovimiento);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => cv.addEventListener(ev, trazoFin));
  // Al girar la tablet con el panel vacío se ajusta el lienzo al nuevo tamaño
  window.addEventListener('resize', () => { if (!$('#firma-modal').hidden && !fmTrazos) prepararLienzo(); });
})();

const firmaHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#firma-modal').hidden) { cerrarFirma(); return true; }
  return firmaHandleBack();
};
