/* PortoValla Operadores · formalización del contrato con el propietario (Patrimonio)
   Al pasar la negociación a «Formalización contrato» se abre la tarjeta para reunir lo que
   hace falta para firmar: NIF del titular, cuenta bancaria, referencias catastrales y los
   documentos (fotocopia del DNI, fichas de catastro, recibos del IBI y certificado de la
   cuenta). De cada tipo puede haber varios: con foto (cámara) o archivo (PDF o imagen).
   Se guardan en Descargas/PortoValla/Patrimonio y salen en el dossier de montaje. */

const FORMAL_DOCS = [
  { k: 'dni', t: 'Fotocopia del DNI', corto: 'DNI' },
  { k: 'catastro', t: 'Fichas de catastro', corto: 'catastro' },
  { k: 'ibi', t: 'Recibos del IBI', corto: 'IBI' },
  { k: 'banco', t: 'Certificado de la cuenta bancaria', corto: 'cuenta bancaria' },
];
const FORMAL_ESTADOS = ['Formalización contrato', 'Ganada'];

let formalFoto = null;      // { negId, cat } de la foto que se está haciendo

function docsFormal(negId, cat) {
  return documentos.filter(d => d.negId === negId && d.formal === cat)
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
}

/** Qué tipos de documento faltan en la negociación. */
function formalFaltan(n) {
  return n && n.id ? FORMAL_DOCS.filter(c => !docsFormal(n.id, c.k).length) : FORMAL_DOCS.slice();
}

function formalLabel(cat) { return (FORMAL_DOCS.find(c => c.k === cat) || {}).t || 'Documento'; }

/** Pinta la tarjeta (visible en «Formalización contrato» y «Ganada»). */
function renderFormal() {
  const card = $('#nf-formal');
  if (!card) return;
  const visible = FORMAL_ESTADOS.includes(nfState.estado);
  card.hidden = !visible;
  if (!visible) return;
  const id = negEditing;
  $('#nf-formal-docs').innerHTML = FORMAL_DOCS.map(c => {
    const docs = id ? docsFormal(id, c.k) : [];
    return `<div class="formal-cat${docs.length ? ' ok' : ''}">
      <div class="formal-head"><b>${docs.length ? '✓' : '○'} ${esc(c.t)}</b>${docs.length ? `<span class="badge ok">${docs.length}</span>` : '<span class="badge pend">Falta</span>'}</div>
      ${docs.map(d => docRowHtml(d, '')).join('')}
      <div class="scan-row">
        <button type="button" class="btn" data-formal="foto" data-cat="${c.k}">📷 Foto</button>
        <button type="button" class="btn" data-formal="archivo" data-cat="${c.k}">📎 Archivo (PDF o imagen)</button>
      </div>
    </div>`;
  }).join('');
  const faltan = id ? formalFaltan({ id }) : FORMAL_DOCS;
  const datos = ['nifTitular', 'iban', 'refCatastral'].filter(k => !$('#neg-form').elements[k].value.trim());
  const est = $('#nf-formal-estado');
  if (!faltan.length && !datos.length) {
    est.className = 'envio-info';
    est.textContent = '✓ Documentación completa: se puede formalizar el contrato.';
  } else {
    est.className = 'aviso';
    est.textContent = 'Falta: ' + [
      ...datos.map(k => ({ nifTitular: 'NIF del titular', iban: 'cuenta bancaria (IBAN)', refCatastral: 'referencia catastral' })[k]),
      ...faltan.map(c => c.corto),
    ].join(', ') + '.';
  }
}

/** Formato del IBAN en grupos de 4 (ES12 3456 …). */
function fmtIban(v) {
  return String(v || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

function ibanValido(v) {
  const s = String(v || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let m = 0;
  for (const d of r) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}

/* --- añadir documentos --- */

function prefijoFormal(n, cat) {
  const base = String(n.propietario || 'propietario').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24);
  return `${base}_${(FORMAL_DOCS.find(c => c.k === cat) || {}).corto || cat}`.replace(/\s+/g, '_');
}

function anexarFormal(cat, modo) {
  const n = saveNeg(true);
  if (!n) return;
  renderAnexos('neg', n.id);
  if (!NATIVE) { toast('Solo disponible en la tablet'); return; }
  if (modo === 'foto') {
    formalFoto = { negId: n.id, cat };
    pickPhoto('camera', 'negdoc');
  } else {
    if (!window.Android.attachFile) { toast('Solo disponible en la tablet'); return; }
    const tag = `neg:${n.id}|${cat}`;
    if (window.Android.attachFileTo) window.Android.attachFileTo(tag, prefijoFormal(n, cat), 'Patrimonio');
    else window.Android.attachFile(tag, prefijoFormal(n, cat));
  }
}

/** Foto del documento hecha con la cámara: se copia a Descargas como documento. */
PHOTO_HANDLERS.negdoc = url => {
  const ctx = formalFoto;
  formalFoto = null;
  const n = ctx && negociaciones.find(x => x.id === ctx.negId);
  if (!n) return;
  const cuantos = docsFormal(n.id, ctx.cat).length;
  const nombre = `${prefijoFormal(n, ctx.cat)}_${cuantos + 1}_${todayISO()}`;
  let r = {};
  try { r = JSON.parse(window.Android.photoToDownloads ? window.Android.photoToDownloads(url, 'Patrimonio', nombre) || '{}' : '{}'); } catch (e) { r = {}; }
  registrarDocumento({ tipo: 'Anexo', externo: true, formal: ctx.cat, negId: n.id, empresa: n.propietario,
    titulo: `${formalLabel(ctx.cat)}${cuantos ? ' ' + (cuantos + 1) : ''}`,
    fichero: r.fichero || nombre + '.jpg', uri: r.uri || url, mime: 'image/jpeg', tamano: r.size || 0 });
  if (r.uri && window.Android.deletePhoto) window.Android.deletePhoto(url);   // la copia buena está en Descargas
  toast(`${formalLabel(ctx.cat)} añadido`);
  refrescarDocs();
};

/** Archivo elegido para un tipo de documento (lo llama anexoGenerico con «neg:<id>|<tipo>»). */
function anexoFormal(r, negId, cat) {
  const n = negociaciones.find(x => x.id === negId);
  const cuantos = docsFormal(negId, cat).length;
  registrarDocumento({ tipo: 'Anexo', externo: true, formal: cat, negId, empresa: n ? n.propietario : '',
    titulo: `${formalLabel(cat)}${cuantos ? ' ' + (cuantos + 1) : ''}`,
    fichero: r.fichero || r.name, uri: r.uri, mime: r.mime || 'application/pdf', tamano: r.size || 0 });
  toast(`${formalLabel(cat)} añadido`);
  refrescarDocs();
}

/* --- para el dossier --- */

/** Filas de la sección «Documentación para el contrato». */
function formalFilas(n) {
  return [
    ['NIF / DNI del titular', n.nifTitular || ''],
    ['Cuenta bancaria (IBAN)', n.iban ? fmtIban(n.iban) : ''],
    ['Referencias catastrales', (n.refCatastral || '').split(/\n+/).map(s => s.trim()).filter(Boolean).join(' · ')],
    ...FORMAL_DOCS.map(c => {
      const docs = docsFormal(n.id, c.k);
      return [c.t, docs.length ? docs.map(d => d.titulo || d.fichero).join(' · ') : 'Falta'];
    }),
  ];
}

/** Imágenes de los documentos (las fotos y hasta 3 páginas de cada PDF). */
function formalFotos(n) {
  const out = [];
  for (const c of FORMAL_DOCS) {
    for (const d of docsFormal(n.id, c.k)) {
      if (!d.uri) continue;
      if (/^image\//.test(d.mime || '')) out.push({ foto: d.uri, pie: d.titulo || c.t });
      else if (/pdf/.test(d.mime || '')) {
        const pags = NATIVE && window.Android.pdfPages ? window.Android.pdfPages(d.uri) : 1;
        for (let i = 0; i < Math.min(pags || 1, 3); i++) {
          out.push({ foto: `pdfpage:${i}:${d.uri}`, pie: `${d.titulo || c.t}${pags > 1 ? ` · página ${i + 1} de ${pags}` : ''}` });
        }
      }
    }
  }
  return out.slice(0, 24);
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.formal) { anexarFormal(t.dataset.cat, t.dataset.formal); return; }
  // Al marcar «Formalización contrato» se lleva a la tarjeta de la documentación
  if (t.closest('#neg-form [data-nf=estado]') && t.dataset.value === 'Formalización contrato' && nfState.estado === 'Formalización contrato') {
    setTimeout(() => $('#nf-formal').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    toast('Añade los datos y documentos del titular para formalizar el contrato');
  }
});
$('#neg-form').addEventListener('input', e => {
  if (['nifTitular', 'iban', 'refCatastral'].includes(e.target.name)) renderFormal();
});
$('#neg-form').elements.iban.addEventListener('blur', e => {
  const v = e.target.value.trim();
  if (!v) return;
  e.target.value = fmtIban(v);
  e.target.classList.toggle('invalid', !ibanValido(v));
  if (!ibanValido(v)) toast('Revisa el IBAN: los dígitos de control no cuadran');
});
