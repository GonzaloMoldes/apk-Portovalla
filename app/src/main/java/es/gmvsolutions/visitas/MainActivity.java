package es.gmvsolutions.visitas;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.media.ExifInterface;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {

    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String FOLDER = "VisitasLeads";
    private static final int REQ_STORAGE = 1;
    private static final int REQ_CAMERA = 2;
    private static final int REQ_GALLERY = 3;
    private static final int REQ_LOCATION = 4;
    private static final int PHOTO_MAX_SIDE = 1280;   // fotos de vallas añadidas desde la app
    private static final int OCR_MAX_SIDE = 2048;

    private WebView web;
    private volatile Uri lastExcelUri;
    private volatile Uri lastPdfUri;
    private Uri pendingPhoto;          // foto de la cámara en curso
    private String pendingPurpose = "ocr";   // "ocr" (tarjeta) o etiqueta de la foto de una valla
    private boolean locationPending;
    private boolean pageLoaded;
    private String pendingJs;          // llamada JS a la espera de que cargue la página

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            String p = savedInstanceState.getString("pendingPhoto");
            if (p != null) pendingPhoto = Uri.parse(p);
            pendingPurpose = savedInstanceState.getString("pendingPurpose", "ocr");
        }
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                if (pendingJs != null) {
                    String js = pendingJs;
                    pendingJs = null;
                    web.evaluateJavascript(js, null);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/index.html");

        // Android 9 o anterior: hace falta permiso para escribir en Descargas
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (pendingPhoto != null) out.putString("pendingPhoto", pendingPhoto.toString());
        out.putString("pendingPurpose", pendingPurpose);
    }

    /** Ejecuta una función JS global con un argumento de texto. */
    private void callJs(String fn, String arg) {
        final String js = "window." + fn + " && " + fn + "(" + JSONObject.quote(arg == null ? "" : arg) + ")";
        runOnUiThread(() -> {
            if (pageLoaded) web.evaluateJavascript(js, null);
            else pendingJs = js;
        });
    }

    // ---------------------------------------------------------------- ubicación (GPS)

    private void sendLocation(Location l) {
        try {
            JSONObject r = new JSONObject();
            r.put("lat", Math.round(l.getLatitude() * 1e6) / 1e6);
            r.put("lng", Math.round(l.getLongitude() * 1e6) / 1e6);
            r.put("acc", Math.round(l.getAccuracy()));
            callJs("onLocation", r.toString());
        } catch (Exception e) {
            callJs("onLocationError", "No se pudo leer la ubicación");
        }
    }

    @SuppressWarnings("MissingPermission")
    private void requestLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            locationPending = true;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            return;
        }
        final LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) {
            callJs("onLocationError", "Este dispositivo no tiene ubicación");
            return;
        }
        Location best = null;
        for (String p : lm.getProviders(true)) {
            Location l = lm.getLastKnownLocation(p);
            if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
        }
        if (best != null && System.currentTimeMillis() - best.getTime() < 2 * 60 * 1000 && best.getAccuracy() < 40) {
            sendLocation(best);
            return;
        }
        String provider = lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER
                : lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ? LocationManager.NETWORK_PROVIDER : null;
        if (provider == null) {
            callJs("onLocationError", "Activa la ubicación del dispositivo");
            return;
        }
        callJs("onLocationStart", "");
        final Handler h = new Handler(Looper.getMainLooper());
        final Location fallback = best;
        final LocationListener[] holder = new LocationListener[1];
        final Runnable timeout = () -> {
            lm.removeUpdates(holder[0]);
            if (fallback != null) sendLocation(fallback);
            else callJs("onLocationError", "No se pudo obtener la ubicación (prueba al aire libre)");
        };
        holder[0] = new LocationListener() {
            @Override
            public void onLocationChanged(Location l) {
                h.removeCallbacks(timeout);
                lm.removeUpdates(this);
                sendLocation(l);
            }
            @Override public void onStatusChanged(String p, int status, Bundle extras) { }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onProviderDisabled(String p) { }
        };
        lm.requestLocationUpdates(provider, 0, 0, holder[0], Looper.getMainLooper());
        h.postDelayed(timeout, 25000);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_LOCATION && locationPending) {
            locationPending = false;
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) requestLocation();
            else callJs("onLocationError", "Sin permiso de ubicación");
        }
    }

    // ---------------------------------------------------------------- tarjeta de visita (OCR)

    private void startScan(String source) {
        startCapture(source, "ocr");
    }

    /** Errores de cámara/galería: van a la tarjeta (OCR) o a la foto de la valla. */
    private void captureError(String msg) {
        if ("ocr".equals(pendingPurpose)) callJs("onOcrError", msg);
        else callJs("onPhotoError", msg);
    }

    private void startCapture(String source, String purpose) {
        pendingPurpose = purpose == null || purpose.isEmpty() ? "ocr" : purpose;
        try {
            if ("gallery".equals(source)) {
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.setType("image/*");
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(Intent.createChooser(pick,
                        "ocr".equals(pendingPurpose) ? "Foto de la tarjeta" : "Foto de la valla"), REQ_GALLERY);
                return;
            }
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME,
                    ("ocr".equals(pendingPurpose) ? "tarjeta_" : "valla_") + System.currentTimeMillis() + ".jpg");
            v.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= 29) {
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + FOLDER);
            }
            pendingPhoto = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (pendingPhoto == null) {
                captureError("No se pudo preparar la foto");
                return;
            }
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            cam.putExtra(MediaStore.EXTRA_OUTPUT, pendingPhoto);
            cam.setClipData(ClipData.newRawUri("", pendingPhoto));
            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(cam, REQ_CAMERA);
        } catch (ActivityNotFoundException e) {
            discardPendingPhoto();
            captureError("No hay ninguna app de cámara disponible");
        } catch (Exception e) {
            discardPendingPhoto();
            captureError("No se pudo abrir la cámara: " + e.getMessage());
        }
    }

    private void discardPendingPhoto() {
        if (pendingPhoto == null) return;
        try {
            getContentResolver().delete(pendingPhoto, null, null);
        } catch (Exception ignored) {
            // la foto temporal no es imprescindible borrarla
        }
        pendingPhoto = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_CAMERA && requestCode != REQ_GALLERY) return;
        final boolean fromCamera = requestCode == REQ_CAMERA;
        final Uri uri = fromCamera ? pendingPhoto : (data != null ? data.getData() : null);
        if (resultCode != RESULT_OK || uri == null) {
            if (fromCamera) discardPendingPhoto();
            return;
        }
        if (!"ocr".equals(pendingPurpose)) {
            savePhotoForJs(uri, pendingPurpose, fromCamera);
            return;
        }
        callJs("onOcrStart", "");
        new Thread(() -> {
            Bitmap bmp;
            try {
                bmp = loadScaledBitmap(uri, OCR_MAX_SIDE);
            } catch (Exception e) {
                bmp = null;
            }
            final Bitmap image = bmp;
            runOnUiThread(() -> {
                if (image == null) {
                    if (fromCamera) discardPendingPhoto();
                    callJs("onOcrError", "No se pudo leer la foto");
                    return;
                }
                TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                recognizer.process(InputImage.fromBitmap(image, 0))
                        .addOnSuccessListener(text -> callJs("onOcrResult", text.getText()))
                        .addOnFailureListener(e -> callJs("onOcrError", "No se pudo reconocer el texto: " + e.getMessage()))
                        .addOnCompleteListener(t -> {
                            recognizer.close();
                            if (fromCamera) discardPendingPhoto();
                        });
            });
        }).start();
    }

    /** Carga la imagen reducida (lado mayor ≤ OCR_MAX_SIDE) y girada según su EXIF. */
    /** Guarda la foto (reducida) en la app y se la pasa a JS: onPhotoResult({tag, url}). */
    private void savePhotoForJs(Uri uri, String tag, boolean fromCamera) {
        new Thread(() -> {
            try {
                Bitmap bmp = loadScaledBitmap(uri, PHOTO_MAX_SIDE);
                File dir = new File(getFilesDir(), "vallas");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("No se pudo crear la carpeta de fotos");
                String safe = tag.replaceAll("[^A-Za-z0-9_-]", "_");
                File f = new File(dir, safe + "_" + System.currentTimeMillis() + ".jpg");
                try (OutputStream out = new FileOutputStream(f)) {
                    bmp.compress(Bitmap.CompressFormat.JPEG, 78, out);
                }
                bmp.recycle();
                JSONObject r = new JSONObject();
                r.put("tag", tag);
                r.put("url", "file://" + f.getAbsolutePath());
                callJs("onPhotoResult", r.toString());
            } catch (Exception e) {
                callJs("onPhotoError", "No se pudo guardar la foto: " + e.getMessage());
            } finally {
                if (fromCamera) runOnUiThread(this::discardPendingPhoto);
            }
        }).start();
    }

    private Bitmap loadScaledBitmap(Uri uri, int maxSide) throws IOException {
        ContentResolver cr = getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap bmp;
        try (InputStream in = cr.openInputStream(uri)) {
            bmp = BitmapFactory.decodeStream(in, null, opts);
        }
        if (bmp == null) throw new IOException("Imagen no válida");

        int rotation = 0;
        try (InputStream in = cr.openInputStream(uri)) {
            int o = new ExifInterface(in).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (o == ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
            else if (o == ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
            else if (o == ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
        } catch (Exception ignored) {
            // sin EXIF: se usa tal cual
        }
        if (rotation != 0) {
            Matrix m = new Matrix();
            m.postRotate(rotation);
            Bitmap rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            if (rotated != bmp) bmp.recycle();
            bmp = rotated;
        }
        return bmp;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.handleBack ? handleBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    private boolean isInstalled(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    private void launch(final Intent intent, final String errorMsg) {
        runOnUiThread(() -> {
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, errorMsg, Toast.LENGTH_LONG).show();
            }
        });
    }

    // ---------------------------------------------------------------- datos

    private File dataFile(String name) {
        return new File(getFilesDir(), name);
    }

    private String readFile(File f) {
        if (!f.exists()) return "";
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
            return new String(buf, 0, off, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    /** Escritura atómica: primero a .tmp y luego renombrar. */
    private boolean writeFile(File f, String content) {
        File tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            return false;
        }
        return tmp.renameTo(f);
    }

    // ---------------------------------------------------------------- excel

    /** Campos simples (texto/número) de un objeto JSON. */
    private static Map<String, String> flat(JSONObject o) {
        Map<String, String> m = new HashMap<>();
        Iterator<String> keys = o.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            Object v = o.opt(k);
            if (v != null && v != JSONObject.NULL && !(v instanceof JSONObject) && !(v instanceof JSONArray)) {
                m.put(k, String.valueOf(v));
            }
        }
        return m;
    }

    private static List<Map<String, String>> parseLeads(String json) throws Exception {
        JSONArray arr = new JSONArray(json);
        List<Map<String, String>> list = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) list.add(flat(arr.getJSONObject(i)));
        return list;
    }

    /** Una fila por valla presupuestada: datos de la visita + valla + campaña. */
    private static List<Map<String, String>> parseBudgets(String json) throws Exception {
        JSONArray arr = new JSONArray(json);
        List<Map<String, String>> rows = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject lead = arr.getJSONObject(i);
            JSONObject p = lead.optJSONObject("presupuesto");
            JSONArray vallas = p == null ? null : p.optJSONArray("vallas");
            if (vallas == null) continue;
            Map<String, String> base = flat(lead);
            base.putAll(flat(p));
            for (int k = 0; k < vallas.length(); k++) {
                JSONObject v = vallas.optJSONObject(k);
                if (v == null) continue;
                Map<String, String> row = new HashMap<>(base);
                row.putAll(flat(v));
                rows.add(row);
            }
        }
        return rows;
    }

    /** Lee una foto incluida en la app (assets/vallas/…). */
    private byte[] loadAsset(String path) {
        try (InputStream in = path.startsWith("file://")
                ? new FileInputStream(path.substring("file://".length()))
                : getAssets().open(path)) {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            return buf.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    /** Escribe el contenido de un fichero en un OutputStream. */
    private interface StreamWriter {
        void write(OutputStream out) throws Exception;
    }

    /**
     * Guarda (o sobrescribe) un fichero en Descargas/&lt;subfolder&gt; y devuelve su Uri
     * para poder abrirlo o compartirlo.
     */
    private Uri saveToDownloads(String subfolder, String name, String mime, StreamWriter writer) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            String relPath = Environment.DIRECTORY_DOWNLOADS + "/" + subfolder;
            Uri uri = null;
            try (Cursor c = cr.query(collection, new String[]{MediaStore.MediaColumns._ID},
                    MediaStore.MediaColumns.DISPLAY_NAME + "=? AND "
                            + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?",
                    new String[]{name, relPath + "/%"}, null)) {
                if (c != null && c.moveToFirst()) {
                    uri = Uri.withAppendedPath(collection, String.valueOf(c.getLong(0)));
                }
            }
            if (uri == null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, relPath);
                uri = cr.insert(collection, v);
                if (uri == null) throw new IOException("No se pudo crear el fichero en Descargas");
            }
            try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "rwt");
                 FileOutputStream out = new FileOutputStream(pfd.getFileDescriptor())) {
                out.getChannel().truncate(0);
                writer.write(out);
            }
            return uri;
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), subfolder);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("No se pudo crear la carpeta " + dir);
        File f = new File(dir, name);
        try (OutputStream out = new FileOutputStream(f)) {
            writer.write(out);
        }
        final Uri[] result = new Uri[1];
        final CountDownLatch latch = new CountDownLatch(1);
        MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()},
                new String[]{mime}, (path, uri) -> { result[0] = uri; latch.countDown(); });
        latch.await(5, TimeUnit.SECONDS);
        if (result[0] == null) throw new IOException("Fichero guardado en " + f + " pero no se pudo compartir");
        return result[0];
    }

    /** Escribe el Excel en Descargas/VisitasLeads y devuelve su Uri. */
    private Uri writeExcel(String leadsJson, String fileName) throws Exception {
        List<Map<String, String>> leads = parseLeads(leadsJson);
        List<Map<String, String>> budgets = parseBudgets(leadsJson);
        XlsxWriter.PhotoSource photos = this::loadAsset;
        String name = fileName.endsWith(".xlsx") ? fileName : fileName + ".xlsx";
        return saveToDownloads(FOLDER, name, XLSX_MIME, out -> XlsxWriter.write(leads, budgets, photos, out));
    }

    /** Genera el PDF del presupuesto en Descargas/VisitasLeads/Presupuestos. */
    private Uri writeBudgetPdf(String docJson) throws Exception {
        JSONObject doc = new JSONObject(docJson);
        String name = doc.optString("fichero", "Presupuesto").replaceAll("[\\\\/:*?\"<>|]", "_");
        if (!name.endsWith(".pdf")) name += ".pdf";
        return saveToDownloads(FOLDER + "/Presupuestos", name, "application/pdf",
                out -> BudgetPdf.write(doc, path -> {
                    byte[] b = loadAsset(path);
                    return b == null ? null : BitmapFactory.decodeByteArray(b, 0, b.length);
                }, out));
    }

    // ---------------------------------------------------------------- puente JS

    private class Bridge {

        @JavascriptInterface
        public String load(String key) {
            return readFile(dataFile(key + ".json"));
        }

        @JavascriptInterface
        public boolean save(String key, String json) {
            return writeFile(dataFile(key + ".json"), json);
        }

        /** Reescribe el Excel. Devuelve "" si todo fue bien o el mensaje de error. */
        @JavascriptInterface
        public String exportExcel(String leadsJson, String fileName) {
            try {
                lastExcelUri = writeExcel(leadsJson, fileName);
                return "";
            } catch (Exception e) {
                return e.getMessage() == null ? e.toString() : e.getMessage();
            }
        }

        @JavascriptInterface
        public String shareExcel(String leadsJson, String fileName) {
            String err = exportExcel(leadsJson, fileName);
            if (!err.isEmpty()) return err;
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(XLSX_MIME);
            send.putExtra(Intent.EXTRA_STREAM, lastExcelUri);
            send.putExtra(Intent.EXTRA_SUBJECT, fileName);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launch(Intent.createChooser(send, "Compartir Excel"), "No hay apps para compartir");
            return "";
        }

        @JavascriptInterface
        public String openExcel(String leadsJson, String fileName) {
            String err = exportExcel(leadsJson, fileName);
            if (!err.isEmpty()) return err;
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(lastExcelUri, XLSX_MIME);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launch(view, "No hay ninguna app instalada para abrir Excel (instala Excel o Google Hojas de cálculo)");
            return "";
        }

        /** Genera el PDF del presupuesto. Devuelve "" si todo fue bien o el mensaje de error. */
        @JavascriptInterface
        public String budgetPdf(String docJson) {
            try {
                lastPdfUri = writeBudgetPdf(docJson);
                return "";
            } catch (Exception e) {
                lastPdfUri = null;
                return e.getMessage() == null ? e.toString() : e.getMessage();
            }
        }

        @JavascriptInterface
        public void viewPdf() {
            if (lastPdfUri == null) return;
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(lastPdfUri, "application/pdf");
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launch(view, "No hay ninguna app para ver PDF");
        }

        /** Email con el PDF del presupuesto adjunto (solo apps de correo). */
        @JavascriptInterface
        public void sendEmailPdf(String to, String subject, String body) {
            if (lastPdfUri == null) { sendEmail(to, subject, body); return; }
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("application/pdf");
            i.putExtra(Intent.EXTRA_EMAIL, new String[]{to});
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, body);
            i.putExtra(Intent.EXTRA_STREAM, lastPdfUri);
            i.setClipData(ClipData.newRawUri("", lastPdfUri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
            launch(i, "No hay ninguna app de correo configurada");
        }

        /** WhatsApp con el PDF adjunto, directo al chat del número (phone: 34600111222). */
        @JavascriptInterface
        public void sendWhatsAppPdf(String phone, String text) {
            if (lastPdfUri == null) { sendWhatsApp(phone, text); return; }
            String pkg = isInstalled("com.whatsapp") ? "com.whatsapp"
                    : isInstalled("com.whatsapp.w4b") ? "com.whatsapp.w4b" : null;
            if (pkg == null) {
                toast("WhatsApp no está instalado");
                return;
            }
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setPackage(pkg);
            i.setType("application/pdf");
            i.putExtra(Intent.EXTRA_STREAM, lastPdfUri);
            i.putExtra(Intent.EXTRA_TEXT, text);
            i.putExtra("jid", phone + "@s.whatsapp.net");
            i.setClipData(ClipData.newRawUri("", lastPdfUri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launch(i, "No se pudo abrir WhatsApp");
        }

        @JavascriptInterface
        public void sendEmail(String to, String subject, String body) {
            Uri uri = Uri.parse("mailto:" + Uri.encode(to)
                    + "?subject=" + Uri.encode(subject) + "&body=" + Uri.encode(body));
            Intent i = new Intent(Intent.ACTION_SENDTO, uri);
            i.putExtra(Intent.EXTRA_EMAIL, new String[]{to});
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, body);
            launch(i, "No hay ninguna app de correo configurada");
        }

        /** phone en formato internacional sin "+", p. ej. 34600111222. */
        @JavascriptInterface
        public void sendWhatsApp(String phone, String text) {
            Uri uri = Uri.parse("https://api.whatsapp.com/send?phone=" + Uri.encode(phone)
                    + "&text=" + Uri.encode(text));
            launch(new Intent(Intent.ACTION_VIEW, uri), "No se pudo abrir WhatsApp");
        }

        @JavascriptInterface
        public void call(String phone) {
            launch(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(phone))),
                    "No se puede llamar desde este dispositivo");
        }

        /** Foto para una valla. El resultado llega a JS en onPhotoResult({tag, url}). */
        @JavascriptInterface
        public void pickPhoto(String source, String tag) {
            runOnUiThread(() -> startCapture(source, tag));
        }

        /** Ubicación actual. El resultado llega a JS en onLocation({lat, lng, acc}). */
        @JavascriptInterface
        public void getLocation() {
            runOnUiThread(MainActivity.this::requestLocation);
        }

        /**
         * Excel de una tabla (kind: "trabajos" o "patrimonio") en Descargas/VisitasLeads/&lt;carpeta&gt;.
         * mode: "share" (compartir), "open" (abrir) o "save" (solo guardar).
         */
        @JavascriptInterface
        public String exportTable(String kind, String rowsJson, String fileName, String mode) {
            try {
                List<Map<String, String>> rows = parseLeads(rowsJson);
                String name = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (!name.endsWith(".xlsx")) name += ".xlsx";
                boolean patrimonio = "patrimonio".equals(kind);
                String folder = FOLDER + (patrimonio ? "/Patrimonio" : "/Trabajos");
                String sheet = patrimonio ? "NEGOCIACIONES" : "TRABAJOS";
                Uri uri = saveToDownloads(folder, name, XLSX_MIME,
                        out -> XlsxWriter.writeTable(kind, sheet, rows, MainActivity.this::loadAsset, out));
                if ("share".equals(mode)) {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(XLSX_MIME);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.putExtra(Intent.EXTRA_SUBJECT, name);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    launch(Intent.createChooser(send, "Compartir Excel"), "No hay apps para compartir");
                } else if ("open".equals(mode)) {
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(uri, XLSX_MIME);
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    launch(view, "No hay ninguna app instalada para abrir Excel");
                }
                return "";
            } catch (Exception e) {
                return e.getMessage() == null ? e.toString() : e.getMessage();
            }
        }

        @JavascriptInterface
        public String exportTrabajos(String rowsJson, String fileName, String mode) {
            return exportTable("trabajos", rowsJson, fileName, mode);
        }

        /** source: "camera" o "gallery". El resultado llega a JS en onOcrResult(texto). */
        @JavascriptInterface
        public void scanCard(String source) {
            runOnUiThread(() -> startScan(source));
        }

        /** Abre la ubicación en Google Maps (o la app de mapas instalada). */
        @JavascriptInterface
        public void openMap(String lat, String lng, String label) {
            Uri geo = Uri.parse("geo:" + lat + "," + lng + "?q=" + lat + "," + lng + "(" + Uri.encode(label) + ")");
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, geo));
                } catch (ActivityNotFoundException e) {
                    launch(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://www.google.com/maps?q=" + lat + "," + lng)), "No se pudo abrir el mapa");
                }
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }

        @JavascriptInterface
        public String excelLocation() {
            return Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER;
        }
    }
}
