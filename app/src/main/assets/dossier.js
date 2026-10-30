/* PortoValla Operadores · dossier de montaje de un emplazamiento (Patrimonio → Trabajos)
   Un PDF con todo lo que se va a hacer: el titular de la finca, lo ofrecido y acordado,
   dónde se instala, qué estructura y cuántas vallas, el tráfico y la visibilidad, las fotos,
   el trabajo de montaje y los documentos. Se genera desde la negociación o desde su trabajo
   de montaje y queda en los documentos de los dos. */

const ESTRUCTURAS = {
  'Pies de caballo': 'una valla encima de la otra',
  'Pies de escalera': 'una valla en el lado contrario de la otra',
  'Viga': 'valla de una sola cara',
  'Monoposte': 'un único poste central',
  'Anclada a fachada': 'fijada a la pared del edificio',
};

function estructuraTexto(e) { return ESTRUCTURAS[e] || ''; }

/** Negociación de la que viene un trabajo (por su enlace o por las vallas que se crearon). */
function negDeTrabajo(t) {
  if (!t) return null;
  if (t.negId) return negociaciones.find(n => n.id === t.negId) || null;
  const codes = (t.vallas || []).map(v => v.codigo);
  return codes.length ? negociaciones.find(n => (n.vallasCreadas || []).some(c => codes.includes(c))) || null : null;
}

/** Trabajo de montaje de una negociación (el más reciente). */
function trabajoDeNeg(n) {
  return trabajos.filter(t => negDeTrabajo(t) === n).sort((a, b) => (b.num || 0) - (a.num || 0))[0] || null;
}

function dossierDoc(n, t) {
  const hoy = todayISO();
  const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const nV = Number(n.nVallas) || 1, anos = Number(n.duracion) || 1;
  const precio = num(n.precioAcordado) || num(n.precioOfrecido);
  const total = totalContrato(n);
  const imp = impactosDia(n);
  const sp = impactosSplit(n);
  const hayCoords = n.lat !== '' && n.lat != null;
  const mapa = hayCoords ? `https://maps.google.com/?q=${n.lat},${n.lng}` : '';
  const euros = v => num(v) ? `${fmtMoney(num(v))} por valla y año` : '';
  const docs = documentos.filter(d => d.negId === n.id || (t && d.trabajoId === t.id));
  const fotos = (n.fotos || []).filter(Boolean);
  return {
    fichero: `Dossier_${safe(n.propietario) || 'emplazamiento'}_${hoy}.pdf`,
    carpeta: 'Patrimonio',
    logo: 'logo.png',
    titulo: 'Dossier de montaje',
    subtitulo: [settings.miEmpresa, `Negociación nº ${n.num}`, t ? `Trabajo nº ${t.num}` : '', fmtDate(hoy)].filter(Boolean).join(' · '),
    datos: [
      ['Titular de la finca', n.propietario || '—'], ['Persona de contacto', n.contacto || '—'],
      ['Teléfono', n.telefono || '—'], ['Correo', n.correo || '—'],
    ],
    tituloResumen: 'Lo ofrecido y lo acordado',
    resumen: [
      ['Estado de la negociación', n.estado || '—'],
      ...(num(n.precioPedido) ? [['Pedía el propietario', euros(n.precioPedido)]] : []),
      ...(num(n.precioOfrecido) ? [['Ofrecimos', euros(n.precioOfrecido)]] : []),
      ...(num(n.precioAcordado) ? [['Precio acordado', euros(n.precioAcordado)]] : []),
      ['Duración del contrato', `${anos} año${anos > 1 ? 's' : ''}`],
      ...(n.pago ? [['Forma de pago', n.pago]] : []),
      ...(precio ? [['Renta anual del emplazamiento', fmtMoney(precio * nV)]] : []),
      ...(total ? [['Total del contrato', fmtMoney(total)]] : []),
    ],
    ultimoEsTotal: !!total,
    secciones: [
      { titulo: 'Dónde se instala', filas: [
        ['Dirección / finca', n.direccion || ''],
        ['Municipio', [n.municipio, n.provincia].filter(Boolean).join(', ')],
        ['Zona', n.zona || ''],
        ['Coordenadas', hayCoords ? `${n.lat}, ${n.lng}` : ''],
        ['Google Maps', mapa],
        ['Sentido de la circulación', n.sentido || ''],
      ] },
      { titulo: 'Qué se instala', filas: [
        ['Tipo de soporte', n.soporte || ''],
        ['Estructura', n.estructura ? `${n.estructura}${estructuraTexto(n.estructura) ? ` (${estructuraTexto(n.estructura)})` : ''}` : 'Sin indicar'],
        ['Número de vallas', `${nV}`],
        ['Medida', n.medida || ''],
        ['Caras', n.caras || ''],
        ['Iluminación', n.iluminacion || ''],
        ['Altura de la estructura', n.alturaEstructura ? `${String(n.alturaEstructura).replace('.', ',')} m` : ''],
        ['Cimentación / anclaje', n.cimentacion || ''],
        ['Códigos de las vallas', (n.vallasCreadas || []).join(', ')],
        ['Instrucciones de montaje', n.notasMontaje || ''],
      ] },
      { titulo: 'Tráfico y visibilidad', filas: [
        ['Vehículos por minuto', num(n.vehiculosMin) ? fmtInt(num(n.vehiculosMin)) : ''],
        ['Personas por minuto', num(n.personasMin) ? fmtInt(num(n.personasMin)) : ''],
        ['Conteo', n.conteoFecha ? `${fmtDate(n.conteoFecha)}${n.conteoHora ? ' a las ' + n.conteoHora : ''}` : ''],
        ['Impactos estimados al día', imp ? `${fmtInt(imp)}${sp.total ? ` (${fmtInt(sp.veh)} en vehículos, ${fmtInt(sp.pie)} a pie)` : ''}` : ''],
        ['Impactos al mes', imp ? fmtInt(imp * 30) : ''],
        ['Tiempo de visión', n.tiempoVision ? `${String(n.tiempoVision).replace('.', ',')} s` : ''],
        ['Distancia desde la que se ve', n.distancia ? `${n.distancia} m` : ''],
      ] },
      ...(t ? [{ titulo: 'Trabajo de montaje', filas: [
        ['Trabajo', `nº ${t.num} · ${(t.tipos || []).join(' + ')}`],
        ['Estado', t.estado || ''],
        ['Fecha prevista', t.fechaPrevista ? fmtDate(t.fechaPrevista) : ''],
        ['Asignado a', t.asignado || ''],
        ['Prioridad', t.prioridad === 'Urgente' ? 'Urgente' : ''],
        ['Realizado el', t.fechaHecho ? fmtDate(t.fechaHecho) : ''],
        ['Firmado por', t.firma ? `${t.firma.nombre}${t.firma.dni ? ' (' + t.firma.dni + ')' : ''}` : ''],
        ['Observaciones del montador', t.obs || ''],
      ] }] : []),
      { titulo: 'Documentos', filas: docs.map(d => [d.tipo === 'Anexo' ? 'Anexo' : d.tipo || 'Documento', `${d.titulo || d.fichero} (${fmtDate((d.fecha || '').slice(0, 10))})`]) },
      { titulo: 'Notas de la negociación', filas: [['Notas', n.notas || '']] },
    ],
    tituloVallas: 'Fotos del emplazamiento',
    vallas: fotos.length ? fotos.slice(0, 6).map((f, i) => ({
      codigo: i ? `Foto ${i + 1}` : 'Emplazamiento', direccion: i ? '' : n.direccion || '',
      lineas: i ? [] : [[n.municipio, n.provincia].filter(Boolean).join(', ')].filter(Boolean),
      mapa: i ? '' : mapa, foto: f, precio: '' })) : [],
    pie: [settings.miEmpresa, settings.comercial, settings.miTelefono, settings.miEmail].filter(Boolean).join(' · '),
  };
}

/** Genera el dossier, lo registra en los documentos y lo abre. */
function generarDossier(origen) {
  let n, t;
  if (origen === 'neg') {
    n = saveNeg(true);
    if (!n) return;
    t = trabajoDeNeg(n);
  } else {
    t = trEditing && trabajos.find(x => x.id === trEditing);
    if (!t) { toast('Guarda primero el trabajo'); return; }
    n = negDeTrabajo(t);
    if (!n) { toast('Este trabajo no viene de una negociación de Patrimonio'); return; }
  }
  if (!NATIVE) { toast('El PDF solo se genera en la tablet'); return; }
  const doc = dossierDoc(n, t);
  const err = window.Android.budgetPdf(JSON.stringify(doc));
  if (err) { toast('⚠ No se pudo crear el PDF: ' + err); return; }
  let info = {};
  try { info = JSON.parse(window.Android.lastPdfInfo() || '{}'); } catch (e) { info = {}; }
  registrarDocumento({ tipo: 'Dossier', titulo: `Dossier de montaje · ${n.propietario}`, fichero: info.name || doc.fichero, uri: info.uri || '',
    negId: n.id, trabajoId: t ? t.id : '', empresa: n.propietario });
  refrescarDocs();
  window.Android.viewPdf();
  toast('Dossier guardado en los documentos');
}

/** Tarjeta del dossier en la ficha del trabajo (solo si viene de Patrimonio). */
function renderTfDossier() {
  const t = trEditing ? trabajos.find(x => x.id === trEditing) : { negId: trNegId, vallas: [] };
  const n = negDeTrabajo(t);
  $('#tf-dossier').hidden = !n;
  if (n) $('#tf-dossier-info').textContent = `Montaje del emplazamiento de ${n.propietario} (negociación nº ${n.num})`
    + `${n.estructura ? ` · estructura ${n.estructura.toLowerCase()}` : ''}. El PDF reúne todo lo que hay que hacer.`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && b.dataset.dossier) generarDossier(b.dataset.dossier);
});
