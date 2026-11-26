package com.fge.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FgeRelease")
public class FgeReleasePlugin extends Plugin {
    private static final Uri RELEASE_PAGE = Uri.parse(
        "https://github.com/dinayuil/french-grammar-app/releases/tag/client-latest"
    );

    @PluginMethod
    public void openRelease(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            Activity activity = getActivity();
            if (activity == null || !"com.fge.open".equals(activity.getPackageName())) {
                call.reject("Public Android client is not available");
                return;
            }
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, RELEASE_PAGE);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                activity.startActivity(intent);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Could not open the release page", error);
            }
        });
    }
}
