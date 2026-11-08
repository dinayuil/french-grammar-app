package com.fge.app;

import android.graphics.Color;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppTheme")
public class AppThemePlugin extends Plugin {

    private static final int LIGHT = Color.parseColor("#FFFFFF");
    private static final int DARK = Color.parseColor("#131F24");

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

            call.resolve();
        });
    }
}
