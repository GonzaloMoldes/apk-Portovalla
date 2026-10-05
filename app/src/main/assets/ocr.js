'use strict';

/* =========================================================================
 * Interpretación del texto leído (OCR) de una tarjeta de visita.
 * Recibe el texto plano y devuelve los campos que se han podido reconocer.
 * ========================================================================= */

(function (global) {
  const PROVINCIAS = {
    '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila',
    '06': 'Badajoz', '07': 'Baleares', '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres',
    '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'Coruña',
    '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa',
    '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida',
    '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia',
    '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas',
    '36': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria',
    '40': 'Segovia', '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel',
    '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '49': 'Zamora',
    '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
  };

  const GENERIC_DOMAINS = /^(gmail|hotmail|yahoo|outlook|live|msn|icloud|me|telefonica|movistar|terra|ono|orange|vodafone|protonmail|aol|mail|correo|yandex|gmx)$/i;
  const LEGAL = /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?l\.?\s?l\.?|s\.?\s?coop\.?|sociedad|cooperativa|c\.?\s?b\.?|grupo|hermanos|hnos\.?)(\s|$|,)/i;
  const JOB = /\b(gerente|director|directora|dirección|comercial|administraci|administrador|responsable|jefe|jefa|ceo|cfo|cto|manager|t[eé]cnic|ventas|dpto|departamento|socio|socia|propietari|encargad|asesor|consultor|ingenier|arquitect|abogad|delegad|coordinador|presidente|fundador|founder|account|sales|marketing|compras|recepci|secretari|atenci[oó]n)/i;
  const STREET = /\b(c\/|calle|avda|avenida|av\.|r[uú]a|plaza|pza|praza|pol[ií]gono|pol\.|nave|km\.?|ctra|carretera|lugar|parcela|edificio|bajo|planta|piso|local|apdo|apartado|camino|paseo|ronda|travesía|n[ºo°]\s?\d)/i;
  const WEB_LABEL = /^(tel[eé]fono|tel|tlf|tfno|m[oó]vil|movil|m[oó]v|fax|email|e-mail|correo|web|mail|www)\b[\s.:]*/i;

  function cleanLine(s) {
    return s.replace(/[|•·]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }

  function findEmail(text) {
    const norm = text.replace(/\s*@\s*/g, '@').replace(/@([\w-]+)\s*\.\s*/g, '@$1.');
    const m = norm.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0].toLowerCase().replace(/[.,;]+$/, '') : '';
  }

  function findWeb(text) {
    const m = text.match(/\b(?:https?:\/\/)?(www\.[a-z0-9.-]+\.[a-z]{2,})\b/i)
      || text.match(/\b([a-z0-9-]+\.(?:com|es|gal|net|org|eu|cat|info|biz))\b(?![@\w])/i);
    return m ? m[1].toLowerCase() : '';
  }

  /** Devuelve los teléfonos españoles (9 cifras) encontrados, móviles primero. */
  function findPhones(lines) {
    const found = [];
    for (const raw of lines) {
      if (/@/.test(raw)) continue;
      const re = /(?:\+|00)?\s?(?:34)?[\s.\-()]*[6789](?:[\s.\-()]*\d){8}/g;
      let m;
      while ((m = re.exec(raw))) {
        let d = m[0].replace(/\D/g, '');
        if (d.startsWith('0034')) d = d.slice(4);
        else if (d.length === 11 && d.startsWith('34')) d = d.slice(2);
        const before = raw.slice(Math.max(0, m.index - 6), m.index);
        const isFax = /(fax|\bF)\s*[.:]?\s*$/i.test(before);
        if (d.length === 9 && /^[6789]/.test(d) && !found.some(f => f.num === d)) {
          found.push({ num: d, mobile: /^[67]/.test(d), fax: isFax });
        }
      }
    }
    const usable = found.filter(f => !f.fax);
    usable.sort((a, b) => (b.mobile ? 1 : 0) - (a.mobile ? 1 : 0));
    return usable.map(f => f.num.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'));
  }

  function findCity(lines) {
    for (const l of lines) {
      const m = l.match(/\b(\d{5})\b[\s,\-]*([\p{L}][\p{L} .'’-]{1,40})/u);
      if (!m) continue;
      const cp = m[1];
      const prov = PROVINCIAS[cp.slice(0, 2)] || '';
      let city = m[2].replace(/\(.*$/, '').replace(/[-,.\s]+$/, '').trim();
      // "15008 A Coruña - España" → quitar país
      city = city.replace(/\b(españa|spain)\b/ig, '').replace(/[-,.\s]+$/, '').trim();
      if (city) return { cp, poblacion: city.toUpperCase(), provincia: prov, line: l };
    }
    return null;
  }

  function isPersonName(l) {
    if (/\d|@|www\.|\.(com|es)\b/i.test(l)) return false;
    if (JOB.test(l) || STREET.test(l) || LEGAL.test(l)) return false;
    const words = l.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return false;
    return words.every(w => /^[\p{Lu}][\p{L}'’.-]*$/u.test(w) || /^(de|del|la|las|los|y|da|do|dos)$/i.test(w));
  }

  function parseCard(text) {
    const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(l => l.length > 1);
    const res = { razonSocial: '', contacto: '', cargo: '', telefono: '', telefono2: '',
      correo: '', web: '', poblacion: '', provincia: '', lines };

    res.correo = findEmail(text || '');
    res.web = findWeb((text || '').replace(/[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}/ig, ' '));
    const phones = findPhones(lines);
    res.telefono = phones[0] || '';
    res.telefono2 = phones[1] || '';

    const city = findCity(lines);
    if (city) { res.poblacion = city.poblacion; res.provincia = city.provincia; }

    // Líneas "de texto" candidatas (sin datos de contacto ni dirección)
    const textual = lines.filter(l =>
      !/@/.test(l) && !WEB_LABEL.test(l) && !/www\./i.test(l)
      && (l.replace(/\D/g, '').length < 5) && !(city && l === city.line) && !STREET.test(l));

    // Cargo
    const cargoLine = textual.find(l => JOB.test(l) && l.split(/\s+/).length <= 6);
    if (cargoLine) res.cargo = cargoLine;

    // Empresa: 1) forma jurídica; 2) coincide con el dominio; 3) primera línea en mayúsculas
    let company = textual.find(l => LEGAL.test(l));
    const domainSrc = res.correo ? res.correo.split('@')[1] : res.web.replace(/^www\./, '');
    const domainName = domainSrc ? domainSrc.split('.')[0] : '';
    if (!company && domainName && !GENERIC_DOMAINS.test(domainName)) {
      const key = domainName.replace(/[^a-z0-9]/gi, '').toLowerCase();
      company = textual.find(l => {
        const k = l.replace(/[^a-z0-9]/gi, '').toLowerCase();
        return k.length >= 3 && (k.includes(key) || key.includes(k));
      });
      if (!company && key.length >= 3) company = domainName.replace(/-/g, ' ').toUpperCase();
    }
    if (!company) {
      company = textual.find(l => l === l.toUpperCase() && /\p{L}{3,}/u.test(l) && !isPersonName(l) && !JOB.test(l));
    }
    // Persona: nombre propio de 2-4 palabras; preferir la línea junto al cargo
    const people = textual.filter(l => (!company || l.toUpperCase() !== company.toUpperCase()) && isPersonName(l));
    let person = people[0] || '';
    if (cargoLine && people.length > 1) {
      const ci = lines.indexOf(cargoLine);
      person = people.slice().sort((a, b) =>
        Math.abs(lines.indexOf(a) - ci) - Math.abs(lines.indexOf(b) - ci))[0];
    }
    // Si hay dos "nombres" y ninguna empresa, el que no es la persona suele ser la empresa
    if (!company && people.length > 1) company = people.find(l => l !== person);
    res.razonSocial = company ? company.toUpperCase() : '';

    res.contacto = person ? (person === person.toUpperCase() ? titleCase(person) : person) : '';
    return res;
  }

  global.parseCard = parseCard;
  if (typeof module !== 'undefined') module.exports = { parseCard };
})(typeof window !== 'undefined' ? window : globalThis);
