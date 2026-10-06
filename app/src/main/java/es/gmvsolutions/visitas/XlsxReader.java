package es.gmvsolutions.visitas;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Lector mínimo de .xlsx: devuelve cada hoja como una lista de filas de texto.
 * Los números (también fechas, porcentajes…) se devuelven tal cual vienen
 * guardados; la app los interpreta según la columna.
 */
public final class XlsxReader {

    private XlsxReader() {}

    /** nombre de hoja → filas (cada fila, lista de celdas; las vacías como ""). */
    public static LinkedHashMap<String, List<List<String>>> read(InputStream in) throws Exception {
        Map<String, byte[]> files = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(in)) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                String n = e.getName();
                if (n.startsWith("xl/") && (n.endsWith(".xml") || n.endsWith(".rels"))) {
                    files.put(n, readAll(zip));
                }
            }
        }
        if (!files.containsKey("xl/workbook.xml")) throw new IOException("No es un fichero Excel (.xlsx) válido");

        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(false);
        DocumentBuilder db = f.newDocumentBuilder();

        // Textos compartidos
        List<String> shared = new ArrayList<>();
        if (files.containsKey("xl/sharedStrings.xml")) {
            Document ss = db.parse(new ByteArrayInputStream(files.get("xl/sharedStrings.xml")));
            NodeList sis = ss.getElementsByTagName("si");
            for (int i = 0; i < sis.getLength(); i++) shared.add(text((Element) sis.item(i)));
        }

        // Hojas: nombre → ruta del xml
        Map<String, String> rels = new HashMap<>();
        if (files.containsKey("xl/_rels/workbook.xml.rels")) {
            Document r = db.parse(new ByteArrayInputStream(files.get("xl/_rels/workbook.xml.rels")));
            NodeList rs = r.getElementsByTagName("Relationship");
            for (int i = 0; i < rs.getLength(); i++) {
                Element el = (Element) rs.item(i);
                String target = el.getAttribute("Target");
                if (target.startsWith("/")) target = target.substring(1);
                else if (!target.startsWith("xl/")) target = "xl/" + target;
                rels.put(el.getAttribute("Id"), target);
            }
        }
        Document wb = db.parse(new ByteArrayInputStream(files.get("xl/workbook.xml")));
        NodeList sheets = wb.getElementsByTagName("sheet");
        LinkedHashMap<String, List<List<String>>> out = new LinkedHashMap<>();
        for (int i = 0; i < sheets.getLength(); i++) {
            Element sh = (Element) sheets.item(i);
            String rid = sh.getAttribute("r:id");
            String path = rels.getOrDefault(rid, "xl/worksheets/sheet" + (i + 1) + ".xml");
            byte[] xml = files.get(path);
            if (xml == null) continue;
            out.put(sh.getAttribute("name"), readSheet(db.parse(new ByteArrayInputStream(xml)), shared));
        }
        return out;
    }

    private static List<List<String>> readSheet(Document doc, List<String> shared) {
        List<List<String>> rows = new ArrayList<>();
        NodeList rs = doc.getElementsByTagName("row");
        for (int i = 0; i < rs.getLength(); i++) {
            Element row = (Element) rs.item(i);
            int r = parseInt(row.getAttribute("r"), rows.size() + 1);
            while (rows.size() < r - 1) rows.add(new ArrayList<>());
            List<String> cells = new ArrayList<>();
            NodeList cs = row.getElementsByTagName("c");
            for (int k = 0; k < cs.getLength(); k++) {
                Element c = (Element) cs.item(k);
                int col = colIndex(c.getAttribute("r"), cells.size());
                while (cells.size() < col) cells.add("");
                cells.add(cellValue(c, shared));
            }
            rows.add(cells);
        }
        return rows;
    }

    private static String cellValue(Element c, List<String> shared) {
        String t = c.getAttribute("t");
        if ("inlineStr".equals(t)) {
            NodeList is = c.getElementsByTagName("is");
            return is.getLength() > 0 ? text((Element) is.item(0)) : "";
        }
        NodeList vs = c.getElementsByTagName("v");
        String v = vs.getLength() > 0 ? vs.item(0).getTextContent() : "";
        if ("s".equals(t)) {
            int idx = parseInt(v, -1);
            return idx >= 0 && idx < shared.size() ? shared.get(idx) : "";
        }
        if ("b".equals(t)) return "1".equals(v) ? "TRUE" : "FALSE";
        return v == null ? "" : v;
    }

    /** Texto de un <si>/<is>: concatena todos los <t> (incluye texto con formato). */
    private static String text(Element el) {
        StringBuilder sb = new StringBuilder();
        NodeList ts = el.getElementsByTagName("t");
        for (int i = 0; i < ts.getLength(); i++) {
            Node n = ts.item(i);
            // Se ignoran las guías fonéticas (<rPh>)
            if (n.getParentNode() != null && "rPh".equals(n.getParentNode().getNodeName())) continue;
            sb.append(n.getTextContent());
        }
        return sb.toString();
    }

    /** "C7" → 2 */
    static int colIndex(String ref, int fallback) {
        if (ref == null || ref.isEmpty()) return fallback;
        int n = 0, i = 0;
        while (i < ref.length() && Character.isLetter(ref.charAt(i))) {
            n = n * 26 + (Character.toUpperCase(ref.charAt(i)) - 'A' + 1);
            i++;
        }
        return n > 0 ? n - 1 : fallback;
    }

    private static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(s.replaceAll("[^0-9]", ""));
        } catch (Exception e) {
            return def;
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) buf.write(b, 0, n);
        return buf.toByteArray();
    }
}
