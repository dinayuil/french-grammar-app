package com.fge.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.util.Log;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppTheme")
public class AppThemePlugin extends Plugin {

    private static final String TAG = "AppTheme";

    // Keep in sync with THEME_COLORS in src/theme.ts and the theme-color meta in index.html.
    private static final int LIGHT = Color.parseColor("#F6F4EF");
    private static final int DARK = Color.parseColor("#0E1420");

    /** Last color/mode applied by JS; 0 means no theme has been applied yet. */
    private volatile int lastColor = 0;
    private volatile boolean lastDark = false;

    @PluginMethod
    public void apply(PluginCall call) {
        final String mode = call.getString("mode", "light");
        final boolean dark = "dark".equals(mode);
        final int color = dark ? DARK : LIGHT;

        getBridge().executeOnMainThread(() -> {
            if (getActivity() == null) {
                call.reject("Activity is not available");
                return;
            }

            lastColor = color;
            lastDark = dark;

            try {
                applyWindow(color, dark);
            } catch (RuntimeException error) {
                call.reject("Failed to apply system bar theme", error);
                return;
            }

            call.resolve();
        });
    }

    /**
     * Capacitor's built-in SystemBars plugin resets the icon appearance and the
     * decor background to the system theme on every configuration change, which
     * would clobber a forced theme. Re-apply it. Posting to the main thread keeps
     * this after SystemBars no matter the (unordered) plugin callback loop: the
     * posted runnable only runs once that synchronous loop has finished.
     */
    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);

        final int color = lastColor;
        if (color == 0 || getActivity() == null) return;

        final boolean dark = lastDark;
        getBridge().executeOnMainThread(() -> {
            if (getActivity() == null) return;
            try {
                applyWindow(color, dark);
            } catch (RuntimeException error) {
                Log.w(TAG, "Failed to re-apply system bar theme after configuration change", error);
            }
        });
    }

    private void applyWindow(int color, boolean dark) {
        Window window = getActivity().getWindow();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);

        window.getDecorView().setBackgroundColor(color);
        if (getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(color);
        }
    }
}
