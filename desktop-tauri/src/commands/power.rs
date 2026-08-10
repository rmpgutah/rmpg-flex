use std::sync::atomic::{AtomicBool, Ordering};

static KEEPING_AWAKE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn keep_awake() -> Result<(), String> {
    KEEPING_AWAKE.store(true, Ordering::Relaxed);

    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(|| {
            let _ = std::process::Command::new("caffeinate")
                .arg("-d")
                .arg("-i")
                .arg("-s")
                .spawn();
        });
    }

    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x80000000;
        const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
        const ES_DISPLAY_REQUIRED: u32 = 0x00000002;
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED); }
    }

    Ok(())
}

#[tauri::command]
pub fn allow_sleep() -> Result<(), String> {
    KEEPING_AWAKE.store(false, Ordering::Relaxed);

    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x80000000;
        unsafe { SetThreadExecutionState(ES_CONTINUOUS); }
    }

    Ok(())
}
