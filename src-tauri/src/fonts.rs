//! System font enumeration via `fontdb`.
//!
//! Returns just enough metadata for the frontend's font picker:
//! family name, PostScript name, file path, and a CJK-support flag
//! (so the picker can prefer fonts that actually render Chinese
//! captions). We dedupe by file path because a single .ttc collection
//! contains multiple faces; ffmpeg's `drawtext=fontfile=…` takes the
//! collection file once.
//!
//! Why fontdb (not font-kit): on macOS `font-kit` exposes fonts via
//! CoreText which only hands back in-memory bytes — there's no API to
//! recover the on-disk URL. fontdb walks the system font directories
//! directly, so every face has a real path we can pass to ffmpeg.

use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
pub struct FontInfo {
    /// Display name. Falls back to the file stem if neither family nor
    /// PostScript name is recoverable from the face.
    pub family: String,
    pub postscript_name: String,
    /// Absolute path to the .ttf / .ttc / .otf on disk.
    pub path: String,
    /// Index of this face within the file. 0 for single-face .ttf/.otf
    /// and the default face of a .ttc; higher for additional faces in
    /// a collection. `ffmpeg drawtext` only ever uses face 0, so a
    /// non-zero `face_index` means "selecting this in the picker won't
    /// match what's rendered" — UI uses this to warn the user.
    pub face_index: u32,
    /// True iff the font's cmap covers ALL of the probe codepoints
    /// (which include simplified-only Chinese glyphs). Used to filter
    /// the picker to faces that actually render Simplified Chinese
    /// captions — a single 你 probe wasn't enough because many
    /// Traditional / Japanese fonts cover it but lack 问 / 时 / 负.
    pub supports_cjk: bool,
}

/// Codepoints we require for `supports_cjk`. The mix is deliberate:
///   你 (U+4F60) — common to Japanese, Traditional, and Simplified
///   问 (U+95EE) — Simplified-specific (Traditional is 問)
///   时 (U+65F6) — Simplified-specific (Traditional is 時)
///   负 (U+8D1F) — Simplified-specific (Traditional is 負)
/// A face must cover EVERY one. Traditional-only or Japanese-only fonts
/// fail on 问/时/负 and get marked unsupported, which prevents the
/// default picker from landing on a face that would render tofu boxes
/// like the user saw.
const CJK_PROBES: &[u32] = &[0x4F60, 0x95EE, 0x65F6, 0x8D1F];

/// Walk the system font sources, dedupe by file path, return one entry
/// per font file.
pub fn list_system_fonts() -> Result<Vec<FontInfo>, String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    // Dedup by (path, face_index) so every face in a .ttc gets its own
    // entry — picker shows e.g. "PingFang SC" alongside "PingFang HK"
    // even though both live in PingFang.ttc.
    let mut seen: HashSet<(PathBuf, u32)> = HashSet::new();
    let mut out: Vec<FontInfo> = Vec::with_capacity(db.len());

    for face in db.faces() {
        // Only file-backed faces are useful for ffmpeg. `Source::Binary`
        // can't be passed to ffmpeg's `drawtext=fontfile=…`.
        let path: PathBuf = match &face.source {
            fontdb::Source::File(p) => p.clone(),
            fontdb::Source::SharedFile(p, _) => p.clone(),
            fontdb::Source::Binary(_) => continue,
        };
        if !seen.insert((path.clone(), face.index)) {
            continue;
        }

        // CJK probe: open the file and check the cmap for this specific
        // face. Loading is cheap (memory-mapped) and only happens once
        // per (path, index).
        let supports_cjk = check_cjk_support(&path, face.index).unwrap_or(false);

        // fontdb gives us families as a list of (Language, name) pairs.
        // Prefer the English (en-US) entry so the dropdown is consistent
        // regardless of system locale; fall back to the first entry.
        let family = best_family_name(&face.families)
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .to_string()
            });
        let postscript_name = face.post_script_name.clone();

        out.push(FontInfo {
            family,
            postscript_name,
            path: path.to_string_lossy().to_string(),
            face_index: face.index,
            supports_cjk,
        });
    }

    // CJK-capable fonts first (so the default pick from the head of the
    // list lands on something that actually renders captions), then
    // alphabetic by family within each group for predictable UI order.
    out.sort_by(|a, b| {
        b.supports_cjk
            .cmp(&a.supports_cjk)
            .then_with(|| a.family.to_lowercase().cmp(&b.family.to_lowercase()))
    });

    Ok(out)
}

fn best_family_name(families: &[(String, fontdb::Language)]) -> Option<String> {
    // Prefer English so the dropdown UI is stable across locales; then
    // fall back to whatever's first if no English entry exists.
    families
        .iter()
        .find(|(_, lang)| matches!(lang, fontdb::Language::English_UnitedStates))
        .map(|(name, _)| name.clone())
        .or_else(|| families.first().map(|(name, _)| name.clone()))
}

fn check_cjk_support(path: &std::path::Path, face_index: u32) -> Option<bool> {
    let bytes = std::fs::read(path).ok()?;
    let face = ttf_parser::Face::parse(&bytes, face_index).ok()?;
    // Require ALL probe codepoints — a font that's missing any of the
    // simplified-specific glyphs would render tofu boxes for them.
    for cp in CJK_PROBES {
        let ch = char::from_u32(*cp)?;
        if face.glyph_index(ch).is_none() {
            return Some(false);
        }
    }
    Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_returns_at_least_one_font_on_a_dev_machine() {
        let fonts = list_system_fonts().expect("enumeration should succeed");
        // CI/dev machines essentially always ship some fonts. If this is
        // 0 it's worth investigating before silently shipping an empty
        // dropdown.
        assert!(!fonts.is_empty(), "no system fonts found at all");
    }

    #[test]
    fn cjk_capable_entries_come_first() {
        let fonts = list_system_fonts().expect("enumeration");
        let first_non_cjk = fonts.iter().position(|f| !f.supports_cjk);
        if let Some(boundary) = first_non_cjk {
            assert!(
                fonts[boundary..].iter().all(|f| !f.supports_cjk),
                "CJK font found after the non-CJK boundary — sort regression"
            );
        }
    }

    #[test]
    fn paths_are_absolute_and_readable() {
        let fonts = list_system_fonts().expect("enumeration");
        // Sample the first CJK-capable font (or first overall). It
        // should exist on disk — fontdb only adds files it found.
        if let Some(f) = fonts.iter().find(|f| f.supports_cjk).or_else(|| fonts.first()) {
            assert!(
                std::path::Path::new(&f.path).exists(),
                "font path {:?} doesn't exist on disk",
                f.path
            );
        }
    }
}
