#!/usr/bin/env python3
"""
Extrae las vallas (OOH) de los PDF de catálogo y genera los datos de la app.

Uso:
    python3 tools/extraer_vallas.py "A CORUÑA.pdf" "LUGO.pdf" "PUEBLOS A CORUÑA.pdf"

Por cada página con una valla lee: municipio, dirección, código OOH, medida,
categoría, coordenadas (del enlace "Ver Street View") y la foto. Escribe:

    app/src/main/assets/vallas.js          (window.VALLAS = [...])
    app/src/main/assets/vallas/<OOH>.jpg   (foto de cada valla)

Necesita: poppler-utils (pdftotext, pdftoppm) y `pip install pypdf pdfplumber`.
Las vallas que ya existían en vallas.js y no aparecen en los PDF se conservan.
"""
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import pdfplumber
from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
PHOTOS = os.path.join(ASSETS, 'vallas')
DATA = os.path.join(ASSETS, 'vallas.js')
FIXES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'correcciones.json')

PHOTO_DPI = 72
FOOTER_Y = 504      # la franja inferior (pie con "Ver Street View") empieza aquí

PROVINCIAS = {'AC': 'Coruña', 'LU': 'Lugo', 'PO': 'Pontevedra', 'OU': 'Ourense'}


def header_blocks(pdf, page):
    """Bloques de texto de la cabecera (franja superior), ordenados de izquierda a derecha."""
    out = subprocess.run(['pdftotext', '-bbox-layout', '-f', str(page), '-l', str(page), pdf, '-'],
                         capture_output=True, text=True, check=True).stdout
    blocks = []
    for m in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</block>', out, re.S):
        words = [(float(x), html.unescape(t), float(y), float(x2))
                 for x, y, x2, t in re.findall(
                     r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)"[^>]*>([^<]+)</word>', m.group(3))
                 if float(y) < 36]
        if words:
            blocks.append((float(m.group(1)), words))
    return [w for _, w in sorted(blocks, key=lambda b: b[0])]


def address_column(pages_blocks):
    """x más habitual en la que empieza la columna de dirección (2º bloque)."""
    xs = [round(min(w[0] for w in b[1])) for b in pages_blocks if len(b) > 2 and b[1]]
    return max(set(xs), key=xs.count) if xs else None


def parse_header(blocks, addr_x):
    """Asigna cada palabra de la cabecera a su columna por posición:
    municipio | dirección (puede ocupar 2 líneas) | OOH-código | medida | categoría."""
    words = sorted((w for b in blocks for w in b), key=lambda w: w[0])
    line_of = [round(w[2] / 6) for w in words]   # misma línea si la y es parecida
    ooh = next((k for k, (_, t, _y, _x2) in enumerate(words) if re.match(r'OOH', t, re.I)), None)
    if ooh is None:
        return None
    code_x = words[ooh][0]
    code_txt = words[ooh][1]
    code_words = {ooh}
    if re.fullmatch(r'OOH-?', code_txt, re.I) and ooh + 1 < len(words):
        code_txt += words[ooh + 1][1]
        code_words.add(ooh + 1)
    m = re.match(r'OOH-?(\w+)', code_txt.replace(' ', ''), re.I)
    if not m:
        return None
    if addr_x is None:
        addr_x = 105
    by_line = lambda k: (line_of[k], words[k][0])
    muni_idx = sorted((k for k, w in enumerate(words) if w[0] < addr_x - 3), key=by_line)
    addr_idx = [k for k, w in enumerate(words) if addr_x - 3 <= w[0] < code_x and k not in code_words]
    # Si la dirección empieza antes de su columna, se separa del municipio por el hueco entre palabras
    for j in range(1, len(muni_idx)):
        a, b = muni_idx[j - 1], muni_idx[j]
        if line_of[a] == line_of[b] and words[b][0] - words[a][3] > 12:
            addr_idx += [k for k in muni_idx[j:] if line_of[k] == line_of[b]]
            muni_idx = [k for k in muni_idx if k not in addr_idx]
            break
    addr_idx.sort(key=by_line)
    muni = ' '.join(words[k][1] for k in muni_idx)
    direccion = ' '.join(words[k][1] for k in addr_idx)
    after = [(w[0], w[1]) for k, w in enumerate(words) if w[0] > code_x and k not in code_words]
    medida = ' '.join(t for x, t in after if x < 880)
    categoria = ' '.join(t for x, t in after if x >= 880)

    prov_code, _, municipio = muni.partition(':')
    num = ''
    nm = re.search(r'_+\s*N[ºo°]\s*(\S*)\s*$', direccion)
    if nm:
        num = nm.group(1)
        direccion = direccion[:nm.start()]
    direccion = re.sub(r'\s+', ' ', direccion.replace('“', '"').replace('”', '"')).strip(' -')
    if num and num != '0':
        direccion += f' (Nº{num})'
    return {
        'codigo': f'OOH-{m.group(1)}',
        'direccion': direccion,
        'municipio': municipio.strip() or prov_code.strip(),
        'provincia': PROVINCIAS.get(prov_code.strip().upper(), ''),
        'medida': medida.strip(' ,'),
        'categoria': categoria.strip(),
    }


def page_coords(page):
    for a in page.get('/Annots') or []:
        uri = str(a.get_object().get('/A', {}).get('/URI', ''))
        m = re.search(r'cbll=\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)', uri.replace('%20', ' '))
        if m:
            return round(float(m.group(1)), 6), round(float(m.group(2)), 6)
        m = re.search(r'[@=](-?\d+\.\d+),\s*(-?\d+\.\d+)', uri.replace('%20', ' '))
        if m:
            return round(float(m.group(1)), 6), round(float(m.group(2)), 6)
    return None, None


def photo_box(plumber_page):
    """Caja (x, y, ancho, alto) de la foto de la valla, o None si la página no tiene foto."""
    best = None
    for im in plumber_page.images:
        top, bottom = im['top'], min(im['bottom'], FOOTER_Y)
        w, h = im['x1'] - im['x0'], bottom - top
        if top < 200 and w > 300 and h > 200 and (best is None or w * h > best[2] * best[3]):
            best = (im['x0'], top, w, h)
    return best


def render_photo(pdf, page, box, dest):
    s = PHOTO_DPI / 72.0
    x, y, w, h = box
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'p')
        subprocess.run(['pdftoppm', '-jpeg', '-jpegopt', 'quality=68', '-r', str(PHOTO_DPI),
                        '-f', str(page), '-l', str(page), '-singlefile',
                        '-x', str(int(x * s)), '-y', str(int(y * s) + 1),
                        '-W', str(int(w * s)), '-H', str(int(h * s) - 2), pdf, base], check=True)
        os.replace(base + '.jpg', dest)


def zona_de(pdf):
    name = os.path.splitext(os.path.basename(pdf))[0]
    name = re.sub(r'(?i)[_ -]*compressed$', '', name)
    name = re.sub(r'^[0-9a-f]{8}-', '', name)        # prefijo de subida
    return name.replace('_', ' ').strip().upper()


def load_existing():
    if not os.path.exists(DATA):
        return []
    txt = open(DATA, encoding='utf-8').read()
    m = re.search(r'=\s*(\[.*\])\s*;', txt, re.S)
    return json.loads(m.group(1)) if m else []


def main(pdfs):
    os.makedirs(PHOTOS, exist_ok=True)
    fixes = json.load(open(FIXES, encoding='utf-8')) if os.path.exists(FIXES) else {}
    vallas = {v['codigo']: v for v in load_existing()}
    for pdf in pdfs:
        zona = zona_de(pdf)
        reader = PdfReader(pdf)
        plumber = pdfplumber.open(pdf)
        n = 0
        sin_foto = []
        vistos = {}
        heads = [header_blocks(pdf, i) for i in range(1, len(reader.pages) + 1)]
        addr_x = address_column(heads)
        for i, page in enumerate(reader.pages, start=1):
            info = parse_header(heads[i - 1], addr_x)
            if not info:
                continue
            fix = fixes.get(zona, {}).get(str(i))
            if fix:
                print(f"  corrección pág. {i}: {info['codigo']} → {fix.get('codigo', info['codigo'])}")
                info.update(fix)
            lat, lng = page_coords(page)
            info.update({'zona': zona, 'lat': lat, 'lng': lng, 'foto': ''})
            box = photo_box(plumber.pages[i - 1])
            dest = os.path.join(PHOTOS, info['codigo'] + '.jpg')
            if box:
                info['foto'] = f"vallas/{info['codigo']}.jpg"
                render_photo(pdf, i, box, dest)
            else:
                sin_foto.append(info['codigo'])
                if os.path.exists(dest):
                    os.remove(dest)
            if info['codigo'] in vistos:
                print(f"  aviso: {info['codigo']} repetido (págs. {vistos[info['codigo']]} y {i}); se queda la última")
            vistos[info['codigo']] = i
            vallas[info['codigo']] = info
            n += 1
        plumber.close()
        print(f'{zona}: {n} vallas' + (f" ({len(sin_foto)} sin foto en el PDF: {', '.join(sin_foto)})" if sin_foto else ''))

    lista = sorted(vallas.values(), key=lambda v: (v['zona'], v['municipio'], v['direccion']))
    with open(DATA, 'w', encoding='utf-8') as f:
        f.write('// Generado por tools/extraer_vallas.py — no editar a mano\n')
        f.write('window.VALLAS = ')
        json.dump(lista, f, ensure_ascii=False, indent=1)
        f.write(';\n')
    print(f'Total: {len(lista)} vallas → {os.path.relpath(DATA, ROOT)}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
