package es.gmvsolutions.visitas;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * PDF de la propuesta de campaña: cabecera, datos del cliente, resumen
 * (periodo, material, precios, total) y una ficha por valla con su foto,
 * dirección, medida, coordenadas y enlace al mapa.
 *
 * Todo el contenido (textos ya formateados) llega preparado desde la app
 * (app.js → budgetDoc); aquí solo se maqueta.
 */
final class BudgetPdf {

    interface Photos {
        Bitmap load(String path);
    }

    private static final int W = 595, H = 842;          // A4 en puntos
    private static final int M = 36;                     // margen
    private static final int PRIMARY = Color.rgb(0x36, 0x5F, 0x99);
    private static final int GOLD = Color.rgb(0xE1, 0xA5, 0x27);
    private static final int MUTED = Color.rgb(0x5F, 0x6F, 0x80);
    private static final int TEXT = Color.rgb(0x1C, 0x27, 0x33);
    private static final int LINE = Color.rgb(0xD4, 0xDC, 0xE5);
    private static final int SOFT = Color.rgb(0xEE, 0xF2, 0xF6);

    private final PdfDocument pdf = new PdfDocument();
    private final Photos photos;
    private PdfDocument.Page page;
    private Canvas c;
    private int pageNo = 0;
    private float y;
    private String footer = "";

    private final Paint title = paint(20, true, Color.WHITE);
    private final Paint subtitle = paint(11, false, Color.WHITE);
    private final Paint h2 = paint(13, true, PRIMARY);
    private final Paint label = paint(9.5f, false, MUTED);
    private final Paint value = paint(10.5f, true, TEXT);
    private final Paint body = paint(10, false, TEXT);
    private final Paint small = paint(8.5f, false, MUTED);
    private final Paint code = paint(13, true, PRIMARY);
    private final Paint price = paint(11, true, PRIMARY);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);

    private BudgetPdf(Photos photos) {
        this.photos = photos;
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(0.8f);
        stroke.setColor(LINE);
    }

    static void write(JSONObject doc, Photos photos, OutputStream out) throws IOException {
        BudgetPdf p = new BudgetPdf(photos);
        try {
            p.render(doc);
            p.finishPage();
            p.pdf.writeTo(out);
        } finally {
            p.pdf.close();
        }
    }

    private static Paint paint(float size, boolean bold, int color) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setTextSize(size);
        p.setColor(color);
        p.setTypeface(Typeface.create(Typeface.SANS_SERIF, bold ? Typeface.BOLD : Typeface.NORMAL));
        return p;
    }

    // ------------------------------------------------------------ páginas

    private void newPage() {
        finishPage();
        pageNo++;
        page = pdf.startPage(new PdfDocument.PageInfo.Builder(W, H, pageNo).create());
        c = page.getCanvas();
        y = M;
    }

    private void finishPage() {
        if (page == null) return;
        c.drawLine(M, H - 30, W - M, H - 30, stroke);
        c.drawText(footer, M, H - 18, small);
        String n = "Página " + pageNo;
        c.drawText(n, W - M - small.measureText(n), H - 18, small);
        pdf.finishPage(page);
        page = null;
    }

    /** Si no caben `h` puntos más, salta de página. */
    private void ensure(float h) {
        if (page == null || y + h > H - 40) newPage();
    }

    // ------------------------------------------------------------ contenido

    private void render(JSONObject doc) {
        footer = doc.optString("pie", "");
        newPage();

        // Cabecera: logo a la izquierda (si lo hay) y título; línea dorada debajo
        Bitmap logo = doc.optString("logo").isEmpty() ? null : photos.load(doc.optString("logo"));
        float tx = M;
        if (logo != null) {
            float lh = 62, lw = lh * logo.getWidth() / logo.getHeight();
            c.drawBitmap(logo, null, new RectF(M, 14, M + lw, 14 + lh), null);
            logo.recycle();
            tx = M + lw + 20;
            title.setColor(PRIMARY);
            subtitle.setColor(MUTED);
        } else {
            fill.setColor(PRIMARY);
            c.drawRect(0, 0, W, 86, fill);
        }
        c.drawText(doc.optString("titulo", "Propuesta de campaña"), tx, 44, title);
        c.drawText(doc.optString("subtitulo", ""), tx, 64, subtitle);
        fill.setColor(GOLD);
        c.drawRect(0, 88, W, 91, fill);
        y = 114;

        // Datos del cliente (2 columnas)
        JSONArray datos = doc.optJSONArray("datos");
        if (datos != null) {
            float colW = (W - 2 * M) / 2f;
            for (int i = 0; i < datos.length(); i += 2) {
                float rowH = 0;
                for (int k = 0; k < 2 && i + k < datos.length(); k++) {
                    JSONArray d = datos.optJSONArray(i + k);
                    if (d == null) continue;
                    float x = M + k * colW;
                    c.drawText(d.optString(0), x, y, label);
                    float h = drawWrapped(d.optString(1), x, y + 14, colW - 12, value, 13);
                    rowH = Math.max(rowH, 14 + h);
                }
                y += rowH + 8;
            }
        }

        // Resumen
        JSONArray resumen = doc.optJSONArray("resumen");
        if (resumen != null && resumen.length() > 0) {
            y += 6;
            float boxTop = y;
            float rowH = 18;
            float boxH = 30 + resumen.length() * rowH + 6;
            ensure(boxH);
            if (y != boxTop) boxTop = y;
            fill.setColor(SOFT);
            c.drawRoundRect(new RectF(M, boxTop, W - M, boxTop + boxH), 8, 8, fill);
            c.drawText(doc.optString("tituloResumen", "Resumen de la campaña"), M + 14, boxTop + 22, h2);
            float ry = boxTop + 42;
            for (int i = 0; i < resumen.length(); i++) {
                JSONArray r = resumen.optJSONArray(i);
                if (r == null) continue;
                boolean last = i == resumen.length() - 1 && doc.optBoolean("ultimoEsTotal", true);
                Paint vp = last ? price : value;
                c.drawText(r.optString(0), M + 14, ry, last ? value : label);
                String v = r.optString(1);
                c.drawText(v, W - M - 14 - vp.measureText(v), ry, vp);
                ry += rowH;
            }
            y = boxTop + boxH + 18;
        }

        // Secciones de detalle: [{titulo, filas: [[etiqueta, valor], …]}]
        JSONArray secciones = doc.optJSONArray("secciones");
        if (secciones != null) {
            for (int i = 0; i < secciones.length(); i++) {
                JSONObject sec = secciones.optJSONObject(i);
                if (sec != null) drawSeccion(sec);
            }
        }

        // Fichas de vallas
        JSONArray vallas = doc.optJSONArray("vallas");
        if (vallas != null && vallas.length() > 0) {
            ensure(30);
            c.drawText(doc.optString("tituloVallas", "Vallas seleccionadas"), M, y + 4, h2);
            y += 16;
            for (int i = 0; i < vallas.length(); i++) {
                JSONObject v = vallas.optJSONObject(i);
                if (v != null) drawValla(v);
            }
        }

        // Artículos (vinilos, lonas, rotulados, estructuras…)
        JSONArray arts = doc.optJSONArray("articulos");
        if (arts != null && arts.length() > 0) drawArticulos(doc.optString("tituloArticulos", "Artículos"), arts);

        // Nota final
        String nota = doc.optString("nota", "");
        if (!nota.isEmpty()) {
            ensure(40);
            y += 6;
            y += drawWrapped(nota, M, y + 10, W - 2 * M, body, 14);
        }

        // Firma de conformidad
        JSONObject firma = doc.optJSONObject("firma");
        if (firma != null) drawFirma(firma);
    }

    /** Sección con título y filas «etiqueta: valor» (el valor ocupa varias líneas si hace falta). */
    private void drawSeccion(JSONObject sec) {
        JSONArray filas = sec.optJSONArray("filas");
        if (filas == null || filas.length() == 0) return;
        final float labelW = 150, valX = M + 10 + labelW, valW = W - M - 10 - valX;
        ensure(60);
        y += 4;
        c.drawText(sec.optString("titulo"), M, y + 4, h2);
        fill.setColor(GOLD);
        c.drawRect(M, y + 10, M + 40, y + 12, fill);
        y += 24;
        for (int i = 0; i < filas.length(); i++) {
            JSONArray f = filas.optJSONArray(i);
            if (f == null) continue;
            String v = f.optString(1);
            if (v.isEmpty()) continue;
            float lh = Math.max(measureWrapped(f.optString(0), labelW - 8, label, 12), measureWrapped(v, valW, value, 13));
            ensure(lh + 8);
            drawWrapped(f.optString(0), M + 10, y + 10, labelW - 8, label, 12);
            drawWrapped(v, valX, y + 10, valW, value, 13);
            y += lh + 6;
            c.drawLine(M + 10, y, W - M - 10, y, stroke);
            y += 4;
        }
        y += 10;
    }

    /** Recuadro de conformidad: texto, firma manuscrita, nombre, DNI y fecha. */
    private void drawFirma(JSONObject f) {
        final float pad = 12, imgW = 240, imgH = 110;
        final float boxW = W - 2 * M;
        String texto = f.optString("texto", "");
        float textH = texto.isEmpty() ? 0 : measureWrapped(texto, boxW - 2 * pad, body, 13) + 6;
        float boxH = 22 + textH + imgH + 54;
        ensure(boxH + 16);
        y += 8;
        float top = y;
        c.drawRoundRect(new RectF(M, top, W - M, top + boxH), 8, 8, stroke);
        c.drawText(f.optString("titulo", "Conformidad"), M + pad, top + 20, h2);
        float ty = top + 34;
        if (!texto.isEmpty()) ty += drawWrapped(texto, M + pad, ty, boxW - 2 * pad, body, 13) + 6;
        RectF dst = new RectF(M + pad, ty, M + pad + imgW, ty + imgH);
        Bitmap bmp = f.optString("imagen").isEmpty() ? null : photos.load(f.optString("imagen"));
        if (bmp != null) {
            float r = Math.min(dst.width() / bmp.getWidth(), dst.height() / bmp.getHeight());
            float w = bmp.getWidth() * r, h = bmp.getHeight() * r;
            c.drawBitmap(bmp, null, new RectF(dst.left, dst.top + (dst.height() - h) / 2, dst.left + w, dst.top + (dst.height() + h) / 2), null);
            bmp.recycle();
        }
        Paint line = new Paint(stroke);
        line.setColor(MUTED);
        c.drawLine(dst.left, dst.bottom + 4, dst.right, dst.bottom + 4, line);
        float ly = dst.bottom + 20;
        c.drawText("Firma de quien recibe", dst.left, ly, small);
        float dx = M + pad + imgW + 24;
        float dy = ty + 14;
        String[][] filas = {{"Nombre", f.optString("nombre")}, {"DNI / NIF", f.optString("dni")}, {"Fecha y hora", f.optString("fecha")}};
        for (String[] fila : filas) {
            if (fila[1].isEmpty()) continue;
            c.drawText(fila[0], dx, dy, label);
            dy += drawWrapped(fila[1], dx, dy + 14, W - M - pad - dx, value, 13) + 20;
        }
        y = top + boxH + 10;
    }

    private void drawValla(JSONObject v) {
        final float photoW = 200, photoH = 150, pad = 10;
        final float textX = M + pad + photoW + 14;
        final float textW = W - M - pad - textX;

        // Medir el texto para saber la altura de la ficha
        List<String> lines = new ArrayList<>();
        JSONArray ls = v.optJSONArray("lineas");
        if (ls != null) for (int i = 0; i < ls.length(); i++) lines.add(ls.optString(i));
        float textH = 18 + measureWrapped(v.optString("direccion"), textW, value, 13) + 4;
        for (String l : lines) textH += measureWrapped(l, textW, body, 13);
        if (!v.optString("mapa").isEmpty()) textH += 4 + measureWrapped(v.optString("mapa"), textW, small, 11);
        if (!v.optString("precio").isEmpty()) textH += 18;
        float cardH = Math.max(photoH, textH) + 2 * pad;

        ensure(cardH + 10);
        float top = y;
        c.drawRoundRect(new RectF(M, top, W - M, top + cardH), 8, 8, stroke);

        // Foto
        RectF dst = new RectF(M + pad, top + pad, M + pad + photoW, top + pad + photoH);
        Bitmap bmp = v.optString("foto").isEmpty() ? null : photos.load(v.optString("foto"));
        if (bmp != null) {
            c.drawBitmap(bmp, centerCrop(bmp, dst.width() / dst.height()), dst, null);
            bmp.recycle();
        } else {
            fill.setColor(SOFT);
            c.drawRect(dst, fill);
            String s = "Sin foto";
            c.drawText(s, dst.centerX() - label.measureText(s) / 2, dst.centerY() + 4, label);
        }

        // Texto
        float ty = top + pad + 12;
        c.drawText(v.optString("codigo"), textX, ty, code);
        ty += 18;
        ty += drawWrapped(v.optString("direccion"), textX, ty, textW, value, 13) + 4;
        for (String l : lines) ty += drawWrapped(l, textX, ty, textW, body, 13);
        if (!v.optString("mapa").isEmpty()) {
            ty += 4;
            ty += drawWrapped(v.optString("mapa"), textX, ty, textW, small, 11);
        }
        if (!v.optString("precio").isEmpty()) {
            ty += 6;
            c.drawText(v.optString("precio"), textX, ty + 6, price);
        }
        y = top + cardH + 10;
    }

    /** Tabla de artículos: concepto (con descripción), medida, cantidad, precio e importe. */
    private void drawArticulos(String titulo, JSONArray arts) {
        final float[] colW = {0, 70, 44, 72, 78};               // la primera ocupa lo que sobra
        float total = 0;
        for (int i = 1; i < colW.length; i++) total += colW[i];
        colW[0] = W - 2 * M - total - 16;
        final String[] heads = {"Artículo", "Medida", "Cant.", "Precio ud.", "Importe"};

        ensure(60);
        y += 6;
        c.drawText(titulo, M, y + 4, h2);
        y += 14;
        // Cabecera de la tabla
        fill.setColor(PRIMARY);
        c.drawRoundRect(new RectF(M, y, W - M, y + 22), 6, 6, fill);
        Paint hp = paint(9.5f, true, Color.WHITE);
        float x = M + 8;
        for (int i = 0; i < heads.length; i++) {
            if (i == 0) c.drawText(heads[i], x, y + 15, hp);
            else c.drawText(heads[i], x + colW[i] - hp.measureText(heads[i]), y + 15, hp);
            x += colW[i];
        }
        y += 26;

        for (int k = 0; k < arts.length(); k++) {
            JSONObject a = arts.optJSONObject(k);
            if (a == null) continue;
            String desc = a.optString("descripcion");
            float h = 16 + measureWrapped(desc, colW[0] - 8, small, 11) + 6;
            ensure(h);
            if (k % 2 == 1) {
                fill.setColor(SOFT);
                c.drawRect(M, y - 2, W - M, y + h - 4, fill);
            }
            x = M + 8;
            c.drawText(a.optString("articulo"), x, y + 11, value);
            drawWrapped(desc, x, y + 25, colW[0] - 8, small, 11);
            x += colW[0];
            String[] vals = {a.optString("medida"), a.optString("cantidad"), a.optString("precio"), a.optString("importe")};
            for (int i = 0; i < vals.length; i++) {
                Paint vp = i == 3 ? price : body;
                c.drawText(vals[i], x + colW[i + 1] - vp.measureText(vals[i]), y + 11, vp);
                x += colW[i + 1];
            }
            y += h;
            c.drawLine(M, y - 4, W - M, y - 4, stroke);
        }
        y += 10;
    }

    /** Recorte centrado de la foto para llenar la caja sin deformarla. */
    private static Rect centerCrop(Bitmap b, float ratio) {
        int w = b.getWidth(), h = b.getHeight();
        if ((float) w / h > ratio) {
            int nw = Math.round(h * ratio);
            int x = (w - nw) / 2;
            return new Rect(x, 0, x + nw, h);
        }
        int nh = Math.round(w / ratio);
        int yy = (h - nh) / 2;
        return new Rect(0, yy, w, yy + nh);
    }

    // ------------------------------------------------------------ texto con saltos de línea

    private List<String> wrap(String text, float maxW, Paint p) {
        List<String> out = new ArrayList<>();
        for (String para : text.split("\n", -1)) {
            String rest = para;
            if (rest.isEmpty()) { out.add(""); continue; }
            while (!rest.isEmpty()) {
                int n = p.breakText(rest, true, maxW, null);
                if (n <= 0) n = 1;
                if (n < rest.length()) {
                    int sp = rest.lastIndexOf(' ', n);
                    if (sp > 0) n = sp;
                }
                out.add(rest.substring(0, n).trim());
                rest = rest.substring(n).trim();
            }
        }
        return out;
    }

    private float measureWrapped(String text, float maxW, Paint p, float lineH) {
        return text.isEmpty() ? 0 : wrap(text, maxW, p).size() * lineH;
    }

    /** Dibuja el texto (y = línea base de la 1ª línea) y devuelve la altura usada. */
    private float drawWrapped(String text, float x, float yy, float maxW, Paint p, float lineH) {
        if (text.isEmpty()) return 0;
        List<String> lines = wrap(text, maxW, p);
        for (int i = 0; i < lines.size(); i++) c.drawText(lines.get(i), x, yy + i * lineH, p);
        return lines.size() * lineH;
    }
}
