package es.gmvsolutions.visitas;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Generador mínimo de ficheros .xlsx (Office Open XML) sin dependencias.
 *
 * Reproduce el modelo de seguimiento semanal: una hoja "TODAS" con todas las
 * visitas y una hoja por semana ("1º JUNIO", "2º JUNIO"...), con las mismas
 * columnas y desplegables que la plantilla original.
 */
public final class XlsxWriter {

    private XlsxWriter() {}

    private static final String[] MESES = {
        "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
        "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
    };

    private enum Kind { TEXT, WRAP, DATE, MONEY, PERCENT, COORD, LINK, PHOTO, NUMBER }

    private static final class Col {
        final String header; final String key; final Kind kind; final double width;
        String list;   // valores del desplegable (opcional), separados por comas
        Col withList(String values) { this.list = values; return this; }
        Col(String header, String key, Kind kind, double width) {
            this.header = header; this.key = key; this.kind = kind; this.width = width;
        }
    }

    private static final Col[] COLS = {
        new Col("CLIENTE LLAMADAS VISITA PROPIETARIO", "tipo", Kind.TEXT, 20)
                .withList("Visita Patrimonio,Lead,Propietario,Cliente"),
        new Col("PVS", "pvs", Kind.TEXT, 8),
        new Col("FECHA", "fecha", Kind.DATE, 12),
        new Col("FECHA FIRMA", "fechaFirma", Kind.DATE, 12),
        new Col("RAZÓN SOCIAL", "razonSocial", Kind.TEXT, 30),
        new Col("PERSONA CONTACTO", "contacto", Kind.TEXT, 22),
        new Col("TELÉFONO", "telefono", Kind.TEXT, 14),
        new Col("POBLACIÓN", "poblacion", Kind.TEXT, 14),
        new Col("PROVINCIA", "provincia", Kind.TEXT, 12).withList("Coruña,Lugo"),
        new Col("CORREO", "correo", Kind.TEXT, 28),
        new Col("SITUACIÓN", "situacion", Kind.WRAP, 40),
        new Col("PVP ENTRADA SIN IVA", "pvpEntrada", Kind.MONEY, 14),
        new Col("PVP TOTAL SIN IVA", "pvpTotal", Kind.MONEY, 14),
        new Col("VOLVER (SI/NO)", "volver", Kind.TEXT, 10).withList("Si,No"),
        new Col("%", "porcentaje", Kind.PERCENT, 8).withList("25%,50%,75%,100%"),
        new Col("FECHA DE TRABAJO REALIZADO", "fechaTrabajo", Kind.DATE, 14),
        new Col("SEGUIMIENTO ENVIADO", "envio", Kind.TEXT, 22),
        new Col("FOTO", "foto", Kind.PHOTO, 26),
        new Col("ID", "id", Kind.TEXT, 14),
    };

    // Índices de estilo (cellXfs en styles.xml)
    private static final int S_HEADER = 1, S_TEXT = 2, S_DATE = 3, S_PCT = 4, S_MONEY = 5, S_WRAP = 6,
            S_COORD = 7, S_LINK = 8;

    private static final LocalDate EXCEL_EPOCH = LocalDate.of(1899, 12, 30);

    /** Devuelve los bytes JPEG de una foto (ruta tal como viene en el dato) o null. */
    public interface PhotoSource {
        byte[] load(String path);
    }

    /** Hoja ya generada, lista para meter en el zip. */
    private static final class Sheet {
        final String name; final String xml; final String filterRef; final Drawing drawing;
        Sheet(String name, String xml, String filterRef, Drawing drawing) {
            this.name = name; this.xml = xml; this.filterRef = filterRef; this.drawing = drawing;
        }
    }

    /** Fotos incrustadas en una hoja. */
    private static final class Drawing {
        final StringBuilder anchors = new StringBuilder();
        final List<String> mediaNames = new ArrayList<>();   // rIdN → media
        final List<String> mediaPaths = new ArrayList<>();   // ruta original de cada media
        int pics = 0;
    }

    public static void write(List<Map<String, String>> leads, OutputStream out) throws IOException {
        write(leads, new ArrayList<>(), null, out);
    }

    /**
     * Escribe el libro completo. Cada visita es un mapa clave → valor (texto).
     * budgets: una fila por valla presupuestada (datos de la visita + valla + campaña).
     */
    public static void write(List<Map<String, String>> leads, List<Map<String, String>> budgets,
                             PhotoSource photos, OutputStream out) throws IOException {
        List<Map<String, String>> sorted = new ArrayList<>(leads);
        sorted.sort(Comparator
                .comparing((Map<String, String> m) -> parseDate(m.get("fecha")) == null)
                .thenComparing(m -> nz(m.get("fecha")))
                .thenComparing(m -> nz(m.get("creado"))));

        // Agrupar por semana (lunes) en orden cronológico
        TreeMap<LocalDate, List<Map<String, String>>> weeks = new TreeMap<>();
        Set<Integer> years = new HashSet<>();
        List<Map<String, String>> sinFecha = new ArrayList<>();
        for (Map<String, String> m : sorted) {
            LocalDate d = parseDate(m.get("fecha"));
            if (d == null) { sinFecha.add(m); continue; }
            LocalDate monday = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            weeks.computeIfAbsent(monday, k -> new ArrayList<>()).add(m);
            years.add(monday.getYear());
        }

        LinkedHashMap<String, List<Map<String, String>>> groups = new LinkedHashMap<>();
        groups.put("TODAS", sorted);
        boolean multiYear = years.size() > 1;
        for (Map.Entry<LocalDate, List<Map<String, String>>> e : weeks.entrySet()) {
            groups.put(weekName(e.getKey(), multiYear), e.getValue());
        }
        if (!sinFecha.isEmpty()) groups.put("SIN FECHA", sinFecha);

        List<Sheet> sheets = new ArrayList<>();
        String lastCol = colName(COLS.length - 1);
        boolean first = true;
        for (Map.Entry<String, List<Map<String, String>>> e : groups.entrySet()) {
            Drawing mainDr = new Drawing();
            String mainXml = tableSheet(e.getValue(), COLS, photos, mainDr);
            sheets.add(new Sheet(e.getKey(), mainXml,
                    "$A$1:$" + lastCol + "$" + Math.max(1, e.getValue().size() + 1), mainDr.pics > 0 ? mainDr : null));
            if (first && budgets != null && !budgets.isEmpty()) {
                // La hoja de presupuestos va justo detrás de TODAS
                Drawing dr = new Drawing();
                String xml = tableSheet(budgets, BCOLS, photos, dr);
                sheets.add(new Sheet("PRESUPUESTOS", xml, "$A$1:$" + colName(BCOLS.length - 1)
                        + "$" + (budgets.size() + 1), dr.pics > 0 ? dr : null));
            }
            first = false;
        }

        zipWorkbook(sheets, photos, out);
    }

    /** Hoja definida desde fuera: columnas {cabecera, clave, tipo, ancho, desplegable} y filas. */
    public static final class SheetDef {
        public final String name;
        public final List<String[]> cols;
        public final List<Map<String, String>> rows;
        public SheetDef(String name, List<String[]> cols, List<Map<String, String>> rows) {
            this.name = name; this.cols = cols; this.rows = rows;
        }
    }

    /** Libro con varias hojas definidas por la app (clientes, vallas, trabajos…), con fotos. */
    public static void writeBook(List<SheetDef> defs, PhotoSource photos, OutputStream out) throws IOException {
        List<Sheet> sheets = new ArrayList<>();
        for (SheetDef def : defs) {
            Col[] cols = new Col[def.cols.size()];
            for (int i = 0; i < cols.length; i++) {
                String[] c = def.cols.get(i);
                Kind kind;
                try {
                    kind = Kind.valueOf(c.length > 2 && c[2] != null ? c[2].toUpperCase() : "TEXT");
                } catch (IllegalArgumentException e) {
                    kind = Kind.TEXT;
                }
                double width = 14;
                try { if (c.length > 3 && c[3] != null) width = Double.parseDouble(c[3]); } catch (NumberFormatException ignored) { }
                cols[i] = new Col(c[0], c[1], kind, width);
                if (c.length > 4 && c[4] != null && !c[4].isEmpty()) cols[i].withList(c[4]);
            }
            Drawing dr = new Drawing();
            String xml = tableSheet(def.rows, cols, photos, dr);
            sheets.add(new Sheet(def.name, xml, "$A$1:$" + colName(Math.max(0, cols.length - 1)) + "$" + (def.rows.size() + 1),
                    dr.pics > 0 ? dr : null));
        }
        zipWorkbook(sheets, photos, out);
    }

    private static void zipWorkbook(List<Sheet> sheets, PhotoSource photos, OutputStream out) throws IOException {
        ZipOutputStream zip = new ZipOutputStream(out);
        int drawings = 0;
        for (Sheet sh : sheets) if (sh.drawing != null) drawings++;

        put(zip, "[Content_Types].xml", contentTypes(sheets.size(), drawings));
        put(zip, "_rels/.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                + "</Relationships>");
        put(zip, "xl/workbook.xml", workbook(sheets));
        put(zip, "xl/_rels/workbook.xml.rels", workbookRels(sheets.size()));
        put(zip, "xl/styles.xml", STYLES);
        int i = 1;
        int d = 1;
        Map<String, String> media = new LinkedHashMap<>();   // nombre en el zip → ruta de la foto
        for (Sheet sh : sheets) {
            put(zip, "xl/worksheets/sheet" + i + ".xml", sh.xml);
            if (sh.drawing != null) {
                put(zip, "xl/worksheets/_rels/sheet" + i + ".xml.rels",
                        rels("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing" + d + ".xml\"/>"));
                put(zip, "xl/drawings/drawing" + d + ".xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                        + "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" "
                        + "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
                        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                        + sh.drawing.anchors + "</xdr:wsDr>");
                StringBuilder dr = new StringBuilder();
                for (int k = 0; k < sh.drawing.mediaNames.size(); k++) {
                    dr.append("<Relationship Id=\"rId").append(k + 1)
                      .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/")
                      .append(sh.drawing.mediaNames.get(k)).append("\"/>");
                    media.put(sh.drawing.mediaNames.get(k), sh.drawing.mediaPaths.get(k));
                }
                put(zip, "xl/drawings/_rels/drawing" + d + ".xml.rels", rels(dr.toString()));
                d++;
            }
            i++;
        }
        // Fotos (una sola vez cada una)
        if (photos != null) {
            for (Map.Entry<String, String> e : media.entrySet()) {
                byte[] img = photos.load(e.getValue());
                if (img == null) continue;
                zip.putNextEntry(new ZipEntry("xl/media/" + e.getKey()));
                zip.write(img);
                zip.closeEntry();
            }
        }
        zip.finish();
        zip.flush();
    }

    private static String rels(String inner) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + inner + "</Relationships>";
    }

    /** "vallas/OOH-2164.jpg" → "OOH-2164.jpeg" (nombre seguro dentro del zip). */
    private static String mediaName(String path) {
        String base = path.substring(path.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        return base + ".jpeg";
    }

    /** "1º JUNIO": nº de semana dentro del mes en que cae el lunes. */
    static String weekName(LocalDate monday, boolean withYear) {
        int n = (monday.getDayOfMonth() - 1) / 7 + 1;
        String s = n + "º " + MESES[monday.getMonthValue() - 1];
        if (withYear) s += " " + monday.getYear();
        return s;
    }

    static LocalDate parseDate(String s) {
        if (s == null || s.length() < 10) return null;
        try {
            return LocalDate.parse(s.substring(0, 10), DateTimeFormatter.ISO_LOCAL_DATE);
        } catch (Exception e) {
            return null;
        }
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static void put(ZipOutputStream zip, String name, String content) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private static String contentTypes(int sheetCount, int drawingCount) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n")
          .append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">")
          .append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>")
          .append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>")
          .append("<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>")
          .append("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>")
          .append("<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
        for (int i = 1; i <= sheetCount; i++) {
            sb.append("<Override PartName=\"/xl/worksheets/sheet").append(i)
              .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
        }
        for (int i = 1; i <= drawingCount; i++) {
            sb.append("<Override PartName=\"/xl/drawings/drawing").append(i)
              .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>");
        }
        sb.append("</Types>");
        return sb.toString();
    }

    private static String workbook(List<Sheet> sheets) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n")
          .append("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" ")
          .append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
          .append("<bookViews><workbookView/></bookViews><sheets>");
        for (int i = 0; i < sheets.size(); i++) {
            sb.append("<sheet name=\"").append(esc(sheets.get(i).name)).append("\" sheetId=\"").append(i + 1)
              .append("\" r:id=\"rId").append(i + 1).append("\"/>");
        }
        sb.append("</sheets><definedNames>");
        for (int i = 0; i < sheets.size(); i++) {
            sb.append("<definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"").append(i)
              .append("\" hidden=\"1\">'").append(esc(sheets.get(i).name.replace("'", "''")))
              .append("'!").append(sheets.get(i).filterRef).append("</definedName>");
        }
        sb.append("</definedNames></workbook>");
        return sb.toString();
    }

    private static String workbookRels(int sheetCount) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n")
          .append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
        for (int i = 1; i <= sheetCount; i++) {
            sb.append("<Relationship Id=\"rId").append(i)
              .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
              .append(i).append(".xml\"/>");
        }
        sb.append("<Relationship Id=\"rId").append(sheetCount + 1)
          .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>")
          .append("</Relationships>");
        return sb.toString();
    }

    // ------------------------------------------------------------ presupuestos

    private static final Col[] BCOLS = {
        new Col("FECHA", "fecha", Kind.DATE, 12),
        new Col("RAZÓN SOCIAL", "razonSocial", Kind.TEXT, 26),
        new Col("PERSONA CONTACTO", "contacto", Kind.TEXT, 20),
        new Col("TELÉFONO", "telefono", Kind.TEXT, 14),
        new Col("CORREO", "correo", Kind.TEXT, 24),
        new Col("VALLA", "codigo", Kind.TEXT, 12),
        new Col("DIRECCIÓN VALLA", "direccion", Kind.WRAP, 34),
        new Col("MUNICIPIO", "municipio", Kind.TEXT, 14),
        new Col("MEDIDA", "medida", Kind.TEXT, 11),
        new Col("CATEGORÍA", "categoria", Kind.TEXT, 10),
        new Col("IMPACTOS / DÍA", "impactos", Kind.NUMBER, 11),
        new Col("LATITUD", "lat", Kind.COORD, 12),
        new Col("LONGITUD", "lng", Kind.COORD, 12),
        new Col("MAPA", "mapa", Kind.LINK, 11),
        new Col("PERIODO", "periodo", Kind.TEXT, 12),
        new Col("DESDE", "desde", Kind.DATE, 12),
        new Col("HASTA", "hasta", Kind.DATE, 12),
        new Col("MATERIAL", "material", Kind.TEXT, 13),
        new Col("PRECIO MES POR VALLA", "precioMes", Kind.MONEY, 13),
        new Col("MESES", "meses", Kind.NUMBER, 8),
        new Col("ALQUILER PERIODO SIN IVA", "precioPeriodo", Kind.MONEY, 14),
        new Col("PRECIO MATERIAL SIN IVA", "precioMaterial", Kind.MONEY, 14),
        new Col("TOTAL VALLA SIN IVA", "total", Kind.MONEY, 14),
        new Col("ARTÍCULO", "artArticulo", Kind.TEXT, 18),
        new Col("DESCRIPCIÓN ARTÍCULO", "artDescripcion", Kind.WRAP, 24),
        new Col("MEDIDA ARTÍCULO", "artMedida", Kind.TEXT, 11),
        new Col("CANTIDAD", "artCantidad", Kind.NUMBER, 9),
        new Col("PRECIO UNIDAD SIN IVA", "artPrecio", Kind.MONEY, 13),
        new Col("IMPORTE ARTÍCULO SIN IVA", "artImporte", Kind.MONEY, 14),
        new Col("FOTO", "foto", Kind.PHOTO, 26),
    };

    private static final int PHOTO_W_PX = 176;   // ancho de la foto en la celda
    private static final double PHOTO_ROW_PT = 102;
    private static final long EMU_PX = 9525;

    private static String tableSheet(List<Map<String, String>> rows, Col[] cols, PhotoSource photos, Drawing dr) {
        String lastCol = colName(cols.length - 1);
        int lastRow = rows.size() + 1;
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n")
          .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" ")
          .append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
          .append("<dimension ref=\"A1:").append(lastCol).append(lastRow).append("\"/>")
          .append("<sheetViews><sheetView workbookViewId=\"0\">")
          .append("<pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>")
          .append("</sheetView></sheetViews>")
          .append("<sheetFormatPr defaultRowHeight=\"15\"/><cols>");
        for (int c = 0; c < cols.length; c++) {
            sb.append("<col min=\"").append(c + 1).append("\" max=\"").append(c + 1)
              .append("\" width=\"").append(cols[c].width).append("\" customWidth=\"1\"/>");
        }
        sb.append("</cols><sheetData>");
        sb.append("<row r=\"1\" ht=\"32\" customHeight=\"1\">");
        for (int c = 0; c < cols.length; c++) inlineStr(sb, colName(c) + 1, cols[c].header, S_HEADER);
        sb.append("</row>");

        Map<String, Integer> mediaIds = new HashMap<>();
        int r = 2;
        for (Map<String, String> m : rows) {
            String foto = nz(m.get("foto"));
            byte[] img = (photos != null && !foto.isEmpty()) ? photos.load(foto) : null;
            sb.append("<row r=\"").append(r).append('"');
            if (img != null) sb.append(" ht=\"").append(PHOTO_ROW_PT).append("\" customHeight=\"1\"");
            sb.append('>');
            for (int c = 0; c < cols.length; c++) {
                Col col = cols[c];
                String ref = colName(c) + r;
                String v = nz(m.get(col.key)).trim();
                if (col.kind == Kind.COORD) {
                    String n = parseNumber(v);
                    if (n != null) number(sb, ref, v.trim(), S_COORD); else inlineStr(sb, ref, v, S_TEXT);
                } else if (col.kind == Kind.LINK) {
                    String lat = nz(m.get("lat")).trim(), lng = nz(m.get("lng")).trim();
                    if (parseNumber(lat) != null && parseNumber(lng) != null) {
                        String url = "https://www.google.com/maps?q=" + lat + "," + lng;
                        sb.append("<c r=\"").append(ref).append("\" s=\"").append(S_LINK)
                          .append("\" t=\"str\"><f>HYPERLINK(&quot;").append(esc(url))
                          .append("&quot;,&quot;Ver mapa&quot;)</f><v>Ver mapa</v></c>");
                    } else {
                        inlineStr(sb, ref, "", S_TEXT);
                    }
                } else if (col.kind == Kind.PHOTO) {
                    inlineStr(sb, ref, img == null && !foto.isEmpty() ? "Sin foto" : "", S_TEXT);
                    if (img != null) addPicture(dr, mediaIds, foto, img, c, r - 1);
                } else {
                    cell(sb, ref, col, v);
                }
            }
            sb.append("</row>");
            r++;
        }
        sb.append("</sheetData>");
        sb.append("<autoFilter ref=\"A1:").append(lastCol).append(lastRow).append("\"/>");
        int lists = 0;
        for (Col col : cols) if (col.list != null) lists++;
        if (lists > 0) {
            int dvLast = Math.max(lastRow + 100, 200);
            sb.append("<dataValidations count=\"").append(lists).append("\">");
            for (int c = 0; c < cols.length; c++) {
                if (cols[c].list != null) {
                    listValidation(sb, colName(c) + "2:" + colName(c) + dvLast, cols[c].list);
                }
            }
            sb.append("</dataValidations>");
        }
        sb.append("<pageMargins left=\"0.5\" right=\"0.5\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/>");
        if (dr.pics > 0) sb.append("<drawing r:id=\"rId1\"/>");
        sb.append("</worksheet>");
        return sb.toString();
    }

    private static void addPicture(Drawing dr, Map<String, Integer> mediaIds, String path, byte[] img,
                                   int col, int row0) {
        Integer rid = mediaIds.get(path);
        if (rid == null) {
            dr.mediaNames.add(mediaName(path));
            dr.mediaPaths.add(path);
            rid = dr.mediaNames.size();
            mediaIds.put(path, rid);
        }
        int[] size = jpegSize(img);
        long w = PHOTO_W_PX;
        long h = (size != null && size[0] > 0) ? Math.round(w * (double) size[1] / size[0]) : Math.round(w * 0.75);
        long maxH = Math.round(PHOTO_ROW_PT * 96 / 72) - 8;
        if (h > maxH) { w = Math.round(w * (double) maxH / h); h = maxH; }
        dr.pics++;
        dr.anchors.append("<xdr:oneCellAnchor><xdr:from><xdr:col>").append(col)
          .append("</xdr:col><xdr:colOff>").append(4 * EMU_PX).append("</xdr:colOff><xdr:row>").append(row0)
          .append("</xdr:row><xdr:rowOff>").append(4 * EMU_PX).append("</xdr:rowOff></xdr:from>")
          .append("<xdr:ext cx=\"").append(w * EMU_PX).append("\" cy=\"").append(h * EMU_PX).append("\"/>")
          .append("<xdr:pic><xdr:nvPicPr><xdr:cNvPr id=\"").append(dr.pics + 1).append("\" name=\"Foto ")
          .append(dr.pics).append("\"/><xdr:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></xdr:cNvPicPr></xdr:nvPicPr>")
          .append("<xdr:blipFill><a:blip r:embed=\"rId").append(rid).append("\"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>")
          .append("<xdr:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"").append(w * EMU_PX).append("\" cy=\"")
          .append(h * EMU_PX).append("\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr>")
          .append("</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>");
    }

    /** Ancho y alto de un JPEG leyendo su cabecera SOF, o null. */
    static int[] jpegSize(byte[] b) {
        int i = 2;
        while (i + 9 < b.length) {
            if ((b[i] & 0xFF) != 0xFF) { i++; continue; }
            int marker = b[i + 1] & 0xFF;
            int len = ((b[i + 2] & 0xFF) << 8) | (b[i + 3] & 0xFF);
            if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
                int h = ((b[i + 5] & 0xFF) << 8) | (b[i + 6] & 0xFF);
                int w = ((b[i + 7] & 0xFF) << 8) | (b[i + 8] & 0xFF);
                return new int[]{w, h};
            }
            i += 2 + len;
        }
        return null;
    }

    private static void listValidation(StringBuilder sb, String ref, String values) {
        sb.append("<dataValidation type=\"list\" allowBlank=\"1\" showErrorMessage=\"0\" sqref=\"")
          .append(ref).append("\"><formula1>\"").append(esc(values)).append("\"</formula1></dataValidation>");
    }

    private static void cell(StringBuilder sb, String ref, Col col, String v) {
        switch (col.kind) {
            case DATE: {
                LocalDate d = parseDate(v);
                if (d != null) {
                    long serial = ChronoUnit.DAYS.between(EXCEL_EPOCH, d);
                    number(sb, ref, String.valueOf(serial), S_DATE);
                } else {
                    inlineStr(sb, ref, v, S_TEXT);
                }
                return;
            }
            case NUMBER: {
                String n = parseNumber(v);
                if (n != null) number(sb, ref, n, S_TEXT); else inlineStr(sb, ref, v, S_TEXT);
                return;
            }
            case MONEY: {
                String n = parseNumber(v);
                if (n != null) number(sb, ref, n, S_MONEY); else inlineStr(sb, ref, v, S_TEXT);
                return;
            }
            case PERCENT: {
                String n = parseNumber(v.replace("%", ""));
                if (n != null) {
                    double p = Double.parseDouble(n);
                    if (p > 1) p = p / 100.0;
                    number(sb, ref, trimDouble(p), S_PCT);
                } else {
                    inlineStr(sb, ref, v, S_TEXT);
                }
                return;
            }
            case WRAP:
                inlineStr(sb, ref, v, S_WRAP);
                return;
            default:
                inlineStr(sb, ref, v, S_TEXT);
        }
    }

    /** Acepta "1.200,50", "1200.5", "1200 €"... Devuelve el número en formato XML o null. */
    static String parseNumber(String v) {
        if (v == null) return null;
        String s = v.replace("€", "").replace(" ", "").trim();
        if (s.isEmpty()) return null;
        if (s.contains(",")) s = s.replace(".", "").replace(",", ".");
        else if (s.matches("\\d{1,3}(\\.\\d{3})+")) s = s.replace(".", "");   // "1.250" = 1250
        try {
            return trimDouble(Double.parseDouble(s));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String trimDouble(double d) {
        if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf((long) d);
        return String.valueOf(d);
    }

    private static void number(StringBuilder sb, String ref, String n, int style) {
        sb.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\"><v>")
          .append(n).append("</v></c>");
    }

    private static void inlineStr(StringBuilder sb, String ref, String text, int style) {
        if (text == null || text.isEmpty()) {
            sb.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\"/>");
            return;
        }
        sb.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
          .append(esc(text)).append("</t></is></c>");
    }

    static String colName(int index) {
        StringBuilder s = new StringBuilder();
        int n = index + 1;
        while (n > 0) {
            int rem = (n - 1) % 26;
            s.insert(0, (char) ('A' + rem));
            n = (n - 1) / 26;
        }
        return s.toString();
    }

    static String esc(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '&': sb.append("&amp;"); break;
                case '<': sb.append("&lt;"); break;
                case '>': sb.append("&gt;"); break;
                case '"': sb.append("&quot;"); break;
                default:
                    // Caracteres de control no válidos en XML 1.0 (se conservan \t \n \r)
                    if (ch < 0x20 && ch != '\t' && ch != '\n' && ch != '\r') continue;
                    sb.append(ch);
            }
        }
        return sb.toString();
    }

    private static final String STYLES =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
        + "<numFmts count=\"3\">"
        + "<numFmt numFmtId=\"164\" formatCode=\"dd/mm/yyyy\"/>"
        + "<numFmt numFmtId=\"165\" formatCode=\"#,##0.00\\ &quot;€&quot;\"/>"
        + "<numFmt numFmtId=\"166\" formatCode=\"0.000000\"/>"
        + "</numFmts>"
        + "<fonts count=\"3\">"
        + "<font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
        + "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
        + "<font><u/><sz val=\"11\"/><color rgb=\"FF0563C1\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
        + "</fonts>"
        + "<fills count=\"3\">"
        + "<fill><patternFill patternType=\"none\"/></fill>"
        + "<fill><patternFill patternType=\"gray125\"/></fill>"
        + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF1F4E78\"/><bgColor indexed=\"64\"/></patternFill></fill>"
        + "</fills>"
        + "<borders count=\"2\">"
        + "<border><left/><right/><top/><bottom/><diagonal/></border>"
        + "<border><left style=\"thin\"><color rgb=\"FFBFBFBF\"/></left><right style=\"thin\"><color rgb=\"FFBFBFBF\"/></right>"
        + "<top style=\"thin\"><color rgb=\"FFBFBFBF\"/></top><bottom style=\"thin\"><color rgb=\"FFBFBFBF\"/></bottom><diagonal/></border>"
        + "</borders>"
        + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
        + "<cellXfs count=\"9\">"
        + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
        + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\">"
        + "<alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf>"
        + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\"/></xf>"
        + "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\"/></xf>"
        + "<xf numFmtId=\"9\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\"/></xf>"
        + "<xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\"/></xf>"
        + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\" wrapText=\"1\"/></xf>"
        + "<xf numFmtId=\"166\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\"/></xf>"
        + "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"top\"/></xf>"
        + "</cellXfs>"
        + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
        + "</styleSheet>";
}
