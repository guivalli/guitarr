package app.guitarr;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.StatFs;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte JS <-> Android: espaço livre, rede, notificação de mídia e serviço de downloads. */
@CapacitorPlugin(name = "SeerNative")
public class SeerNativePlugin extends Plugin {
    private static SeerNativePlugin instance;

    @Override public void load() { instance = this; }

    /** Comando vindo da notificação, da tela de bloqueio ou do fone: vai para o JavaScript. */
    static void emit(String action, long position) {
        SeerNativePlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        if (position >= 0) o.put("position", position);
        p.notifyListeners("mediaAction", o);
    }

    @PluginMethod public void getStorage(PluginCall call) {
        try {
            StatFs fs = new StatFs(getContext().getFilesDir().getAbsolutePath());
            JSObject o = new JSObject();
            o.put("free", fs.getAvailableBytes());
            o.put("total", fs.getTotalBytes());
            call.resolve(o);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public void getNetwork(PluginCall call) {
        JSObject o = new JSObject();
        boolean connected = false, wifi = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
            connected = c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            // "Wi-Fi" aqui = rede sem franquia de dados (Wi-Fi, Ethernet, hotspot marcado como não medido)
            wifi = connected && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        } catch (Exception ignored) {}
        o.put("connected", connected);
        o.put("wifi", wifi);
        call.resolve(o);
    }

    private void send(Intent i) {
        Context c = getContext();
        try { ContextCompat.startForegroundService(c, i); } catch (Exception ignored) { /* app em segundo plano sem permissão: ignora */ }
    }

    @PluginMethod public void mediaUpdate(PluginCall call) {
        Intent i = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_MEDIA)
                .putExtra("title", call.getString("title", "")).putExtra("artist", call.getString("artist", ""))
                .putExtra("album", call.getString("album", "")).putExtra("art", call.getString("art", ""))
                .putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)))
                .putExtra("position", call.getLong("position", 0L)).putExtra("duration", call.getLong("duration", 0L));
        send(i);
        call.resolve();
    }

    @PluginMethod public void mediaStop(PluginCall call) {
        send(new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_MEDIA_STOP));
        call.resolve();
    }

    @PluginMethod public void keepAlive(PluginCall call) {
        Intent i = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_DL)
                .putExtra("title", call.getString("title", "Baixando")).putExtra("text", call.getString("text", ""))
                .putExtra("progress", call.getInt("progress", 0));
        send(i);
        call.resolve();
    }

    @PluginMethod public void keepAliveStop(PluginCall call) {
        send(new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_DL_STOP));
        call.resolve();
    }
}
