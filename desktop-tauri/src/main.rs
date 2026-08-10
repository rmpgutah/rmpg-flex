#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::system::get_system_info,
            commands::system::check_disk_space,
            commands::system::get_network_interfaces,
            commands::system::get_battery_status,
            commands::system::get_idle_time,
            commands::window::minimize_window,
            commands::window::maximize_window,
            commands::window::close_window,
            commands::window::toggle_fullscreen,
            commands::window::set_dock_badge,
            commands::window::flash_frame,
            commands::app::get_version,
            commands::app::force_refresh,
            commands::app::restart_app,
            commands::app::get_app_logs,
            commands::app::open_logs_folder,
            commands::power::keep_awake,
            commands::power::allow_sleep,
            commands::files::write_export_file,
            commands::files::read_import_file,
            commands::files::reveal_in_folder,
            commands::files::get_downloads_path,
            commands::files::get_printers,
            commands::files::print_silent,
            commands::files::print_to_pdf,
            commands::secondary::open_secondary_window,
            commands::secondary::close_secondary_window,
            commands::secondary::open_company_browser,
            commands::updater::check_for_updates,
            commands::updater::install_update,
        ])
        .setup(|app| {
            let bridge_js = include_str!("../scripts/electron-compat-bridge.js");

            let url = tauri::Url::parse("https://rmpgutah.us").unwrap();
            let window = WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .title("RMPG Flex")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 700.0)
                .center()
                .visible(false)
                .initialization_script(bridge_js)
                .build()?;

            let show_item = MenuItem::with_id(app, "show", "Show RMPG Flex", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("RMPG Flex")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            let win = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let _ = win.show();
                let _ = win.set_focus();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running RMPG Flex");
}
