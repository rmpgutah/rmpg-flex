/*
 * rmpg-browser — the RMPG Flex Desktop web browser.
 *
 * A real tabbed browser (address bar, tabs, back/forward/reload, downloads)
 * built directly on WebKitGTK. Written first-party rather than shipping midori
 * because midori depends on libpeas, which forces gobject-introspection on
 * globally and breaks the pango/harfbuzz gir chain in this Buildroot tree (see
 * configs/desktop.fragment for the full account of that failure).
 *
 * Two modes:
 *   rmpg-browser [URL...]   normal browser — tabs, address bar, the lot
 *   rmpg-browser --app=URL  chromeless single window, no tabs or address bar,
 *                           used to present RMPG Flex as an application rather
 *                           than a web page. Still a real, resizable,
 *                           minimizable window managed by Openbox.
 */
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <string.h>

#define HOME_URL "https://rmpgutah.us"

typedef struct {
    GtkWidget *window;
    GtkWidget *notebook;
    GtkWidget *url_entry;
    GtkWidget *back_btn;
    GtkWidget *forward_btn;
    GtkWidget *reload_btn;
    GtkWidget *progress;
    gboolean   app_mode;
} Browser;

static void add_tab(Browser *b, const char *uri, gboolean focus);

/* Current tab's WebView, or NULL when no tabs remain. */
static WebKitWebView *current_view(Browser *b)
{
    int page = gtk_notebook_get_current_page(GTK_NOTEBOOK(b->notebook));
    if (page < 0) return NULL;
    GtkWidget *scroll = gtk_notebook_get_nth_page(GTK_NOTEBOOK(b->notebook), page);
    return WEBKIT_WEB_VIEW(gtk_bin_get_child(GTK_BIN(scroll)));
}

/*
 * Turn whatever the user typed into something loadable. Anything with a
 * scheme, or that looks like a bare hostname, is treated as a URL; everything
 * else becomes a search. Without this, typing "rmpgutah.us" would be handed to
 * WebKit as a relative path and silently fail.
 */
static char *normalize_uri(const char *text)
{
    while (*text == ' ') text++;
    if (!*text) return g_strdup(HOME_URL);

    if (strstr(text, "://") || g_str_has_prefix(text, "about:") ||
        g_str_has_prefix(text, "data:") || g_str_has_prefix(text, "file:"))
        return g_strdup(text);

    /* A dot with no spaces reads as a hostname. */
    if (strchr(text, '.') && !strchr(text, ' '))
        return g_strdup_printf("https://%s", text);

    char *escaped = g_uri_escape_string(text, NULL, TRUE);
    char *search = g_strdup_printf("https://duckduckgo.com/?q=%s", escaped);
    g_free(escaped);
    return search;
}

static void update_chrome(Browser *b)
{
    if (b->app_mode) return;
    WebKitWebView *view = current_view(b);
    if (!view) return;

    const char *uri = webkit_web_view_get_uri(view);
    if (uri && !gtk_widget_has_focus(b->url_entry))
        gtk_entry_set_text(GTK_ENTRY(b->url_entry), uri);

    gtk_widget_set_sensitive(b->back_btn, webkit_web_view_can_go_back(view));
    gtk_widget_set_sensitive(b->forward_btn, webkit_web_view_can_go_forward(view));
}

/* --------------------------------------------------------- view callbacks */

static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer data)
{
    Browser *b = data;
    (void)view;   /* chrome state is read from the ACTIVE tab, not the sender */
    if (b->app_mode) return;

    if (event == WEBKIT_LOAD_FINISHED)
        gtk_widget_hide(b->progress);
    else
        gtk_widget_show(b->progress);
    update_chrome(b);
}

static void on_progress(GObject *obj, GParamSpec *spec, gpointer data)
{
    Browser *b = data;
    (void)spec;
    if (b->app_mode) return;
    double p = webkit_web_view_get_estimated_load_progress(WEBKIT_WEB_VIEW(obj));
    gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(b->progress), p);
}

static void on_title_changed(GObject *obj, GParamSpec *spec, gpointer data)
{
    Browser *b = data;
    (void)spec;
    WebKitWebView *view = WEBKIT_WEB_VIEW(obj);
    const char *title = webkit_web_view_get_title(view);
    if (!title || !*title) title = "Loading…";

    if (b->app_mode) {
        gtk_window_set_title(GTK_WINDOW(b->window), title);
        return;
    }

    /* Update this view's tab label, trimmed so one long title cannot squeeze
     * every other tab off the strip. */
    GtkWidget *scroll = gtk_widget_get_parent(GTK_WIDGET(view));
    GtkWidget *label_box = gtk_notebook_get_tab_label(GTK_NOTEBOOK(b->notebook), scroll);
    if (label_box) {
        GtkWidget *label = g_object_get_data(G_OBJECT(label_box), "title-label");
        if (label) {
            char *shown = g_utf8_strlen(title, -1) > 22
                ? g_strdup_printf("%s…", g_utf8_substring(title, 0, 22))
                : g_strdup(title);
            gtk_label_set_text(GTK_LABEL(label), shown);
            gtk_widget_set_tooltip_text(label, title);
            g_free(shown);
        }
    }
    gtk_window_set_title(GTK_WINDOW(b->window), title);
}

/* Open target=_blank / window.open in a new tab rather than swallowing it —
 * a browser that silently drops popups looks broken on real sites. */
static GtkWidget *on_create_view(WebKitWebView *view, WebKitNavigationAction *action, gpointer data)
{
    Browser *b = data;
    (void)view;
    WebKitURIRequest *req = webkit_navigation_action_get_request(action);
    const char *uri = req ? webkit_uri_request_get_uri(req) : NULL;
    if (uri) add_tab(b, uri, TRUE);
    return NULL;
}

/*
 * Downloads land in /root/Downloads (the desktop user's home) with the
 * server-suggested name. Without a decide-destination handler WebKit cancels
 * every download, which reads to the user as "the link does nothing".
 */
static gboolean on_download_destination(WebKitDownload *download, gchar *suggested, gpointer data)
{
    (void)data;
    const char *home = g_get_home_dir();
    char *dir = g_build_filename(home, "Downloads", NULL);
    g_mkdir_with_parents(dir, 0755);

    char *path = g_build_filename(dir, suggested && *suggested ? suggested : "download", NULL);
    /* Never clobber an existing file — append -1, -2, … like a real browser. */
    int n = 1;
    while (g_file_test(path, G_FILE_TEST_EXISTS) && n < 1000) {
        g_free(path);
        path = g_strdup_printf("%s/%s-%d", dir, suggested && *suggested ? suggested : "download", n++);
    }
    char *uri = g_filename_to_uri(path, NULL, NULL);
    if (uri) webkit_download_set_destination(download, uri);
    g_free(uri); g_free(path); g_free(dir);
    return TRUE;
}

static void on_download_started(WebKitWebContext *ctx, WebKitDownload *download, gpointer data)
{
    (void)ctx;
    g_signal_connect(download, "decide-destination",
                     G_CALLBACK(on_download_destination), data);
}

/* -------------------------------------------------------------------- tabs */

static void on_tab_close_clicked(GtkButton *btn, gpointer data)
{
    Browser *b = data;
    GtkWidget *scroll = g_object_get_data(G_OBJECT(btn), "page");
    int page = gtk_notebook_page_num(GTK_NOTEBOOK(b->notebook), scroll);
    if (page >= 0) gtk_notebook_remove_page(GTK_NOTEBOOK(b->notebook), page);

    /* Closing the last tab closes the browser, matching every desktop browser. */
    if (gtk_notebook_get_n_pages(GTK_NOTEBOOK(b->notebook)) == 0)
        gtk_widget_destroy(b->window);
}

static void add_tab(Browser *b, const char *uri, gboolean focus)
{
    WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());

    WebKitSettings *settings = webkit_web_view_get_settings(view);
    webkit_settings_set_enable_developer_extras(settings, TRUE);
    webkit_settings_set_javascript_can_open_windows_automatically(settings, TRUE);

    g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), b);
    g_signal_connect(view, "notify::estimated-load-progress", G_CALLBACK(on_progress), b);
    g_signal_connect(view, "notify::title", G_CALLBACK(on_title_changed), b);
    g_signal_connect(view, "create", G_CALLBACK(on_create_view), b);

    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_container_add(GTK_CONTAINER(scroll), GTK_WIDGET(view));

    GtkWidget *tab_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    GtkWidget *label = gtk_label_new("New tab");
    gtk_label_set_ellipsize(GTK_LABEL(label), PANGO_ELLIPSIZE_END);
    GtkWidget *close = gtk_button_new_with_label("×");
    gtk_button_set_relief(GTK_BUTTON(close), GTK_RELIEF_NONE);
    gtk_widget_set_tooltip_text(close, "Close tab");
    g_object_set_data(G_OBJECT(close), "page", scroll);
    g_signal_connect(close, "clicked", G_CALLBACK(on_tab_close_clicked), b);
    gtk_box_pack_start(GTK_BOX(tab_box), label, TRUE, TRUE, 0);
    gtk_box_pack_end(GTK_BOX(tab_box), close, FALSE, FALSE, 0);
    g_object_set_data(G_OBJECT(tab_box), "title-label", label);
    gtk_widget_show_all(tab_box);

    int page = gtk_notebook_append_page(GTK_NOTEBOOK(b->notebook), scroll, tab_box);
    gtk_widget_show_all(scroll);
    if (focus) gtk_notebook_set_current_page(GTK_NOTEBOOK(b->notebook), page);

    webkit_web_view_load_uri(view, uri ? uri : HOME_URL);
}

/* ----------------------------------------------------------- UI callbacks */

static void on_url_activate(GtkEntry *entry, gpointer data)
{
    Browser *b = data;
    WebKitWebView *view = current_view(b);
    if (!view) { add_tab(b, gtk_entry_get_text(entry), TRUE); return; }
    char *uri = normalize_uri(gtk_entry_get_text(entry));
    webkit_web_view_load_uri(view, uri);
    g_free(uri);
    gtk_widget_grab_focus(GTK_WIDGET(view));
}

static void on_back(GtkButton *btn, gpointer data)
{ (void)btn; WebKitWebView *v = current_view(data); if (v) webkit_web_view_go_back(v); }

static void on_forward(GtkButton *btn, gpointer data)
{ (void)btn; WebKitWebView *v = current_view(data); if (v) webkit_web_view_go_forward(v); }

static void on_reload(GtkButton *btn, gpointer data)
{ (void)btn; WebKitWebView *v = current_view(data); if (v) webkit_web_view_reload(v); }

static void on_home(GtkButton *btn, gpointer data)
{ (void)btn; WebKitWebView *v = current_view(data); if (v) webkit_web_view_load_uri(v, HOME_URL); }

static void on_new_tab(GtkButton *btn, gpointer data)
{ (void)btn; add_tab(data, HOME_URL, TRUE); }

/* Runs after the notebook has finished switching pages — see on_switch_page. */
static gboolean update_chrome_idle(gpointer data)
{
    update_chrome(data);
    return G_SOURCE_REMOVE;
}

static void on_switch_page(GtkNotebook *nb, GtkWidget *page, guint num, gpointer data)
{
    (void)nb; (void)page; (void)num;
    /* Deferred: the notebook has not finished switching when this fires, so
     * reading current_view() here would return the OLD page. */
    g_idle_add(update_chrome_idle, data);
}

static gboolean on_key_press(GtkWidget *w, GdkEventKey *ev, gpointer data)
{
    Browser *b = data;
    (void)w;
    if (!(ev->state & GDK_CONTROL_MASK)) {
        if (ev->keyval == GDK_KEY_F5) { on_reload(NULL, b); return TRUE; }
        return FALSE;
    }
    switch (ev->keyval) {
    case GDK_KEY_t: add_tab(b, HOME_URL, TRUE); return TRUE;
    case GDK_KEY_l: gtk_widget_grab_focus(b->url_entry); return TRUE;
    case GDK_KEY_r: on_reload(NULL, b); return TRUE;
    case GDK_KEY_w: {
        int page = gtk_notebook_get_current_page(GTK_NOTEBOOK(b->notebook));
        if (page >= 0) gtk_notebook_remove_page(GTK_NOTEBOOK(b->notebook), page);
        if (gtk_notebook_get_n_pages(GTK_NOTEBOOK(b->notebook)) == 0)
            gtk_widget_destroy(b->window);
        return TRUE;
    }
    default: return FALSE;
    }
}

/* -------------------------------------------------------------------- main */

int main(int argc, char **argv)
{
    gtk_init(&argc, &argv);

    Browser *b = g_new0(Browser, 1);
    const char *app_url = NULL;
    GPtrArray *urls = g_ptr_array_new();

    for (int i = 1; i < argc; i++) {
        if (g_str_has_prefix(argv[i], "--app=")) {
            app_url = argv[i] + 6;
            b->app_mode = TRUE;
        } else if (argv[i][0] != '-') {
            g_ptr_array_add(urls, argv[i]);
        }
    }

    b->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_default_size(GTK_WINDOW(b->window), 1100, 720);
    gtk_window_set_title(GTK_WINDOW(b->window),
                         b->app_mode ? "RMPG Flex" : "RMPG Browser");
    g_signal_connect(b->window, "destroy", G_CALLBACK(gtk_main_quit), NULL);

    /* Downloads are a context-wide concern, not per-view. */
    g_signal_connect(webkit_web_context_get_default(), "download-started",
                     G_CALLBACK(on_download_started), b);

    if (b->app_mode) {
        /* Chromeless: a single WebView filling the window. */
        WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
        g_signal_connect(view, "notify::title", G_CALLBACK(on_title_changed), b);
        gtk_container_add(GTK_CONTAINER(b->window), GTK_WIDGET(view));
        webkit_web_view_load_uri(view, app_url && *app_url ? app_url : HOME_URL);
        gtk_widget_show_all(b->window);
        gtk_main();
        return 0;
    }

    GtkWidget *col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(b->window), col);

    GtkWidget *bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
    gtk_container_set_border_width(GTK_CONTAINER(bar), 4);

    b->back_btn    = gtk_button_new_with_label("◀");
    b->forward_btn = gtk_button_new_with_label("▶");
    b->reload_btn  = gtk_button_new_with_label("⟳");
    GtkWidget *home_btn = gtk_button_new_with_label("⌂");
    GtkWidget *newtab   = gtk_button_new_with_label("＋");
    gtk_widget_set_tooltip_text(b->back_btn, "Back");
    gtk_widget_set_tooltip_text(b->forward_btn, "Forward");
    gtk_widget_set_tooltip_text(b->reload_btn, "Reload (F5)");
    gtk_widget_set_tooltip_text(home_btn, "RMPG Flex home");
    gtk_widget_set_tooltip_text(newtab, "New tab (Ctrl+T)");

    b->url_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(b->url_entry), "Search or enter address");

    g_signal_connect(b->back_btn, "clicked", G_CALLBACK(on_back), b);
    g_signal_connect(b->forward_btn, "clicked", G_CALLBACK(on_forward), b);
    g_signal_connect(b->reload_btn, "clicked", G_CALLBACK(on_reload), b);
    g_signal_connect(home_btn, "clicked", G_CALLBACK(on_home), b);
    g_signal_connect(newtab, "clicked", G_CALLBACK(on_new_tab), b);
    g_signal_connect(b->url_entry, "activate", G_CALLBACK(on_url_activate), b);

    gtk_box_pack_start(GTK_BOX(bar), b->back_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(bar), b->forward_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(bar), b->reload_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(bar), home_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(bar), b->url_entry, TRUE, TRUE, 4);
    gtk_box_pack_end(GTK_BOX(bar), newtab, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(col), bar, FALSE, FALSE, 0);

    b->progress = gtk_progress_bar_new();
    gtk_box_pack_start(GTK_BOX(col), b->progress, FALSE, FALSE, 0);

    b->notebook = gtk_notebook_new();
    gtk_notebook_set_scrollable(GTK_NOTEBOOK(b->notebook), TRUE);
    g_signal_connect(b->notebook, "switch-page", G_CALLBACK(on_switch_page), b);
    gtk_box_pack_start(GTK_BOX(col), b->notebook, TRUE, TRUE, 0);

    g_signal_connect(b->window, "key-press-event", G_CALLBACK(on_key_press), b);

    if (urls->len == 0) {
        add_tab(b, HOME_URL, TRUE);
    } else {
        for (guint i = 0; i < urls->len; i++) {
            char *uri = normalize_uri(g_ptr_array_index(urls, i));
            add_tab(b, uri, i == 0);
            g_free(uri);
        }
    }
    g_ptr_array_free(urls, TRUE);

    gtk_widget_show_all(b->window);
    gtk_widget_hide(b->progress);
    gtk_main();
    return 0;
}
