/* PortoValla Operadores · lectura de tickets de gasto (texto del OCR → datos)
   Reconstruye las filas del ticket a partir de la posición de cada línea leída
   (el OCR suele separar «TOTAL» y «45,30» aunque estén en la misma fila) y busca:
   nombre del local, razón social, CIF, dirección, fecha, total, IVA, base, litros,
   matrícula, forma de pago y tipo de gasto (combustible / comida…). */

const TICKET_TIPOS = ['Combustible', 'Comida', 'Parking / peaje', 'Alojamiento', 'Otro'];

/** Filas del ticket: agrupa las líneas del OCR por altura y las ordena de izquierda a derecha. */
function ticketRows(r) {
  const lines = (r.lines || []).filter(l => l.t && l.y != null);
  if (!lines.length) return String(r.text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const hs = lines.map(l => l.h || 0).filter(Boolean).sort((a, b) => a - b);
  const hMed = hs.length ? hs[Math.floor(hs.length / 2)] : 20;
  const sorted = lines.map(l => Object.assign({ cy: l.y + (l.h || hMed) / 2 }, l)).sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const l of sorted) {
    const row = rows.find(rw => Math.abs(rw.cy - l.cy) < hMed * 0.55);
    if (row) { row.items.push(l); row.cy = (row.cy * (row.items.length - 1) + l.cy) / row.items.length; }
    else rows.push({ cy: l.cy, items: [l] });
  }
  return rows.sort((a, b) => a.cy - b.cy)
    .map(rw => rw.items.sort((a, b) => (a.x || 0) - (b.x || 0)).map(i => i.t.trim()).join('  '));
}

/** "1.234,56" / "1,234.56" / "45,30" / "45.30" → número */
function ticketNum(s) {
  let v = String(s).replace(/\s/g, '');
  const c = v.lastIndexOf(','), d = v.lastIndexOf('.');
  if (c >= 0 && d >= 0) v = c > d ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (c >= 0) v = v.replace(',', '.');
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

const RE_FECHA = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/;
const RE_HORA = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/** Importes de una fila (sin fechas, horas, teléfonos ni porcentajes). */
function ticketAmounts(row) {
  const limpio = row.replace(new RegExp(RE_FECHA.source, 'g'), ' ').replace(RE_HORA, ' ')
    .replace(/\b\d{9,}\b/g, ' ').replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');
  const out = [];
  const re = /(?:^|[^\d.,])(-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+[.,]\d{2})(?![\d.,]*\d)/g;
  let m;
  while ((m = re.exec(limpio))) out.push(ticketNum(m[1]));
  return out;
}

function ticketFecha(rows) {
  for (const row of rows) {
    const m = row.match(RE_FECHA);
    if (!m) continue;
    let [, d, mo, y] = m;
    if (Number(mo) > 12 || Number(d) > 31 || Number(d) < 1 || Number(mo) < 1) continue;
    if (y.length === 2) y = '20' + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

const RE_CIF = [/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/, /^\d{8}[A-Z]$/, /^[XYZ]\d{7}[A-Z]$/];

/** Posibles CIF/NIF de una fila: cada palabra (sin puntos ni guiones) y cada par de palabras seguidas. */
function cifTokens(row) {
  const t = row.toUpperCase().replace(/C\.?\s?I\.?\s?F\.?|N\.?\s?I\.?\s?F\.?|:/g, ' ').split(/\s+/).map(x => x.replace(/[.\-]/g, '')).filter(Boolean);
  const out = [];
  t.forEach((x, i) => { out.push(x); if (t[i + 1]) out.push(x + t[i + 1]); });
  return out;
}

function ticketCif(rows) {
  const conClave = rows.filter(r => /C\.?\s?I\.?\s?F|N\.?\s?I\.?\s?F/i.test(r));
  for (const grupo of [conClave, rows]) {
    for (const row of grupo) {
      for (const p of RE_CIF) { const m = cifTokens(row).find(x => p.test(x)); if (m) return m; }
    }
  }
  return '';
}

const RE_DIR = /(?:^|\s)(C\/|C\.\s|CL\.?\s|CALLE|AVDA|AV\.|AVENIDA|R[UÚ]A|CTRA|CARRETERA|PLAZA|PZA|PRAZA|LUGAR|LG\.|POL[IÍ]GONO|POL\.|PASEO|P[º°]|CAMI[NÑ]O|ESTRADA|BARRIO|URB\.?|AUTOV[IÍ]A|A-\d|AP-\d|N-\d+|KM\.?\s*\d)/i;
const RE_CP = /\b(\d{5})\b/;

/** Fila de dirección: empieza por calle/avenida/… o lo lleva junto a un número o código postal. */
function esDireccion(row) {
  const t = row.trim();
  return new RegExp('^' + RE_DIR.source.replace('(?:^|\\s)', ''), 'i').test(t) || (RE_DIR.test(t) && /\d/.test(t));
}

function ticketDireccion(rows) {
  const top = rows.slice(0, 14);
  for (let i = 0; i < top.length; i++) {
    if (!esDireccion(top[i]) || /TOTAL|IVA|EUR|ENTRADA|SALIDA/i.test(top[i])) continue;
    let dir = top[i].replace(/^(DIRECCI[OÓ]N|DIR\.?)\s*:?\s*/i, '');
    const next = top[i + 1] || '';
    if (!RE_CP.test(dir) && RE_CP.test(next) && !/TEL|TLF|CIF|NIF/i.test(next)) dir += ', ' + next;
    return dir.replace(/\s{2,}/g, ' ').trim();
  }
  const cp = top.find(r => RE_CP.test(r) && /[A-ZÁÉÍÓÚÑ]{3}/i.test(r) && !/TEL|TLF|CIF|NIF|TOTAL|FACT/i.test(r));
  return cp ? cp.replace(/\s{2,}/g, ' ').trim() : '';
}

const RE_NO_NOMBRE = /C\.?I\.?F|N\.?I\.?F|TEL|TLF|FAX|FACTURA|TICKET|SIMPLIFICADA|BIENVENID|WELCOME|GRACIAS|FECHA|HORA|CAJA|MESA|ATENDID|^\W*$|WWW\.|@|HTTP/i;

function ticketNombres(rows) {
  // Sin el CIF que a veces va en la misma fila que la razón social
  const top = rows.slice(0, 8).map(r => r.split(/\s+/).filter(w => !RE_CIF.some(p => p.test(w.toUpperCase().replace(/[.\-]/g, '')))).join(' '));
  const candidatos = top.filter(r => !RE_NO_NOMBRE.test(r) && !esDireccion(r) && !RE_FECHA.test(r)
    && (r.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length >= 3 && !/\d[.,]\d{2}\b/.test(r));
  const esEmpresa = r => /\b(S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?\s?U?\.?|S\.?\s?COOP|SOCIEDAD|LIMITADA|C\.?\s?B\.?)\s*$/i.test(r.trim());
  const empresa = top.find(r => esEmpresa(r) && !RE_NO_NOMBRE.test(r)) || '';
  const nombre = candidatos.find(r => r !== empresa) || empresa;
  const limpia = s => s.replace(/\s{2,}/g, ' ').trim();
  return { nombre: limpia(nombre), empresa: limpia(empresa !== nombre ? empresa : '') };
}

function ticketTotal(rows) {
  const busca = (re, no) => {
    const out = [];
    rows.forEach((row, i) => {
      if (!re.test(row) || (no && no.test(row))) return;
      let a = ticketAmounts(row);
      if (!a.length && rows[i + 1]) a = ticketAmounts(rows[i + 1]);
      if (a.length) out.push(a[a.length - 1]);
    });
    return out.filter(x => x > 0 && x < 20000);
  };
  const niveles = [
    busca(/\bTOTAL\b|\bTOTAL[:.]/i, /SUB\s*-?\s*TOTAL|TOTAL\s*(IVA|I\.V\.A|BASE|DTO|DESC|LITROS|PUNTOS|ART|UNID|CUOTA)/i),
    busca(/A\s*PAGAR|IMPORTE\s*(TOTAL|EUR|€)?\b|TOTAL\s*EUR|\bEUROS?\b/i, /UNIT|PRECIO|BASE|CUOTA/i),
    busca(/TARJETA|VISA|MASTER\s*CARD|CONTACTLESS|D[EÉ]BITO|CR[EÉ]DITO/i),
    busca(/EFECTIVO|PAGADO|ENTREGADO|CONTADO/i, /CAMBIO|DEVOLU/i),
  ];
  for (const n of niveles) if (n.length) return Math.max(...n);
  const todos = rows.flatMap(ticketAmounts).filter(x => x > 0 && x < 20000);
  return todos.length ? Math.max(...todos) : 0;
}

/** IVA: tipo (%), cuota y base. Si no aparece la cuota, se calcula a partir del total. */
function ticketIva(rows, total, tipoGasto) {
  const pctRe = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g;
  const filasIva = rows.filter(r => /I\.?\s?V\.?\s?A|IMPUESTO|CUOTA|\bVAT\b/i.test(r) || /\b(21|10|4|5)(?:[.,]0{1,2})?\s*%/.test(r));
  let pct = 0;
  for (const r of filasIva) {
    let m;
    pctRe.lastIndex = 0;
    while ((m = pctRe.exec(r))) {
      const v = ticketNum(m[1]);
      if ([21, 10, 4, 5].includes(v)) { pct = v; break; }
    }
    if (pct) break;
  }
  if (!pct) pct = tipoGasto === 'Combustible' ? 21 : tipoGasto === 'Comida' ? 10 : tipoGasto === 'Alojamiento' ? 10 : 0;
  if (!total) return { pct: pct ? String(pct) : '', iva: 0, base: 0 };
  const esperado = pct ? total * pct / (100 + pct) : 0;
  let iva = 0;
  if (pct) {
    const cands = filasIva.flatMap(ticketAmounts).filter(x => x > 0 && x < total);
    const ok = cands.filter(x => Math.abs(x - esperado) <= Math.max(0.06, esperado * 0.02));
    iva = ok.length ? ok.sort((a, b) => Math.abs(a - esperado) - Math.abs(b - esperado))[0] : Math.round(esperado * 100) / 100;
  }
  return { pct: pct ? String(pct) : '', iva, base: Math.round((total - iva) * 100) / 100 };
}

const RE_COMBUSTIBLE = /GASOLEO|GASÓLEO|DIESEL|DI[EÉ]SEL|GASOLINA|SIN\s*PLOMO|S\/PLOMO|\bSP\s?9[58]\b|EFITEC|ADBLUE|AD\s?BLUE|LITROS|\bLTS?\b|€\s*\/\s*L|EUR\s*\/\s*L|REPSOL|CEPSA|MOEVE|GALP|\bSHELL\b|\bBP\b|PETRONOR|\bAVIA\b|BALLENOIL|PLENOIL|PETROPRIX|CARREFOUR\s*GAS|ESTACI[OÓ]N\s*DE\s*SERVICIO/i;
const RE_COMIDA = /RESTAURANTE|MES[OÓ]N|TABERNA|CAFETER[IÍ]A|\bBAR\b|CAFE\b|CAFÉ|MEN[UÚ]|COMENSAL|PULPER[IÍ]A|PIZZER[IÍ]A|BOCADILLO|RACI[OÓ]N|CA[NÑ]A|CERVEZA|AGUA\s*MINERAL|POSTRE|\bMESA\b|BRASER[IÍ]A|MARISQUER[IÍ]A|HAMBURGUES/i;
const RE_PARKING = /PARKING|APARCAMIENTO|ESTACIONAMIENTO|\bORA\b|PEAJE|AUTOPISTA|AUDASA|AUTOESTRADA|TOLL/i;
const RE_HOTEL = /HOTEL|HOSTAL|PENSI[OÓ]N|ALOJAMIENTO|HABITACI[OÓ]N|NOCHE/i;

function ticketTipo(texto) {
  if (RE_COMBUSTIBLE.test(texto)) return 'Combustible';
  if (RE_PARKING.test(texto)) return 'Parking / peaje';
  if (RE_HOTEL.test(texto)) return 'Alojamiento';
  if (RE_COMIDA.test(texto)) return 'Comida';
  return '';
}

function ticketLitros(rows) {
  for (const r of rows) {
    let m = r.match(/(\d{1,3}[.,]\d{1,3})\s*(?:L\b|LTS?\b|LITROS|LT\.)/i) || r.match(/LITROS\s*:?\s*(\d{1,3}[.,]\d{1,3})/i)
      || r.match(/VOLUMEN\s*:?\s*(\d{1,3}[.,]\d{1,3})/i);
    if (m) { const v = ticketNum(m[1]); if (v > 0 && v < 500) return v; }
  }
  return 0;
}

function ticketPrecioLitro(rows) {
  for (const r of rows) {
    const m = r.match(/(\d[.,]\d{3})\s*(?:€|EUR)?\s*\/\s*L/i) || r.match(/PRECIO\s*(?:\/\s*L|LITRO)\s*:?\s*(\d[.,]\d{2,3})/i);
    if (m) return ticketNum(m[1]);
  }
  return 0;
}

/** Datos del ticket a partir del resultado del OCR ({text, lines}). */
function parseTicket(r) {
  const rows = ticketRows(r);
  const texto = rows.join('\n');
  const tipo = ticketTipo(texto);
  const total = ticketTotal(rows);
  const iva = ticketIva(rows, total, tipo);
  const nombres = ticketNombres(rows);
  let litros = tipo === 'Combustible' ? ticketLitros(rows) : 0;
  const pl = tipo === 'Combustible' ? ticketPrecioLitro(rows) : 0;
  if (!litros && pl && total) litros = Math.round(total / pl * 100) / 100;
  const mat = texto.toUpperCase().match(/\b(\d{4})\s?-?([BCDFGHJKLMNPRSTVWXYZ]{3})\b/);
  const fmt = n => (n ? String(n.toFixed(2)).replace('.', ',') : '');
  return {
    tipo,
    fecha: ticketFecha(rows),
    local: nombres.nombre,
    empresa: nombres.empresa,
    cif: ticketCif(rows),
    direccion: ticketDireccion(rows),
    total: fmt(total),
    base: fmt(iva.base),
    ivaPct: iva.pct,
    iva: fmt(iva.iva),
    litros: litros ? String(litros).replace('.', ',') : '',
    precioLitro: pl ? String(pl).replace('.', ',') : '',
    matricula: mat ? `${mat[1]} ${mat[2]}` : '',
    pago: /TARJETA|VISA|MASTER\s*CARD|CONTACTLESS|D[EÉ]BITO|CR[EÉ]DITO/i.test(texto) ? 'Tarjeta'
      : /EFECTIVO|CONTADO/i.test(texto) ? 'Efectivo' : '',
    texto,
  };
}

if (typeof module !== 'undefined') module.exports = { parseTicket, ticketRows, ticketAmounts };
