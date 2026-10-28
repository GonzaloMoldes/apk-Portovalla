/* PortoValla Operadores · oferta al propietario (Patrimonio)
   PDF con los datos del propietario, el emplazamiento (soporte, medida, caras, iluminación),
   las fotos, el tráfico y la visibilidad, la ubicación en Google Maps, el precio ofrecido,
   la duración del contrato y la valoración. Se guarda en Descargas/PortoValla/Patrimonio,
   queda en los documentos de la negociación y se puede enviar por email o WhatsApp. */

function ofertaDoc(n) {
  const hoy = todayISO();
  const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const nV = Number(n.nVallas) || 1, anos = Number(n.duracion) || 1;
  const precio = num(n.precioOfrecido) || num(n.precioAcordado);
  const imp = impactosDia(n);
  const sp = typeof impactosSplit === 'function' ? impactosSplit(n) : null;
  const mapa = n.lat !== '' && n.lat != null ? `https://maps.google.com/?q=${n.lat},${n.lng}` : '';
  const conteo = n.conteoFecha ? ` (conteo del ${fmtDate(n.conteoFecha)}${n.conteoHora ? ' a las ' + n.conteoHora : ''})` : '';
  const fotos = (n.fotos || []).filter(Boolean);
  const lineas = [
    [n.municipio, n.provincia].filter(Boolean).join(', '),
    [n.soporte, `${nV} valla${nV > 1 ? 's' : ''}`, n.medida, n.caras, n.iluminacion && `iluminación: ${n.iluminacion.toLowerCase()}`].filter(Boolean).join(' · '),
    (num(n.vehiculosMin) || num(n.personasMin)) ? `Tráfico: ${fmtInt(num(n.vehiculosMin))} vehículos y ${fmtInt(num(n.personasMin))} personas por minuto${conteo}` : '',
    imp ? `Impactos estimados: ${fmtInt(imp)} al día${sp && sp.total ? ` (${fmtInt(sp.veh)} en vehículos, ${fmtInt(sp.pie)} a pie)` : ''}` : '',
    [n.tiempoVision && `Tiempo de visión: ${String(n.tiempoVision).replace('.', ',')} s`, n.distancia && `se ve desde ${n.distancia} m`, n.sentido && `sentido: ${n.sentido.toLowerCase()}`].filter(Boolean).join(' · '),
    n.lat !== '' && n.lat != null ? `Coordenadas: ${n.lat}, ${n.lng}` : '',
  ].filter(Boolean);
  const resumen = [
    ['Emplazamiento', [n.soporte, n.medida].filter(Boolean).join(' · ') || '—'],
    ['Número de vallas', String(nV)],
    ...(n.caras ? [['Caras', n.caras]] : []),
    ...(imp ? [['Impactos estimados al día', fmtInt(imp)]] : []),
    ['Duración del contrato', `${anos} año${anos > 1 ? 's' : ''}`],
    ...(n.pago ? [['Forma de pago', n.pago]] : []),
    ...(precio ? [['Precio ofrecido por valla y año', fmtMoney(precio)], ['Valoración anual del emplazamiento', fmtMoney(precio * nV)]] : []),
    ...(precio ? [['Total del contrato', fmtMoney(precio * nV * anos)]] : []),
  ];
  return {
    fichero: `Oferta_${safe(n.propietario) || 'propietario'}_${hoy}.pdf`,
    carpeta: 'Patrimonio',
    logo: 'logo.png',
    titulo: 'Propuesta de alquiler de emplazamiento',
    subtitulo: [settings.miEmpresa, fmtDate(hoy)].filter(Boolean).join(' · '),
    datos: [
      ['Propietario', n.propietario || ''], ['Persona de contacto', n.contacto || '—'],
      ['Teléfono', n.telefono || '—'], ['Correo', n.correo || '—'],
      ['Finca / dirección', n.direccion || '—'], ['Municipio', [n.municipio, n.provincia].filter(Boolean).join(', ') || '—'],
    ],
    tituloResumen: 'Nuestra oferta',
    resumen,
    ultimoEsTotal: !!precio,
    tituloVallas: 'El emplazamiento',
    vallas: [
      { codigo: 'Ubicación de la valla', direccion: n.direccion || '', lineas, mapa: mapa ? `Ver en Google Maps: ${mapa}` : '', foto: fotos[0] || '',
        precio: precio ? `${fmtMoney(precio)} por valla y año` : '' },
      ...fotos.slice(1, 5).map((f, i) => ({ codigo: `Foto ${i + 2}`, direccion: n.direccion || '', lineas: [], mapa: '', foto: f, precio: '' })),
    ],
    nota: 'Propuesta sin compromiso, válida durante 30 días desde su fecha. Los importes no incluyen impuestos.',
    pie: [settings.miEmpresa, settings.comercial, settings.miTelefono, settings.miEmail].filter(Boolean).join(' · '),
  };
}

/** Genera el PDF de la oferta (guardando antes la ficha) y lo apunta en los documentos de la negociación. */
function generarOferta() {
  const n = saveNeg(true);
  if (!n) return null;
  if (!num(n.precioOfrecido) && !num(n.precioAcordado)) { toast('Pon el precio ofrecido antes de hacer la oferta'); return null; }
  if (!NATIVE) { toast('El PDF solo se genera en la tablet'); return null; }
  const doc = ofertaDoc(n);
  const err = window.Android.budgetPdf(JSON.stringify(doc));
  if (err) { toast('⚠ No se pudo crear el PDF: ' + err); return null; }
  let info = {};
  try { info = JSON.parse(window.Android.lastPdfInfo() || '{}'); } catch (e) { info = {}; }
  registrarDocumento({ tipo: 'Oferta', titulo: `Oferta a ${n.propietario}${num(n.precioOfrecido) ? ' · ' + fmtMoney(num(n.precioOfrecido)) + '/valla y año' : ''}`,
    fichero: info.name || doc.fichero, uri: info.uri || '', negId: n.id, empresa: n.propietario });
  renderAnexos('neg', n.id);
  return n;
}

function textoOferta(n, canal) {
  const precio = num(n.precioOfrecido) || num(n.precioAcordado);
  const saludo = n.contacto ? `Hola ${n.contacto.split(' ')[0]}` : 'Buenos días';
  if (canal === 'wa') {
    return `${saludo}, soy ${settings.comercial || ''} de ${settings.miEmpresa || 'Porto Valla'}. Le envío nuestra propuesta para instalar `
      + `${Number(n.nVallas) > 1 ? n.nVallas + ' vallas' : 'una valla'} publicitaria en su finca${n.direccion ? ` (${n.direccion})` : ''}`
      + `${precio ? `: ${fmtMoney(precio)} por valla y año durante ${n.duracion || 1} año${Number(n.duracion) > 1 ? 's' : ''}` : ''}. Cualquier duda, me dice.`;
  }
  return `${saludo}:\n\nTal como hablamos, le adjunto nuestra propuesta para el alquiler del emplazamiento de su finca`
    + `${n.direccion ? ` en ${n.direccion}${n.municipio ? ', ' + n.municipio : ''}` : ''} para ${Number(n.nVallas) > 1 ? n.nVallas + ' vallas publicitarias' : 'una valla publicitaria'}.`
    + `${precio ? `\n\nLe ofrecemos ${fmtMoney(precio)} por valla y año, con un contrato de ${n.duracion || 1} año${Number(n.duracion) > 1 ? 's' : ''}${n.pago ? ` y pago ${n.pago.toLowerCase()}` : ''}.` : ''}`
    + `\n\nEn el PDF tiene las fotos, la ubicación y los datos de tráfico y visibilidad del emplazamiento.\n\nQuedo a su disposición para cualquier duda.`
    + `\n\nUn saludo,\n${settings.comercial || ''}\n${settings.miEmpresa || ''}\n${settings.miTelefono || ''}\n${settings.miEmail || ''}`;
}

function enviarOferta(canal) {
  const n = generarOferta();
  if (!n) return;
  if (canal === 'mail') {
    if (!validEmail(n.correo)) { toast('El propietario no tiene un correo válido'); return; }
    window.Android.sendEmailPdf(n.correo, `Propuesta de alquiler de emplazamiento – ${settings.miEmpresa || 'Porto Valla'}`, textoOferta(n, 'mail'));
  } else {
    const tel = normPhone(n.telefono);
    if (!tel) { toast('El propietario no tiene teléfono'); return; }
    window.Android.sendWhatsAppPdf(tel, textoOferta(n, 'wa'));
  }
  // Oferta enviada: se apunta en la negociación
  if (['Contacto inicial', 'En negociación', ''].includes(n.estado || '')) {
    n.estado = 'Oferta enviada';
    nfState.estado = 'Oferta enviada';
    renderNf();
  }
  n.ofertas = (n.ofertas || []).concat({ fecha: todayISO(), canal: canal === 'mail' ? 'Email' : 'WhatsApp', precio: n.precioOfrecido || '' });
  n.modificado = new Date().toISOString();
  saveNegs();
  renderOfertasNeg(n);
  toast('Oferta enviada · estado: oferta enviada');
}

/** Ofertas ya enviadas de la negociación (debajo de los botones). */
function renderOfertasNeg(n) {
  $('#nf-ofertas').textContent = (n && n.ofertas || []).length
    ? 'Ofertas enviadas: ' + n.ofertas.map(o => `${fmtDate(o.fecha)} por ${o.canal}${o.precio ? ' (' + fmtMoney(num(o.precio)) + ')' : ''}`).join(' · ') : '';
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t || !t.dataset.oferta) return;
  if (t.dataset.oferta === 'pdf') { if (generarOferta()) { window.Android.viewPdf(); toast('Oferta guardada en los documentos'); } }
  else enviarOferta(t.dataset.oferta);
});
