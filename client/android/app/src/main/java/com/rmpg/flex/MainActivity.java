package com.rmpg.flex;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int LOCATION_PERMISSION_REQUEST_CODE = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrganicMapsPlugin.class);
        super.onCreate(savedInstanceState);
        requestLocationPermissions();
    }

    /**
     * Request location permissions on startup.
     * GPS tracking is mandatory for all RMPG Flex officers.
     * Prompts for fine + coarse location, then background location on Android 10+.
     */
    private void requestLocationPermissions() {
        // Check if fine location is already granted
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            // Request fine + coarse location
            ActivityCompat.requestPermissions(this,
                new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                },
                LOCATION_PERMISSION_REQUEST_CODE
            );
        } else {
            // Fine location already granted — request background location on Android 10+
            requestBackgroundLocationIfNeeded();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Fine location granted — now request background location
                requestBackgroundLocationIfNeeded();
            }
        }
    }

    /**
     * On Android 10+ (API 29+), background location must be requested separately
     * after foreground location is already granted.
     */
    private void requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                    new String[]{ Manifest.permission.ACCESS_BACKGROUND_LOCATION },
                    LOCATION_PERMISSION_REQUEST_CODE + 1
                );
            }
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Forward Volume Up button presses to the WebView as custom events
        // Used for hardware panic button activation
        if (event.getKeyCode() == KeyEvent.KEYCODE_VOLUME_UP) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                // Inject keydown event into WebView
                getBridge().getWebView().evaluateJavascript(
                    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'AudioVolumeUp', code: 'AudioVolumeUp', bubbles: true }));",
                    null
                );
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                // Inject keyup event into WebView
                getBridge().getWebView().evaluateJavascript(
                    "document.dispatchEvent(new KeyboardEvent('keyup', { key: 'AudioVolumeUp', code: 'AudioVolumeUp', bubbles: true }));",
                    null
                );
            }
            // Return true to consume the event (prevent volume change)
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
