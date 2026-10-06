'use strict';

/* =========================================================================
 * Importar / exportar los datos de cada área en Excel, y copia de
 * seguridad completa (JSON). Al importar se actualizan los registros que
 * ya existen (por ID, código o nº) y se añaden los nuevos; no se borra nada.
 * ========================================================================= */

/* Columnas del Excel de visitas (las mismas que genera XlsxWriter.COLS) */
const VISITA_COLS = [
  ['CLIENTE LLAMADAS VISITA PROPIETARIO', 'tipo', 'text'], ['PVS', 'pvs', 'text'], ['FECHA', 'fecha', 'date'],
  ['FECHA FIRMA', 'fechaFirma', 'date'], ['RAZÓN SOCIAL', 'razonSocial', 'text'], ['PERSONA CONTACTO', 'contacto', 'text'],
  ['TELÉFONO', 'telefono', 'text'], ['POBLACIÓN', 'poblacion', 'text'], ['PROVINCIA', 'provincia', 'text'],
  ['CORREO', 'correo', 'text'], ['SITUACIÓN', 'situacion', 'wrap'], ['PVP ENTRADA SIN IVA', 'pvpEntrada', 'money'],
  ['PVP TOTAL SIN IVA', 'pvpTotal', 'money'], ['VOLVER (SI/NO)', 'volver', 'text'], ['%', 'porcentaje', 'percent'],
  ['FECHA DE TRABAJO REALIZADO', 'fechaTrabajo', 'date'], ['SEGUIMIENTO ENVIADO', 'envio', 'text'], ['ID', 'id', 'text'],
];
const VISITA_ALIAS = { 'COLUMNA 15': 'porcentaje', 'TIPO': 'tipo' };

const VALLA_COLS = [
  ['CÓDIGO', 'codigo', 'text', 12], ['ZONA', 'zona', 'text', 16], ['MUNICIPIO', 'municipio', 'text', 16],
  ['PROVINCIA', 'provincia', 'text', 11], ['DIRECCIÓN', 'direccion', 'wrap', 40], ['MEDIDA', 'medida', 'text', 12],
  ['CATEGORÍA', 'categoria', 'text', 9, 'A,B,C,D'], ['LATITUD', 'lat', 'coord', 12], ['LONGITUD', 'lng', 'coord', 12],
  ['MAPA', 'mapa', 'link', 11], ['DISPONIBILIDAD', 'disponibilidad', 'text', 13, 'Disponible,Ocupada,Consultar'],
  ['CLIENTE / OCUPADA POR', 'ocupadaPor', 'text', 22], ['OCUPADA HASTA', 'ocupadaHasta', 'date', 12],
  ['FOTO', 'foto', 'photo', 26],
];

const CLIENTE_COLS = [
  ['NOMBRE / RAZÓN SOCIAL', 'nombre', 'text', 28], ['CIF / NIF', 'cif', 'text', 12], ['PERSONA CONTACTO', 'contacto', 'text', 18],
  ['TELÉFONO', 'telefono', 'text', 13], ['CORREO', 'correo', 'text', 24], ['DIRECCIÓN', 'direccion', 'text', 28],
  ['POBLACIÓN', 'poblacion', 'text', 14], ['PROVINCIA', 'provincia', 'text', 11], ['NOTAS', 'notas', 'wrap', 30],
  ['VALLAS EN VIGOR', 'vallasActivas', 'text', 22], ['€ / MES EN VIGOR', 'mensual', 'money', 12], ['ID', 'id', 'text', 14],
];

const CONTRATO_COLS = [
  ['CLIENTE', 'clienteNombre', 'text', 26], ['VALLA', 'codigo', 'text', 12], ['DIRECCIÓN VALLA', 'direccion', 'wrap', 34],
  ['MUNICIPIO', 'municipio', 'text', 14], ['DESDE', 'desde', 'date', 12], ['HASTA', 'hasta', 'date', 12],
  ['PRECIO MES', 'precioMes', 'money', 12], ['CAMPAÑA', 'campana', 'text', 20], ['NOTAS', 'notas', 'wrap', 26],
  ['ESTADO', 'estado', 'text', 10], ['FOTO', 'foto', 'photo', 26], ['ID', 'id', 'text', 14], ['ID CLIENTE', 'clienteId', 'text', 14],
];

/* ------------------------------------------------------------- utilidades de importación */

function normHeader(s) {
  return String(s || '').replace(/%/g, ' PCT ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Valor de una celda de Excel → valor de la app, según el tipo de columna. */
function fromCell(kind, v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const isNum = /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(s);
  switch (kind) {
    case 'date': {
      if (isNum) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86400000);
        return d.toISOString().slice(0, 10);
      }
      const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
    }
    case 'percent': {
      const n = parseMoney(s.replace('%', ''));
      return n ? String(Math.round(n <= 1 ? n * 100 : n)) : '';
    }
    case 'money': case 'number':
      return isNum ? String(Number(s)) : s;
    case 'coord':
      return isNum ? Number(Number(s).toFixed(6)) : '';
    case 'link': case 'photo':
      return '';
    default:
      if (isNum && /E/i.test(s)) return String(Math.round(Number(s)));   // teléfonos guardados como número
      return isNum && /\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
  }
}

/** Convierte una hoja (filas de texto) en objetos con las claves de `cols`. */
function sheetToObjects(rows, cols, alias) {
  if (!rows || !rows.length) return [];
  const byHeader = {};
  cols.forEach(c => { byHeader[normHeader(c[0])] = c; });
  Object.entries(alias || {}).forEach(([h, key]) => {
    const c = cols.find(x => x[1] === key);
    if (c) byHeader[normHeader(h)] = c;
  });
  const map = rows[0].map(h => byHeader[normHeader(h)] || null);
  if (!map.some(Boolean)) return [];
  const out = [];
  for (const r of rows.slice(1)) {
    const o = {};
    let any = false;
    map.forEach((c, i) => {
      if (!c) return;
      const v = fromCell(c[2], r[i]);
      if (v !== '') { o[c[1]] = v; any = true; }
    });
    if (any) out.push(o);
  }
  return out;
}

/** Hojas del libro cuyas cabeceras contienen la columna indicada. */
function sheetsWith(book, header) {
  const h = normHeader(header);
  return Object.entries(book).filter(([, rows]) => rows.length && rows[0].some(c => normHeader(c) === h));
}

function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) if (v !== '' && v != null && k !== 'id') target[k] = v;
  return target;
}

/* ------------------------------------------------------------- importación por área */

const IMPORTERS = {
  visitas(book) {
    const res = { nuevos: 0, actualizados: 0 };
    const sheets = sheetsWith(book, 'RAZÓN SOCIAL');
    if (!sheets.length) throw new Error('No encuentro la columna RAZÓN SOCIAL');
    const now = new Date().toISOString();
    for (const [, rows] of sheets) {
      for (const o of sheetToObjects(rows, VISITA_COLS, VISITA_ALIAS)) {
        if (!o.razonSocial) continue;
        let l = o.id && leads.find(x => x.id === o.id);
        if (!l) l = leads.find(x => normName(x.razonSocial) === normName(o.razonSocial) && (x.fecha || '') === (o.fecha || '')
          && (x.tipo || '') === (o.tipo || x.tipo || ''));
        if (l) { mergeInto(l, o); l.modificado = now; res.actualizados++; }
        else {
          leads.push(Object.assign({ id: o.id || uid(), creado: now, modificado: now, envio: '', tipo: 'Lead' }, o));
          res.nuevos++;
        }
      }
    }
    store.save('leads', leads);
    syncExcel(true);
    return res;
  },

  vallas(book) {
    const res = { nuevos: 0, actualizados: 0 };
    const sheets = sheetsWith(book, 'CÓDIGO');
    if (!sheets.length) throw new Error('No encuentro la columna CÓDIGO');
    for (const o of sheetToObjects(sheets[0][1], VALLA_COLS)) {
      if (!o.codigo) continue;
      const codigo = normCodigo(o.codigo);
      const actual = VALLAS_DB.find(v => v.codigo === codigo);
      const campos = {};
      for (const k of ['zona', 'municipio', 'provincia', 'direccion', 'medida', 'categoria', 'lat', 'lng']) {
        if (o[k] !== undefined && o[k] !== '') campos[k] = o[k];
      }
      if (actual) {
        const base = Object.assign({}, actual);
        ['_editada', '_nueva'].forEach(k => delete base[k]);
        vallasUser[codigo] = Object.assign(base, campos, { codigo });
        res.actualizados++;
      } else {
        vallasUser[codigo] = Object.assign({ codigo, foto: '' }, campos);
        res.nuevos++;
      }
      if (o.disponibilidad && !contratoActivo(codigo)) {
        const c = o.ocupadaPor && clienteByNombre(o.ocupadaPor);
        if (o.disponibilidad === 'Ocupada' && c) contratoDesdeValla(codigo, c.id, o.ocupadaHasta);
        else if (o.disponibilidad === 'Disponible') delete vallasDispo[codigo];
        else vallasDispo[codigo] = { estado: o.disponibilidad, ocupadaPor: o.ocupadaPor || '', hasta: o.ocupadaHasta || '' };
      }
    }
    saveCatalog();
    saveDispo();
    return res;
  },

  clientes(book) {
    const res = { nuevos: 0, actualizados: 0 };
    const now = new Date().toISOString();
    const cs = sheetsWith(book, 'NOMBRE / RAZÓN SOCIAL');
    if (cs.length) {
      for (const o of sheetToObjects(cs[0][1], CLIENTE_COLS)) {
        if (!o.nombre) continue;
        delete o.vallasActivas; delete o.mensual;
        let c = (o.id && clienteById(o.id)) || clienteByNombre(o.nombre);
        if (c) { mergeInto(c, o); c.modificado = now; res.actualizados++; }
        else { clientes.push(Object.assign({ id: o.id || uid(), creado: now, modificado: now }, o)); res.nuevos++; }
      }
      saveClientes();
    }
    const ct = sheetsWith(book, 'VALLA').find(([, rows]) => rows[0].some(h => normHeader(h) === 'DESDE'));
    if (ct) {
      for (const o of sheetToObjects(ct[1], CONTRATO_COLS)) {
        if (!o.codigo) continue;
        const cli = (o.clienteId && clienteById(o.clienteId)) || clienteByNombre(o.clienteNombre);
        if (!cli) continue;
        const codigo = normCodigo(o.codigo);
        const datos = { clienteId: cli.id, codigo, desde: o.desde || '', hasta: o.hasta || '', precioMes: o.precioMes || '',
          campana: o.campana || '', notas: o.notas || '' };
        let x = (o.id && contratos.find(k => k.id === o.id))
          || contratos.find(k => k.clienteId === cli.id && k.codigo === codigo && (k.desde || '') === datos.desde);
        if (x) { Object.assign(x, datos, { modificado: now }); res.actualizados++; }
        else { contratos.push(Object.assign({ id: o.id || uid(), creado: now }, datos)); res.nuevos++; }
      }
      saveContratos();
    }
    if (!cs.length && !ct) throw new Error('No encuentro las hojas de clientes o contratos');
    return res;
  },

  trabajos(book) {
    const res = { nuevos: 0, actualizados: 0 };
    const sheets = sheetsWith(book, 'TRABAJO / ARTÍCULO').concat(sheetsWith(book, 'TRABAJO'));
    if (!sheets.length) throw new Error('No encuentro la columna TRABAJO');
    const grupos = new Map();
    for (const o of sheetToObjects(sheets[0][1], TR_COLS, { 'TRABAJO': 'tipos' })) {
      const key = o.id || o.num;
      if (!key) continue;
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(o);
    }
    const now = new Date().toISOString();
    for (const filas of grupos.values()) {
      const f = filas[0];
      const venta = (f.clase || 'Trabajo') === 'Venta';
      const num = Number(String(f.num || '').replace(/\D/g, '')) || 0;
      const codigos = [...new Set(filas.map(x => x.codigo).filter(Boolean).map(normCodigo))];
      const datos = {
        clase: venta ? 'Venta' : 'Trabajo', fechaPrevista: f.fechaPrevista || '', prioridad: f.prioridad || 'Normal',
        clienteNombre: f.clienteNombre || '', campana: f.campana || '', material: f.material || '',
        descripcion: f.descripcion || '', asignado: f.asignado || '', estado: f.estado || 'Pendiente',
        fechaHecho: f.fechaHecho || '', obs: f.obs || '',
        tipos: venta ? [] : String(f.tipos || '').split(/\s*\+\s*/).filter(Boolean),
        lineas: venta ? filas.filter(x => x.tipos).map(x => ({ articulo: x.tipos, descripcion: x.artDescripcion || '',
          medida: x.artMedida || '', cantidad: x.artCantidad || '1', precio: x.artPrecio || '' })) : [],
        vallas: codigos.map(code => {
          const v = VALLAS_DB.find(x => x.codigo === code) || filas.find(x => normCodigo(x.codigo) === code) || { codigo: code };
          return { codigo: code, direccion: v.direccion || '', municipio: v.municipio || '', provincia: v.provincia || '',
            zona: v.zona || '', medida: v.medida || '', lat: v.lat == null ? '' : v.lat, lng: v.lng == null ? '' : v.lng, foto: v.foto || '' };
        }),
      };
      const cli = clienteByNombre(datos.clienteNombre);
      datos.clienteId = cli ? cli.id : '';
      if (venta) datos.importe = String(ventaImporte(datos.lineas));
      let t = (f.id && trabajos.find(x => x.id === f.id)) || (num && trabajos.find(x => x.num === num));
      if (t) { Object.assign(t, datos, { modificado: now }); res.actualizados++; }
      else {
        const n = num && !trabajos.some(x => x.num === num) ? num : trabajos.reduce((m, x) => Math.max(m, x.num || 0), 0) + 1;
        trabajos.push(Object.assign({ id: f.id || uid(), num: n, creado: now, modificado: now }, datos));
        res.nuevos++;
      }
    }
    saveTrabajos();
    return res;
  },

  patrimonio(book) {
    const res = { nuevos: 0, actualizados: 0 };
    const sheets = sheetsWith(book, 'PROPIETARIO');
    if (!sheets.length) throw new Error('No encuentro la columna PROPIETARIO');
    const now = new Date().toISOString();
    for (const o of sheetToObjects(sheets[0][1], NEG_COLS)) {
      if (!o.propietario) continue;
      const num = Number(String(o.num || '').replace(/\D/g, '')) || 0;
      delete o.num; delete o.impactos; delete o.totalContrato;
      if (o.vallasCreadas) o.vallasCreadas = String(o.vallasCreadas).split(/[,;\s]+/).filter(Boolean);
      let n = (o.id && negociaciones.find(x => x.id === o.id)) || (num && negociaciones.find(x => x.num === num));
      if (n) { mergeInto(n, o); if (o.vallasCreadas) n.vallasCreadas = o.vallasCreadas; n.modificado = now; res.actualizados++; }
      else {
        const nn = num && !negociaciones.some(x => x.num === num) ? num : negociaciones.reduce((m, x) => Math.max(m, x.num || 0), 0) + 1;
        negociaciones.push(Object.assign({ id: o.id || uid(), num: nn, fecha: todayISO(), fotos: [], vallasCreadas: [],
          estado: 'Contacto inicial', creado: now, modificado: now }, o));
        res.nuevos++;
      }
    }
    saveNegs();
    return res;
  },
};

/* ------------------------------------------------------------- exportación por área */

function clienteRows() {
  return clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(c => {
    const r = clienteResumen(c);
    return Object.assign({}, c, { vallasActivas: r.activos.map(ct => ct.codigo).join(', '), mensual: r.mensual ? String(r.mensual) : '' });
  });
}

function contratoRows() {
  return contratos.map(ct => {
    const c = clienteById(ct.clienteId) || {};
    const v = VALLAS_DB.find(x => x.codigo === ct.codigo) || {};
    return Object.assign({}, ct, { clienteNombre: c.nombre || '', direccion: v.direccion || '', municipio: v.municipio || '',
      lat: v.lat, lng: v.lng, foto: v.foto || '', estado: contratoEstado(ct) });
  }).sort((a, b) => a.clienteNombre.localeCompare(b.clienteNombre, 'es') || (a.desde || '').localeCompare(b.desde || ''));
}

function vallaRows() {
  return VALLAS_DB.map(v => {
    const d = vallaDisponibilidad(v.codigo);
    return Object.assign({}, v, { disponibilidad: d.estado, ocupadaPor: d.cliente || '', ocupadaHasta: d.hasta || '' });
  });
}

const EXPORTERS = {
  visitas(mode) {
    if (!NATIVE) { toast('El Excel solo se genera en la tablet'); return; }
    const fn = mode === 'open' ? 'openExcel' : 'shareExcel';
    const err = window.Android[fn](JSON.stringify(leads), settings.fichero || 'Visitas_Leads');
    if (err) toast('⚠ ' + err);
  },
  vallas(mode) {
    exportBook(`Vallas_${todayISO()}`, 'Vallas', mode, [{ name: 'VALLAS', cols: VALLA_COLS, rows: vallaRows() }]);
  },
  clientes(mode) {
    exportBook(`Clientes_${todayISO()}`, 'Clientes', mode, [
      { name: 'CLIENTES', cols: CLIENTE_COLS, rows: clienteRows() },
      { name: 'CONTRATOS', cols: CONTRATO_COLS, rows: contratoRows() },
    ]);
  },
  trabajos(mode) {
    exportBook(`Trabajos_y_ventas_${todayISO()}`, 'Trabajos', mode,
      [{ name: 'TRABAJOS', cols: TR_COLS, rows: trabajoRows(trabajos.slice().sort((a, b) => a.num - b.num)) }]);
  },
  patrimonio(mode) {
    exportBook(`Patrimonio_${todayISO()}`, 'Patrimonio', mode,
      [{ name: 'NEGOCIACIONES', cols: NEG_COLS, rows: negRows(negociaciones.slice().sort((a, b) => a.num - b.num)) }]);
  },
};

const AREA_INFO = {
  visitas: ['Visitas', 'El Excel de visitas (hoja TODAS y una por semana). También puedes importar tu Excel antiguo de seguimiento semanal.'],
  vallas: ['Vallas', 'El catálogo completo con disponibilidad, cliente, coordenadas y foto.'],
  clientes: ['Clientes', 'Dos hojas: CLIENTES y CONTRATOS (vallas contratadas por cada cliente).'],
  trabajos: ['Trabajos y ventas', 'Todos los trabajos (una fila por valla) y ventas (una fila por artículo).'],
  patrimonio: ['Patrimonio', 'Todas las negociaciones con propietarios.'],
};

let ioArea = '';

function openIo(area) {
  ioArea = area;
  const [titulo, hint] = AREA_INFO[area];
  $('#io-title').textContent = `${titulo}: importar / exportar`;
  $('#io-hint').textContent = hint;
  $('#io-modal').hidden = false;
}

function refrescarArea(area) {
  ({ visitas: renderList, vallas: () => { renderCatFilters(); renderCatalog(); }, clientes: renderClientes,
    trabajos: renderTrabajos, patrimonio: renderNegs })[area]();
}

/* ------------------------------------------------------------- respuestas de Android */

window.onImportBook = function (json) {
  let r;
  try { r = JSON.parse(json); } catch (e) { toast('⚠ Fichero no válido'); return; }
  if (!IMPORTERS[r.area]) { toast('⚠ Este fichero no se puede importar aquí'); return; }
  try {
    const res = IMPORTERS[r.area](r.sheets || {});
    refrescarArea(r.area);
    toast(`Importado: ${res.nuevos} nuevo${res.nuevos === 1 ? '' : 's'} y ${res.actualizados} actualizado${res.actualizados === 1 ? '' : 's'}`);
  } catch (e) {
    toast('⚠ ' + e.message);
  }
};

window.onImportText = function (json) {
  let r;
  try { r = JSON.parse(json); } catch (e) { toast('⚠ Fichero no válido'); return; }
  if (r.area !== 'backup') { toast('⚠ Para importar aquí elige un fichero Excel (.xlsx)'); return; }
  restaurarCopia(r.text, r.name);
};

window.onImportError = function (msg) { toast('⚠ ' + (msg || 'No se pudo importar')); };

/* ------------------------------------------------------------- copia de seguridad completa */

const BACKUP_KEYS = ['leads', 'settings', 'trabajos', 'negociaciones', 'clientes', 'contratos', 'documentos',
  'vallas_user', 'vallas_dispo'];

function exportarCopia() {
  const data = {};
  for (const k of BACKUP_KEYS) data[k] = store.load(k);
  const txt = JSON.stringify({ app: 'VisitasLeads', version: 1, fecha: new Date().toISOString(), data });
  if (!NATIVE) { toast('La copia solo se genera en la tablet'); return; }
  const err = window.Android.saveText('Copias', `Copia_PortoValla_Operadores_${todayISO()}.json`, 'application/json', txt, 'share');
  if (err) toast('⚠ ' + err);
}

function restaurarCopia(text, name) {
  let b;
  try { b = JSON.parse(text); } catch (e) { toast('⚠ La copia no es válida'); return; }
  if (!b || b.app !== 'VisitasLeads' || !b.data) { toast('⚠ Ese fichero no es una copia de PortoValla Operadores'); return; }
  const n = (b.data.leads || []).length;
  if (!confirm(`¿Restaurar la copia ${name || ''} del ${fmtDate((b.fecha || '').slice(0, 10))} (${n} visitas)?\n\nSe sustituirán TODOS los datos actuales de la tablet.`)) return;
  for (const k of BACKUP_KEYS) if (b.data[k] !== undefined && b.data[k] !== null) store.save(k, b.data[k]);
  toast('Copia restaurada. Reiniciando…');
  setTimeout(() => location.reload(), 800);
}

/* ------------------------------------------------------------- eventos */

const clientesHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#io-modal').hidden) { $('#io-modal').hidden = true; return true; }
  return clientesHandleBack();
};

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.io) { openIo(t.dataset.io); return; }
  if (t.dataset.backup === 'export') { exportarCopia(); return; }
  if (t.dataset.backup === 'import') {
    if (NATIVE) window.Android.importFile('backup'); else toast('Solo disponible en la tablet');
    return;
  }
  switch (t.dataset.ioDo) {
    case 'share': $('#io-modal').hidden = true; EXPORTERS[ioArea]('share'); break;
    case 'open': $('#io-modal').hidden = true; EXPORTERS[ioArea]('open'); break;
    case 'import':
      if (NATIVE) window.Android.importFile(ioArea); else toast('Solo disponible en la tablet');
      $('#io-modal').hidden = true;
      break;
    case 'close': $('#io-modal').hidden = true; break;
  }
});
$('#io-modal').addEventListener('click', e => { if (e.target.id === 'io-modal') e.target.hidden = true; });
