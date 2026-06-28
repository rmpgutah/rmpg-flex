package com.rmpg.flex;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OrganicMaps")
public class OrganicMapsPlugin extends Plugin {

    private static final String OM_PACKAGE = "app.organicmaps";

    @PluginMethod
    public void isInstalled(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        boolean installed;
        try {
            pm.getPackageInfo(OM_PACKAGE, 0);
            installed = true;
        } catch (PackageManager.NameNotFoundException e) {
            installed = false;
        }
        JSObject ret = new JSObject();
        ret.put("installed", installed);
        call.resolve(ret);
    }

    /**
     * Opens Organic Maps centered on the destination pin. Works without an API key.
     * The officer taps OM's built-in "Route here" to start turn-by-turn from their GPS.
     * Use this as a reliable fallback and while the OM API registration is pending.
     */
    @PluginMethod
    public void openAtPoint(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        if (lat == null || lng == null) { call.reject("lat and lng required"); return; }
        String label = call.getString("label", "");

        Uri uri = Uri.parse("geo:" + lat + "," + lng + "?q=" + lat + "," + lng
                + "(" + Uri.encode(label) + ")");
        Intent intent = new Intent(Intent.ACTION_VIEW, uri).setPackage(OM_PACKAGE);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Organic Maps not installed or could not be launched", e);
        }
    }

    /**
     * Requests Organic Maps to start turn-by-turn navigation from current GPS
     * to the destination. If buildNavigationIntent() returns null (e.g. before
     * the OM API signup completes), we transparently fall back to a geo: pin.
     */
    @PluginMethod
    public void startNavigation(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        if (lat == null || lng == null) { call.reject("lat and lng required"); return; }
        String label = call.getString("label", "");

        Intent navIntent = buildNavigationIntent(lat, lng, label);
        Intent intent = (navIntent != null) ? navIntent : new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("geo:" + lat + "," + lng + "?q=" + lat + "," + lng
                        + "(" + Uri.encode(label) + ")")
        ).setPackage(OM_PACKAGE);

        try {
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("mode", (navIntent != null) ? "turn-by-turn" : "pin-fallback");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Organic Maps not installed or could not be launched", e);
        }
    }

    /**
     * USER CONTRIBUTION (~5-10 lines): fill in OM's Intent extras here after signup.
     * Return null to fall back to the geo: pin behavior.
     *
     * Reference: https://github.com/organicmaps/api-android
     *
     * Sketch (verify constants against the current README — OM occasionally
     * renames the extra keys):
     *
     *   String apiId  = "YOUR_OM_API_ID_HERE";
     *   String action = "app.organicmaps.api.request";
     *   // Build a MWMPoint Parcelable — see MapsWithMeApi in the api-android lib
     *   Parcelable point = new MWMPoint(lat, lng, label);
     *   return new Intent(action)
     *       .setPackage(OM_PACKAGE)
     *       .putExtra("app.organicmaps.api.version", 1)
     *       .putExtra("app.organicmaps.api.api_id", apiId)
     *       .putExtra("app.organicmaps.api.api_name", "RMPG Flex")
     *       .putExtra("app.organicmaps.api.points", new Parcelable[] { point })
     *       .putExtra("app.organicmaps.api.return_on_balloon_click", true);
     *       // Add the turn-by-turn flag the README specifies, if any.
     *
     * You'll likely want to vendor the api-android library (Gradle dep or
     * drop the MWMPoint class into this package) before this compiles.
     */
    private Intent buildNavigationIntent(double lat, double lng, String label) {
        return null;
    }
}
