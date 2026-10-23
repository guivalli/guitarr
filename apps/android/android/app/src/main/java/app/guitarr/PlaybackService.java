package app.guitarr;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Serviço em primeiro plano do Guitarr. Faz duas coisas, e para quando nenhuma é necessária:
 *  - mídia: sessão + notificação com play/pause/anterior/próxima (tela de bloqueio, fone, Bluetooth, carro).
 *    O áudio em si toca no WebView; aqui só espelhamos o estado e devolvemos os comandos ao JavaScript.
 *  - downloads: mantém o processo vivo com tela apagada enquanto o offline baixa.
 */
public class PlaybackService extends Service {
    static final String ACTION_MEDIA = "app.guitarr.MEDIA";
    static final String ACTION_MEDIA_STOP = "app.guitarr.MEDIA_STOP";
    static final String ACTION_DL = "app.guitarr.DL";
    static final String ACTION_DL_STOP = "app.guitarr.DL_STOP";
    static final String ACTION_CMD = "app.guitarr.CMD";
    private static final String CH_MEDIA = "seer_media", CH_DL = "seer_downloads";
    private static final int ID_MEDIA = 4201, ID_DL = 4202;

    private MediaSession session;
    private NotificationManager nm;
    private PowerManager.WakeLock wake;
    private boolean mediaOn = false, dlOn = false, playing = false, foreground = false, noisyReg = false;
    private String title = "", artist = "", album = "", art = "", dlTitle = "", dlText = "";
    private long position = 0, duration = 0;
    private int dlProgress = 0;
    private Bitmap artBitmap;
    private String artLoaded = "";
    private long updatedAt = 0;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) SeerNativePlugin.emit("pause", -1);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CH_MEDIA, "Reprodução", NotificationManager.IMPORTANCE_LOW));
            nm.createNotificationChannel(new NotificationChannel(CH_DL, "Downloads offline", NotificationManager.IMPORTANCE_LOW));
        }
        session = new MediaSession(this, "GuitarrPlayback");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { SeerNativePlugin.emit("play", -1); }
            @Override public void onPause() { SeerNativePlugin.emit("pause", -1); }
            @Override public void onSkipToNext() { SeerNativePlugin.emit("next", -1); }
            @Override public void onSkipToPrevious() { SeerNativePlugin.emit("previous", -1); }
            @Override public void onSeekTo(long pos) { SeerNativePlugin.emit("seek", pos); }
            @Override public void onStop() { SeerNativePlugin.emit("pause", -1); }
        });
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Guitarr:service");
        wake.setReferenceCounted(false);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (a == null) { stopIfIdle(); return START_NOT_STICKY; }
        switch (a) {
            case ACTION_MEDIA:
                mediaOn = true;
                title = nz(intent.getStringExtra("title")); artist = nz(intent.getStringExtra("artist")); album = nz(intent.getStringExtra("album"));
                playing = intent.getBooleanExtra("playing", false);
                position = intent.getLongExtra("position", 0); duration = intent.getLongExtra("duration", 0);
                updatedAt = System.currentTimeMillis();
                String newArt = nz(intent.getStringExtra("art"));
                if (!newArt.equals(art)) { art = newArt; artBitmap = null; loadArt(newArt); }
                if (!noisyReg) { registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)); noisyReg = true; }
                session.setActive(true);
                applyMedia();
                break;
            case ACTION_MEDIA_STOP:
                mediaOn = false; playing = false;
                session.setActive(false);
                if (noisyReg) { try { unregisterReceiver(noisy); } catch (Exception ignored) {} noisyReg = false; }
                break;
            case ACTION_DL:
                dlOn = true;
                dlTitle = nz(intent.getStringExtra("title")); dlText = nz(intent.getStringExtra("text"));
                dlProgress = intent.getIntExtra("progress", 0);
                break;
            case ACTION_DL_STOP:
                dlOn = false;
                break;
            case ACTION_CMD:
                SeerNativePlugin.emit(nz(intent.getStringExtra("cmd")), -1);
                return START_NOT_STICKY;
        }
        refreshForeground();
        return START_NOT_STICKY;
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private void applyMedia() {
        MediaMetadata.Builder mb = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (artBitmap != null) mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBitmap);
        session.setMetadata(mb.build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f, updatedAt).build());
    }

    private void loadArt(final String url) {
        if (url.isEmpty()) return;
        new Thread(() -> {
            Bitmap b = null;
            try {
                if (url.startsWith("file:")) {
                    b = BitmapFactory.decodeFile(url.substring(url.indexOf("://") >= 0 ? url.indexOf("://") + 3 : 5));
                } else {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(8000); c.setReadTimeout(8000);
                    try (InputStream in = c.getInputStream()) { b = BitmapFactory.decodeStream(in); }
                }
            } catch (Exception ignored) {}
            if (b != null && url.equals(art)) {
                final Bitmap bb = b;
                new android.os.Handler(getMainLooper()).post(() -> { artBitmap = bb; artLoaded = url; if (mediaOn) { applyMedia(); refreshForeground(); } });
            }
        }).start();
    }

    private PendingIntent cmd(String c, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION_CMD).putExtra("cmd", c);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification mediaNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_MEDIA) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        b.setSmallIcon(R.drawable.ic_stat_guitarr).setContentTitle(title).setContentText(artist).setSubText(album)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(playing).setOnlyAlertOnce(true).setShowWhen(false);
        if (artBitmap != null) b.setLargeIcon(artBitmap);
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_previous), "Anterior", cmd("previous", 1)).build());
        b.addAction(playing
                ? new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_pause), "Pausar", cmd("pause", 2)).build()
                : new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_play), "Tocar", cmd("play", 3)).build());
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_next), "Próxima", cmd("next", 4)).build());
        b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private Notification downloadNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_DL) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        b.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(dlTitle).setContentText(dlText).setOngoing(true).setOnlyAlertOnce(true)
                .setProgress(100, Math.max(0, Math.min(100, dlProgress)), false)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return b.build();
    }

    /** Liga/desliga o primeiro plano conforme o que está ativo; a notificação de mídia tem prioridade. */
    private void refreshForeground() {
        if (!mediaOn && !dlOn) { stopIfIdle(); return; }
        Notification n = mediaOn ? mediaNotification() : downloadNotification();
        int id = mediaOn ? ID_MEDIA : ID_DL;
        int type = 0;
        if (Build.VERSION.SDK_INT >= 29) {
            type = (mediaOn ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0) | (dlOn ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(id, n, type); else startForeground(id, n);
            foreground = true;
        } catch (Exception e) { return; }
        // a notificação do outro tipo some quando só um está ativo
        nm.cancel(mediaOn ? ID_DL : ID_MEDIA);
        if (dlOn && !wake.isHeld()) wake.acquire(6 * 60 * 60 * 1000L);
        if (!dlOn && wake.isHeld()) wake.release();
    }

    private void stopIfIdle() {
        if (mediaOn || dlOn) return;
        if (wake.isHeld()) wake.release();
        try { session.setActive(false); } catch (Exception ignored) {}
        stopForeground(STOP_FOREGROUND_REMOVE);
        foreground = false;
        stopSelf();
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // app fechado pelos recentes: a Activity (e o WebView que toca o áudio) morreu, então o serviço também
        mediaOn = false; dlOn = false;
        stopIfIdle();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        if (noisyReg) { try { unregisterReceiver(noisy); } catch (Exception ignored) {} }
        if (wake != null && wake.isHeld()) wake.release();
        if (session != null) session.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
