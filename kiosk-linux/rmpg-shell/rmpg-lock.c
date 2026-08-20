/*
 * rmpg-lock — screen lock for RMPG Flex terminals.
 *
 * A patrol terminal left unattended sits displaying live dispatch, warrant and
 * person data to anyone who walks past the vehicle. This covers the screen
 * after an idle period and will not uncover it until someone dismisses it.
 *
 * SECURITY MODEL — read this before changing anything here.
 *
 * This program deliberately does NOT verify a password. There is no local user
 * account on a kiosk terminal, and inventing a local PIN store would mean
 * inventing credential storage, rotation and lockout on a device sitting in a
 * vehicle — a worse position than having no local secret at all.
 *
 * Instead the lock is a *visual and input* barrier, and the real access control
 * stays where it already is: RMPG Flex's own authentication. On lock, the shell
 * signs the Flex session out (see rmpg-shell's idle watcher), so dismissing this
 * overlay reveals nothing but the Flex login page. An attacker who dismisses the
 * lock gains exactly what they would gain from a freshly booted terminal.
 *
 * That is an honest boundary rather than security theatre: this stops a passer-by
 * reading the screen, and it does not pretend to stop someone with physical
 * access and time, which no screen lock on an unattended device in a vehicle
 * genuinely can.
 */
#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <X11/Xlib.h>

/* Grab keyboard and pointer so the lock cannot be tabbed or clicked past.
 *
 * Retried rather than attempted once: another client (a menu that was open when
 * the idle timer fired, or Openbox mid-drag) can hold an active grab, and X
 * refuses ours with AlreadyGrabbed until it releases. Failing silently there
 * would leave a lock screen that looks locked but is not, which is worse than
 * not locking at all. */
static gboolean grab_input(GtkWidget *win)
{
    GdkWindow *gw = gtk_widget_get_window(win);
    GdkDisplay *display = gdk_window_get_display(gw);
    GdkSeat *seat = gdk_display_get_default_seat(display);

    for (int attempt = 0; attempt < 20; attempt++) {
        GdkGrabStatus status = gdk_seat_grab(
            seat, gw, GDK_SEAT_CAPABILITY_ALL, TRUE, NULL, NULL, NULL, NULL);
        if (status == GDK_GRAB_SUCCESS) return TRUE;
        g_usleep(100000); /* 100 ms */
    }
    g_warning("rmpg-lock: could not grab input after 2s — refusing to show a lock that can be bypassed");
    return FALSE;
}

static void on_unlock(GtkWidget *w, gpointer data)
{
    (void)w; (void)data;
    gtk_main_quit();
}

static gboolean on_key(GtkWidget *w, GdkEventKey *ev, gpointer data)
{
    (void)w; (void)data;
    /* Any key dismisses. There is nothing to type: see the security model above. */
    if (ev->type == GDK_KEY_PRESS) gtk_main_quit();
    return TRUE;
}

/* Live clock on the lock screen. An officer returning to the vehicle should be
 * able to see at a glance that the terminal is alive and current, not frozen or
 * crashed — a black or static screen is indistinguishable from a dead machine. */
static gboolean tick(gpointer label)
{
    GDateTime *now = g_date_time_new_now_local();
    char *text = g_date_time_format(now, "<span size='60000' weight='bold'>%-I:%M</span>\n"
                                        "<span size='16000'>%A, %B %-d</span>");
    gtk_label_set_markup(GTK_LABEL(label), text);
    g_free(text);
    g_date_time_unref(now);
    return G_SOURCE_CONTINUE;
}

static const char *CSS =
    "window { background-color: #0a1420; }"
    "label { color: #eef2f7; }"
    "#hint { color: #b7c2cf; font-size: 13px; }"
    "#banner { color: #ef4444; font-size: 12px; font-weight: bold; }"
    "button { color: #eef2f7; background-image: none; background-color: #16304d;"
    "         border: 1px solid #b7c2cf; border-radius: 2px; padding: 10px 28px;"
    "         font-weight: bold; }"
    "button:hover { background-color: #22405f; }";

int main(int argc, char **argv)
{
    gtk_init(&argc, &argv);

    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, CSS, -1, NULL);
    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(), GTK_STYLE_PROVIDER(css),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);

    GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_fullscreen(GTK_WINDOW(win));
    gtk_window_set_keep_above(GTK_WINDOW(win), TRUE);
    gtk_window_set_decorated(GTK_WINDOW(win), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(win), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(win), TRUE);
    /* No delete-event handler that lets it close: the only exits are a keypress
     * or the unlock button. */
    g_signal_connect(win, "key-press-event", G_CALLBACK(on_key), NULL);

    GtkWidget *col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 18);
    gtk_widget_set_halign(col, GTK_ALIGN_CENTER);
    gtk_widget_set_valign(col, GTK_ALIGN_CENTER);
    gtk_container_add(GTK_CONTAINER(win), col);

    GtkWidget *clock = gtk_label_new(NULL);
    gtk_label_set_justify(GTK_LABEL(clock), GTK_JUSTIFY_CENTER);
    gtk_box_pack_start(GTK_BOX(col), clock, FALSE, FALSE, 0);

    GtkWidget *title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(title),
        "<span size='22000' weight='bold'>TERMINAL LOCKED</span>");
    gtk_box_pack_start(GTK_BOX(col), title, FALSE, FALSE, 0);

    GtkWidget *hint = gtk_label_new("Press any key or select Unlock, then sign in to RMPG Flex.");
    gtk_widget_set_name(hint, "hint");
    gtk_box_pack_start(GTK_BOX(col), hint, FALSE, FALSE, 0);

    GtkWidget *unlock = gtk_button_new_with_label("Unlock");
    gtk_widget_set_halign(unlock, GTK_ALIGN_CENTER);
    g_signal_connect(unlock, "clicked", G_CALLBACK(on_unlock), NULL);
    gtk_box_pack_start(GTK_BOX(col), unlock, FALSE, FALSE, 10);

    /* Same restricted-system warning the Flex console carries. A locked terminal
     * is still an access point to a law-enforcement system, and the notice needs
     * to be visible before anyone touches it, not only after signing in. */
    GtkWidget *banner = gtk_label_new(
        "RESTRICTED INTERNAL SYSTEM — AUTHORIZED USERS ONLY. ALL ACTIVITY IS MONITORED AND RECORDED.");
    gtk_widget_set_name(banner, "banner");
    gtk_label_set_line_wrap(GTK_LABEL(banner), TRUE);
    gtk_label_set_justify(GTK_LABEL(banner), GTK_JUSTIFY_CENTER);
    gtk_box_pack_start(GTK_BOX(col), banner, FALSE, FALSE, 20);

    gtk_widget_show_all(win);

    if (!grab_input(win)) {
        /* Could not guarantee exclusivity. Exit rather than display a lock that
         * an attacker can alt-tab past — the shell will retry on the next idle
         * interval, and a terminal that failed to lock is at least honest about
         * it in the log. */
        gtk_widget_destroy(win);
        return 2;
    }

    tick(clock);
    g_timeout_add_seconds(1, tick, clock);

    g_print("rmpg-lock: locked\n");
    gtk_main();
    g_print("rmpg-lock: unlocked\n");
    return 0;
}
