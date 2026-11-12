//! Design tokens. Every widget reads colours/sizes from [`Tokens`] so themes apply everywhere.
//!
//! AI Видео: Dark and Light are our neumorphic palettes (NeuDark, NeuLight: soft blue-grey
//! chrome, rounded corners, blue-tinted shadows); the Brand theme (navy chrome, the brand's
//! blue-violet accent, solid black menus and windows with a strong black shadow, the brand
//! backdrop behind the panels and around the monitors' pictures) is the browser build's default.
//! Fonts are Inter + JetBrains Mono (OFL).

use std::sync::Arc;

use egui::{Color32, FontData, FontDefinitions, FontFamily, FontId, Stroke, TextStyle, Visuals};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeKind {
    /// NeuDark (default on the desktop).
    #[default]
    Dark,
    /// NeuDark with slightly lighter panels.
    Medium,
    Light,
    /// AI Видео's Brand theme (the browser build starts in it).
    Brand,
}

impl ThemeKind {
    /// Settings ▸ Appearance ▸ Color Theme value (`darkest`, `dark`, `light`).
    pub fn pref_name(self) -> &'static str {
        match self {
            ThemeKind::Dark => "darkest",
            ThemeKind::Medium => "dark",
            ThemeKind::Light => "light",
            ThemeKind::Brand => "brand",
        }
    }
    pub fn from_pref(s: &str) -> ThemeKind {
        match s {
            "dark" => ThemeKind::Medium,
            "light" => ThemeKind::Light,
            "brand" => ThemeKind::Brand,
            _ => ThemeKind::Dark,
        }
    }
    pub fn from_name(s: &str) -> Option<ThemeKind> {
        match s.to_ascii_lowercase().as_str() {
            "dark" | "darkest" => Some(ThemeKind::Dark),
            "medium" | "grey" | "gray" => Some(ThemeKind::Medium),
            "light" => Some(ThemeKind::Light),
            "brand" => Some(ThemeKind::Brand),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    pub kind: ThemeKind,
    /// Space between panels / app background.
    pub app_bg: Color32,
    /// Header bar (top).
    pub header_bg: Color32,
    /// Panel body.
    pub panel_bg: Color32,
    /// Panel tab strip.
    pub tab_bg: Color32,
    pub tab_text: Color32,
    pub tab_text_active: Color32,
    /// Blue focus rectangle around the active panel.
    pub focus: Color32,
    pub accent: Color32,
    pub accent_hover: Color32,
    pub text: Color32,
    pub text_dim: Color32,
    pub text_faint: Color32,
    pub icon: Color32,
    pub icon_active: Color32,
    pub hover: Color32,
    pub pressed: Color32,
    pub field_bg: Color32,
    pub field_border: Color32,
    pub separator: Color32,
    pub row_alt: Color32,
    pub row_selected: Color32,
    /// Scrubby (hot-text) numeric value colour.
    pub hot_text: Color32,
    /// Selected pills and compact toggle backgrounds.
    pub pill_active_bg: Color32,
    /// The selected clip bar in Effect Controls.
    pub clip_bar_bg: Color32,
    /// Raised audio control surfaces, such as mixer channel strips.
    pub control_surface: Color32,
    /// Recessed audio control tracks and panner wells.
    pub control_well: Color32,
    pub control_border: Color32,
    pub control_handle_bg: Color32,
    pub control_handle: Color32,
    pub control_handle_dim: Color32,
    /// Data-plot surfaces (keyframe, EQ and dynamics graphs), distinct from media canvases.
    pub plot_bg: Color32,
    pub plot_grid: Color32,
    pub plot_axis: Color32,
    pub plot_handle: Color32,
    pub plot_handle_dim: Color32,
    /// Meter wells and the separate loudness readout surface.
    pub meter_bg: Color32,
    pub meter_readout_bg: Color32,
    pub meter_clip_off: Color32,
    pub panner_bg: Color32,
    pub panner_border: Color32,
    pub panner_speaker: Color32,
    pub fader_knob: Color32,
    pub eq_track: Color32,
    pub eq_tick: Color32,
    pub eq_knob: Color32,
    pub eq_knob_active: Color32,
    pub eq_node: Color32,
    pub eq_node_off: Color32,
    pub crossover_handle: Color32,
    pub keyframe_plot_bg: Color32,
    pub keyframe_plot_grid: Color32,
    pub keyframe_plot_axis: Color32,
    pub keyframe_handle: Color32,
    pub switch_fill: Color32,
    pub switch_knob: Color32,
    pub switch_border: Color32,
    pub slider_disabled_track: Color32,
    pub slider_disabled_knob: Color32,
    pub button_hover: Color32,
    pub button_border: Color32,
    pub caption_track_bg: Color32,
    pub scroll_thumb: Color32,
    pub scroll_thumb_hover: Color32,
    pub vertical_scroll_thumb: Color32,
    pub disabled_clip_bg: Color32,
    // timeline
    pub tl_bg: Color32,
    pub tl_track_bg: Color32,
    pub tl_track_bg_alt: Color32,
    pub tl_header_bg: Color32,
    pub tl_ruler_bg: Color32,
    pub tl_ruler_tick: Color32,
    pub tl_ruler_text: Color32,
    pub playhead: Color32,
    /// Fill of a track header's source-patch / track-targeting button while it is on.
    pub track_target: Color32,
    pub in_out_shade: Color32,
    pub clip_selected_border: Color32,
    pub render_red: Color32,
    pub render_yellow: Color32,
    pub render_green: Color32,
    pub monitor_bg: Color32,
    pub timecode: Color32,
    pub danger: Color32,
    pub radius: f32,
    pub radius_sm: f32,
    pub gap: f32,
    pub tab_h: f32,
}

impl Tokens {
    pub fn for_kind(kind: ThemeKind) -> Self {
        // Measured from Premiere 26 "Darkest" (plan/premiere/02-ui-ux.md §1).
        let dark = Tokens {
            kind,
            app_bg: Color32::from_rgb(0, 0, 0),
            header_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            panel_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tab_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tab_text: Color32::from_rgb(0xb0, 0xb0, 0xb0),
            tab_text_active: Color32::from_rgb(0xd1, 0xd1, 0xd1),
            focus: Color32::from_rgb(0x57, 0x94, 0xec),
            accent: Color32::from_rgb(0x2f, 0x6b, 0xdf),
            accent_hover: Color32::from_rgb(0x3f, 0x7c, 0xe8),
            text: Color32::from_rgb(0xd1, 0xd1, 0xd1),
            text_dim: Color32::from_rgb(0xb0, 0xb0, 0xb0),
            text_faint: Color32::from_rgb(0x6e, 0x6e, 0x6e),
            icon: Color32::from_rgb(0xb0, 0xb0, 0xb0),
            icon_active: Color32::from_rgb(0xd1, 0xd1, 0xd1),
            hover: Color32::from_rgb(0x2c, 0x2c, 0x2c),
            pressed: Color32::from_rgb(0x4b, 0x4b, 0x4b),
            field_bg: Color32::from_rgb(0x0e, 0x0e, 0x0e),
            field_border: Color32::from_rgb(0x30, 0x30, 0x30),
            separator: Color32::from_rgb(0x30, 0x30, 0x30),
            row_alt: Color32::from_rgb(0x21, 0x21, 0x21),
            row_selected: Color32::from_rgb(0x33, 0x33, 0x33),
            hot_text: Color32::from_rgb(0x40, 0x96, 0xf3),
            pill_active_bg: Color32::from_rgb(0x3a, 0x3a, 0x3a),
            clip_bar_bg: Color32::from_rgb(58, 58, 70),
            control_surface: Color32::from_rgb(0x24, 0x24, 0x24),
            control_well: Color32::from_rgb(0x10, 0x10, 0x10),
            control_border: Color32::from_rgb(0x50, 0x50, 0x50),
            control_handle_bg: Color32::from_rgb(0x2a, 0x2a, 0x2a),
            control_handle: Color32::from_rgb(0xe0, 0xe0, 0xe0),
            control_handle_dim: Color32::from_rgb(0xb0, 0xb0, 0xb0),
            plot_bg: Color32::from_rgb(0x18, 0x18, 0x18),
            plot_grid: Color32::from_rgb(0x2c, 0x2c, 0x2c),
            plot_axis: Color32::from_rgb(0x44, 0x44, 0x44),
            plot_handle: Color32::from_rgb(0xe0, 0xe0, 0xe0),
            plot_handle_dim: Color32::from_rgb(0x90, 0x90, 0x90),
            meter_bg: Color32::BLACK,
            meter_readout_bg: Color32::from_rgb(0x14, 0x14, 0x14),
            meter_clip_off: Color32::from_rgb(0x30, 0x30, 0x30),
            panner_bg: Color32::from_gray(22),
            panner_border: Color32::from_gray(96),
            panner_speaker: Color32::from_gray(144),
            fader_knob: Color32::from_gray(90),
            eq_track: Color32::from_gray(48),
            eq_tick: Color32::from_gray(96),
            eq_knob: Color32::from_gray(192),
            eq_knob_active: Color32::from_gray(240),
            eq_node: Color32::from_gray(232),
            eq_node_off: Color32::from_gray(112),
            crossover_handle: Color32::from_gray(255),
            keyframe_plot_bg: Color32::from_gray(25),
            keyframe_plot_grid: Color32::from_gray(42),
            keyframe_plot_axis: Color32::from_gray(51),
            keyframe_handle: Color32::from_gray(208),
            switch_fill: Color32::from_gray(212),
            switch_knob: Color32::from_gray(29),
            switch_border: Color32::from_gray(138),
            slider_disabled_track: Color32::from_gray(74),
            slider_disabled_knob: Color32::from_gray(106),
            button_hover: Color32::from_gray(42),
            button_border: Color32::from_gray(75),
            caption_track_bg: Color32::from_rgb(0x23, 0x20, 0x2a),
            scroll_thumb: Color32::from_gray(0x4b),
            scroll_thumb_hover: Color32::from_gray(0x6a),
            vertical_scroll_thumb: Color32::from_gray(80),
            disabled_clip_bg: Color32::from_gray(0x2a),
            tl_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tl_track_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tl_track_bg_alt: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tl_header_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tl_ruler_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            tl_ruler_tick: Color32::from_rgb(0x8d, 0x8d, 0x8d),
            tl_ruler_text: Color32::from_rgb(0xb0, 0xb0, 0xb0),
            playhead: Color32::from_rgb(0x58, 0x95, 0xec),
            track_target: Color32::from_rgb(0x26, 0x5b, 0xc1),
            in_out_shade: Color32::from_rgb(0x3f, 0x3f, 0x3f),
            clip_selected_border: Color32::from_rgb(0xeb, 0xeb, 0xeb),
            render_red: Color32::from_rgb(0xe3, 0x48, 0x50),
            render_yellow: Color32::from_rgb(0xf0, 0xf0, 0x4f),
            render_green: Color32::from_rgb(0x2d, 0x9d, 0x78),
            monitor_bg: Color32::from_rgb(0x1d, 0x1d, 0x1d),
            timecode: Color32::from_rgb(0x40, 0x96, 0xf3),
            danger: Color32::from_rgb(0xdc, 0x51, 0x3d),
            radius: 0.0,
            radius_sm: 4.0,
            gap: 4.0,
            tab_h: 32.0,
        };
        // NeuDark: chrome #262D3A, cards #282F3D, canvas #1B202A, fields #202632, text
        // #E4EBF6 / #C4CFE0 / #A0ADC2, accent #5CA8FF (fills a shade deeper so white text reads).
        let neu_dark = Tokens {
            app_bg: hex(0x1b202a),
            header_bg: hex(0x262d3a),
            panel_bg: hex(0x282f3d),
            tab_bg: hex(0x262d3a),
            tab_text: hex(0xa0adc2),
            tab_text_active: hex(0xe4ebf6),
            focus: hex(0x5ca8ff),
            accent: hex(0x3a8eea),
            accent_hover: hex(0x5ca8ff),
            text: hex(0xc4cfe0),
            text_dim: hex(0xa0adc2),
            text_faint: hex(0x6f7c92),
            icon: hex(0xa0adc2),
            icon_active: hex(0xe4ebf6),
            hover: hex(0x313a4a),
            pressed: hex(0x3b4558),
            field_bg: hex(0x202632),
            field_border: hex(0x3b4558),
            separator: hex(0x343d4d),
            row_alt: hex(0x2b3341),
            row_selected: hex(0x2c4a6e),
            hot_text: hex(0x8ec6ff),
            pill_active_bg: hex(0x364052),
            clip_bar_bg: hex(0x34405a),
            control_surface: hex(0x2d3544),
            control_well: hex(0x1e2430),
            control_border: hex(0x4a5468),
            control_handle_bg: hex(0x313a4a),
            plot_bg: hex(0x1e2430),
            plot_grid: hex(0x2b3342),
            plot_axis: hex(0x3a4456),
            keyframe_plot_bg: hex(0x1e2430),
            keyframe_plot_grid: hex(0x2b3342),
            keyframe_plot_axis: hex(0x3a4456),
            button_hover: hex(0x313a4a),
            button_border: hex(0x4a5468),
            caption_track_bg: hex(0x2a2a44),
            scroll_thumb: hex(0x4a5468),
            scroll_thumb_hover: hex(0x5d687c),
            vertical_scroll_thumb: hex(0x4a5468),
            disabled_clip_bg: hex(0x313a4a),
            tl_bg: hex(0x202632),
            tl_track_bg: hex(0x252c39),
            tl_track_bg_alt: hex(0x252c39),
            tl_header_bg: hex(0x262d3a),
            tl_ruler_bg: hex(0x222834),
            tl_ruler_tick: hex(0x5d687c),
            tl_ruler_text: hex(0xa0adc2),
            playhead: hex(0x5ca8ff),
            track_target: hex(0x2c6cb8),
            in_out_shade: hex(0x3b4558),
            monitor_bg: hex(0x1b202a),
            timecode: hex(0x8ec6ff),
            radius_sm: 6.0,
            ..dark
        };
        match kind {
            ThemeKind::Dark => neu_dark,
            ThemeKind::Medium => Tokens {
                kind,
                app_bg: hex(0x222834),
                header_bg: hex(0x2d3544),
                panel_bg: hex(0x2f3747),
                tab_bg: hex(0x2d3544),
                tl_header_bg: hex(0x2d3544),
                tl_track_bg: hex(0x2b3341),
                tl_track_bg_alt: hex(0x2b3341),
                hover: hex(0x3a4456),
                ..neu_dark
            },
            // NeuLight: chrome #E4ECF6, cards #E6EEF8, canvas #D6E0ED, fields #DCE6F3, text
            // #1E2C42 / #34445E / #4E5E78, accent #3480E2, accent text #1652A8. Pages, frames and
            // the pictures in the monitors keep their own colours.
            ThemeKind::Light => Tokens {
                app_bg: hex(0xd6e0ed),
                header_bg: hex(0xe4ecf6),
                panel_bg: hex(0xe6eef8),
                tab_bg: hex(0xe4ecf6),
                tab_text: hex(0x4e5e78),
                tab_text_active: hex(0x1e2c42),
                focus: hex(0x3480e2),
                accent: hex(0x3480e2),
                accent_hover: hex(0x1652a8),
                text: hex(0x1e2c42),
                text_dim: hex(0x4e5e78),
                text_faint: hex(0x8d9ab0),
                icon: hex(0x4e5e78),
                hover: hex(0xd5e0ee),
                pressed: hex(0xc9d6e8),
                field_bg: hex(0xf3f7fc),
                field_border: hex(0xb3c2d6),
                separator: hex(0xc9d5e5),
                row_alt: hex(0xe0e9f4),
                row_selected: hex(0xc2d8f5),
                hot_text: hex(0x1652a8),
                pill_active_bg: hex(0xc9d6e8),
                clip_bar_bg: hex(0xc2d3ec),
                control_surface: hex(0xe0e9f4),
                control_well: hex(0xcdd8e7),
                control_border: hex(0x9aa9bf),
                control_handle_bg: hex(0xd5e0ee),
                control_handle: hex(0x1e2c42),
                control_handle_dim: hex(0x4e5e78),
                plot_bg: hex(0xf3f7fc),
                plot_grid: hex(0xd5e0ee),
                plot_axis: hex(0xb3c2d6),
                plot_handle: hex(0x1e2c42),
                plot_handle_dim: hex(0x4e5e78),
                meter_bg: hex(0xcdd8e7),
                meter_readout_bg: hex(0xdce6f3),
                meter_clip_off: hex(0x9aa9bf),
                panner_bg: hex(0xcdd8e7),
                panner_border: hex(0x9aa9bf),
                panner_speaker: hex(0x4e5e78),
                fader_knob: hex(0x8d9ab0),
                eq_track: hex(0xcdd8e7),
                eq_tick: hex(0x9aa9bf),
                eq_knob: hex(0x4e5e78),
                eq_knob_active: hex(0x1e2c42),
                eq_node: hex(0x34445e),
                eq_node_off: hex(0x8d9ab0),
                crossover_handle: hex(0x34445e),
                keyframe_plot_bg: hex(0xf3f7fc),
                keyframe_plot_grid: hex(0xd5e0ee),
                keyframe_plot_axis: hex(0xb3c2d6),
                keyframe_handle: hex(0x34445e),
                switch_fill: hex(0x3480e2),
                switch_knob: hex(0xf3f7fc),
                switch_border: hex(0x8d9ab0),
                slider_disabled_track: hex(0xc9d6e8),
                slider_disabled_knob: hex(0x9aa9bf),
                button_hover: hex(0xd5e0ee),
                button_border: hex(0xb3c2d6),
                icon_active: hex(0x1e2c42),
                caption_track_bg: hex(0xdcd8f0),
                scroll_thumb: hex(0xb3c2d6),
                scroll_thumb_hover: hex(0x9aa9bf),
                vertical_scroll_thumb: hex(0xb3c2d6),
                disabled_clip_bg: hex(0xc9d6e8),
                in_out_shade: hex(0xc2d0e2),
                tl_bg: hex(0xdce6f3),
                tl_track_bg: hex(0xe6eef8),
                tl_track_bg_alt: hex(0xe9f0f8),
                tl_header_bg: hex(0xe4ecf6),
                tl_ruler_bg: hex(0xe9f0f8),
                tl_ruler_tick: hex(0x8d9ab0),
                tl_ruler_text: hex(0x34445e),
                playhead: hex(0x3480e2),
                track_target: hex(0x3480e2),
                monitor_bg: hex(0xd6e0ed),
                timecode: hex(0x1652a8),
                clip_selected_border: hex(0x1e2c42),
                radius_sm: 6.0,
                ..dark
            },
            // Brand: the brand gradient's navy (#0a0a0f → #1a1a2e → #16213e) for the chrome, the
            // brand's blue-violet (#667eea) for the accent. `app_bg` and `monitor_bg` are
            // [`BRAND_CANVAS`]: [`fill`] paints the brand backdrop there.
            ThemeKind::Brand => Tokens {
                app_bg: BRAND_CANVAS,
                header_bg: hex(0x0c0d17),
                panel_bg: hex(0x111222),
                tab_bg: hex(0x0c0d17),
                tab_text: hex(0xb7bbd8),
                tab_text_active: hex(0xffffff),
                focus: hex(0x8a9bff),
                accent: hex(0x667eea),
                accent_hover: hex(0x7a8ff0),
                text: hex(0xeef0ff),
                text_dim: hex(0xb7bbd8),
                text_faint: hex(0x6e7298),
                icon: hex(0xb7bbd8),
                icon_active: hex(0xffffff),
                hover: hex(0x1f2238),
                pressed: hex(0x2a2e4c),
                field_bg: hex(0x0a0b14),
                field_border: hex(0x2a2d46),
                separator: hex(0x232640),
                row_alt: hex(0x14162a),
                row_selected: hex(0x2a3066),
                hot_text: hex(0xa9b4ff),
                pill_active_bg: hex(0x2a2e4c),
                clip_bar_bg: hex(0x2a3066),
                control_surface: hex(0x16182a),
                control_well: hex(0x0a0b14),
                control_border: hex(0x3a3e62),
                control_handle_bg: hex(0x1f2238),
                plot_bg: hex(0x0e0f1c),
                plot_grid: hex(0x232640),
                plot_axis: hex(0x30345a),
                keyframe_plot_bg: hex(0x0e0f1c),
                keyframe_plot_grid: hex(0x232640),
                keyframe_plot_axis: hex(0x30345a),
                button_hover: hex(0x1f2238),
                button_border: hex(0x3a3e62),
                caption_track_bg: hex(0x1c1a33),
                scroll_thumb: hex(0x2a2d46),
                scroll_thumb_hover: hex(0x3a3e62),
                vertical_scroll_thumb: hex(0x2a2d46),
                disabled_clip_bg: hex(0x1f2238),
                tl_bg: hex(0x0e0f1c),
                tl_track_bg: hex(0x14162a),
                tl_track_bg_alt: hex(0x14162a),
                tl_header_bg: hex(0x111222),
                tl_ruler_bg: hex(0x12131f),
                tl_ruler_tick: hex(0x5b5f84),
                tl_ruler_text: hex(0xd8dbf0),
                playhead: hex(0x8a9bff),
                track_target: hex(0x5468d4),
                in_out_shade: hex(0x2a2d46),
                monitor_bg: BRAND_CANVAS,
                timecode: hex(0xa9b4ff),
                radius_sm: 6.0,
                ..dark
            },
        }
    }

    /// Settings ▸ Appearance on top of a theme: the highlight colour (selections, primary buttons,
    /// the focus outline, the playhead, timecodes, drag values and track targeting) and accessible
    /// colour contrast (brighter secondary text and borders).
    pub fn with_appearance(mut self, highlight: Option<[u8; 3]>, accessible_contrast: bool) -> Self {
        // AI Видео: the default highlight is "the theme's own" (each palette has its accent).
        let highlight = highlight.filter(|c| Some(*c) != filmcraft_engine::settings::parse_hex(filmcraft_engine::settings::DEFAULT_HIGHLIGHT));
        if let Some([r, g, b]) = highlight {
            let c = Color32::from_rgb(r, g, b);
            // A highlight of the user's own also colours the theme's other blues: the same hue, as
            // much more or less saturated and bright as each of them is than the theme's highlight.
            // The theme's own highlight leaves them exactly as designed.
            if c != self.accent {
                let tint = |s: f32, v: f32| {
                    let mut h = egui::ecolor::HsvaGamma::from(c);
                    h.s = (h.s * s).clamp(0.0, 1.0);
                    h.v = (h.v * v).clamp(0.0, 1.0);
                    Color32::from(h)
                };
                self.focus = tint(0.92, 1.06);
                self.playhead = self.focus;
                self.timecode = tint(0.98, 1.09);
                self.hot_text = self.timecode;
                self.track_target = tint(1.0, 0.865);
            }
            let lift = |v: u8| v.saturating_add(16);
            self.accent = c;
            self.accent_hover = Color32::from_rgb(lift(r), lift(g), lift(b));
        }
        if accessible_contrast {
            if self.kind == ThemeKind::Light {
                self.text_dim = Color32::from_rgb(40, 40, 40);
                self.text_faint = Color32::from_rgb(80, 80, 80);
                self.field_border = Color32::from_rgb(110, 110, 110);
            } else {
                self.text_dim = self.text;
                self.text_faint = Color32::from_rgb(0xa8, 0xa8, 0xa8);
                self.tab_text = self.tab_text_active;
                self.field_border = Color32::from_rgb(0x6a, 0x6a, 0x6a);
                self.separator = Color32::from_rgb(0x50, 0x50, 0x50);
            }
        }
        self
    }

    /// Mono font for timecode.
    pub fn mono(size: f32) -> FontId {
        FontId::new(size, FontFamily::Monospace)
    }
    pub fn ui(size: f32) -> FontId {
        FontId::new(size, FontFamily::Proportional)
    }
    pub fn semibold(size: f32) -> FontId {
        FontId::new(size, FontFamily::Name("semibold".into()))
    }
    /// The big blue timecode over the timeline and under the monitors: regular weight, as in
    /// Premiere (Premiere's reads 10 px tall and 76 px wide for 00:00:16:05 at 1x).
    pub fn timecode() -> FontId {
        FontId::new(16.0, FontFamily::Proportional)
    }
}

const fn hex(rgb: u32) -> Color32 {
    Color32::from_rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8)
}

/// The colour the Brand backdrop reads as: `app_bg` and `monitor_bg` in the Brand theme.
pub const BRAND_CANVAS: Color32 = Color32::from_rgb(0x16, 0x18, 0x2C);

/// Fill `rect` with `color`, or with the brand backdrop when `color` is [`BRAND_CANVAS`].
pub fn fill(painter: &egui::Painter, rect: egui::Rect, color: Color32) {
    if color == BRAND_CANVAS {
        paint_brand_backdrop(painter, rect);
    } else {
        painter.rect_filled(rect, 0.0, color);
    }
}

/// The Brand theme's backdrop, as the owner's pages draw it in CSS: the brand gradient
/// (#0a0a0f → #1a1a2e → #16213e at 135°), three soft glows (circles at 20% 80%, 80% 20% and
/// 40% 40%, fading out halfway to the farthest corner), a 30 px grid of 5% white lines, and an
/// inner shadow round the edges.
pub fn paint_brand_backdrop(painter: &egui::Painter, rect: egui::Rect) {
    use egui::epaint::{Mesh, Vertex, WHITE_UV};
    if !(rect.width().is_finite() && rect.height().is_finite()) || rect.width() <= 0.0 || rect.height() <= 0.0 {
        return;
    }
    // The glows reach past the rect: keep everything inside it.
    let painter = &painter.with_clip_rect(painter.clip_rect().intersect(rect));
    let vertex = |pos: egui::Pos2, color: Color32| Vertex { pos, uv: WHITE_UV, color };
    let quad = |m: &mut Mesh, corners: [(egui::Pos2, Color32); 4]| {
        let base = m.vertices.len() as u32;
        m.vertices.extend(corners.iter().map(|(p, c)| vertex(*p, *c)));
        m.indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    };
    let (a, mid, b) = (hex(0x0a0a0f), hex(0x1a1a2e), hex(0x16213e));
    let mut m = Mesh::default();
    quad(&mut m, [(rect.left_top(), a), (rect.right_top(), mid), (rect.right_bottom(), b), (rect.left_bottom(), mid)]);
    painter.add(egui::Shape::mesh(m));
    for (fx, fy, rgb, alpha) in [(0.2_f32, 0.8_f32, (120, 119, 198), 0.30_f32), (0.8, 0.2, (255, 119, 198), 0.30), (0.4, 0.4, (120, 219, 255), 0.20)] {
        let c = rect.min + egui::vec2(rect.width() * fx, rect.height() * fy);
        let far = egui::vec2(rect.width() * fx.max(1.0 - fx), rect.height() * fy.max(1.0 - fy)).length();
        let reach = far * 0.5;
        let inner = Color32::from_rgba_unmultiplied(rgb.0, rgb.1, rgb.2, (alpha * 255.0) as u8);
        let mut g = Mesh::default();
        g.vertices.push(vertex(c, inner));
        const STEPS: u32 = 64;
        for i in 0..=STEPS {
            let angle = std::f32::consts::TAU * i as f32 / STEPS as f32;
            g.vertices.push(vertex(c + egui::vec2(angle.cos(), angle.sin()) * reach, Color32::TRANSPARENT));
        }
        for i in 1..=STEPS {
            g.indices.extend([0, i, i + 1]);
        }
        painter.add(egui::Shape::mesh(g));
    }
    let line = Stroke::new(1.0, Color32::from_rgba_unmultiplied(255, 255, 255, 13));
    let mut x = rect.left() + 0.5;
    while x < rect.right() {
        painter.vline(x, rect.y_range(), line);
        x += 30.0;
    }
    let mut y = rect.top() + 0.5;
    while y < rect.bottom() {
        painter.hline(rect.x_range(), y, line);
        y += 30.0;
    }
    let dark = |a: f32| Color32::from_rgba_unmultiplied(0, 0, 0, (a * 153.0) as u8);
    let mut sh = Mesh::default();
    let r = rect;
    for (i0, i1, a0, a1) in [(0.0_f32, 10.0_f32, 1.0_f32, 0.75_f32), (10.0, 45.0, 0.75, 0.0)] {
        let (i0, i1) = (i0.min(r.height() / 2.0).min(r.width() / 2.0), i1.min(r.height() / 2.0).min(r.width() / 2.0));
        quad(&mut sh, [(egui::pos2(r.left(), r.top() + i0), dark(a0)), (egui::pos2(r.right(), r.top() + i0), dark(a0)), (egui::pos2(r.right(), r.top() + i1), dark(a1)), (egui::pos2(r.left(), r.top() + i1), dark(a1))]);
        quad(&mut sh, [(egui::pos2(r.left(), r.bottom() - i1), dark(a1)), (egui::pos2(r.right(), r.bottom() - i1), dark(a1)), (egui::pos2(r.right(), r.bottom() - i0), dark(a0)), (egui::pos2(r.left(), r.bottom() - i0), dark(a0))]);
        quad(&mut sh, [(egui::pos2(r.left() + i0, r.top()), dark(a0)), (egui::pos2(r.left() + i1, r.top()), dark(a1)), (egui::pos2(r.left() + i1, r.bottom()), dark(a1)), (egui::pos2(r.left() + i0, r.bottom()), dark(a0))]);
        quad(&mut sh, [(egui::pos2(r.right() - i1, r.top()), dark(a1)), (egui::pos2(r.right() - i0, r.top()), dark(a0)), (egui::pos2(r.right() - i0, r.bottom()), dark(a0)), (egui::pos2(r.right() - i1, r.bottom()), dark(a1))]);
    }
    painter.add(egui::Shape::mesh(sh));
}

/// Menu text: Premiere's menus are the system's, larger and brighter than panel text, one item
/// every 24 px.
pub const MENU_TEXT_SIZE: f32 = 13.0;
pub const MENU_TEXT: Color32 = Color32::from_rgb(0xde, 0xde, 0xde);

/// Style of the menu bar's menus and their submenus (on top of egui's own menu style).
pub fn menu_style(s: &mut egui::Style) {
    egui::containers::menu::menu_style(s);
    s.text_styles.insert(TextStyle::Button, FontId::new(MENU_TEXT_SIZE, FontFamily::Proportional));
    s.text_styles.insert(TextStyle::Body, FontId::new(MENU_TEXT_SIZE, FontFamily::Proportional));
    s.spacing.item_spacing.y = 0.0;
    if s.visuals.dark_mode {
        s.visuals.override_text_color = Some(MENU_TEXT);
    }
}

/// Every font family the theme defines (fallback fonts such as the Japanese fonts are added to each
/// of them).
pub fn font_families() -> Vec<FontFamily> {
    vec![FontFamily::Proportional, FontFamily::Monospace, FontFamily::Name("semibold".into()), FontFamily::Name("medium".into())]
}

/// Install the Latin UI fonts, Chinese fallback (craft-fonts or an installed face), Japanese
/// craft-fonts, Arabic and Hebrew fallbacks (craft-fonts or installed faces, `crate::rtl`) and
/// egui visuals. Document names keep their glyphs in every interface language.
pub fn install(ctx: &egui::Context, t: &Tokens) {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert("inter".into(), Arc::new(FontData::from_static(filmcraft_text::fonts::INTER_REGULAR)));
    fonts.font_data.insert("inter-medium".into(), Arc::new(FontData::from_static(filmcraft_text::fonts::INTER_MEDIUM)));
    fonts.font_data.insert("inter-semibold".into(), Arc::new(FontData::from_static(filmcraft_text::fonts::INTER_SEMIBOLD)));
    fonts.font_data.insert("jbmono".into(), Arc::new(FontData::from_static(filmcraft_text::fonts::JETBRAINS_MONO_REGULAR)));
    fonts.families.entry(FontFamily::Proportional).or_default().insert(0, "inter".into());
    fonts.families.entry(FontFamily::Monospace).or_default().insert(0, "jbmono".into());
    fonts.families.insert(FontFamily::Name("semibold".into()), vec!["inter-semibold".into(), "inter".into()]);
    fonts.families.insert(FontFamily::Name("medium".into()), vec!["inter-medium".into(), "inter".into()]);
    // Japanese before Chinese: the two share code points, and Japanese text must keep Japanese
    // glyph forms; Chinese faces still cover the hanzi Japanese fonts lack
    add_craft_fonts(&mut fonts);
    crate::cjk::install(&mut fonts);
    crate::rtl::install(&mut fonts);
    ctx.set_fonts(fonts);
    apply_visuals(ctx, t);
}

/// Name of the egui font for a craft-fonts entry.
fn craft_font_name(f: &filmcraft_text::fonts::CraftFont) -> String {
    format!("craft:{} {}", f.family, f.style)
}

/// Append the Japanese craft-fonts (empty unless built with `CRAFT_FONTS_DIR`) as the last fallbacks
/// of every font family, after the app's own fonts: BIZ UDPGothic first (bold before regular in
/// the "semibold" and "medium" families), then the other Japanese faces.
fn add_craft_fonts(fonts: &mut FontDefinitions) {
    let jpan: Vec<_> = filmcraft_text::fonts::craft_japanese().collect();
    for f in &jpan {
        fonts.font_data.insert(craft_font_name(f), Arc::new(FontData::from_static(f.bytes)));
    }
    for (family, stack) in fonts.families.iter_mut() {
        let heavy = matches!(family, FontFamily::Name(n) if matches!(n.as_ref(), "semibold" | "medium"));
        let mut order = jpan.clone();
        order.sort_by_key(|f| (!f.family.contains("Gothic"), (f.style == "Bold") != heavy));
        stack.extend(order.iter().map(|f| craft_font_name(f)));
    }
}

pub fn apply_visuals(ctx: &egui::Context, t: &Tokens) {
    let light = t.kind == ThemeKind::Light;
    // FilmCraft decides between light and dark itself (Settings ▸ Appearance ▸ Appearance Mode), so
    // egui must not switch to its other built-in style when the system appearance changes.
    ctx.set_theme(if light { egui::Theme::Light } else { egui::Theme::Dark });
    let mut v = if light { Visuals::light() } else { Visuals::dark() };
    v.panel_fill = t.panel_bg;
    v.window_fill = t.panel_bg;
    v.extreme_bg_color = t.field_bg;
    v.faint_bg_color = t.row_alt;
    v.override_text_color = Some(t.text);
    v.selection.bg_fill = t.accent;
    v.selection.stroke = Stroke::new(1.0, Color32::WHITE);
    v.hyperlink_color = t.accent;
    v.window_stroke = Stroke::new(1.0, t.field_border);
    v.window_corner_radius = egui::CornerRadius::same(6);
    v.menu_corner_radius = egui::CornerRadius::same(6);
    v.popup_shadow = egui::epaint::Shadow { offset: [0, 4], blur: 16, spread: 0, color: Color32::from_black_alpha(140) };
    v.window_shadow = v.popup_shadow;
    match t.kind {
        // Brand: menus, popups and windows are solid black blocks with a strong black shadow.
        ThemeKind::Brand => {
            v.window_fill = Color32::BLACK;
            v.window_stroke = Stroke::new(1.0, hex(0x26283c));
            v.window_corner_radius = egui::CornerRadius::same(8);
            v.menu_corner_radius = egui::CornerRadius::same(6);
            v.popup_shadow = egui::epaint::Shadow { offset: [0, 8], blur: 32, spread: 0, color: Color32::BLACK };
            v.window_shadow = egui::epaint::Shadow { offset: [0, 10], blur: 36, spread: 2, color: Color32::BLACK };
            v.hyperlink_color = hex(0xa9b4ff);
            v.selection.stroke = Stroke::new(1.0, Color32::WHITE);
        }
        // Neumorphic Light and Dark: rounder windows and menus, soft shadows tinted with the
        // palette's blue instead of grey.
        _ => {
            let shade = if light { Color32::from_rgba_unmultiplied(0x46, 0x5a, 0x82, 70) } else { Color32::from_black_alpha(150) };
            v.window_corner_radius = egui::CornerRadius::same(10);
            v.menu_corner_radius = egui::CornerRadius::same(8);
            v.popup_shadow = egui::epaint::Shadow { offset: [0, 6], blur: 18, spread: 0, color: shade };
            v.window_shadow = egui::epaint::Shadow { offset: [0, 10], blur: 30, spread: 0, color: shade };
            v.hyperlink_color = if light { hex(0x1652a8) } else { hex(0x8ec6ff) };
        }
    }
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = egui::CornerRadius::same(t.radius_sm as u8);
    }
    v.widgets.noninteractive.bg_fill = t.panel_bg;
    v.widgets.noninteractive.weak_bg_fill = t.panel_bg;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, t.separator);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0, t.text);
    v.widgets.inactive.bg_fill = t.field_bg;
    v.widgets.inactive.weak_bg_fill = t.field_bg;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, t.field_border);
    v.widgets.inactive.fg_stroke = Stroke::new(1.0, t.text);
    v.widgets.hovered.bg_fill = t.hover;
    v.widgets.hovered.weak_bg_fill = t.hover;
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, t.field_border);
    v.widgets.hovered.fg_stroke = Stroke::new(1.0, t.tab_text_active);
    v.widgets.active.bg_fill = t.pressed;
    v.widgets.active.weak_bg_fill = t.pressed;
    v.widgets.active.fg_stroke = Stroke::new(1.0, t.tab_text_active);
    v.widgets.open.bg_fill = t.hover;
    v.widgets.open.weak_bg_fill = t.hover;
    ctx.set_visuals(v);
    ctx.global_style_mut(|s| {
        s.spacing.item_spacing = egui::vec2(6.0, 4.0);
        s.spacing.button_padding = egui::vec2(8.0, 3.0);
        s.spacing.interact_size.y = 24.0;
        s.spacing.menu_margin = egui::Margin::same(4);
        s.text_styles.insert(TextStyle::Body, FontId::new(12.0, FontFamily::Proportional));
        s.text_styles.insert(TextStyle::Button, FontId::new(12.0, FontFamily::Proportional));
        s.text_styles.insert(TextStyle::Small, FontId::new(11.0, FontFamily::Proportional));
        s.text_styles.insert(TextStyle::Heading, FontId::new(15.0, FontFamily::Name("semibold".into())));
        s.text_styles.insert(TextStyle::Monospace, FontId::new(12.0, FontFamily::Monospace));
        s.animation_time = ANIMATION_TIME;
    });
}

/// How long egui's fades and slides take (menus, collapsing sections, tooltips); 0 when
/// Settings ▸ Appearance ▸ "Animate zoom, scrolling and menus" is off (#2325).
pub const ANIMATION_TIME: f32 = 0.12;

#[cfg(test)]
mod tests {
    use super::*;

    const JAPANESE: &str = "日本語の文字";

    fn installed() -> egui::Context {
        let ctx = egui::Context::default();
        install(&ctx, &Tokens::for_kind(ThemeKind::default()));
        let mut out = ctx.run_ui(egui::RawInput::default(), |_| {});
        out.textures_delta.clear();
        ctx
    }

    #[test]
    fn light_theme_has_light_chrome_and_plot_surfaces() {
        let dark = Tokens::for_kind(ThemeKind::Dark);
        let light = Tokens::for_kind(ThemeKind::Light);
        let luminance = |c: Color32| u16::from(c.r()) + u16::from(c.g()) + u16::from(c.b());

        for (name, dark_surface, light_surface) in [
            ("active pill", dark.pill_active_bg, light.pill_active_bg),
            ("clip bar", dark.clip_bar_bg, light.clip_bar_bg),
            ("control surface", dark.control_surface, light.control_surface),
            ("control well", dark.control_well, light.control_well),
            ("plot", dark.plot_bg, light.plot_bg),
            ("keyframe plot", dark.keyframe_plot_bg, light.keyframe_plot_bg),
            ("panner", dark.panner_bg, light.panner_bg),
            ("caption lane", dark.caption_track_bg, light.caption_track_bg),
            ("active toggle", dark.pressed, light.pressed),
            ("meter", dark.meter_bg, light.meter_bg),
            ("meter readout", dark.meter_readout_bg, light.meter_readout_bg),
        ] {
            assert!(luminance(light_surface) > luminance(dark_surface), "{name} did not adapt to Light");
        }
        assert!(luminance(light.control_handle) < luminance(light.control_handle_bg));
        assert!(luminance(light.plot_handle) < luminance(light.plot_bg));
        assert!(luminance(light.icon_active) < luminance(light.pressed));
    }

    /// The colours the highlight drives besides the accent (#707).
    fn highlight_blues(t: &Tokens) -> [Color32; 5] {
        [t.focus, t.playhead, t.timecode, t.hot_text, t.track_target]
    }

    #[test]
    fn the_default_highlight_leaves_the_theme_blues_as_designed() {
        let default = filmcraft_engine::settings::parse_hex(filmcraft_engine::settings::DEFAULT_HIGHLIGHT);
        for k in [ThemeKind::Dark, ThemeKind::Medium, ThemeKind::Light] {
            assert_eq!(highlight_blues(&Tokens::for_kind(k).with_appearance(default, false)), highlight_blues(&Tokens::for_kind(k)), "{k:?}");
        }
    }

    #[test]
    fn a_highlight_of_ones_own_colours_the_playhead_timecodes_focus_and_targeting() {
        let pink = Color32::from_rgb(0xe0, 0x45, 0x7b);
        let t = Tokens::for_kind(ThemeKind::Dark).with_appearance(Some([0xe0, 0x45, 0x7b]), false);
        let hue = |c: Color32| egui::ecolor::HsvaGamma::from(c).h;
        for (c, was) in highlight_blues(&t).into_iter().zip(highlight_blues(&Tokens::for_kind(ThemeKind::Dark))) {
            assert_ne!(c, was);
            assert!((hue(c) - hue(pink)).abs() < 0.01, "{c:?} has the highlight's hue");
        }
        let v = |c: Color32| egui::ecolor::HsvaGamma::from(c).v;
        assert!(v(t.playhead) > v(pink) && v(t.timecode) > v(pink) && v(t.track_target) < v(pink), "lighter and darker as the default blues are");
    }

    /// Chinese media and track names must render even when the interface stays in English.
    /// Compare the rasterized glyphs with the missing-glyph box, including custom weight families.
    #[test]
    fn chinese_names_render_in_every_theme_and_font_family() {
        const CHINESE: &str = "中文旁白音乐声轨测试简体汉语繁體漢語车";
        filmcraft_text::fonts::scan_system();
        let available = filmcraft_text::fonts::all_faces()
            .iter()
            .any(|f| matches!(f.info.origin, "system" | filmcraft_text::fonts::CRAFT_ORIGIN) && f.covers_text(CHINESE));
        if !available {
            eprintln!("SKIPPED: no craft-fonts or installed Chinese font");
            return;
        }
        let ctx = egui::Context::default();
        for kind in [ThemeKind::Dark, ThemeKind::Medium, ThemeKind::Light] {
            install(&ctx, &Tokens::for_kind(kind));
            ctx.run_ui(egui::RawInput::default(), |_| {}).textures_delta.clear();
            ctx.fonts_mut(|fonts| {
                for family in font_families() {
                    let font = FontId::new(13.0, family);
                    let missing = fonts.layout_no_wrap("\u{fffd}".into(), font.clone(), Color32::WHITE);
                    let missing_uv = missing.rows[0].glyphs[0].uv_rect;
                    let names = fonts.layout_no_wrap(CHINESE.into(), font.clone(), Color32::WHITE);
                    assert_eq!(names.rows.iter().map(|r| r.glyphs.len()).sum::<usize>(), CHINESE.chars().count());
                    for glyph in names.rows.iter().flat_map(|r| &r.glyphs) {
                        assert!(!glyph.uv_rect.is_nothing(), "empty {} in {font:?}", glyph.chr);
                        assert_ne!(glyph.uv_rect, missing_uv, "missing {} in {kind:?} / {font:?}", glyph.chr);
                    }
                }
            });
        }
        // the layouts above put glyphs in the atlas: take that update so it isn't dropped unapplied
        ctx.run_ui(egui::RawInput::default(), |_| {}).textures_delta.clear();
    }

    /// Typed, pasted or IME-composed Hangul draws real glyphs, not the missing-glyph box (artcraft#2093).
    #[test]
    fn korean_text_renders_with_an_installed_korean_font() {
        const KOREAN: &str = "한국어 입력 테스트";
        filmcraft_text::fonts::scan_system();
        // `covers_text`, not `has_char`: probing keeps no font file loaded (see `cjk::find_system_font`)
        let available = filmcraft_text::fonts::all_faces().iter().any(|f| f.info.origin == "system" && f.covers_text(KOREAN));
        if !available {
            eprintln!("SKIPPED: no installed Korean font");
            return;
        }
        let ctx = egui::Context::default();
        install(&ctx, &Tokens::for_kind(ThemeKind::Dark));
        ctx.run_ui(egui::RawInput::default(), |_| {}).textures_delta.clear();
        ctx.fonts_mut(|fonts| {
            for family in font_families() {
                let font = FontId::new(13.0, family);
                let missing = fonts.layout_no_wrap("\u{fffd}".into(), font.clone(), Color32::WHITE);
                let missing_uv = missing.rows[0].glyphs[0].uv_rect;
                let text = fonts.layout_no_wrap(KOREAN.into(), font.clone(), Color32::WHITE);
                for glyph in text.rows.iter().flat_map(|r| &r.glyphs).filter(|g| g.chr != ' ') {
                    assert_ne!(glyph.uv_rect, missing_uv, "missing {} in {font:?}", glyph.chr);
                }
            }
        });
        ctx.run_ui(egui::RawInput::default(), |_| {}).textures_delta.clear();
    }

    /// Built with craft-fonts: every font family ends with the Japanese faces (BIZ UDPGothic
    /// first), and Japanese text gets real glyphs, not the replacement box.
    #[test]
    fn japanese_renders_with_craft_fonts() {
        if filmcraft_text::fonts::craft_japanese().next().is_none() {
            eprintln!("SKIPPED: built without craft-fonts (set CRAFT_FONTS_DIR to run)");
            return;
        }
        let ctx = installed();
        ctx.fonts_mut(|fonts| {
            let defs = fonts.definitions().clone();
            for (family, stack) in &defs.families {
                // installed faces come after the craft run: right-to-left ones (Hebrew is not in
                // craft-fonts) and the Hangul face (none is in craft-fonts)
                let stack: Vec<&String> = stack
                    .iter()
                    .filter(|n| !crate::rtl::is_system_face(n) && n.as_str() != crate::cjk::KOREAN_FACE && n.as_str() != crate::cjk::THAI_FACE)
                    .collect();
                let first = stack.iter().position(|n| n.starts_with("craft:")).unwrap_or(stack.len());
                assert!(first > 0 && stack[first..].iter().all(|n| n.starts_with("craft:")), "{family:?}: {stack:?}");
                let first_japanese = stack.iter().find(|n| n.starts_with("craft:BIZ") || n.starts_with("craft:Shippori"));
                assert!(first_japanese.is_some_and(|n| n.starts_with("craft:BIZ UDPGothic")), "{family:?}: {stack:?}");
            }
            for family in [FontFamily::Proportional, FontFamily::Monospace] {
                let font = FontId::new(13.0, family);
                for ch in JAPANESE.chars() {
                    assert!(fonts.has_glyph(&font, ch), "missing {ch} in {font:?}");
                }
            }
        });
        // laid out and drawn: the replacement box (U+FFFD) would show as one glyph per character
        // from the fallback face; a real face gives each character its own width
        let galley = ctx.fonts_mut(|f| f.layout_no_wrap(JAPANESE.into(), FontId::new(13.0, FontFamily::Proportional), Color32::WHITE));
        assert_eq!(galley.rows.iter().map(|r| r.glyphs.len()).sum::<usize>(), JAPANESE.chars().count());
        assert!(galley.size().x > 13.0 * 4.0, "{:?}", galley.size());
    }

    /// Latin text keeps its UI faces, with or without craft-fonts and system Chinese fonts.
    #[test]
    fn works_without_craft_fonts() {
        let ctx = installed();
        let n = filmcraft_text::fonts::craft_japanese().count()
            + crate::cjk::craft_fonts().count()
            + crate::rtl::craft_fonts().count()
            + crate::cjk::thai_craft_fonts().count();
        ctx.fonts_mut(|fonts| {
            let defs = fonts.definitions().clone();
            assert_eq!(defs.font_data.keys().filter(|k| k.starts_with("craft:")).count(), n);
            assert_eq!(defs.families[&FontFamily::Proportional].first().map(String::as_str), Some("inter"));
            assert_eq!(defs.families[&FontFamily::Monospace].first().map(String::as_str), Some("jbmono"));
            assert!(fonts.has_glyph(&FontId::new(13.0, FontFamily::Proportional), 'A'));
            if n == 0 {
                assert!(defs.families.values().flatten().all(|name| !name.starts_with("craft:")));
            }
        });
    }
}
