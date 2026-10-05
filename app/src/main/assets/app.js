'use strict';

/* =========================================================================
 * Visitas Leads — lógica de la app (corre dentro del WebView de Android).
 * Los datos se guardan en la tablet (fichero JSON interno) y cada cambio
 * reescribe el Excel en Descargas/VisitasLeads.
 * Fuera de Android (navegador) usa localStorage para poder probarla.
 * ========================================================================= */

const NATIVE = typeof window.Android !== 'undefined';

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
  'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

const DEFAULT_SETTINGS = {
  comercial: 'Gonzalo',
  miEmpresa: 'PortoValla',
  miTelefono: '',
  miEmail: '',
  autoEnviar: true,
  prefijo: '34',
  fichero: 'Visitas_Leads',
  situaciones: [
    'VISITADO E INFORMADO',
    'HABLADO CON EL RESPONSABLE',
    'NO ESTABA EL RESPONSABLE',
    'DEJADA INFORMACIÓN',
    'DEJADA TARJETA',
    'INTERESADO',
    'NO INTERESADO',
    'PIDE PRESUPUESTO',
    'LLAMAR PARA CITA',
    'VOLVER MÁS ADELANTE',
    'SE GESTIONA DESDE CENTRAL',
  ].join('\n'),
};

/* Tres modelos de mensaje; cada uno tiene versión email y versión WhatsApp. */
const FIRMA = '\n\nUn saludo,\n{comercial}\n{miEmpresa}\n{miTelefono}\n{miEmail}';
const DEFAULT_PLANTILLAS = [
  {
    nombre: 'Gracias tras hablar',
    emailAsunto: 'Gracias por atenderme – {miEmpresa}',
    emailCuerpo:
      'Hola {contacto},\n\n' +
      'Muchas gracias por el tiempo que me dedicó hoy en {empresa}. Fue un placer conocerle y ' +
      'comentar con usted cómo podemos ayudarles desde {miEmpresa}.\n\n' +
      'Le dejo aquí mis datos de contacto para cualquier duda que le surja.' + FIRMA,
    whatsapp:
      'Hola {contacto}, soy {comercial} de {miEmpresa}. Muchas gracias por atenderme hoy en {empresa}, ' +
      'fue un placer hablar con usted. Le dejo mi contacto por aquí para lo que necesite. ¡Un saludo!',
  },
  {
    nombre: 'Dejé mis datos',
    emailAsunto: 'Visita de {miEmpresa} a {empresa}',
    emailCuerpo:
      'Hola {contacto},\n\n' +
      'Hoy he pasado por {empresa} para presentarles {miEmpresa} y he dejado allí mis datos de contacto. ' +
      'Le escribo también por aquí para que los tenga a mano.\n\n' +
      'Me gustaría comentarle brevemente cómo podemos ayudarles. Cuando le venga bien, puede responder ' +
      'a este correo o llamarme.' + FIRMA,
    whatsapp:
      'Hola {contacto}, soy {comercial} de {miEmpresa}. Hoy pasé por {empresa} y dejé mis datos. ' +
      'Le escribo para que tenga también mi contacto por aquí; cuando le venga bien, lo comentamos. ¡Un saludo!',
  },
  {
    nombre: 'Info en breve',
    emailAsunto: 'Información de {miEmpresa} para {empresa}',
    emailCuerpo:
      'Hola {contacto},\n\n' +
      'Gracias de nuevo por su interés. Tal como hablamos, en breve le enviaré la información ' +
      'detallada para {empresa}.\n\n' +
      'Si mientras tanto tiene cualquier pregunta, quedo a su disposición.' + FIRMA,
    whatsapp:
      'Hola {contacto}, soy {comercial} de {miEmpresa}. Tal como hablamos, en breve le envío la ' +
      'información para {empresa}. Cualquier duda, me dice. ¡Un saludo!',
  },
];

const FIELDS = ['tipo', 'pvs', 'fecha', 'fechaFirma', 'razonSocial', 'contacto', 'telefono',
  'poblacion', 'provincia', 'correo', 'situacion', 'pvpEntrada', 'pvpTotal', 'volver',
  'porcentaje', 'fechaTrabajo'];

/* ------------------------------------------------------------- almacenamiento */

const store = {
  load(key) {
    try {
      const raw = NATIVE ? window.Android.load(key) : localStorage.getItem('vl_' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  save(key, value) {
    const json = JSON.stringify(value);
    if (NATIVE) return window.Android.save(key, json);
    localStorage.setItem('vl_' + key, json);
    return true;
  },
};

let leads = store.load('leads') || [];
let settings = Object.assign({}, DEFAULT_SETTINGS, store.load('settings') || {});
if (!Array.isArray(settings.plantillas) || settings.plantillas.length !== DEFAULT_PLANTILLAS.length) {
  settings.plantillas = DEFAULT_PLANTILLAS.map(p => Object.assign({}, p));
}
['emailAsunto', 'emailCuerpo', 'whatsappTexto'].forEach(k => delete settings[k]); // formato antiguo
let filter = 'semana';
let editingId = null;

/* ------------------------------------------------------------- utilidades */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(s) {
  const d = parseISO(s);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** Mismo nombre que la hoja del Excel: "1º JUNIO". */
function weekName(d) {
  const m = mondayOf(d);
  return `${Math.floor((m.getDate() - 1) / 7) + 1}º ${MESES[m.getMonth()]}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ------------------------------------------------------------- contacto */

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());
}

/** Normaliza a formato internacional sin "+" (34600111222). */
function normPhone(raw) {
  let s = (raw || '').trim();
  if (!s) return '';
  const intl = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/\D/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  if (!intl && s.length === 9) s = (settings.prefijo || '34').replace(/\D/g, '') + s;
  return s.length >= 9 ? s : '';
}

/** En España solo los 6xx/7xx son móviles; otros países se dan por buenos. */
function isMobile(raw) {
  const p = normPhone(raw);
  if (!p) return false;
  if (p.startsWith('34') && p.length === 11) return /^34[67]/.test(p);
  return true;
}

function channelsFor(lead) {
  const ch = [];
  if (validEmail(lead.correo)) ch.push('email');
  if (isMobile(lead.telefono)) ch.push('whatsapp');
  return ch;
}

function fillTemplate(tpl, lead) {
  const vars = {
    contacto: (lead.contacto || '').trim(),
    empresa: (lead.razonSocial || '').trim(),
    poblacion: (lead.poblacion || '').trim(),
    fecha: fmtDate(lead.fecha),
    comercial: settings.comercial || '',
    miEmpresa: settings.miEmpresa || '',
    miTelefono: settings.miTelefono || '',
    miEmail: settings.miEmail || '',
    vallas: budgetVallasText(lead.presupuesto),
    presupuesto: budgetSummary(lead.presupuesto),
  };
  return String(tpl || '')
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/[ \t]+([,.!?])/g, '$1')       // "Hola ," → "Hola,"
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------- persistencia + excel */

function persist() {
  const ok = store.save('leads', leads);
  if (!ok) { toast('⚠ No se pudieron guardar los datos'); return; }
  syncExcel(true);
}

function syncExcel(silent) {
  if (!NATIVE) return '';
  const err = window.Android.exportExcel(JSON.stringify(leads), settings.fichero || 'Visitas_Leads');
  if (err) toast('⚠ Excel: ' + err);
  else if (!silent) toast('Excel actualizado');
  return err;
}

/* ------------------------------------------------------------- navegación */

function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  window.scrollTo(0, 0);
}

function currentView() {
  const v = $('.view.active');
  return v ? v.id.replace('view-', '') : 'list';
}

window.handleBack = function () {
  if (!$('#send-modal').hidden) { closeSend(); return true; }
  if (!$('#ocr-modal').hidden) { $('#ocr-modal').hidden = true; return true; }
  if (currentView() === 'vallas') { closePicker(); return true; }
  if (currentView() !== 'list') { show('list'); renderList(); return true; }
  return false;
};

/* ------------------------------------------------------------- listado */

function matchesFilter(l) {
  const d = parseISO(l.fecha);
  const now = new Date();
  switch (filter) {
    case 'hoy': return l.fecha === todayISO();
    case 'semana': return d && mondayOf(d).getTime() === mondayOf(now).getTime();
    case 'pendiente': return !l.envio && l.tipo !== 'Visita Patrimonio' && channelsFor(l).length > 0;
    case 'volver': return l.volver === 'Si';
    default: return true;
  }
}

function matchesSearch(l, q) {
  if (!q) return true;
  const hay = [l.razonSocial, l.contacto, l.poblacion, l.situacion, l.telefono, l.correo, l.tipo]
    .join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

function renderList() {
  const q = $('#search').value.trim();
  const items = leads
    .filter(l => matchesFilter(l) && matchesSearch(l, q))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''));

  const pendientes = leads.filter(l => !l.envio && l.tipo !== 'Visita Patrimonio' && channelsFor(l).length).length;
  $('#stats').textContent = `${items.length} de ${leads.length} visitas` +
    (pendientes ? ` · ${pendientes} sin seguimiento enviado` : '');

  const list = $('#list');
  if (!items.length) {
    list.innerHTML = `<div class="empty">${leads.length
      ? 'No hay visitas con este filtro.'
      : 'Aún no hay visitas.<br>Pulsa <b>＋ Nueva visita</b> para empezar.'}</div>`;
    return;
  }

  let html = '';
  let lastGroup = null;
  for (const l of items) {
    const d = parseISO(l.fecha);
    const group = d ? `${weekName(d)} ${d.getFullYear()}` : 'SIN FECHA';
    if (group !== lastGroup) { html += `<div class="week">${esc(group)}</div>`; lastGroup = group; }

    const ch = channelsFor(l);
    const sub = [l.contacto, l.poblacion, l.telefono, l.correo].filter(Boolean).map(esc).join(' · ');
    const badges = [
      `<span class="badge t-${esc((l.tipo || '').replace(/\s/g, ''))}">${esc(l.tipo || 'Lead')}</span>`,
      `<span class="badge">${esc(fmtDate(l.fecha))}</span>`,
      l.porcentaje ? `<span class="badge">${esc(l.porcentaje)}%</span>` : '',
      l.volver === 'Si' ? '<span class="badge volver">Volver</span>' : '',
      l.presupuesto && l.presupuesto.vallas && l.presupuesto.vallas.length
        ? `<span class="badge budget-b">Presupuesto · ${l.presupuesto.vallas.length} valla${l.presupuesto.vallas.length > 1 ? 's' : ''}${budgetTotal(l.presupuesto) ? ' · ' + fmtMoney(budgetTotal(l.presupuesto)) : ''}</span>` : '',
      l.envio ? `<span class="badge ok">✓ ${esc(l.envio)}</span>`
        : (ch.length && l.tipo !== 'Visita Patrimonio' ? '<span class="badge pend">Sin seguimiento</span>' : ''),
    ].join('');

    const acts = [
      ch.includes('email') ? `<button class="act mail" data-send="email" data-id="${l.id}">✉ Email</button>` : '',
      ch.includes('whatsapp') ? `<button class="act wa" data-send="whatsapp" data-id="${l.id}">WhatsApp</button>` : '',
      normPhone(l.telefono) ? `<button class="act" data-call="${l.id}">☎ Llamar</button>` : '',
    ].join('');

    html += `
      <article class="lead" data-id="${l.id}">
        <div class="lead-main">
          <div class="lead-title">${esc(l.razonSocial || '(sin nombre)')}</div>
          ${sub ? `<div class="lead-sub">${sub}</div>` : ''}
          ${l.situacion ? `<div class="lead-sit">${esc(l.situacion)}</div>` : ''}
          <div class="badges">${badges}</div>
        </div>
        ${acts ? `<div class="lead-actions">${acts}</div>` : ''}
      </article>`;
  }
  list.innerHTML = html;
}

/* ------------------------------------------------------------- formulario */

function setChipGroup(name, value) {
  const group = $(`[data-bind="${name}"]`);
  if (!group) return;
  $$('.chip', group).forEach(c => c.classList.toggle('active', c.dataset.value === value));
  $(`#lead-form [name="${name}"]`).value = value || '';
}

/** Marca el botón de población/provincia que coincide con lo escrito en el campo. */
function syncFillChips() {
  $$('#lead-form [data-fill]').forEach(group => {
    const v = ($(`#lead-form [name="${group.dataset.fill}"]`).value || '').trim().toLowerCase();
    $$('.chip', group).forEach(c => c.classList.toggle('active', !!v && c.dataset.value.toLowerCase() === v));
  });
}

function situacionOptions() {
  return (settings.situaciones || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/** Separa el texto de "Situación" en opciones marcadas + nota libre. */
function splitSituacion(text) {
  const opts = situacionOptions();
  const sel = [];
  const rest = [];
  for (const part of String(text || '').split(/\.\s+|\n/).map(p => p.trim().replace(/\.$/, '')).filter(Boolean)) {
    const o = opts.find(x => x.toLowerCase() === part.toLowerCase());
    if (o) { if (!sel.includes(o)) sel.push(o); } else rest.push(part);
  }
  return { sel, nota: rest.join('. ') };
}

function composeSituacion() {
  const sel = $$('#situacion-chips .chip.active').map(c => c.dataset.value);
  const nota = $('#lead-form [name="nota"]').value.trim();
  return [...sel, nota].filter(Boolean).join('. ');
}

function refreshDatalists() {
  const pobl = [...new Set(leads.map(l => (l.poblacion || '').trim()).filter(Boolean))].sort();
  $('#dl-poblacion').innerHTML = pobl.map(p => `<option value="${esc(p)}">`).join('');
  // Botones con las poblaciones usadas más recientemente
  const recent = [];
  for (const l of leads.slice().sort((a, b) => (b.creado || '').localeCompare(a.creado || ''))) {
    const p = (l.poblacion || '').trim().toUpperCase();
    if (p && !recent.includes(p)) recent.push(p);
    if (recent.length >= 6) break;
  }
  $('#poblacion-chips').innerHTML = recent
    .map(p => `<button type="button" class="chip" data-value="${esc(p)}">${esc(p)}</button>`).join('');
  $('#situacion-chips').innerHTML = situacionOptions()
    .map(s => `<button type="button" class="chip" data-value="${esc(s)}">${esc(s)}</button>`).join('');
}

function openForm(id) {
  editingId = id || null;
  const form = $('#lead-form');
  form.reset();
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
  refreshDatalists();

  let lead;
  if (id) {
    lead = leads.find(l => l.id === id);
  } else {
    // Nueva visita: hoy, y misma población/provincia que la última (se suelen visitar varias seguidas)
    const last = leads.slice().sort((a, b) => (b.creado || '').localeCompare(a.creado || ''))[0] || {};
    lead = { tipo: 'Lead', fecha: todayISO(), volver: 'No', porcentaje: '25',
      poblacion: last.poblacion || '', provincia: last.provincia || '' };
  }

  for (const f of FIELDS) {
    const el = form.elements[f];
    if (el) el.value = lead[f] || '';
  }
  ['tipo', 'volver', 'porcentaje'].forEach(n => setChipGroup(n, lead[n] || ''));
  const sit = splitSituacion(lead.situacion);
  $$('#situacion-chips .chip').forEach(c => c.classList.toggle('active', sit.sel.includes(c.dataset.value)));
  form.elements.nota.value = sit.nota;
  syncFillChips();
  loadBudget(lead.presupuesto);

  $('#form-title').textContent = id ? 'Editar visita' : 'Nueva visita';
  $('#btn-delete').hidden = !id;
  $('#envio-info').textContent = lead.envio ? `Seguimiento enviado: ${lead.envio}` : '';
  $('details.card', form).open = !!(lead.pvpEntrada || lead.pvpTotal || lead.fechaFirma || lead.fechaTrabajo);
  show('form');
}

function readForm() {
  const form = $('#lead-form');
  const data = {};
  for (const f of FIELDS) data[f] = (form.elements[f].value || '').trim();
  data.situacion = composeSituacion();
  data.correo = data.correo.toLowerCase();
  data.presupuesto = budgetForSave();
  const total = budgetTotal();
  if (data.presupuesto && total > 0 && !data.pvpTotal) data.pvpTotal = String(total).replace('.', ',');
  return data;
}

function saveForm(thenSend) {
  const form = $('#lead-form');
  const data = readForm();
  $$('.invalid', form).forEach(el => el.classList.remove('invalid'));

  const bad = [];
  if (!data.razonSocial) bad.push('razonSocial');
  if (!data.fecha) bad.push('fecha');
  if (data.correo && !validEmail(data.correo)) bad.push('correo');
  if (bad.length) {
    bad.forEach(n => form.elements[n].classList.add('invalid'));
    form.elements[bad[0]].focus();
    toast(bad.includes('correo') ? 'El correo no es válido' : 'Falta la razón social o la fecha');
    return;
  }

  const now = new Date().toISOString();
  let lead;
  const isNew = !editingId;
  if (editingId) {
    lead = leads.find(l => l.id === editingId);
    Object.assign(lead, data, { modificado: now });
    if (!data.presupuesto) delete lead.presupuesto;
  } else {
    lead = Object.assign({ id: uid(), creado: now, modificado: now, envio: '' }, data);
    if (!lead.presupuesto) delete lead.presupuesto;
    leads.push(lead);
  }
  persist();
  toast('Visita guardada');

  show('list');
  renderList();

  const wantsSend = thenSend || (isNew && settings.autoEnviar && !lead.envio);
  if (wantsSend && lead.tipo !== 'Visita Patrimonio') {
    const ch = channelsFor(lead);
    if (ch.length) openSend(lead.id, ch[0]);
    else if (thenSend) toast('Esta visita no tiene correo ni móvil válido');
  }
}

function deleteLead() {
  if (!editingId) return;
  const l = leads.find(x => x.id === editingId);
  if (!confirm(`¿Eliminar la visita a "${l ? l.razonSocial : ''}"?`)) return;
  leads = leads.filter(x => x.id !== editingId);
  persist();
  toast('Visita eliminada');
  show('list');
  renderList();
}

/* ------------------------------------------------------------- envío */

let sending = null; // { id, channel, modelo }

/** Modelo sugerido: si no hay persona de contacto se dejaron los datos; si no, agradecimiento. */
function suggestedModel(lead) {
  const sit = (lead.situacion || '').toLowerCase();
  if (/presupuesto|propuesta|precio|enviar info|mandar info/.test(sit)) return 2;
  if (/hablado con/.test(sit)) return 0;
  if (/no estaba|dejad|dej[eé] (mis )?datos|ausente/.test(sit)) return 1;
  return (lead.contacto || '').trim() ? 0 : 1;
}

function openSend(id, channel) {
  const lead = leads.find(l => l.id === id);
  if (!lead) return;
  const ch = channelsFor(lead);
  if (!ch.length) { toast('Sin correo ni móvil para enviar'); return; }
  if (!ch.includes(channel)) channel = ch[0];
  sending = { id, channel, modelo: suggestedModel(lead) };

  $('#send-title').textContent = `Seguimiento · ${lead.razonSocial}`;
  $('#send-channels').innerHTML = ch.map(c =>
    `<button type="button" class="chip${c === channel ? ' active' : ''}" data-channel="${c}">${c === 'email' ? '✉ Email' : 'WhatsApp'}</button>`).join('');
  $('#send-models').innerHTML = settings.plantillas.map((p, i) =>
    `<button type="button" class="chip${i === sending.modelo ? ' active' : ''}" data-model="${i}">${esc(p.nombre || 'Modelo ' + (i + 1))}</button>`).join('');
  fillSend(lead, channel);
  $('#send-modal').hidden = false;
}

function fillSend(lead, channel) {
  const isMail = channel === 'email';
  $('#send-subject-wrap').hidden = !isMail;
  const tpl = settings.plantillas[sending ? sending.modelo : 0] || DEFAULT_PLANTILLAS[0];
  $('#send-subject').value = isMail ? fillTemplate(tpl.emailAsunto, lead) : '';
  $('#send-body').value = fillTemplate(isMail ? tpl.emailCuerpo : tpl.whatsapp, lead);
  $('#send-to').textContent = isMail ? `Para: ${lead.correo}` : `WhatsApp: +${normPhone(lead.telefono)}`;
  $('#send-go').textContent = isMail ? 'Abrir correo y enviar' : 'Abrir WhatsApp y enviar';
}

function closeSend() {
  $('#send-modal').hidden = true;
  sending = null;
}

function doSend() {
  if (!sending) return;
  const lead = leads.find(l => l.id === sending.id);
  if (!lead) return closeSend();
  const body = $('#send-body').value;

  if (sending.channel === 'email') {
    const subject = $('#send-subject').value;
    if (NATIVE) window.Android.sendEmail(lead.correo, subject, body);
    else window.open(`mailto:${encodeURIComponent(lead.correo)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  } else {
    const phone = normPhone(lead.telefono);
    if (NATIVE) window.Android.sendWhatsApp(phone, body);
    else window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(body)}`);
  }

  const modelo = (settings.plantillas[sending.modelo] || {}).nombre || '';
  lead.envio = [sending.channel === 'email' ? 'Email' : 'WhatsApp', modelo, fmtDate(todayISO())].filter(Boolean).join(' · ');
  lead.modificado = new Date().toISOString();
  persist();
  closeSend();
  renderList();
}

/* ------------------------------------------------------------- presupuesto de vallas */

const VALLAS_DB = Array.isArray(window.VALLAS) ? window.VALLAS : [];
const PERIOD_MONTHS = { Mensual: 1, Trimestral: 3, Semestral: 6, Anual: 12 };
let budget = null;          // presupuesto que se está editando en el formulario
let pickerSel = null;       // Set de códigos marcados en el selector
let pickerZona = 'Todas';

function emptyBudget() {
  return { codes: [], snap: {}, periodo: '', desde: '', hasta: '', material: '', precioPeriodo: '', precioMaterial: '' };
}

function vallaByCode(code) {
  return VALLAS_DB.find(v => v.codigo === code) || (budget && budget.snap[code]) || null;
}

function parseMoney(s) {
  let v = String(s == null ? '' : s).replace(/[€\s]/g, '');
  if (!v) return 0;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Total = (precio periodo + precio material) × nº de vallas. */
function budgetTotal(b) {
  b = b || budget;
  if (!b) return 0;
  const n = b.codes ? b.codes.length : (b.vallas || []).length;
  return Math.round((parseMoney(b.precioPeriodo) + parseMoney(b.precioMaterial)) * n * 100) / 100;
}

function addMonthsISO(iso, months) {
  const d = parseISO(iso);
  if (!d) return '';
  const e = new Date(d.getFullYear(), d.getMonth() + months, d.getDate() - 1);
  return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
}

function loadBudget(p) {
  budget = emptyBudget();
  if (p) {
    for (const k of ['periodo', 'desde', 'hasta', 'material', 'precioPeriodo', 'precioMaterial']) budget[k] = p[k] || '';
    for (const v of p.vallas || []) { budget.codes.push(v.codigo); budget.snap[v.codigo] = v; }
  }
  renderBudget();
}

function budgetVisible() {
  const pide = $$('#situacion-chips .chip.active').some(c => /presupuesto/i.test(c.dataset.value));
  return pide || (budget && budget.codes.length > 0);
}

function renderBudget() {
  const card = $('#presupuesto-card');
  card.hidden = !budgetVisible();
  if (card.hidden || !budget) return;
  $('#vallas-sel').innerHTML = budget.codes.length ? budget.codes.map(code => {
    const v = vallaByCode(code) || { codigo: code, direccion: '' };
    return `<div class="vsel">
      ${v.foto ? `<img src="${esc(v.foto)}" alt="">` : ''}
      <div class="vsel-info"><b>${esc(v.codigo)}</b><span>${esc(v.direccion)}${v.municipio ? ' · ' + esc(v.municipio) : ''}</span></div>
      ${v.lat ? `<button type="button" class="act" data-map="${esc(code)}">📍</button>` : ''}
      <button type="button" class="vsel-x" data-unvalla="${esc(code)}" aria-label="Quitar">✕</button>
    </div>`;
  }).join('') : '<p class="hint">Todavía no has elegido ninguna valla.</p>';

  $$('[data-budget]').forEach(g => $$('.chip', g).forEach(c =>
    c.classList.toggle('active', budget[g.dataset.budget] === c.dataset.value)));
  const fechas = $('#periodo-fechas');
  fechas.hidden = !budget.periodo;
  const form = $('#lead-form');
  form.elements.b_desde.value = budget.desde;
  form.elements.b_hasta.value = budget.hasta;
  form.elements.b_hasta.readOnly = budget.periodo !== 'Fechas';
  form.elements.b_precioPeriodo.value = budget.precioPeriodo;
  form.elements.b_precioMaterial.value = budget.precioMaterial;
  renderBudgetTotal();
}

function renderBudgetTotal() {
  const n = budget.codes.length;
  const t = budgetTotal();
  $('#presupuesto-total').textContent = n
    ? `${n} valla${n > 1 ? 's' : ''}${t ? ` · Total: ${fmtMoney(t)} sin IVA` : ''}`
    : '';
}

function budgetForSave() {
  if (!budget || !budgetVisible()) return null;
  const b = budget;
  if (!b.codes.length && !b.periodo && !b.material && !b.precioPeriodo && !b.precioMaterial) return null;
  return {
    vallas: b.codes.map(code => {
      const v = vallaByCode(code) || { codigo: code };
      return { codigo: v.codigo, direccion: v.direccion || '', municipio: v.municipio || '', provincia: v.provincia || '',
        zona: v.zona || '', medida: v.medida || '', categoria: v.categoria || '',
        lat: v.lat == null ? '' : v.lat, lng: v.lng == null ? '' : v.lng, foto: v.foto || '' };
    }),
    periodo: b.periodo, desde: b.desde, hasta: b.hasta, material: b.material,
    precioPeriodo: b.precioPeriodo, precioMaterial: b.precioMaterial,
    total: String(Math.round((parseMoney(b.precioPeriodo) + parseMoney(b.precioMaterial)) * 100) / 100),
  };
}

function budgetVallasText(p) {
  if (!p || !p.vallas || !p.vallas.length) return '';
  return p.vallas.map(v => `- ${v.codigo}: ${v.direccion}${v.municipio ? ` (${v.municipio})` : ''}`).join('\n');
}

function budgetSummary(p) {
  if (!p) return '';
  const periodo = p.periodo === 'Fechas' ? `del ${fmtDate(p.desde)} al ${fmtDate(p.hasta)}` : (p.periodo || '').toLowerCase();
  const parts = [
    p.vallas && p.vallas.length ? `${p.vallas.length} valla${p.vallas.length > 1 ? 's' : ''}` : '',
    periodo ? `campaña ${periodo}` : '',
    p.material ? `material: ${p.material.toLowerCase()}` : '',
    budgetTotal(p) ? `total ${fmtMoney(budgetTotal(p))} sin IVA` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function setBudgetField(key, value) {
  budget[key] = value;
  if ((key === 'periodo' || key === 'desde') && PERIOD_MONTHS[budget.periodo]) {
    if (!budget.desde) budget.desde = todayISO();
    budget.hasta = addMonthsISO(budget.desde, PERIOD_MONTHS[budget.periodo]);
  }
  renderBudget();
}

/* --- selector de vallas --- */

function openPicker() {
  pickerSel = new Set(budget.codes);
  const zonas = [...new Set(VALLAS_DB.map(v => v.zona).filter(Boolean))];
  $('#vallas-zonas').innerHTML = ['Todas', ...zonas].map(z =>
    `<button type="button" class="chip${z === pickerZona ? ' active' : ''}" data-zona="${esc(z)}">${esc(z === 'Todas' ? 'Todas' : z)}</button>`).join('');
  $('#vallas-search').value = '';
  renderPicker();
  show('vallas');
}

function renderPicker() {
  const q = $('#vallas-search').value.trim().toLowerCase();
  const items = VALLAS_DB.filter(v =>
    (pickerZona === 'Todas' || v.zona === pickerZona) &&
    (!q || q.split(/\s+/).every(w =>
      [v.codigo, v.direccion, v.municipio, v.zona, v.medida].join(' ').toLowerCase().includes(w))));
  $('#vallas-stats').textContent = `${items.length} vallas · ${pickerSel.size} seleccionada${pickerSel.size === 1 ? '' : 's'}`;
  $('#vallas-done').textContent = `Listo (${pickerSel.size})`;
  $('#vallas-grid').innerHTML = items.length ? items.map(v => `
    <article class="valla${pickerSel.has(v.codigo) ? ' sel' : ''}" data-valla="${esc(v.codigo)}">
      ${v.foto ? `<img src="${esc(v.foto)}" alt="" loading="lazy">` : '<div class="nofoto">Sin foto</div>'}
      <div class="valla-body">
        <div class="valla-code">${esc(v.codigo)}</div>
        <div class="valla-dir">${esc(v.direccion)}</div>
        <div class="valla-meta">${[v.municipio, v.medida, v.categoria && 'Cat. ' + v.categoria].filter(Boolean).map(esc).join(' · ')}</div>
        ${v.lat ? `<button type="button" class="valla-map" data-map="${esc(v.codigo)}">📍 Ver en mapa</button>` : ''}
      </div>
    </article>`).join('') : '<div class="empty">No hay vallas que coincidan.</div>';
}

function closePicker() {
  // Se respeta el orden del catálogo
  budget.codes = VALLAS_DB.map(v => v.codigo).filter(c => pickerSel.has(c))
    .concat([...pickerSel].filter(c => !VALLAS_DB.some(v => v.codigo === c)));
  show('form');
  renderBudget();
  setTimeout(() => $('#presupuesto-card').scrollIntoView({ block: 'start' }), 30);
}

function openMapFor(code) {
  const v = vallaByCode(code);
  if (!v || v.lat == null || v.lat === '') return;
  if (NATIVE) window.Android.openMap(String(v.lat), String(v.lng), `${v.codigo} ${v.direccion}`);
  else window.open(`https://www.google.com/maps?q=${v.lat},${v.lng}`);
}

/* ------------------------------------------------------------- tarjeta de visita (OCR) */

let ocrData = null;

function scanCard(source) {
  if (!NATIVE) { toast('El escáner solo funciona en la tablet'); return; }
  $('#ocr-modal').hidden = true;
  window.Android.scanCard(source);
}

window.onOcrStart = function () { toast('Leyendo la tarjeta…'); };
window.onOcrError = function (msg) { if (msg) toast('⚠ ' + msg); };

/** Llamado desde Android con el texto reconocido. */
window.onOcrResult = function (text) {
  if (currentView() !== 'form') openForm(null);
  const r = window.parseCard(text);
  if (!r.lines.length) { toast('No se ha podido leer texto. Prueba con más luz y la tarjeta recta.'); return; }
  const form = $('#lead-form');
  const put = (field, value, overwrite) => {
    if (value && (overwrite || !form.elements[field].value.trim())) form.elements[field].value = value;
  };
  put('razonSocial', r.razonSocial, true);
  put('contacto', r.contacto, true);
  put('telefono', r.telefono, true);
  put('correo', r.correo, true);
  put('poblacion', r.poblacion, true);
  put('provincia', r.provincia, true);
  const extra = [r.cargo && `Cargo: ${r.cargo}`, r.telefono2 && `Otro tel.: ${r.telefono2}`, r.web && `Web: ${r.web}`]
    .filter(Boolean).join('. ');
  if (extra) {
    const nota = form.elements.nota;
    if (!nota.value.includes(extra)) nota.value = [nota.value.trim(), extra].filter(Boolean).join('. ');
  }
  ocrData = r;
  syncFillChips();
  renderOcr();
  $('#ocr-modal').hidden = false;
};

const OCR_TARGETS = [
  ['razonSocial', 'Empresa'], ['contacto', 'Contacto'], ['telefono', 'Teléfono'],
  ['correo', 'Correo'], ['poblacion', 'Población'],
];

function renderOcr() {
  const form = $('#lead-form');
  $('#ocr-summary').innerHTML = OCR_TARGETS.map(([f, label]) =>
    `<dt>${label}</dt><dd>${esc(form.elements[f].value) || '—'}</dd>`).join('') +
    `<dt>Provincia</dt><dd>${esc(form.elements.provincia.value) || '—'}</dd>`;
  $('#ocr-lines').innerHTML = ocrData.lines.map((l, i) => `
    <div class="ocr-line">
      <div class="ocr-line-text">${esc(l)}</div>
      <div class="chips small">${OCR_TARGETS.map(([f, label]) =>
        `<button type="button" class="chip" data-ocr-line="${i}" data-ocr-field="${f}">${label}</button>`).join('')}</div>
    </div>`).join('');
}

function assignOcrLine(i, field) {
  const form = $('#lead-form');
  let v = ocrData.lines[i];
  if (field === 'telefono') {
    const digits = v.replace(/\D/g, '').replace(/^(0034|34)(?=\d{9}$)/, '');
    v = digits.length === 9 ? digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : v;
  } else if (field === 'correo') {
    v = (v.replace(/\s*@\s*/g, '@').match(/[^\s:]+@[^\s]+/) || [v])[0].toLowerCase();
  } else if (field === 'poblacion') {
    const m = v.match(/\b(\d{5})\b[\s,-]*(.+)/);
    if (m) {
      v = m[2].replace(/\(.*$/, '').trim();
      const prov = window.parseCard(m[1] + ' X').provincia;
      if (prov) form.elements.provincia.value = prov;
    }
    v = v.toUpperCase();
  } else if (field === 'razonSocial') {
    v = v.toUpperCase();
  }
  form.elements[field].value = v;
  syncFillChips();
  renderOcr();
}

/* ------------------------------------------------------------- ajustes */

function openSettings() {
  const form = $('#settings-form');
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = settings[el.name] == null ? '' : settings[el.name];
  }
  settings.plantillas.forEach((p, i) => {
    for (const k of ['nombre', 'emailAsunto', 'emailCuerpo', 'whatsapp']) form.elements[`tpl${i}_${k}`].value = p[k] || '';
  });
  $('#excel-location').textContent = NATIVE
    ? `El Excel se guarda en: ${window.Android.excelLocation()}/${settings.fichero || 'Visitas_Leads'}.xlsx (se actualiza solo cada vez que guardas).`
    : 'Modo navegador: el Excel solo se genera en la tablet.';
  show('settings');
}

function saveSettings() {
  const form = $('#settings-form');
  const next = Object.assign({}, settings);
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.name.startsWith('tpl')) continue;
    next[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  next.plantillas = DEFAULT_PLANTILLAS.map((d, i) => {
    const p = {};
    for (const k of ['nombre', 'emailAsunto', 'emailCuerpo', 'whatsapp']) {
      p[k] = form.elements[`tpl${i}_${k}`].value.trim() || d[k];
    }
    return p;
  });
  next.fichero = (next.fichero || 'Visitas_Leads').replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '');
  settings = next;
  store.save('settings', settings);
  syncExcel(true);
  toast('Ajustes guardados');
  show('list');
  renderList();
}

function resetTemplates() {
  const form = $('#settings-form');
  DEFAULT_PLANTILLAS.forEach((p, i) => {
    for (const k of ['nombre', 'emailAsunto', 'emailCuerpo', 'whatsapp']) form.elements[`tpl${i}_${k}`].value = p[k];
  });
  form.elements.situaciones.value = DEFAULT_SETTINGS.situaciones;
  toast('Textos restaurados (pulsa Guardar ajustes)');
}

/* ------------------------------------------------------------- eventos */

document.addEventListener('click', e => {
  const t = e.target.closest('button, article.lead, article.valla');
  if (!t) return;

  // Grupos de chips de selección única (tipo, volver, %)
  const bind = t.closest('[data-bind]');
  if (bind && t.classList.contains('chip')) {
    const name = bind.dataset.bind;
    const cur = $(`#lead-form [name="${name}"]`).value;
    setChipGroup(name, cur === t.dataset.value && name !== 'tipo' ? '' : t.dataset.value);
    return;
  }
  const fill = t.closest('[data-fill]');
  if (fill && t.classList.contains('chip')) {
    $(`#lead-form [name="${fill.dataset.fill}"]`).value = t.dataset.value;
    syncFillChips();
    return;
  }
  if (t.closest('[data-multi]') && t.classList.contains('chip')) {
    t.classList.toggle('active');
    renderBudget();
    return;
  }
  if (t.dataset.map) { openMapFor(t.dataset.map); return; }
  const bg = t.closest('[data-budget]');
  if (bg && t.classList.contains('chip')) {
    setBudgetField(bg.dataset.budget, budget[bg.dataset.budget] === t.dataset.value ? '' : t.dataset.value);
    return;
  }
  if (t.dataset.unvalla) {
    budget.codes = budget.codes.filter(c => c !== t.dataset.unvalla);
    renderBudget();
    return;
  }
  if (t.matches('article.valla')) {
    const c = t.dataset.valla;
    if (pickerSel.has(c)) pickerSel.delete(c); else pickerSel.add(c);
    t.classList.toggle('sel', pickerSel.has(c));
    $('#vallas-stats').textContent = $('#vallas-stats').textContent.replace(/\d+ seleccionadas?$/,
      `${pickerSel.size} seleccionada${pickerSel.size === 1 ? '' : 's'}`);
    $('#vallas-done').textContent = `Listo (${pickerSel.size})`;
    return;
  }
  if (t.dataset.zona) {
    pickerZona = t.dataset.zona;
    $$('#vallas-zonas .chip').forEach(c => c.classList.toggle('active', c === t));
    renderPicker();
    return;
  }
  const dateGroup = t.closest('[data-date]');
  if (dateGroup && t.classList.contains('chip')) {
    const d = new Date();
    d.setDate(d.getDate() + Number(t.dataset.offset || 0));
    $(`#lead-form [name="${dateGroup.dataset.date}"]`).value =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return;
  }
  if (t.dataset.ocrField) { assignOcrLine(Number(t.dataset.ocrLine), t.dataset.ocrField); return; }
  if (t.dataset.filter) {
    filter = t.dataset.filter;
    $$('#filters .chip').forEach(c => c.classList.toggle('active', c === t));
    renderList();
    return;
  }
  if (t.dataset.channel && sending) {
    sending.channel = t.dataset.channel;
    $$('#send-channels .chip').forEach(c => c.classList.toggle('active', c === t));
    fillSend(leads.find(l => l.id === sending.id), sending.channel);
    return;
  }
  if (t.dataset.model && sending) {
    sending.modelo = Number(t.dataset.model);
    $$('#send-models .chip').forEach(c => c.classList.toggle('active', c === t));
    fillSend(leads.find(l => l.id === sending.id), sending.channel);
    return;
  }
  if (t.dataset.send) { openSend(t.dataset.id, t.dataset.send); return; }
  if (t.dataset.call) {
    const l = leads.find(x => x.id === t.dataset.call);
    if (l && NATIVE) window.Android.call('+' + normPhone(l.telefono));
    return;
  }
  if (t.matches('article.lead')) { openForm(t.dataset.id); return; }

  const exportArgs = () => [JSON.stringify(leads), settings.fichero || 'Visitas_Leads'];
  switch (t.dataset.action) {
    case 'new': openForm(null); break;
    case 'vallas-pick': openPicker(); break;
    case 'vallas-done': closePicker(); break;
    case 'scan-camera': scanCard('camera'); break;
    case 'scan-gallery': scanCard('gallery'); break;
    case 'ocr-done': $('#ocr-modal').hidden = true; break;
    case 'back': window.handleBack(); break;
    case 'settings': openSettings(); break;
    case 'save': saveForm(false); break;
    case 'save-send': saveForm(true); break;
    case 'delete': deleteLead(); break;
    case 'send-cancel': closeSend(); break;
    case 'send-go': doSend(); break;
    case 'save-settings': saveSettings(); break;
    case 'reset-templates': resetTemplates(); break;
    case 'excel-open':
      if (!NATIVE) { toast('Solo disponible en la tablet'); break; }
      { const err = window.Android.openExcel(...exportArgs()); if (err) toast('⚠ ' + err); }
      break;
    case 'excel-share':
      if (!NATIVE) { toast('Solo disponible en la tablet'); break; }
      { const err = window.Android.shareExcel(...exportArgs()); if (err) toast('⚠ ' + err); }
      break;
  }
});

$('#send-modal').addEventListener('click', e => { if (e.target.id === 'send-modal') closeSend(); });
$('#ocr-modal').addEventListener('click', e => { if (e.target.id === 'ocr-modal') e.target.hidden = true; });
$('#search').addEventListener('input', renderList);
$('#vallas-search').addEventListener('input', renderPicker);
$('#lead-form').addEventListener('input', e => {
  const k = e.target.name || '';
  if (k.startsWith('b_') && budget) {
    budget[k.slice(2)] = e.target.value.trim();
    if (k === 'b_desde') setBudgetField('desde', e.target.value);
    else renderBudgetTotal();
  }
  if (e.target.name === 'poblacion' || e.target.name === 'provincia') syncFillChips();
});

/* ------------------------------------------------------------- inicio */

renderList();
if (NATIVE && leads.length) syncExcel(true);
