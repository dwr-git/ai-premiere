//! `window.aipremiere`: AI Видео's page bridge — the control channel as promises, plus what the
//! page around the editor needs (the assistant panel and «Мои проекты» in `studio/`).
//!
//! The control methods are `window.filmcraft`'s ([`crate::api`]); this object adds the page's own:
//!
//! ```js
//! await aipremiere.execute("timeline.razor", {time: 254016000000})  // engine command → result
//! await aipremiere.request("ui.inspect")                           // control method → result
//! await aipremiere.commands()                                      // every command with its params doc
//! const {pngBase64} = await aipremiere.screenshot()                // the window as PNG (base64)
//! await aipremiere.open("Ролик.fcproj", blobOrBytes)               // open a project, or import media
//! aipremiere.putMedia("/files/Интервью.mp4", blob)                 // a project's media at its path
//! aipremiere.mediaBlob("/files/Интервью.mp4")                      // that media as a Blob (upload it)
//! await aipremiere.addFont("LiberationSans-Regular.ttf", bytes)    // a font for titles and captions
//! aipremiere.wantsKeyboard()                                       // a text field has the keyboard
//! ```
//!
//! Events on `window` (`detail` in braces):
//! - `aipremiere:save` `{name, path, bytes}` — a saved project (File ▸ Save, Save As, Ctrl+S) while
//!   `aipremiere.takesSaves` is true: the page keeps it in the user's projects on the server.
//!   Exports (video, audio, frames, captions, interchange) always download.
//! - `aipremiere:saveas` `{name}` — Save of a project that has no file yet: the page asks for a
//!   name and runs `file.saveAs` with `/projects/<name>.fcproj`.
//! - `aipremiere:dirty` `{dirty}` — unsaved changes appeared or went away.
//! - `aipremiere:ai` `{x, y}` — the «ИИ» chip in the header (CSS pixels from the canvas's top left).

use std::cell::Cell;

use serde_json::json;
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};

use crate::api::to_js;

/// The largest file the page may hand over at once (the server's own limit is usually lower).
const MAX_FILE_BYTES: f64 = 4.0 * 1024.0 * 1024.0 * 1024.0;

/// The largest font file.
const MAX_FONT_BYTES: u32 = 64 * 1024 * 1024;

fn error(message: &str) -> JsValue {
    js_sys::Error::new(message).into()
}

fn set(obj: &js_sys::Object, name: &str, v: &JsValue) -> Result<(), JsValue> {
    js_sys::Reflect::set(obj, &name.into(), v).map(|_| ())
}

/// A file name the page passed: no folders, trimmed, at most 200 characters, `fallback` when empty.
fn clean_name(name: &str, fallback: &str) -> String {
    let name: String = name.trim().chars().map(|c| if c == '/' || c == '\\' || c.is_control() { '_' } else { c }).take(200).collect();
    if name.is_empty() || name == "." || name == ".." { fallback.to_string() } else { name }
}

/// What the page handed over as a `Blob`: a `Blob`/`File` as it is, bytes wrapped in one.
fn blob_of(v: &JsValue) -> Result<web_sys::Blob, JsValue> {
    let blob = if let Some(b) = v.dyn_ref::<web_sys::Blob>() {
        b.clone()
    } else if let Some(a) = v.dyn_ref::<js_sys::Uint8Array>() {
        let parts = js_sys::Array::of1(a);
        web_sys::Blob::new_with_u8_array_sequence(&parts)?
    } else if v.is_instance_of::<js_sys::ArrayBuffer>() {
        let parts = js_sys::Array::of1(&js_sys::Uint8Array::new(v));
        web_sys::Blob::new_with_u8_array_sequence(&parts)?
    } else {
        return Err(error("the file must be a Blob, a File, a Uint8Array or an ArrayBuffer"));
    };
    if blob.size() > MAX_FILE_BYTES {
        return Err(error("the file is too large"));
    }
    Ok(blob)
}

fn file_of(blob: &web_sys::Blob, name: &str) -> Result<web_sys::File, JsValue> {
    let parts = js_sys::Array::of1(blob);
    web_sys::File::new_with_blob_sequence(&parts, name)
}

fn is_project(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".fcproj")
}

/// Open a file the page has (from the user's projects on the server, or picked by the user): a
/// project (`.fcproj`) replaces the open one; video, audio, stills and captions are imported into
/// it, as a dropped file is. Resolves with the engine's result.
fn open(name: String, data: JsValue) -> js_sys::Promise {
    future_to_promise(async move {
        let name = clean_name(&name, "Проект.fcproj");
        let blob = blob_of(&data)?;
        if is_project(&name) {
            if blob.size() > 256.0 * 1024.0 * 1024.0 {
                return Err(error("the project file is over 256 MB"));
            }
            let buf = JsFuture::from(blob.array_buffer()).await?;
            let bytes = js_sys::Uint8Array::new(&buf).to_vec();
            let r = crate::import::open_project_bytes(format!("/projects/{name}"), bytes).await.map_err(|e| error(&e))?;
            Ok(to_js(&r))
        } else {
            let file = file_of(&blob, &name)?;
            Ok(to_js(&crate::import::import_files(vec![file]).await))
        }
    })
}

/// Put a project's media file at the exact path the project names (`/files/<name>`), so the
/// project finds it when it opens. Nothing changes when something is at that path already.
/// Returns whether the file was put there.
fn put_media(path: String, data: JsValue) -> Result<bool, JsValue> {
    if !path.starts_with("/files/") || path.contains("/../") || path.len() > 600 {
        return Err(error("a media path is /files/<name>"));
    }
    let blob = blob_of(&data)?;
    let name = path.rsplit('/').next().unwrap_or("media").to_string();
    let put = crate::fs::register_blob_at(&path, blob.clone());
    if put && let Ok(file) = file_of(&blob, &name) {
        crate::recovery::keep_media(&path, &file);
    }
    crate::repaint();
    Ok(put)
}

/// Add a font for titles and captions (TrueType or OpenType bytes). Resolves `{faces}`.
fn add_font(_name: String, data: JsValue) -> Result<JsValue, JsValue> {
    let array = if let Some(a) = data.dyn_ref::<js_sys::Uint8Array>() {
        a.clone()
    } else if data.is_instance_of::<js_sys::ArrayBuffer>() {
        js_sys::Uint8Array::new(&data)
    } else {
        return Err(error("font bytes must be a Uint8Array or an ArrayBuffer"));
    };
    if array.length() > MAX_FONT_BYTES {
        return Err(error("the font file is too large"));
    }
    let faces = filmcraft_text::fonts::add_font_data(array.to_vec());
    crate::repaint();
    Ok(to_js(&json!({ "faces": faces.len() })))
}

/// Tell the page something happened (`aipremiere:<what>` on `window`, with `detail`).
fn notify(what: &str, detail: &JsValue) -> Result<(), String> {
    let window = web_sys::window().ok_or("no window")?;
    let init = web_sys::CustomEventInit::new();
    init.set_detail(detail);
    let event = web_sys::CustomEvent::new_with_event_init_dict(&format!("aipremiere:{what}"), &init).map_err(|e| format!("{e:?}"))?;
    window.dispatch_event(&event).map(|_| ()).map_err(|e| format!("{e:?}"))
}

/// Whether the page said it takes saves (`aipremiere.takesSaves = true`).
pub fn listening() -> bool {
    web_sys::window()
        .and_then(|w| js_sys::Reflect::get(&w, &"aipremiere".into()).ok())
        .filter(|o| o.is_object())
        .and_then(|o| js_sys::Reflect::get(&o, &"takesSaves".into()).ok())
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// A saved project goes to the page while it listens. `Ok(false)`: nobody listens (download it).
pub fn save_to_page(path: &str, bytes: &[u8]) -> Result<bool, String> {
    if !listening() {
        return Ok(false);
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    let detail = js_sys::Object::new();
    let put = |k: &str, v: &JsValue| js_sys::Reflect::set(&detail, &k.into(), v).map(|_| ()).map_err(|e| format!("{e:?}"));
    put("name", &name.into())?;
    put("path", &path.into())?;
    put("bytes", &js_sys::Uint8Array::from(bytes).into())?;
    notify("save", &detail.into())?;
    Ok(true)
}

/// Save of a project with no file yet: the page asks for the name (`aipremiere:saveas`).
/// `false`: nobody listens, so the app saves under the suggested name itself.
pub fn ask_save_name(suggested: &str) -> bool {
    listening() && notify("saveas", &to_js(&json!({ "name": suggested }))).is_ok()
}

/// The page's AI menu at this point of the canvas: `aipremiere:ai` with `{x, y}`.
pub fn ai_menu(x: f32, y: f32) {
    let _ = notify("ai", &to_js(&json!({ "x": x, "y": y })));
}

/// Whether the project has unsaved changes, told to the page when it changes.
pub fn dirty(now: bool) {
    thread_local! {
        static LAST: Cell<Option<bool>> = const { Cell::new(None) };
    }
    if LAST.with(|l| l.replace(Some(now))) != Some(now) {
        let _ = notify("dirty", &to_js(&json!({ "dirty": now })));
    }
}

/// Install `window.aipremiere` (after [`crate::api::install`], whose functions it reuses).
pub fn install() -> Result<(), JsValue> {
    let window = web_sys::window().ok_or("no window")?;
    let fc = js_sys::Reflect::get(&window, &"filmcraft".into())?;
    let obj = js_sys::Object::new();
    for name in ["request", "execute", "commands", "screenshot", "inspect", "uiInspect", "info", "files", "readFile", "importFiles", "importUrl", "openProject"] {
        if let Ok(f) = js_sys::Reflect::get(&fc, &name.into())
            && f.is_function()
        {
            set(&obj, name, &f)?;
        }
    }
    set(&obj, "open", &Closure::<dyn Fn(String, JsValue) -> js_sys::Promise>::new(open).into_js_value())?;
    set(&obj, "putMedia", &Closure::<dyn Fn(String, JsValue) -> Result<bool, JsValue>>::new(put_media).into_js_value())?;
    set(
        &obj,
        "mediaBlob",
        &Closure::<dyn Fn(String) -> JsValue>::new(|path: String| crate::fs::blob(&path).map(JsValue::from).unwrap_or(JsValue::NULL)).into_js_value(),
    )?;
    set(
        &obj,
        "addFont",
        &Closure::<dyn Fn(String, JsValue) -> js_sys::Promise>::new(|name: String, data: JsValue| {
            let r = add_font(name, data);
            future_to_promise(async move { r })
        })
        .into_js_value(),
    )?;
    set(&obj, "wantsKeyboard", &Closure::<dyn Fn() -> bool>::new(crate::wants_keyboard).into_js_value())?;
    set(&obj, "takesSaves", &JsValue::FALSE)?;
    set(&obj, "product", &JsValue::from_str("AI Видео"))?;
    js_sys::Reflect::set(&window, &"aipremiere".into(), &obj)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_in_their_folder() {
        assert_eq!(clean_name("../a/b.fcproj", "x"), ".._a_b.fcproj");
        assert_eq!(clean_name("  ", "Проект.fcproj"), "Проект.fcproj");
        assert_eq!(clean_name("..", "x"), "x");
        assert!(is_project("Ролик.FCPROJ"));
        assert!(!is_project("Ролик.mp4"));
    }
}
