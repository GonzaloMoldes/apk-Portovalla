package es.gmvsolutions.visitas;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Avisos de la agenda. La app (agenda.js) calcula la lista de avisos con la fecha en que hay
 * que avisar y la guarda aquí (alertas.json). Una alarma diaria (y al reiniciar la tablet)
 * muestra una notificación con lo que ya toca: trabajos, contratos, revisiones, tráfico…
 */
public final class Alerts extends BroadcastReceiver {

    static final String CHANNEL = "agenda";
    static final String EXTRA_AGENDA = "abrirAgenda";
    private static final String FILE = "alertas.json";
    private static final String PREFS = "avisos";
    private static final int NOTIF_ID = 1001;

    // ---------------------------------------------------------------- guardar y programar

    static void save(Context ctx, String json, int hour, boolean enabled) throws IOException {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), FILE))) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("hour", Math.max(0, Math.min(23, hour))).putBoolean("enabled", enabled).apply();
        schedule(ctx);
    }

    /** Alarma diaria (inexacta, no necesita permisos especiales) a la hora elegida. */
    static void schedule(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx);
        if (am == null) return;
        am.cancel(pi);
        if (!p.getBoolean("enabled", true)) return;
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, p.getInt("hour", 9));
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    private static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, Alerts.class).setAction("es.gmvsolutions.visitas.AVISO_DIARIO");
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ---------------------------------------------------------------- receptor

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            schedule(ctx);
            return;
        }
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("enabled", true)) return;
        String hoy = today();
        if (hoy.equals(p.getString("lastDay", ""))) return;    // una vez al día
        if (notifyDue(ctx, false)) p.edit().putString("lastDay", hoy).apply();
    }

    // ---------------------------------------------------------------- notificación

    /** Muestra la notificación con los avisos que ya tocan. Devuelve false si no hay ninguno. */
    static boolean notifyDue(Context ctx, boolean evenIfEmpty) {
        List<String[]> due = dueAlerts(ctx);
        if (due.isEmpty() && !evenIfEmpty) return false;
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Agenda y avisos", NotificationManager.IMPORTANCE_DEFAULT));

        Intent open = new Intent(ctx, MainActivity.class).putExtra(EXTRA_AGENDA, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = due.isEmpty() ? "PortoValla · sin avisos pendientes"
                : "PortoValla · " + due.size() + (due.size() == 1 ? " aviso" : " avisos") + " en la agenda";
        Notification.InboxStyle style = new Notification.InboxStyle().setBigContentTitle(title);
        for (int i = 0; i < due.size() && i < 6; i++) style.addLine(due.get(i)[0]);
        if (due.size() > 6) style.setSummaryText("y " + (due.size() - 6) + " más");
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(0xFF365F99)
                .setContentTitle(title)
                .setContentText(due.isEmpty() ? "Todo al día" : due.get(0)[0])
                .setStyle(style)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(NOTIF_ID, n);
        return true;
    }

    /** Avisos cuya fecha de aviso es hoy o anterior: [título, texto]. */
    private static List<String[]> dueAlerts(Context ctx) {
        List<String[]> out = new ArrayList<>();
        File f = new File(ctx.getFilesDir(), FILE);
        if (!f.exists()) return out;
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int off = 0, n;
            while (off < buf.length && (n = in.read(buf, off, buf.length - off)) > 0) off += n;
            JSONArray arr = new JSONArray(new String(buf, 0, off, StandardCharsets.UTF_8));
            String hoy = today();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String fecha = o.optString("fecha");
                if (!fecha.isEmpty() && fecha.compareTo(hoy) <= 0) out.add(new String[]{o.optString("titulo"), o.optString("texto")});
            }
        } catch (Exception e) {
            // fichero dañado: sin avisos
        }
        return out;
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }
}
