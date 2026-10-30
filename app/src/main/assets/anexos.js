/* PortoValla Operadores · documentos anexados en Patrimonio, Vallas y Trabajos
   Igual que en Clientes y Visitas: se elige un PDF (o imagen), Android guarda una copia en
   Descargas/PortoValla/<carpeta> y queda en la lista de documentos de la ficha para abrirlo
   o enviarlo. En la valla salen también los contratos de la negociación con el propietario. */

const ANEXO_CTX = {
  neg: { campo: 'negId', carpeta: 'Patrimonio', box: '#nf-docs',
    nombre: id => (negociaciones.find(n => n.id === id) || {}).propietario || 'propietario' },
  valla: { campo: 'vallaCodigo', carpeta: 'Vallas', box: '#vf-docs', nombre: id => id },
  trabajo: { campo: 'trabajoId', carpeta: 'Trabajos', box: '#tf-docs',
    nombre: id => `trabajo_${(trabajos.find(t => t.id === id) || {}).num || ''}` },
};

/** Negociación de la que salió una valla (si se creó al ganar una negociación). */
function negDeValla(code) {
  return negociaciones.find(n => (n.vallasCreadas || []).includes(code)) || null;
}

function docsDe(kind, id) {
  if (!id) return [];
  const campo = ANEXO_CTX[kind].campo;
  // Los documentos de la formalización (DNI, catastro…) tienen su propia tarjeta en la negociación
  let list = documentos.filter(d => d[campo] === id && !(kind === 'neg' && d.formal));
  if (kind === 'valla') {
    const n = negDeValla(id);
    if (n) list = list.concat(documentos.filter(d => d.negId === n.id && !list.includes(d)));
  }
  return list.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
}

function docRowHtml(d, extra) {
  return `<div class="row-item">
    <div class="ri-main"><b>${d.externo ? '📎' : '📄'} ${esc(d.titulo || d.fichero || 'Documento')}</b>
      <span>${esc([d.externo ? 'Anexado' : d.tipo, fmtDate((d.fecha || '').slice(0, 10)), extra, d.fichero, fmtTamano(d.tamano)].filter(Boolean).join(' · '))}</span></div>
    <button type="button" class="act" data-doc-open="${d.id}">Abrir</button>
    <button type="button" class="act" data-doc-share="${d.id}">Enviar</button>
    ${d.externo ? `<button type="button" class="vsel-x" data-doc-del="${d.id}" aria-label="Quitar" title="Quitar">${icon('close')}</button>` : ''}
  </div>`;
}

function renderAnexos(kind, id) {
  const ctx = ANEXO_CTX[kind];
  const box = $(ctx.box);
  if (!box) return;
  const docs = docsDe(kind, id);
  box.innerHTML = !id ? '<p class="hint">Guarda la ficha para poder anexar documentos.</p>'
    : docs.length ? docs.map(d => docRowHtml(d, kind === 'valla' && d.negId && !d.vallaCodigo ? 'de la negociación' : '')).join('')
      : '<p class="hint">Sin documentos. Anexa aquí contratos, permisos, planos…</p>';
}

/** Anexa un documento a la ficha (la guarda antes si hace falta). */
function anexarA(kind) {
  if (!NATIVE || !window.Android.attachFile) { toast('Solo disponible en la tablet'); return; }
  let id = '';
  if (kind === 'neg') { const n = saveNeg(true); if (!n) return; id = n.id; }
  else if (kind === 'valla') id = vallaEditing || '';
  else if (kind === 'trabajo') id = trEditing || '';
  if (!id) { toast('Guarda primero la ficha'); return; }
  const ctx = ANEXO_CTX[kind];
  const prefijo = String(ctx.nombre(id)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30);
  if (window.Android.attachFileTo) window.Android.attachFileTo(`${kind}:${id}`, prefijo, ctx.carpeta);
  else window.Android.attachFile(`${kind}:${id}`, prefijo);
}

/** Respuesta de Android para neg:/valla:/trabajo: (la llama onAttachResult de clientes.js). */
function anexoGenerico(r) {
  const [kind, ...rest] = String(r.tag).split(':');
  const [id, cat] = rest.join(':').split('|');
  if (kind === 'neg' && cat && typeof anexoFormal === 'function') { anexoFormal(r, id, cat); return; }
  const ctx = ANEXO_CTX[kind];
  if (!ctx) return;
  const base = String(r.name || 'Documento').replace(/\.[a-z0-9]{2,4}$/i, '');
  const titulo = prompt('Nombre del documento (p. ej. «Contrato firmado con el propietario»):', base);
  registrarDocumento({ tipo: 'Anexo', externo: true, titulo: titulo == null || !titulo.trim() ? base : titulo.trim(),
    fichero: r.fichero || r.name, uri: r.uri, mime: r.mime || 'application/pdf', tamano: r.size || 0,
    [ctx.campo]: id, empresa: ctx.nombre(id) });
  toast('Documento anexado');
  refrescarDocs();
}

/** Vuelve a pintar la lista de documentos de la pantalla abierta. */
function refrescarDocs() {
  const v = currentView();
  if (v === 'neg-form') { renderAnexos('neg', negEditing); if (typeof renderFormal === 'function') renderFormal(); }
  else if (v === 'valla-form') renderAnexos('valla', vallaEditing);
  else if (v === 'trabajo-form') renderAnexos('trabajo', trEditing);
  else if (v === 'form' && typeof renderLeadDocs === 'function') renderLeadDocs();
  else if (v === 'cliente-form') renderCf();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (t && t.dataset.anexar) anexarA(t.dataset.anexar);
});
