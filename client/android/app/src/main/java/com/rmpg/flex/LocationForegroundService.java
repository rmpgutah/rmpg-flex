package com.rmpg.flex;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the GPS subsystem alive while RMPG Flex is
 * minimized or the screen is off, so officer location continues to flow to
 * dispatch. Runs purely as a "platform anchor" — actual location reading is
 * still done by the WebView's navigator.geolocation.watchPosition(), which
 * the OS lets continue running because this service holds a foreground
 * service of type "location".
 *
 * Android 14 (API 34+) requires:
 *   - FOREGROUND_SERVICE_LOCATION permission (declared in manifest)
 *   - <service android:foregroundServiceType="location" /> (declared in manifest)
 *   - startForeground(id, notification, FOREGROUND_SERVICE_TYPE_LOCATION) below
 *
 * Manual test (cannot be verified without an Android Studio build):
 *   1. cd client && npm run cap:android && npx cap sync android
 *   2. Build APK in Android Studio (Run → Run 'app')
 *   3. Sign in to RMPG Flex
 *   4. Grant fine-location and background-location when prompted
 *   5. Pull down notification shade — expect a persistent "RMPG Flex GPS active" notif
 *   6. Press home → app backgrounds → notification stays
 *   7. Open dispatch map on a desktop browser → unit position should update
 *      every ~15s while phone screen is off
 *   8. Force-stop the app → notification disappears
 */
public class LocationForegroundService extends Service {

    private static final String CHANNEL_ID = "rmpg_flex_location";
    private static final int NOTIFICATION_ID = 4001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureNotificationChannel();

        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // On API 31+ pending-intent flags must include MUTABLE/IMMUTABLE.
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openAppIntent, pendingFlags);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("RMPG Flex GPS active")
                .setContentText("Sharing your location with dispatch")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(contentIntent)
                .build();

        // Android 14+ requires the service-type arg on startForeground for type "location".
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // STICKY so the OS restarts us if it kills the service for memory pressure
        // (the WebView's geolocation watcher will reconnect on re-bind).
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // Started service, not bound
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "GPS Tracking",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Persistent notification while RMPG Flex shares your GPS location with dispatch");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    /** Convenience starter so callers don't need to construct the Intent. */
    public static void start(Context ctx) {
        Intent svc = new Intent(ctx, LocationForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(svc);
        } else {
            ctx.startService(svc);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, LocationForegroundService.class));
    }
}
