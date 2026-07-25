/*
 * rmpg-shell — the RMPG Flex Desktop taskbar.
 *
 * A Windows-style taskbar for the kiosk-linux desktop: Start button and menu
 * on the left, a live window list in the middle, and a clock plus status
 * indicators on the right. Written directly against GTK3 + Xlib rather than
 * using an off-the-shelf panel because Buildroot 2024.02.9 packages none of
 * them (no tint2, no lxpanel, no xfce4-panel — checked), and because a
 * first-party shell is what makes the "locked down / managed" requirement
 * enforceable: the Start menu serves a fixed application list from
 * /etc/rmpg-desktop/apps.conf, so a user cannot launch something that policy
 * did not put there.
 *
 * The window list is driven by EWMH properties on the X root window
 * (_NET_CLIENT_LIST, _NET_ACTIVE_WINDOW, _NET_WM_NAME) rather than libwnck,
 * which Buildroot also does not package. Openbox is a fully EWMH-compliant WM,
 * so these properties are authoritative.
 *
 * Struts: the panel reserves screen space via _NET_WM_STRUT_PARTIAL so
 * maximized windows stop at the top of the taskbar instead of hiding behind
 * it — the single detail that most makes a panel feel native rather than a
 * floating window that happens to sit at the bottom.
 */
#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <glib/gstdio.h>   /* g_chmod — not pulled in by glib.h */
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>

#define PANEL_HEIGHT 40
#define APPS_CONF "/etc/rmpg-desktop/apps.conf"
#define MAX_TITLE_CHARS 28

typedef struct {
    char name[128];
    char exec[256];
    char icon[128];
    int  admin_only;
} AppEntry;

static AppEntry  g_apps[64];
static int       g_app_count;
static GtkWidget *g_task_box;
static GtkWidget *g_clock_label;
static GtkWidget *g_battery_label;
static GtkWidget *g_net_label;
static GtkWidget *g_res_label;
static gboolean   g_admin_mode;

/*
 * Forward declarations. The Start menu is built before the Wi-Fi and
 * system-information sections appear in this file, and the Wi-Fi code calls
 * run_capture() which is defined down with the system-info helpers. Declaring
 * them here keeps the file in reading order (panel, then features) instead of
 * reordering everything to satisfy the compiler.
 */
static char *run_capture(const char *cmd);
static void  on_system_info(GtkMenuItem *item, gpointer data);
static void  on_wifi_settings(GtkMenuItem *item, gpointer data);
static void  update_network(void);
/* Idle lock lives further down (it needs run_capture and the status labels), but
 * the Start menu wires up "Lock terminal" before that point. */
static void  on_lock_now(GtkMenuItem *item, gpointer data);

/* ---------------------------------------------------------------- helpers */

/*
 * gtk_widget_destroy has the wrong arity for GtkCallback, and casting it
 * directly trips -Wcast-function-type. A one-line wrapper with the right
 * signature is the correct fix rather than silencing the warning.
 */
static void destroy_child(GtkWidget *widget, gpointer data)
{
    (void)data;
    gtk_widget_destroy(widget);
}


static Display *xdisplay(void) { return GDK_DISPLAY_XDISPLAY(gdk_display_get_default()); }

/*
 * Read a window property. Returns a newly-allocated buffer the caller frees
 * with XFree, or NULL. Wrapping XGetWindowProperty is worth it here because
 * every EWMH read needs the same six ignored out-params.
 */
static unsigned char *get_prop(Window w, Atom prop, Atom type, unsigned long *nitems)
{
    Atom actual_type;
    int actual_format;
    unsigned long bytes_after;
    unsigned char *data = NULL;

    if (XGetWindowProperty(xdisplay(), w, prop, 0, 4096, False, type,
                           &actual_type, &actual_format, nitems,
                           &bytes_after, &data) != Success)
        return NULL;
    if (!data)
        return NULL;
    if (actual_type == None) { XFree(data); return NULL; }
    return data;
}

/*
 * Window title, preferring _NET_WM_NAME (UTF-8) over the legacy WM_NAME
 * (Latin-1). Apps that set only the legacy property still get a usable label.
 */
static char *window_title(Window w)
{
    Display *d = xdisplay();
    unsigned long n = 0;
    unsigned char *data = get_prop(w, XInternAtom(d, "_NET_WM_NAME", False),
                                   XInternAtom(d, "UTF8_STRING", False), &n);
    if (data) {
        char *title = g_strdup((char *)data);
        XFree(data);
        if (*title) return title;
        g_free(title);
    }
    char *legacy = NULL;
    if (XFetchName(d, w, &legacy) && legacy) {
        char *title = g_strdup(legacy);
        XFree(legacy);
        return title;
    }
    return g_strdup("Untitled");
}

/*
 * Skip windows the user should never see a taskbar button for: our own panel,
 * the desktop layer, and anything flagged _NET_WM_STATE_SKIP_TASKBAR or typed
 * as DOCK/DESKTOP. Without this the panel lists pcmanfm's desktop window and
 * itself.
 */
static gboolean should_skip(Window w)
{
    Display *d = xdisplay();
    unsigned long n = 0;

    unsigned char *type = get_prop(w, XInternAtom(d, "_NET_WM_WINDOW_TYPE", False), XA_ATOM, &n);
    if (type) {
        Atom *atoms = (Atom *)type;
        Atom dock    = XInternAtom(d, "_NET_WM_WINDOW_TYPE_DOCK", False);
        Atom desktop = XInternAtom(d, "_NET_WM_WINDOW_TYPE_DESKTOP", False);
        for (unsigned long i = 0; i < n; i++) {
            if (atoms[i] == dock || atoms[i] == desktop) { XFree(type); return TRUE; }
        }
        XFree(type);
    }

    n = 0;
    unsigned char *state = get_prop(w, XInternAtom(d, "_NET_WM_STATE", False), XA_ATOM, &n);
    if (state) {
        Atom *atoms = (Atom *)state;
        Atom skip = XInternAtom(d, "_NET_WM_STATE_SKIP_TASKBAR", False);
        for (unsigned long i = 0; i < n; i++) {
            if (atoms[i] == skip) { XFree(state); return TRUE; }
        }
        XFree(state);
    }
    return FALSE;
}

/*
 * Ask the WM to activate a window, via a client message rather than
 * XSetInputFocus. Openbox needs _NET_ACTIVE_WINDOW to also raise the window
 * and switch desktops if needed; raw focus-setting would focus an obscured
 * window and look like nothing happened.
 */
static void activate_window(Window w)
{
    Display *d = xdisplay();
    XEvent ev;
    memset(&ev, 0, sizeof(ev));
    ev.xclient.type = ClientMessage;
    ev.xclient.window = w;
    ev.xclient.message_type = XInternAtom(d, "_NET_ACTIVE_WINDOW", False);
    ev.xclient.format = 32;
    ev.xclient.data.l[0] = 2;              /* source: pager/taskbar */
    ev.xclient.data.l[1] = CurrentTime;
    XSendEvent(d, DefaultRootWindow(d), False,
               SubstructureRedirectMask | SubstructureNotifyMask, &ev);
    XFlush(d);
}

/* Minimize (iconify) — clicking the active window's button should hide it,
 * matching Windows' toggle behavior. */
static void minimize_window(Window w)
{
    Display *d = xdisplay();
    XIconifyWindow(d, w, DefaultScreen(d));
    XFlush(d);
}

static Window active_window(void)
{
    Display *d = xdisplay();
    unsigned long n = 0;
    unsigned char *data = get_prop(DefaultRootWindow(d),
                                   XInternAtom(d, "_NET_ACTIVE_WINDOW", False),
                                   XA_WINDOW, &n);
    if (!data) return None;
    Window w = *(Window *)data;
    XFree(data);
    return w;
}

/* ------------------------------------------------------------ window list */

static void on_task_clicked(GtkButton *btn, gpointer data)
{
    Window w = (Window)(uintptr_t)data;
    (void)btn;
    if (active_window() == w)
        minimize_window(w);
    else
        activate_window(w);
}

static void rebuild_task_list(void)
{
    Display *d = xdisplay();
    Window active = active_window();

    gtk_container_foreach(GTK_CONTAINER(g_task_box),
                          destroy_child, NULL);

    unsigned long n = 0;
    unsigned char *data = get_prop(DefaultRootWindow(d),
                                   XInternAtom(d, "_NET_CLIENT_LIST", False),
                                   XA_WINDOW, &n);
    if (!data) { gtk_widget_show_all(g_task_box); return; }

    Window *wins = (Window *)data;
    for (unsigned long i = 0; i < n; i++) {
        if (should_skip(wins[i])) continue;

        char *title = window_title(wins[i]);
        if (g_utf8_strlen(title, -1) > MAX_TITLE_CHARS) {
            char *cut = g_utf8_substring(title, 0, MAX_TITLE_CHARS);
            char *ell = g_strconcat(cut, "…", NULL);
            g_free(title); g_free(cut);
            title = ell;
        }

        GtkWidget *btn = gtk_button_new_with_label(title);
        gtk_widget_set_size_request(btn, 180, PANEL_HEIGHT - 8);
        gtk_button_set_relief(GTK_BUTTON(btn),
                              wins[i] == active ? GTK_RELIEF_NORMAL : GTK_RELIEF_NONE);
        gtk_widget_set_tooltip_text(btn, title);
        GtkWidget *label = gtk_bin_get_child(GTK_BIN(btn));
        gtk_label_set_xalign(GTK_LABEL(label), 0.0);
        gtk_label_set_ellipsize(GTK_LABEL(label), PANGO_ELLIPSIZE_END);
        if (wins[i] == active)
            gtk_style_context_add_class(gtk_widget_get_style_context(btn), "task-active");

        g_signal_connect(btn, "clicked", G_CALLBACK(on_task_clicked),
                         (gpointer)(uintptr_t)wins[i]);
        gtk_box_pack_start(GTK_BOX(g_task_box), btn, FALSE, FALSE, 0);
        g_free(title);
    }
    XFree(data);
    gtk_widget_show_all(g_task_box);
}

/*
 * Root-window PropertyNotify filter. Rebuilding only when _NET_CLIENT_LIST or
 * _NET_ACTIVE_WINDOW actually change avoids the rebuild storm that a plain
 * timer poll would cause (the root window sees frequent unrelated property
 * traffic).
 */
static GdkFilterReturn root_filter(GdkXEvent *xev, GdkEvent *ev, gpointer data)
{
    XEvent *e = (XEvent *)xev;
    (void)ev; (void)data;
    if (e->type == PropertyNotify) {
        Display *d = xdisplay();
        if (e->xproperty.atom == XInternAtom(d, "_NET_CLIENT_LIST", False) ||
            e->xproperty.atom == XInternAtom(d, "_NET_ACTIVE_WINDOW", False))
            rebuild_task_list();
    }
    return GDK_FILTER_CONTINUE;
}

/* -------------------------------------------------------------- Start menu */

/*
 * Application list. Fixed, policy-controlled, and read once at startup from
 * /etc/rmpg-desktop/apps.conf — format:
 *   Name|command to exec|icon-name|admin_only(0|1)
 * Entries flagged admin_only are hidden unless the shell was started with
 * --admin, which is how a fielded terminal keeps the terminal emulator and
 * other diagnostic tools out of an officer's Start menu.
 */
static void load_apps(void)
{
    FILE *f = fopen(APPS_CONF, "r");
    if (!f) {
        g_warning("rmpg-shell: cannot read %s — Start menu will be empty", APPS_CONF);
        return;
    }
    char line[600];
    while (fgets(line, sizeof(line), f) && g_app_count < (int)G_N_ELEMENTS(g_apps)) {
        char *p = strchr(line, '\n'); if (p) *p = '\0';
        if (line[0] == '#' || line[0] == '\0') continue;

        char **parts = g_strsplit(line, "|", 4);
        if (g_strv_length(parts) >= 3) {
            AppEntry *a = &g_apps[g_app_count++];
            g_strlcpy(a->name, g_strstrip(parts[0]), sizeof(a->name));
            g_strlcpy(a->exec, g_strstrip(parts[1]), sizeof(a->exec));
            g_strlcpy(a->icon, g_strstrip(parts[2]), sizeof(a->icon));
            a->admin_only = (g_strv_length(parts) >= 4) ? atoi(g_strstrip(parts[3])) : 0;
        }
        g_strfreev(parts);
    }
    fclose(f);
}

static void launch(const char *cmd)
{
    GError *err = NULL;
    /* g_spawn_command_line_async detaches the child, so a launched app
     * surviving a shell restart is intentional. */
    if (!g_spawn_command_line_async(cmd, &err)) {
        g_warning("rmpg-shell: failed to launch \"%s\": %s", cmd, err ? err->message : "?");
        g_clear_error(&err);
    }
}

static void on_app_activate(GtkMenuItem *item, gpointer data)
{
    (void)item;
    launch((const char *)data);
}

static void on_logoff(GtkMenuItem *item, gpointer data)
{
    (void)item; (void)data;
    /* Ending the X session drops back to the session supervisor, which starts
     * a fresh one — the desktop equivalent of signing out. */
    launch("openbox --exit");
}

static void on_reboot(GtkMenuItem *item, gpointer data)  { (void)item; (void)data; launch("/sbin/reboot"); }
static void on_shutdown(GtkMenuItem *item, gpointer data){ (void)item; (void)data; launch("/sbin/poweroff"); }

static void on_start_clicked(GtkButton *btn, gpointer data)
{
    (void)data;
    GtkWidget *menu = gtk_menu_new();

    GtkWidget *header = gtk_menu_item_new_with_label("RMPG Flex Terminal");
    gtk_widget_set_sensitive(header, FALSE);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), header);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

    for (int i = 0; i < g_app_count; i++) {
        if (g_apps[i].admin_only && !g_admin_mode) continue;
        GtkWidget *item = gtk_menu_item_new_with_label(g_apps[i].name);
        g_signal_connect(item, "activate", G_CALLBACK(on_app_activate), g_apps[i].exec);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    }

    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

    GtkWidget *lock = gtk_menu_item_new_with_label("Lock terminal");
    g_signal_connect(lock, "activate", G_CALLBACK(on_lock_now), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), lock);

    GtkWidget *wifi = gtk_menu_item_new_with_label("Wi-Fi…");
    g_signal_connect(wifi, "activate", G_CALLBACK(on_wifi_settings), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), wifi);

    GtkWidget *sysinfo = gtk_menu_item_new_with_label("System Information");
    g_signal_connect(sysinfo, "activate", G_CALLBACK(on_system_info), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), sysinfo);

    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

    GtkWidget *logoff = gtk_menu_item_new_with_label("Sign out");
    g_signal_connect(logoff, "activate", G_CALLBACK(on_logoff), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), logoff);

    GtkWidget *reboot = gtk_menu_item_new_with_label("Restart");
    g_signal_connect(reboot, "activate", G_CALLBACK(on_reboot), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), reboot);

    GtkWidget *shutdown = gtk_menu_item_new_with_label("Shut down");
    g_signal_connect(shutdown, "activate", G_CALLBACK(on_shutdown), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), shutdown);

    gtk_widget_show_all(menu);
    gtk_menu_popup_at_widget(GTK_MENU(menu), GTK_WIDGET(btn),
                             GDK_GRAVITY_NORTH_WEST, GDK_GRAVITY_SOUTH_WEST, NULL);
}

/* ------------------------------------------------- system status indicators */

/* Read a small sysfs/proc file into a trimmed string. Returns NULL if absent —
 * every caller must tolerate that, because the whole point is running
 * unchanged on hardware that has the file (FZ-55) and hardware that does not
 * (QEMU has no battery at all). */
static char *read_sys(const char *path)
{
    char *contents = NULL;
    gsize len = 0;
    if (!g_file_get_contents(path, &contents, &len, NULL))
        return NULL;
    return g_strstrip(contents);
}

/*
 * Battery. The FZ-55 ships with two bays (BAT0/BAT1), so capacity is averaged
 * across every battery present rather than reporting only the first — a
 * single-bay reading on a dual-bay unit would show "50%" while the machine
 * actually has a full charge in the second bay.
 */
static void update_battery(void)
{
    GDir *dir = g_dir_open("/sys/class/power_supply", 0, NULL);
    if (!dir) { gtk_widget_hide(g_battery_label); return; }

    int total = 0, count = 0;
    gboolean charging = FALSE, have_ac = FALSE, ac_online = FALSE;
    const char *name;

    while ((name = g_dir_read_name(dir))) {
        char *type_path = g_strdup_printf("/sys/class/power_supply/%s/type", name);
        char *type = read_sys(type_path);
        g_free(type_path);
        if (!type) continue;

        if (g_strcmp0(type, "Battery") == 0) {
            char *cap_path = g_strdup_printf("/sys/class/power_supply/%s/capacity", name);
            char *cap = read_sys(cap_path);
            g_free(cap_path);
            if (cap) {
                total += atoi(cap);
                count++;
                g_free(cap);
            }
            char *st_path = g_strdup_printf("/sys/class/power_supply/%s/status", name);
            char *st = read_sys(st_path);
            g_free(st_path);
            if (st) {
                if (g_strcmp0(st, "Charging") == 0) charging = TRUE;
                g_free(st);
            }
        } else if (g_strcmp0(type, "Mains") == 0) {
            have_ac = TRUE;
            char *on_path = g_strdup_printf("/sys/class/power_supply/%s/online", name);
            char *on = read_sys(on_path);
            g_free(on_path);
            if (on) { ac_online = (atoi(on) == 1); g_free(on); }
        }
        g_free(type);
    }
    g_dir_close(dir);

    if (count == 0) {
        /* No battery: a desk-mounted terminal or a VM. Show AC state if we can
         * see a mains supply, otherwise hide the indicator entirely rather
         * than displaying a meaningless 0%. */
        if (have_ac) {
            gtk_label_set_text(GTK_LABEL(g_battery_label), ac_online ? "AC" : "No AC");
            gtk_widget_show(g_battery_label);
        } else {
            gtk_widget_hide(g_battery_label);
        }
        return;
    }

    int pct = total / count;
    const char *glyph = charging ? "⚡" : "";
    char *text = count > 1
        ? g_strdup_printf("%s%d%% (%d bat)", glyph, pct, count)
        : g_strdup_printf("%s%d%%", glyph, pct);
    gtk_label_set_text(GTK_LABEL(g_battery_label), text);

    /* Colour-code low charge — on a patrol vehicle this is the difference
     * between noticing and being caught out. */
    GtkStyleContext *ctx = gtk_widget_get_style_context(g_battery_label);
    gtk_style_context_remove_class(ctx, "warn");
    gtk_style_context_remove_class(ctx, "critical");
    if (!charging && pct <= 10)      gtk_style_context_add_class(ctx, "critical");
    else if (!charging && pct <= 25) gtk_style_context_add_class(ctx, "warn");

    g_free(text);
    gtk_widget_show(g_battery_label);
}

/* Primary non-loopback IPv4 address, or NULL when offline. */
static char *primary_ipv4(void)
{
    char *out = NULL;
    if (!g_spawn_command_line_sync("ip -4 -o addr show scope global",
                                   &out, NULL, NULL, NULL) || !out)
        return NULL;

    char *addr = NULL;
    char **lines = g_strsplit(out, "\n", -1);
    for (int i = 0; lines[i] && !addr; i++) {
        if (!*lines[i]) continue;
        char **f = g_strsplit_set(lines[i], " ", -1);
        for (int j = 0; f[j]; j++) {
            if (g_strcmp0(f[j], "inet") == 0 && f[j + 1]) {
                char **cidr = g_strsplit(f[j + 1], "/", 2);
                addr = g_strdup(cidr[0]);
                g_strfreev(cidr);
                break;
            }
        }
        g_strfreev(f);
    }
    g_strfreev(lines);
    g_free(out);
    return addr;
}

static void update_network(void)
{
    char *ip = primary_ipv4();
    if (ip) {
        char *text = g_strdup_printf("● %s", ip);
        gtk_label_set_text(GTK_LABEL(g_net_label), text);
        gtk_style_context_remove_class(gtk_widget_get_style_context(g_net_label), "critical");
        g_free(text);
        g_free(ip);
    } else {
        gtk_label_set_text(GTK_LABEL(g_net_label), "● Offline");
        gtk_style_context_add_class(gtk_widget_get_style_context(g_net_label), "critical");
    }
}

/* Memory pressure from /proc/meminfo. MemAvailable is the honest number —
 * MemFree ignores reclaimable cache and makes a healthy system look starved. */
static void mem_stats(long *total_kb, long *avail_kb)
{
    *total_kb = *avail_kb = 0;
    char *contents = NULL;
    if (!g_file_get_contents("/proc/meminfo", &contents, NULL, NULL)) return;
    char **lines = g_strsplit(contents, "\n", -1);
    for (int i = 0; lines[i]; i++) {
        if (g_str_has_prefix(lines[i], "MemTotal:"))     sscanf(lines[i], "MemTotal: %ld kB", total_kb);
        else if (g_str_has_prefix(lines[i], "MemAvailable:")) sscanf(lines[i], "MemAvailable: %ld kB", avail_kb);
    }
    g_strfreev(lines);
    g_free(contents);
}

static void update_resources(void)
{
    long total = 0, avail = 0;
    mem_stats(&total, &avail);
    if (total <= 0) { gtk_widget_hide(g_res_label); return; }
    int used_pct = (int)(100.0 * (total - avail) / total);
    char *text = g_strdup_printf("RAM %d%%", used_pct);
    gtk_label_set_text(GTK_LABEL(g_res_label), text);
    g_free(text);
    gtk_widget_show(g_res_label);
}

/* ---------------------------------------------------------------- Wi-Fi UI */

/*
 * Wi-Fi is driven through connmanctl rather than D-Bus. connman already owns
 * scanning, association, DHCP and — the part that matters for an unattended
 * terminal — persisting known networks so it reconnects by itself after a
 * reboot or a dropout. Shelling out to its CLI keeps that behavior and leaves
 * no D-Bus client code to maintain here.
 *
 * Service identifiers look like: wifi_001122334455_5353494431_managed_psk
 * `connmanctl services` prints "  *AO NetworkName    <service-id>", where the
 * leading flags mark the connected service.
 */
typedef struct {
    char id[192];
    char name[128];
    gboolean connected;
    gboolean secured;
} WifiService;

static WifiService g_wifi[64];
static int         g_wifi_count;
static GtkWidget  *g_wifi_list;
static GtkWidget  *g_wifi_status;

static void wifi_scan_services(void)
{
    g_wifi_count = 0;
    char *out = run_capture("connmanctl services");
    if (!out) return;

    char **lines = g_strsplit(out, "\n", -1);
    for (int i = 0; lines[i] && g_wifi_count < (int)G_N_ELEMENTS(g_wifi); i++) {
        /* Only wifi_* services; skip ethernet and vpn entries. */
        char *svc = strstr(lines[i], "wifi_");
        if (!svc) continue;

        WifiService *w = &g_wifi[g_wifi_count];
        g_strlcpy(w->id, g_strstrip(svc), sizeof(w->id));
        w->secured = (strstr(w->id, "_psk") || strstr(w->id, "_ieee8021x")) ? TRUE : FALSE;

        /* Everything before the service id is "flags + name". The flags column
         * is the first 4 characters; connected services carry 'O' (online) or
         * 'R' (ready). */
        size_t prefix_len = svc - lines[i];
        char *prefix = g_strndup(lines[i], prefix_len);
        w->connected = (prefix_len >= 4 &&
                        (prefix[2] == 'O' || prefix[2] == 'R' ||
                         prefix[3] == 'O' || prefix[3] == 'R'));
        char *name = g_strstrip(prefix + (prefix_len >= 4 ? 4 : 0));
        g_strlcpy(w->name, *name ? name : "(hidden network)", sizeof(w->name));
        g_free(prefix);

        g_wifi_count++;
    }
    g_strfreev(lines);
    g_free(out);
}

static void wifi_populate_list(void)
{
    gtk_container_foreach(GTK_CONTAINER(g_wifi_list),
                          destroy_child, NULL);

    if (g_wifi_count == 0) {
        GtkWidget *empty = gtk_label_new("No networks found yet — scanning…");
        gtk_label_set_xalign(GTK_LABEL(empty), 0.0);
        gtk_box_pack_start(GTK_BOX(g_wifi_list), empty, FALSE, FALSE, 6);
    }

    for (int i = 0; i < g_wifi_count; i++) {
        char *label = g_strdup_printf("%s%s%s",
                                      g_wifi[i].connected ? "✓ " : "",
                                      g_wifi[i].name,
                                      g_wifi[i].secured ? "  🔒" : "");
        GtkWidget *btn = gtk_button_new_with_label(label);
        GtkWidget *lbl = gtk_bin_get_child(GTK_BIN(btn));
        gtk_label_set_xalign(GTK_LABEL(lbl), 0.0);
        g_object_set_data(G_OBJECT(btn), "wifi-index", GINT_TO_POINTER(i));
        gtk_box_pack_start(GTK_BOX(g_wifi_list), btn, FALSE, FALSE, 0);
        g_free(label);
    }
    gtk_widget_show_all(g_wifi_list);
}

static void on_show_password_toggled(GtkToggleButton *btn, gpointer entry)
{
    gtk_entry_set_visibility(GTK_ENTRY(entry), gtk_toggle_button_get_active(btn));
}

/* Ask for a passphrase. connmanctl's own agent is interactive, so instead of
 * driving it we write the passphrase into a connman "provisioning" config
 * file, which connman reads and applies without any prompt. */
static char *ask_passphrase(GtkWindow *parent, const char *ssid)
{
    GtkWidget *dlg = gtk_dialog_new_with_buttons("Wi-Fi password", parent,
                                                 GTK_DIALOG_MODAL,
                                                 "Cancel", GTK_RESPONSE_CANCEL,
                                                 "Connect", GTK_RESPONSE_OK, NULL);
    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dlg));
    gtk_container_set_border_width(GTK_CONTAINER(content), 14);

    char *prompt_text = g_strdup_printf("Enter the password for \"%s\":", ssid);
    GtkWidget *prompt = gtk_label_new(prompt_text);
    gtk_label_set_xalign(GTK_LABEL(prompt), 0.0);
    g_free(prompt_text);

    GtkWidget *entry = gtk_entry_new();
    gtk_entry_set_visibility(GTK_ENTRY(entry), FALSE);
    gtk_entry_set_input_purpose(GTK_ENTRY(entry), GTK_INPUT_PURPOSE_PASSWORD);
    gtk_entry_set_activates_default(GTK_ENTRY(entry), TRUE);
    gtk_widget_set_size_request(entry, 320, -1);

    GtkWidget *show = gtk_check_button_new_with_label("Show password");
    g_signal_connect(show, "toggled", G_CALLBACK(on_show_password_toggled), entry);

    gtk_box_pack_start(GTK_BOX(content), prompt, FALSE, FALSE, 6);
    gtk_box_pack_start(GTK_BOX(content), entry, FALSE, FALSE, 4);
    gtk_box_pack_start(GTK_BOX(content), show, FALSE, FALSE, 2);
    gtk_dialog_set_default_response(GTK_DIALOG(dlg), GTK_RESPONSE_OK);
    gtk_widget_show_all(dlg);

    char *result = NULL;
    if (gtk_dialog_run(GTK_DIALOG(dlg)) == GTK_RESPONSE_OK)
        result = g_strdup(gtk_entry_get_text(GTK_ENTRY(entry)));
    gtk_widget_destroy(dlg);
    return result;
}

static void wifi_set_status(const char *msg)
{
    if (g_wifi_status) gtk_label_set_text(GTK_LABEL(g_wifi_status), msg);
    /* Pump the main loop so the status text actually paints before the
     * blocking connect call below — otherwise the window looks frozen with no
     * feedback for several seconds. */
    while (gtk_events_pending()) gtk_main_iteration();
}

static void wifi_connect(GtkWindow *parent, int index)
{
    if (index < 0 || index >= g_wifi_count) return;
    WifiService *w = &g_wifi[index];

    if (w->secured) {
        char *pass = ask_passphrase(parent, w->name);
        if (!pass) return;

        /*
         * Provisioning file: connman applies this without an interactive
         * agent. Written to the runtime config dir with 0600 — it contains a
         * network credential and must not be world-readable.
         */
        g_mkdir_with_parents("/var/lib/connman", 0755);
        char *cfg = g_strdup_printf("/var/lib/connman/rmpg-%s.config", w->name);
        char *body = g_strdup_printf(
            "[global]\nName=RMPG provisioned\n\n"
            "[service_%s]\nType=wifi\nName=%s\nPassphrase=%s\n",
            w->name, w->name, pass);
        GError *err = NULL;
        if (!g_file_set_contents(cfg, body, -1, &err)) {
            wifi_set_status(err ? err->message : "Could not save network settings");
            g_clear_error(&err);
        } else {
            g_chmod(cfg, 0600);
        }
        /* Wipe the plaintext copy from our own memory promptly. */
        memset(body, 0, strlen(body));
        g_free(body); g_free(cfg);
        memset(pass, 0, strlen(pass));
        g_free(pass);
    }

    wifi_set_status("Connecting…");
    char *cmd = g_strdup_printf("connmanctl connect %s", w->id);
    char *out = run_capture(cmd);
    g_free(cmd);

    if (out && (strstr(out, "Connected") || !strstr(out, "Error"))) {
        wifi_set_status("Connected.");
    } else {
        char *msg = g_strdup_printf("Could not connect: %s",
                                    out && *out ? out : "no response from connman");
        wifi_set_status(msg);
        g_free(msg);
    }
    g_free(out);

    wifi_scan_services();
    wifi_populate_list();
    update_network();
}

static void on_wifi_row_clicked(GtkWidget *btn, gpointer parent)
{
    int idx = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(btn), "wifi-index"));
    wifi_connect(GTK_WINDOW(parent), idx);
}

static void wifi_refresh(GtkWidget *w, gpointer parent)
{
    (void)w;
    wifi_set_status("Scanning…");
    /* connman scans asynchronously; this call blocks until the scan completes. */
    char *out = run_capture("connmanctl scan wifi");
    g_free(out);
    wifi_scan_services();
    wifi_populate_list();

    /* Attach handlers after (re)populating. */
    GList *kids = gtk_container_get_children(GTK_CONTAINER(g_wifi_list));
    for (GList *l = kids; l; l = l->next) {
        if (GTK_IS_BUTTON(l->data))
            g_signal_connect(l->data, "clicked", G_CALLBACK(on_wifi_row_clicked), parent);
    }
    g_list_free(kids);
    wifi_set_status(g_wifi_count ? "Select a network to connect." : "No networks found.");
}

static void on_wifi_settings(GtkMenuItem *item, gpointer data)
{
    (void)item; (void)data;

    GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(win), "Wi-Fi");
    gtk_window_set_default_size(GTK_WINDOW(win), 420, 460);
    gtk_container_set_border_width(GTK_CONTAINER(win), 14);

    GtkWidget *col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_container_add(GTK_CONTAINER(win), col);

    GtkWidget *title = gtk_label_new("Available networks");
    gtk_label_set_xalign(GTK_LABEL(title), 0.0);
    gtk_box_pack_start(GTK_BOX(col), title, FALSE, FALSE, 0);

    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_widget_set_vexpand(scroll, TRUE);
    g_wifi_list = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    gtk_container_add(GTK_CONTAINER(scroll), g_wifi_list);
    gtk_box_pack_start(GTK_BOX(col), scroll, TRUE, TRUE, 0);

    g_wifi_status = gtk_label_new("Scanning…");
    gtk_label_set_xalign(GTK_LABEL(g_wifi_status), 0.0);
    gtk_box_pack_start(GTK_BOX(col), g_wifi_status, FALSE, FALSE, 0);

    GtkWidget *rescan = gtk_button_new_with_label("Scan again");
    g_signal_connect(rescan, "clicked", G_CALLBACK(wifi_refresh), win);
    gtk_box_pack_start(GTK_BOX(col), rescan, FALSE, FALSE, 0);

    gtk_widget_show_all(win);
    wifi_refresh(NULL, win);
}

/* ------------------------------------------------------ system information */

static void add_info_row(GtkGrid *grid, int row, const char *key, const char *value)
{
    GtkWidget *k = gtk_label_new(key);
    gtk_label_set_xalign(GTK_LABEL(k), 0.0);
    gtk_style_context_add_class(gtk_widget_get_style_context(k), "info-key");
    GtkWidget *v = gtk_label_new(value && *value ? value : "—");
    gtk_label_set_xalign(GTK_LABEL(v), 0.0);
    gtk_label_set_selectable(GTK_LABEL(v), TRUE);
    gtk_label_set_line_wrap(GTK_LABEL(v), TRUE);
    gtk_grid_attach(grid, k, 0, row, 1, 1);
    gtk_grid_attach(grid, v, 1, row, 1, 1);
}

/* First value for a /proc/cpuinfo key, plus a count of logical CPUs. */
static char *cpu_model(int *cores)
{
    *cores = 0;
    char *contents = NULL, *model = NULL;
    if (!g_file_get_contents("/proc/cpuinfo", &contents, NULL, NULL)) return NULL;
    char **lines = g_strsplit(contents, "\n", -1);
    for (int i = 0; lines[i]; i++) {
        if (g_str_has_prefix(lines[i], "processor")) (*cores)++;
        if (!model && g_str_has_prefix(lines[i], "model name")) {
            char *colon = strchr(lines[i], ':');
            if (colon) model = g_strdup(g_strstrip(colon + 1));
        }
    }
    g_strfreev(lines);
    g_free(contents);
    return model;
}

static char *run_capture(const char *cmd)
{
    char *out = NULL;
    if (!g_spawn_command_line_sync(cmd, &out, NULL, NULL, NULL)) return NULL;
    return out ? g_strstrip(out) : NULL;
}

static void on_system_info(GtkMenuItem *item, gpointer data)
{
    (void)item; (void)data;

    GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(win), "System Information");
    gtk_window_set_default_size(GTK_WINDOW(win), 560, 460);
    gtk_container_set_border_width(GTK_CONTAINER(win), 16);

    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    GtkWidget *grid = gtk_grid_new();
    gtk_grid_set_row_spacing(GTK_GRID(grid), 8);
    gtk_grid_set_column_spacing(GTK_GRID(grid), 20);
    gtk_container_add(GTK_CONTAINER(scroll), grid);
    gtk_container_add(GTK_CONTAINER(win), scroll);

    int row = 0, cores = 0;
    char *cpu = cpu_model(&cores);
    long total = 0, avail = 0;
    mem_stats(&total, &avail);

    add_info_row(GTK_GRID(grid), row++, "Operating system", "RMPG Flex Desktop (Kiosk Linux)");

    char *kernel = run_capture("uname -r");
    add_info_row(GTK_GRID(grid), row++, "Kernel", kernel);
    g_free(kernel);

    char *host = run_capture("hostname");
    add_info_row(GTK_GRID(grid), row++, "Device name", host);
    g_free(host);

    char *cpu_text = g_strdup_printf("%s (%d logical)", cpu ? cpu : "Unknown", cores);
    add_info_row(GTK_GRID(grid), row++, "Processor", cpu_text);
    g_free(cpu_text); g_free(cpu);

    char *mem_text = g_strdup_printf("%.1f GB total, %.1f GB available",
                                     total / 1048576.0, avail / 1048576.0);
    add_info_row(GTK_GRID(grid), row++, "Memory", mem_text);
    g_free(mem_text);

    char *disk = run_capture("sh -c \"df -h / | tail -1 | awk '{print $3\\\" used of \\\"$2\\\" (\\\"$5\\\" full)\\\"}'\"");
    add_info_row(GTK_GRID(grid), row++, "Storage", disk);
    g_free(disk);

    char *ip = primary_ipv4();
    add_info_row(GTK_GRID(grid), row++, "IP address", ip ? ip : "Offline");
    g_free(ip);

    char *uptime = run_capture("sh -c \"uptime | sed 's/.*up //; s/,  *load.*//'\"");
    add_info_row(GTK_GRID(grid), row++, "Uptime", uptime);
    g_free(uptime);

    char *display = run_capture("sh -c \"xdpyinfo | grep dimensions | awk '{print $2}'\"");
    add_info_row(GTK_GRID(grid), row++, "Display", display);
    g_free(display);

    /* Which A/B slot booted — genuinely useful in the field when a terminal
     * has self-healed onto its backup copy and nobody noticed. */
    char *slot = run_capture("sh -c \"cat /proc/cmdline | tr ' ' '\\n' | grep -o 'slot_[ab]' | head -1\"");
    add_info_row(GTK_GRID(grid), row++, "Boot slot", slot && *slot ? slot : "slot_a");
    g_free(slot);

    gtk_widget_show_all(win);
}

/* -------------------------------------------------------------- idle lock */

/*
 * Idle detection via the X Screen Saver extension. This is the only source that
 * sees ALL input — keyboard, mouse and the FZ-55's touchscreen — regardless of
 * which window received it. A timer in this process would only notice input
 * delivered to the panel, and polling devices directly misses the touchscreen.
 *
 * Loaded with dlopen rather than linked, so a build without libXss still
 * produces a working taskbar minus the lock, instead of failing to start at all.
 * A terminal with no taskbar is unusable; a terminal with no idle lock is merely
 * less secure, and says so in the log.
 */
typedef struct {
    Window window;
    int state;
    int kind;
    unsigned long til_or_since;
    unsigned long idle;      /* milliseconds since last input */
    unsigned long eventMask;
} RmpgXssInfo;

typedef RmpgXssInfo *(*XssAllocInfoFn)(void);
typedef int (*XssQueryInfoFn)(Display *, Drawable, RmpgXssInfo *);

static XssAllocInfoFn  xss_alloc_info;
static XssQueryInfoFn  xss_query_info;
static RmpgXssInfo    *xss_info;
static guint           g_idle_timeout_s;
static gboolean        g_locking;

static void init_idle_detection(void)
{
    const char *env = g_getenv("RMPG_LOCK_IDLE_SECONDS");
    /* 600s default. Long enough not to interrupt an officer reading a long
     * call narrative, short enough that a vehicle left unattended is not
     * displaying dispatch data for many minutes. 0 disables. */
    g_idle_timeout_s = env ? (guint) atoi(env) : 600;
    if (g_idle_timeout_s == 0) {
        g_message("rmpg-shell: idle lock disabled (RMPG_LOCK_IDLE_SECONDS=0)");
        return;
    }

    void *lib = dlopen("libXss.so.1", RTLD_LAZY);
    if (!lib) {
        g_warning("rmpg-shell: libXss unavailable — IDLE LOCK IS DISABLED (%s)", dlerror());
        g_idle_timeout_s = 0;
        return;
    }
    xss_alloc_info = (XssAllocInfoFn) dlsym(lib, "XScreenSaverAllocInfo");
    xss_query_info = (XssQueryInfoFn) dlsym(lib, "XScreenSaverQueryInfo");
    if (!xss_alloc_info || !xss_query_info) {
        g_warning("rmpg-shell: libXss missing expected symbols — IDLE LOCK IS DISABLED");
        g_idle_timeout_s = 0;
        return;
    }
    xss_info = xss_alloc_info();
    g_message("rmpg-shell: idle lock armed at %us", g_idle_timeout_s);
}

/*
 * Sign the Flex session out, then lock.
 *
 * Order matters: sign out FIRST. If the lock were shown first and the terminal
 * lost power or the lock crashed, the screen would come back to a still
 * authenticated console. Signing out before covering the screen means the worst
 * case is a logged-out terminal, never an unlocked authenticated one.
 *
 * Sign-out is done by restarting the console window pointed at the Flex login
 * URL. Crude, but it reuses Flex's own auth as the access boundary instead of
 * inventing a second credential path on the device — see rmpg-lock.c.
 */
static void lock_screen(void)
{
    if (g_locking) return;
    g_locking = TRUE;

    g_message("rmpg-shell: idle for %us — signing out and locking", g_idle_timeout_s);

    /* Replace the console window with a fresh, unauthenticated one. */
    if (system("pkill -f 'rmpg-browser --app=' >/dev/null 2>&1") == -1)
        g_warning("rmpg-shell: could not signal the console window");
    g_spawn_command_line_async("rmpg-browser --app=https://rmpgutah.us", NULL);

    /* Blocking: nothing else should happen in the panel while locked. */
    int rc = system("rmpg-lock");
    if (rc != 0)
        g_warning("rmpg-shell: rmpg-lock exited %d — terminal may not have locked", rc);

    g_locking = FALSE;
}

static gboolean idle_check(gpointer data)
{
    (void)data;
    if (g_idle_timeout_s == 0 || !xss_info || g_locking) return G_SOURCE_CONTINUE;

    Display *d = xdisplay();
    if (!xss_query_info(d, DefaultRootWindow(d), xss_info)) return G_SOURCE_CONTINUE;

    if (xss_info->idle / 1000 >= g_idle_timeout_s) lock_screen();
    return G_SOURCE_CONTINUE;
}

static void on_lock_now(GtkMenuItem *item, gpointer data)
{
    (void)item; (void)data;
    /* Explicit lock from the Start menu — an officer stepping out of the vehicle
     * should not have to wait for the idle timer. */
    lock_screen();
}

/* ------------------------------------------------------------------ clock */

static gboolean tick(gpointer data)
{
    (void)data;
    GDateTime *now = g_date_time_new_now_local();
    char *text = g_date_time_format(now, "%-I:%M %p\n%a %b %-d");
    gtk_label_set_text(GTK_LABEL(g_clock_label), text);
    g_free(text);
    g_date_time_unref(now);
    return G_SOURCE_CONTINUE;
}

/*
 * Slower cadence for the status indicators. Battery and memory do not change
 * meaningfully second-to-second, and `ip addr` spawns a process — polling that
 * once a second would burn measurable CPU on an idle terminal for no benefit.
 */
static gboolean slow_tick(gpointer data)
{
    (void)data;
    update_battery();
    update_network();
    update_resources();
    return G_SOURCE_CONTINUE;
}

/* ------------------------------------------------------------------ struts */

/*
 * Reserve the panel's screen area so maximized windows do not cover it.
 * _NET_WM_STRUT_PARTIAL is the modern form; the legacy _NET_WM_STRUT is set
 * too because some older toolkits only honor that one.
 */
static void set_struts(GtkWidget *win, int screen_width, int screen_height)
{
    Display *d = xdisplay();
    Window w = GDK_WINDOW_XID(gtk_widget_get_window(win));

    long strut[12] = {0};
    strut[3]  = PANEL_HEIGHT;      /* bottom */
    strut[10] = 0;                 /* bottom_start_x */
    strut[11] = screen_width - 1;  /* bottom_end_x   */
    (void)screen_height;

    XChangeProperty(d, w, XInternAtom(d, "_NET_WM_STRUT_PARTIAL", False),
                    XA_CARDINAL, 32, PropModeReplace,
                    (unsigned char *)strut, 12);
    XChangeProperty(d, w, XInternAtom(d, "_NET_WM_STRUT", False),
                    XA_CARDINAL, 32, PropModeReplace,
                    (unsigned char *)strut, 4);
}

/* -------------------------------------------------------------------- main */

static const char *CSS =
    "window { background-color: #0c1a2b; }"
    "button { color: #eef2f7; background-image: none; background-color: transparent;"
    "         border: 1px solid transparent; border-radius: 2px; padding: 2px 10px; }"
    "button:hover { background-color: #16304d; border-color: #22405f; }"
    "button.task-active { background-color: #1d3a5c; border-color: #b7c2cf; }"
    "#start-button { background-color: #16304d; border: 1px solid #b7c2cf;"
    "                font-weight: bold; padding: 2px 18px; }"
    "#start-button:hover { background-color: #22405f; }"
    "#clock { color: #b7c2cf; font-size: 10px; padding: 0 12px; }"
    "#status { color: #b7c2cf; font-size: 11px; padding: 0 8px; }"
    "#status.warn { color: #f59e0b; }"
    "#status.critical { color: #ef4444; }"
    "label.info-key { color: #b7c2cf; font-weight: bold; }"
    "menu { background-color: #12253a; color: #eef2f7; border: 1px solid #22405f; }"
    "menuitem { padding: 6px 18px; }"
    "menuitem:hover { background-color: #1d3a5c; }";

int main(int argc, char **argv)
{
    gtk_init(&argc, &argv);

    for (int i = 1; i < argc; i++)
        if (g_strcmp0(argv[i], "--admin") == 0) g_admin_mode = TRUE;

    load_apps();

    GdkScreen *screen = gdk_screen_get_default();

    /* Primary monitor geometry. gdk_screen_get_width/height are deprecated and
     * report the union of all monitors — on a dual-head terminal that would
     * stretch the taskbar across both screens. */
    GdkDisplay *display = gdk_display_get_default();
    GdkMonitor *monitor = gdk_display_get_primary_monitor(display);
    if (!monitor) monitor = gdk_display_get_monitor(display, 0);
    GdkRectangle geom = { 0, 0, 1280, 800 };
    if (monitor) gdk_monitor_get_geometry(monitor, &geom);
    int sw = geom.width;
    int sh = geom.height;

    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, CSS, -1, NULL);
    gtk_style_context_add_provider_for_screen(screen, GTK_STYLE_PROVIDER(css),
                                              GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);

    GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_type_hint(GTK_WINDOW(win), GDK_WINDOW_TYPE_HINT_DOCK);
    gtk_window_set_decorated(GTK_WINDOW(win), FALSE);
    gtk_window_set_keep_above(GTK_WINDOW(win), TRUE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(win), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(win), TRUE);
    gtk_window_move(GTK_WINDOW(win), 0, sh - PANEL_HEIGHT);
    gtk_widget_set_size_request(win, sw, PANEL_HEIGHT);

    GtkWidget *row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
    gtk_container_add(GTK_CONTAINER(win), row);

    GtkWidget *start = gtk_button_new_with_label("RMPG");
    gtk_widget_set_name(start, "start-button");
    g_signal_connect(start, "clicked", G_CALLBACK(on_start_clicked), NULL);
    gtk_box_pack_start(GTK_BOX(row), start, FALSE, FALSE, 2);

    gtk_box_pack_start(GTK_BOX(row),
                       gtk_separator_new(GTK_ORIENTATION_VERTICAL), FALSE, FALSE, 4);

    g_task_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 2);
    gtk_box_pack_start(GTK_BOX(row), g_task_box, TRUE, TRUE, 0);

    /* Status area, packed right-to-left so it reads clock | battery | net | RAM
     * left-to-right on screen, matching the Windows notification-area order. */
    g_clock_label = gtk_label_new("");
    gtk_widget_set_name(g_clock_label, "clock");
    gtk_label_set_justify(GTK_LABEL(g_clock_label), GTK_JUSTIFY_RIGHT);
    gtk_box_pack_end(GTK_BOX(row), g_clock_label, FALSE, FALSE, 0);

    g_battery_label = gtk_label_new("");
    gtk_widget_set_name(g_battery_label, "status");
    gtk_box_pack_end(GTK_BOX(row), g_battery_label, FALSE, FALSE, 0);

    /* Clicking the network indicator opens the Wi-Fi picker — the fastest
     * path to fixing the problem the indicator is reporting. */
    GtkWidget *net_btn = gtk_button_new();
    g_net_label = gtk_label_new("");
    gtk_widget_set_name(g_net_label, "status");
    gtk_container_add(GTK_CONTAINER(net_btn), g_net_label);
    gtk_button_set_relief(GTK_BUTTON(net_btn), GTK_RELIEF_NONE);
    gtk_widget_set_tooltip_text(net_btn, "Network — click to manage Wi-Fi");
    g_signal_connect(net_btn, "clicked", G_CALLBACK(on_wifi_settings), NULL);
    gtk_box_pack_end(GTK_BOX(row), net_btn, FALSE, FALSE, 0);

    g_res_label = gtk_label_new("");
    gtk_widget_set_name(g_res_label, "status");
    gtk_box_pack_end(GTK_BOX(row), g_res_label, FALSE, FALSE, 0);

    gtk_widget_show_all(win);
    set_struts(win, sw, sh);

    /* Subscribe to root-window property changes for the live window list. */
    Display *d = xdisplay();
    XSelectInput(d, DefaultRootWindow(d), PropertyChangeMask);
    gdk_window_add_filter(gdk_screen_get_root_window(screen), root_filter, NULL);

    tick(NULL);
    g_timeout_add_seconds(1, tick, NULL);
    slow_tick(NULL);
    g_timeout_add_seconds(10, slow_tick, NULL);
    init_idle_detection();
    /* 5s poll: fine-grained enough that the lock lands within a few seconds of
     * the threshold, cheap enough to be invisible (one X round-trip). */
    g_timeout_add_seconds(5, idle_check, NULL);
    rebuild_task_list();

    g_print("rmpg-shell: panel up (%dx%d, admin=%d, %d apps)\n",
            sw, PANEL_HEIGHT, g_admin_mode, g_app_count);
    gtk_main();
    return 0;
}
