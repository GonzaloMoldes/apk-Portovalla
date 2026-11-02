/* PortoValla Operadores · pedido de contrato a la central (Visitas y Clientes)
   Los datos que pide la central para hacer un contrato: cliente, contacto, teléfono, dirección,
   valla contratada, periodo, inicio de campaña, precio de alquiler mensual, producción de la
   lona, forma de pago y renovación. Lo que no se escribe se toma del presupuesto de la visita
   (sale en gris en cada campo). El botón envía el mensaje por WhatsApp eligiendo el grupo.
   Al pasar la visita a cliente, el pedido pasa a su ficha. */

const PC_CAMPOS = ['direccion', 'vallas', 'periodo', 'inicio', 'precio', 'lona', 'pago', 'renovacion', 'notas'];
const PC_PAGOS = ['Pronto pago por transferencia de Lona+1 mes, resto transferencia mensual', 'Transferencia mensual',
  'Pago único por adelantado'];

/** HTML de la tarjeta (igual en la visita y en el cliente). */
function pedidoCardHtml(ctx) {
  return `<h2>📝 Pedido de contrato</h2>
    <p class="hint">Lo que se envía a la central para hacer el contrato. Lo que está en gris sale ${ctx === 'lead' ? 'del presupuesto de la visita' : 'de la última visita con presupuesto'}; escribe encima para cambiarlo.</p>
    <label>Dirección del cliente<input type="text" name="pc_direccion" autocapitalize="words"></label>
    <div class="grid">
      <label>Valla contratada<input type="text" name="pc_vallas" autocapitalize="characters"></label>
      <label>Periodo<input type="text" name="pc_periodo"></label>
    </div>
    <div class="grid">
      <label>Inicio de campaña<input type="date" name="pc_inicio"></label>
      <label>Precio alquiler mensual (€)<input type="text" name="pc_precio" inputmode="decimal"></label>
    </div>
    <label>Producción lona (importe y tipo)<input type="text" name="pc_lona"></label>
    <label>Forma de pago<textarea name="pc_pago" rows="2"></textarea></label>
    <div class="chips small" data-pc-pago data-sin-desplegable>
      ${PC_PAGOS.map(p => `<button type="button" class="chip" data-value="${esc(p)}">${esc(p.length > 40 ? p.slice(0, 38) + '…' : p)}</button>`).join('')}
    </div>
    <label class="lbl">Renovación</label>
    <div class="chips" data-pc-renov data-sin-desplegable>
      <button type="button" class="chip" data-value="Tácita">Tácita</button>
      <button type="button" class="chip" data-value="No Tácita">No tácita</button>
    </div>
    <input type="hidden" name="pc_renovacion">
    <label>Observaciones (opcional)<textarea name="pc_notas" rows="2"></textarea></label>
    <label class="lbl">Mensaje</label>
    <pre class="pc-mensaje" data-pc-mensaje></pre>
    <div class="scan-row">
      <button type="button" class="btn wa" data-pc-enviar>📤 Enviar por WhatsApp (elegir grupo)</button>
    </div>
    <p class="envio-info" data-pc-enviado></p>`;
}

/* ------------------------------------------------------------- valores */

const pcMoney = n => {
  const v = Math.round(n * 100) / 100;
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}€`;
};

/** Valores propuestos a partir de un presupuesto. */
function pedidoDePresupuesto(p) {
  if (!p) return {};
  const vallas = p.vallas || [];
  const meses = Number(p.meses) || 0;
  const precios = vallas.map(v => parseMoney(v.precioMes)).filter(Boolean);
  const mat = parseMoney(p.precioMaterial) * Math.max(1, vallas.length);
  return {
    vallas: vallas.map(v => v.codigo).join(', '),
    periodo: meses ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` : periodoText(p),
    inicio: p.desde || '',
    precio: precios.length ? String(precios.reduce((a, b) => a + b, 0)) : '',
    lona: mat ? `${pcMoney(mat)}${p.material ? ` (${p.material.toLowerCase()})` : ''}` : (p.material || ''),
  };
}

/** Datos del contexto (visita abierta o cliente abierto) y lo que se propone. */
function pedidoContexto(sel) {
  const f = $(sel).elements;
  if (sel === '#lead-form') {
    return {
      cliente: f.razonSocial.value.trim(), contacto: f.contacto.value.trim(), telefono: f.telefono.value.trim(),
      auto: Object.assign({ direccion: [f.poblacion.value.trim(), f.provincia.value.trim()].filter(Boolean).join(', ') },
        pedidoDePresupuesto(typeof budgetForSave === 'function' ? budgetForSave() : null)),
    };
  }
  // Cliente: su dirección y el presupuesto de su última visita
  const c = cliEditing ? clienteById(cliEditing) : null;
  const visita = c ? leads.filter(l => (l.clienteId === c.id || normName(l.razonSocial) === normName(c.nombre)) && l.presupuesto)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))[0] : null;
  return {
    cliente: f.nombre.value.trim(), contacto: f.contacto.value.trim(), telefono: f.telefono.value.trim(),
    auto: Object.assign({ direccion: [f.direccion.value.trim(), f.poblacion.value.trim(), f.provincia.value.trim()].filter(Boolean).join(', ') },
      visita ? Object.assign({}, pedidoDePresupuesto(visita.presupuesto), (visita.pedido || {}).datos || {}) : {}),
  };
}

function pedidoLeer(sel) {
  const f = $(sel).elements;
  const d = {};
  for (const k of PC_CAMPOS) d[k] = (f['pc_' + k].value || '').trim();
  return d;
}

/** Valor final de cada campo: lo escrito o, si no, lo propuesto. */
function pedidoValores(sel) {
  const ctx = pedidoContexto(sel);
  const d = pedidoLeer(sel);
  const out = { cliente: ctx.cliente, contacto: ctx.contacto, telefono: ctx.telefono };
  for (const k of PC_CAMPOS) out[k] = d[k] || ctx.auto[k] || '';
  return out;
}

function fmtTelefonoMsg(t) {
  const n = normPhone(t);
  if (!n) return t || '';
  const m = /^34(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(n);
  return m ? `+34 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : '+' + n;
}

/** Texto del mensaje para la central. */
function pedidoMensaje(v) {
  const fecha = iso => { const d = parseISO(iso); return d ? `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}` : iso; };
  const mismo = !v.contacto || normName(v.contacto) === normName(v.cliente);
  const varias = (v.vallas || '').split(/[,;]+/).filter(s => s.trim()).length > 1;
  const precio = v.precio && /^[\d.,\s]+$/.test(v.precio) ? pcMoney(parseMoney(v.precio)) : v.precio;
  const lineas = [
    ['Cliente', v.cliente],
    ['Contacto', mismo ? (v.cliente ? '(mismo que cliente)' : '') : v.contacto],
    ['Teléfono', fmtTelefonoMsg(v.telefono)],
    ['Dirección', v.direccion],
    [varias ? 'Vallas contratadas' : 'Valla contratada', v.vallas],
    ['Periodo', v.periodo],
    ['Inicio campaña', v.inicio ? fecha(v.inicio) : ''],
    ['Precio alquiler mensual', precio],
    ['Producción lona', v.lona],
    ['Forma de pago', v.pago],
    ['Renovación', v.renovacion],
    ['Observaciones', v.notas],
  ].filter(([, x]) => x && String(x).trim());
  return `${saludoHora()}, necesito un contrato para:\n\n${lineas.map(([k, x]) => `-${k}: ${x}`).join('\n')}`;
}

function saludoHora() {
  const h = new Date().getHours();
  return h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
}

/* ------------------------------------------------------------- tarjeta */

/** Rellena la tarjeta con el pedido guardado (en la visita o en el cliente). */
function pedidoCargar(sel, pedido) {
  const f = $(sel).elements;
  const d = (pedido && pedido.datos) || {};
  for (const k of PC_CAMPOS) f['pc_' + k].value = d[k] || '';
  if (!f.pc_inicio.value) f.pc_inicio.value = pedidoContexto(sel).auto.inicio || '';   // la fecha no admite texto en gris
  $(sel).querySelector('[data-pc-enviado]').textContent = pedido && pedido.enviado
    ? `Pedido enviado por WhatsApp el ${fmtDate(pedido.enviado.slice(0, 10))} a las ${pedido.enviado.slice(11, 16)}.` : '';
  pedidoRender(sel);
}

/** Lo que se guarda: lo escrito en la tarjeta y la fecha del último envío. */
function pedidoGuardar(sel, anterior) {
  const d = pedidoLeer(sel);
  const hay = PC_CAMPOS.some(k => d[k]);
  if (!hay && !(anterior && anterior.enviado)) return null;
  return { datos: d, enviado: (anterior && anterior.enviado) || '' };
}

function pedidoRender(sel) {
  const form = $(sel);
  const f = form.elements;
  const ctx = pedidoContexto(sel);
  for (const k of ['direccion', 'vallas', 'periodo', 'precio', 'lona']) f['pc_' + k].placeholder = ctx.auto[k] || '';
  // La fecha no admite texto de ejemplo: si está vacía se propone la del presupuesto
  f.pc_inicio.title = ctx.auto.inicio ? `Del presupuesto: ${fmtDate(ctx.auto.inicio)}` : '';
  $$('[data-pc-renov] .chip', form).forEach(c => c.classList.toggle('active', c.dataset.value === f.pc_renovacion.value));
  $$('[data-pc-pago] .chip', form).forEach(c => c.classList.toggle('active', c.dataset.value === f.pc_pago.value.trim()));
  form.querySelector('[data-pc-mensaje]').textContent = pedidoMensaje(pedidoValores(sel));
}

/** Envía el mensaje: WhatsApp se abre para elegir el grupo de contratos. */
function pedidoEnviar(sel) {
  const v = pedidoValores(sel);
  if (!v.cliente) { toast('Falta el nombre del cliente'); return; }
  const faltan = [['vallas', 'la valla'], ['inicio', 'el inicio'], ['precio', 'el precio'], ['pago', 'la forma de pago'], ['renovacion', 'la renovación']]
    .filter(([k]) => !v[k]).map(([, t]) => t);
  if (faltan.length && !confirm(`Falta ${faltan.join(', ')}. ¿Enviar igualmente?`)) return;
  const texto = pedidoMensaje(v);
  if (!NATIVE) { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`); }
  else if (window.Android.shareWhatsAppText) window.Android.shareWhatsAppText(texto);
  else window.Android.sendWhatsApp('', texto);
  // Se apunta el envío y se guarda la ficha
  const ahora = `${todayISO()}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const datos = {};
  for (const k of PC_CAMPOS) datos[k] = v[k];
  const pedido = { datos, enviado: ahora };
  if (sel === '#lead-form') {
    const l = editingId && leads.find(x => x.id === editingId);
    if (l) {
      l.pedido = pedido;
      if (l.clienteId && clienteById(l.clienteId)) clienteById(l.clienteId).pedido = Object.assign({}, pedido);
      persist();
      if (typeof saveClientes === 'function') saveClientes();
    }
  } else {
    const c = cliEditing && clienteById(cliEditing);
    if (c) { c.pedido = pedido; saveClientes(); }
  }
  pedidoCargar(sel, pedido);
  toast('Elige el grupo de contratos en WhatsApp');
}

/* ------------------------------------------------------------- montaje y eventos */

for (const [sel, box, ctx] of [['#lead-form', '#lead-pc', 'lead'], ['#cli-form', '#cf-pc', 'cliente']]) {
  $(box).innerHTML = pedidoCardHtml(ctx);
  const form = $(sel);
  form.addEventListener('input', () => pedidoRender(sel));
  form.addEventListener('change', () => pedidoRender(sel));
  form.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.closest('[data-pc-renov]')) {
      form.elements.pc_renovacion.value = form.elements.pc_renovacion.value === t.dataset.value ? '' : t.dataset.value;
      pedidoRender(sel);
    } else if (t.closest('[data-pc-pago]')) {
      form.elements.pc_pago.value = t.dataset.value;
      pedidoRender(sel);
    } else if (t.dataset.pcEnviar !== undefined) pedidoEnviar(sel);
  });
}
