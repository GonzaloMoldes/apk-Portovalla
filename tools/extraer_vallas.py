#!/usr/bin/env python3
"""
Extrae las vallas (OOH) de los PDF de catálogo y genera los datos de la app.

Uso:
    python3 tools/extraer_vallas.py "A CORUÑA.pdf" "LUGO.pdf" "PUEBLOS A CORUÑA.pdf"

Por cada página con una valla lee: municipio, dirección, código OOH, medida,
categoría, coordenadas (del enlace "Ver Street View") y la foto. Escribe:

    app/src/main/assets/vallas.js          (window.VALLAS = [...])
    app/src/main/assets/vallas/<OOH>.jpg   (foto de cada valla)

Necesita: poppler-utils (pdftotext, pdftoppm) y `pip install pypdf`.
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

from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
PHOTOS = os.path.join(ASSETS, 'vallas')
DATA = os.path.join(ASSETS, 'vallas.js')

# Zona de la foto en la página (puntos PDF, página de 960x540)
PHOTO_BOX = (0, 30, 638, 474)   # x, y, ancho, alto
PHOTO_DPI = 96

PROVINCIAS = {'AC': 'Coruña', 'LU': 'Lugo', 'PO': 'Pontevedra', 'OU': 'Ourense'}


def header_blocks(pdf, page):
    """Bloques de texto de la cabecera (franja superior), ordenados de izquierda a derecha."""
    out = subprocess.run(['pdftotext', '-bbox-layout', '-f', str(page), '-l', str(page), pdf, '-'],
                         capture_output=True, text=True, check=True).stdout
    blocks = []
    for m in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</block>', out, re.S):
        if float(m.group(2)) < 28:
            words = re.findall(r'>([^<]+)</word>', m.group(3))
            blocks.append((float(m.group(1)), html.unescape(' '.join(words))))
    return [t for _, t in sorted(blocks)]


def parse_header(blocks):
    """[municipio, dirección…, código OOH, medida, categoría]"""
    idx = next((i for i, b in enumerate(blocks) if re.match(r'OOH\s*-?\s*\w+', b, re.I)), None)
    if idx is None or idx < 1:
        return None
    m = re.match(r'OOH\s*-?\s*(\w+)', blocks[idx], re.I)
    muni = blocks[0]
    if ':' not in muni and idx > 1:
        muni = ''
    prov_code, _, municipio = muni.partition(':')
    direccion = ' '.join(blocks[1:idx]) if muni else ' '.join(blocks[:idx])
    num = ''
    nm = re.search(r'_+\s*N[ºo°]\s*(\S*)\s*$', direccion)
    if nm:
        num = nm.group(1)
        direccion = direccion[:nm.start()]
    direccion = re.sub(r'\s+', ' ', direccion.replace('“', '"').replace('”', '"')).strip(' -')
    if num and num != '0':
        direccion += f' (Nº{num})'
    rest = blocks[idx + 1:]
    return {
        'codigo': f'OOH-{m.group(1)}',
        'direccion': direccion,
        'municipio': municipio.strip() or prov_code.strip(),
        'provincia': PROVINCIAS.get(prov_code.strip().upper(), ''),
        'medida': rest[0].strip(' ,') if rest else '',
        'categoria': rest[1].strip() if len(rest) > 1 else '',
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


def render_photo(pdf, page, dest):
    s = PHOTO_DPI / 72.0
    x, y, w, h = PHOTO_BOX
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'p')
        subprocess.run(['pdftoppm', '-jpeg', '-jpegopt', 'quality=72', '-r', str(PHOTO_DPI),
                        '-f', str(page), '-l', str(page), '-singlefile',
                        '-x', str(int(x * s)), '-y', str(int(y * s)),
                        '-W', str(int(w * s)), '-H', str(int(h * s)), pdf, base], check=True)
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
    vallas = {v['codigo']: v for v in load_existing()}
    for pdf in pdfs:
        zona = zona_de(pdf)
        reader = PdfReader(pdf)
        n = 0
        for i, page in enumerate(reader.pages, start=1):
            info = parse_header(header_blocks(pdf, i))
            if not info:
                continue
            lat, lng = page_coords(page)
            info.update({'zona': zona, 'lat': lat, 'lng': lng, 'foto': f"vallas/{info['codigo']}.jpg"})
            render_photo(pdf, i, os.path.join(ASSETS, info['foto']))
            if info['codigo'] in vallas and vallas[info['codigo']].get('zona') != zona:
                print(f"  aviso: {info['codigo']} repetido en {zona} (se sobrescribe)")
            vallas[info['codigo']] = info
            n += 1
        print(f'{zona}: {n} vallas')

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
