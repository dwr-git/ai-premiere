//! FilmCraft in the browser.
//!
//! The same engine and egui UI as the desktop app, compiled to `wasm32-unknown-unknown` and run
//! by eframe's web runner on WebGPU (WebGL2 fallback). What the desktop shell gets from the OS,
//! this crate gets from the browser:
//!
//! | Desktop | Web ([module]) |
//! |---|---|
//! | file system ([`filmcraft_engine::FsServices`]) | virtual file table of `File`/`Blob`s with chunked range reads, downloads ([`fs`]) |
//! | file dialogs (rfd) | `<input type=file>` / File System Access pickers, drag-and-drop ([`import`]) |
//! | auto-save + recovery journal (data dir) | OPFS snapshot + media copies ([`recovery`], [`opfs`]) |
//! | cpal audio output | WebAudio `AudioWorklet`, played-frame clock ([`audio`]) |
//! | VideoToolbox… | WebCodecs `VideoDecoder` ([`webcodecs`]) |
//! | frame worker threads | cooperative frame queue pumped between UI frames (`FrameServer::pump`) |
//! | TCP control channel / MCP | `window.filmcraft` JavaScript API ([`api`]) |
//!
//! Everything here is `wasm32`-only; on other targets the crate is empty.
#![cfg(target_arch = "wasm32")]
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable))]

pub mod api;
pub mod audio;
pub mod bridge;
pub mod download_pacing;
pub mod fs;
pub mod host;
pub mod hostmode;
pub mod import;
pub mod opfs;
pub mod recovery;
pub mod recovery_policy;
pub mod webcodecs;

use std::cell::RefCell;
use std::sync::Arc;

use filmcraft_engine::Session;
use filmcraft_ui_egui::FilmcraftApp;
use serde_json::json;
use wasm_bindgen::prelude::*;

/// Work for the UI thread with access to the app (posted by async tasks and the JS API).
pub type Action = Box<dyn FnOnce(&mut WebApp, &egui::Context)>;

thread_local! {
    static ACTIONS: RefCell<Vec<Action>> = const { RefCell::new(Vec::new()) };
    static CTX: RefCell<Option<egui::Context>> = const { RefCell::new(None) };
    static INFO: RefCell<serde_json::Value> = const { RefCell::new(serde_json::Value::Null) };
}

/// Run `f` on the UI thread at the next frame.
pub fn post(f: impl FnOnce(&mut WebApp, &egui::Context) + 'static) {
    ACTIONS.with(|a| a.borrow_mut().push(Box::new(f)));
    repaint();
}

/// Ask for a UI frame.
pub fn repaint() {
    CTX.with(|c| {
        if let Some(c) = c.borrow().as_ref() {
            c.request_repaint();
        }
    });
}

/// Give a host that builds its own [`WebApp`] the egui context that [`post`] and [`repaint`] wake.
/// [`start`] calls it; an embedding app that runs `WebApp` in its own eframe runner calls it once
/// from its app creator, or posted actions and JS API requests wait for the next input event.
pub fn set_context(ctx: egui::Context) {
    CTX.with(|c| *c.borrow_mut() = Some(ctx));
}

/// Environment facts reported by `filmcraft.info()` (backend, isolation, codecs…).
pub fn set_info(key: &str, v: serde_json::Value) {
    INFO.with(|i| {
        let mut i = i.borrow_mut();
        if !i.is_object() {
            *i = json!({});
        }
        i[key] = v;
    });
}

pub fn info() -> serde_json::Value {
    INFO.with(|i| i.borrow().clone())
}

/// Whether a text field of the editor has the keyboard (`aipremiere.wantsKeyboard()`).
pub fn wants_keyboard() -> bool {
    CTX.with(|c| c.borrow().as_ref().is_some_and(egui::Context::text_edit_focused))
}

/// The engine's write hook on the web, AI Видео: a saved project goes to the page while it
/// takes saves (the user's projects on the server); everything else — exports, captions,
/// interchange files — and a save nobody takes downloads.
fn deliver(path: &str, data: &[u8]) {
    let project = path.to_ascii_lowercase().ends_with(".fcproj") && !path.starts_with("/exports/");
    if project {
        match bridge::save_to_page(path, data) {
            Ok(true) => return,
            Ok(false) => {}
            Err(e) => log::warn!("handing {path} to the page: {e}"),
        }
    }
    if let Err(e) = fs::download(path, data) {
        log::warn!("download {path}: {e:?}");
    }
}

/// Leave the editor for the site it lives on: `window.STUDIO_CONFIG.homeUrl` (studio/config.js,
/// made absolute by the panel), one level up without it.
fn go_home() {
    let Some(window) = web_sys::window() else { return };
    let url = js_sys::Reflect::get(&window, &"STUDIO_CONFIG".into())
        .ok()
        .filter(|c| c.is_object())
        .and_then(|c| js_sys::Reflect::get(&c, &"homeUrl".into()).ok())
        .and_then(|u| u.as_string())
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| "../".to_string());
    if let Err(e) = window.location().set_href(&url) {
        log::error!("couldn't go to {url}: {e:?}");
    }
}

/// The eframe app: the shared FilmCraft UI plus the web host's per-frame duties.
pub struct WebApp {
    pub app: FilmcraftApp,
    pub audio: Option<audio::Handle>,
    pub autosave: recovery::Autosave,
    /// The host bridge in host mode (`?host=parent` / `data-host="page"`): written files go to
    /// the host instead of downloads, it hears about unsaved changes, and it opens the files it
    /// sends.
    pub host: Option<host::Bridge>,
}

impl eframe::App for WebApp {
    fn raw_input_hook(&mut self, ctx: &egui::Context, raw_input: &mut egui::RawInput) {
        self.app.raw_input_hook(ctx, raw_input);
    }

    /// Hidden logic pass: host actions, app logic, API replies, jobs, host saves and dirty reports, audio, autosave, then IME reset; it does not draw UI.
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let actions = ACTIONS.with(|a| std::mem::take(&mut *a.borrow_mut()));
        for f in actions {
            f(self, ctx);
        }
        self.app.logic_inner(ctx);
        // exports advance between frames (no threads)
        if self.app.session.pump_jobs(std::time::Duration::from_millis(30)) {
            ctx.request_repaint();
        }
        // In host mode: files written this frame (commands, exports) go to the host, and it
        // hears when unsaved changes appear or go away.
        if let Some(host) = &self.host {
            host.sync(&self.app.session);
        } else {
            bridge::dirty(self.app.session.is_dirty());
        }
        if let Some(a) = &self.audio {
            a.pump();
        }
        self.autosave.tick(&self.app.session, ctx);
        self.app.finish_ime_reset_logic(ctx);
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.app.ui(ui, frame);
    }
}

fn query_flag(name: &str) -> bool {
    web_sys::window().and_then(|w| w.location().search().ok()).and_then(|s| web_sys::UrlSearchParams::new_with_str(&s).ok()).is_some_and(|p| p.has(name))
}

/// Entry point (called by the page's bootstrap script once the wasm module is instantiated).
#[wasm_bindgen]
pub async fn start(canvas_id: String) -> Result<(), JsValue> {
    eframe::WebLogger::init(log::LevelFilter::Info).ok();
    let t0 = web_time::Instant::now();
    let doc = web_sys::window().and_then(|w| w.document()).ok_or("no document")?;
    let canvas: web_sys::HtmlCanvasElement = doc.get_element_by_id(&canvas_id).ok_or("no canvas")?.dyn_into()?;

    // Host modes (`craft-web-host`): `?host=parent`, a same-origin page framing FilmCraft in an
    // `<iframe>`, opens files in it and stores what it saves (`host`); unframed there is no parent,
    // so that URL on its own stays the normal app with downloads. `data-host="page"` on the canvas
    // opts a page in instead: it runs FilmCraft in its own document and talks over DOM
    // `CustomEvent`s on the canvas. In host mode the host sends the document to edit, so no demo
    // project opens and nothing from an earlier visit is recovered.
    let host = host::Bridge::connect(&canvas);
    let in_host_mode = host.is_some();

    let isolated = js_sys::Reflect::get(&js_sys::global(), &"crossOriginIsolated".into()).ok().and_then(|v| v.as_bool()).unwrap_or(false);
    // Frame rendering runs cooperatively on this thread. wasm threads need a cross-origin
    // isolated page *and* a build with atomics (nightly `build-std`); this build has none.
    set_info("crossOriginIsolated", json!(isolated));
    set_info("threads", json!(false));
    set_info("frameWorkers", json!("cooperative"));
    set_info("opfs", json!(opfs::available()));

    // Media kept in OPFS by earlier sessions come back under their paths (recovery).
    let restored = if !in_host_mode && opfs::available() && !query_flag("fresh") { recovery::restore_media().await } else { 0 };
    let recovered = if in_host_mode || query_flag("fresh") || query_flag("norecover") { None } else { recovery::load_snapshot().await };
    webcodecs::probe().await;

    api::install()?;
    // AI Видео: window.aipremiere for the assistant panel and «Мои проекты» (studio/).
    bridge::install()?;
    import::install_drop_handlers()?;

    // AI Видео starts on an empty project; `?demo` opens the demo project.
    let demo = !in_host_mode && query_flag("demo");
    let mut web_options = eframe::WebOptions::default();
    // `?webgl`: WebGL2 only. The page reloads with it when starting on WebGPU fails (an adapter
    // whose device can't be created, a driver the browser rejects…); see `index.html`.
    if query_flag("webgl")
        && let eframe::egui_wgpu::WgpuSetup::CreateNew(c) = &mut web_options.wgpu_options.wgpu_setup
    {
        c.instance_descriptor.backends = eframe::wgpu::Backends::GL;
    }
    let runner = eframe::WebRunner::new();
    let host_for_app = host.clone();
    let started = runner
        .start(
            canvas,
            web_options,
            Box::new(move |cc| {
                filmcraft_ui_egui::install_ime_reset_callbacks(&cc.egui_ctx);
                set_context(cc.egui_ctx.clone());
                let ctx = cc.egui_ctx.clone();
                fs::set_on_data(move || ctx.request_repaint());
                // Host mode: written files (saved projects, exports, …) are handed to the host
                // instead of downloading, and it opens the files it sends. Otherwise the app
                // offers what it writes as a browser download.
                match &host_for_app {
                    Some(bridge) => bridge.install(),
                    None => fs::set_on_write(deliver),
                }
                webcodecs::install();
                let mut session = Session::new(Arc::new(fs::WebServices));
                // AI Видео: the interface in Russian and the Brand theme. The browser keeps no
                // preferences between visits; the panel re-applies a theme chosen there.
                session.prefs.general.interface_language = "ru".into();
                session.prefs.appearance.appearance_mode = "dark".into();
                session.prefs.appearance.dark_theme = "brand".into();
                session.prefs.appearance.sync_color_theme();
                let mut toast = None;
                if let Some((name, bytes)) = recovered {
                    let path = format!("/recovered/{name}");
                    fs::put(&path, bytes);
                    match session.execute("file.open", json!({"path": path})) {
                        Ok(_) => {
                            // the recovered changes are unsaved
                            session.saved_revision = 0;
                            toast = Some(format!("Восстановлены несохранённые изменения проекта {name}"));
                        }
                        Err(e) => log::warn!("recovery failed: {e}"),
                    }
                } else if demo {
                    let _ = session.execute("file.openDemoProject", json!({}));
                } else if !in_host_mode {
                    let _ = session.execute("file.newProject", json!({"name": "Без названия"}));
                }
                let mut app = FilmcraftApp::new(session);
                import::install_hooks(&mut app);
                if !in_host_mode {
                    // Save of a project with no file yet: the page asks for the name.
                    app.hooks.pick_save = Some(Box::new(|name: &str| if bridge::ask_save_name(name) { None } else { Some(format!("/projects/{name}")) }));
                    // The house at the right of the header goes back to the site; «ИИ» opens the
                    // page's AI menu.
                    app.hooks.go_home = Some(Box::new(go_home));
                    app.hooks.ai_assist = Some(Box::new(bridge::ai_menu));
                }
                // Settings ▸ General ▸ Interface Language ▸ System Language (#218): the browser's languages.
                app.hooks.system_languages =
                    Some(Box::new(|| web_sys::window().map(|w| w.navigator().languages().iter().filter_map(|v| v.as_string()).collect()).unwrap_or_default()));
                let (tx, rx) = std::sync::mpsc::channel();
                api::set_sender(tx);
                app = app.with_control(rx);
                if let Some(t) = toast {
                    app.status(t);
                }
                let backend = cc.wgpu_render_state.as_ref().map(|rs| rs.adapter.get_info().backend);
                set_info("backend", json!(backend.map(|b| format!("{b:?}"))));
                // The GPU compositor needs float render targets everywhere: WebGPU only (WebGL2
                // composites on the CPU).
                if let Some(rs) = cc.wgpu_render_state.clone()
                    && backend == Some(eframe::wgpu::Backend::BrowserWebGpu)
                    && !query_flag("cpu")
                {
                    app.set_wgpu(rs);
                    set_info("compositor", json!("gpu"));
                } else {
                    set_info("compositor", json!("cpu"));
                }
                let audio = audio::Handle::new();
                if let Some(a) = &audio {
                    app.audio = Some(Box::new(a.clone()));
                }
                set_info("audio", json!(audio.is_some()));
                set_info("restoredMedia", json!(restored));
                Ok(Box::new(WebApp { app, audio, autosave: recovery::Autosave::default(), host: host_for_app }))
            }),
        )
        .await;
    // Ready only once the runner is up: starting can still fail after the app is made.
    if let Some(bridge) = &host {
        match &started {
            Ok(()) => bridge.post_ready(),
            Err(e) => bridge.post_failed(&e.as_string().unwrap_or_else(|| format!("{e:?}"))),
        }
    }
    started?;
    set_info("startupMs", json!(t0.elapsed().as_secs_f64() * 1000.0));
    // keep the runner alive for the page's lifetime
    std::mem::forget(runner);
    if let Some(el) = doc.get_element_by_id("loading") {
        el.remove();
    }
    Ok(())
}
