#[derive(Debug, Clone, Default, PartialEq)]
struct State {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    color: Option<String>,
    font: Option<String>,
    size: Option<String>,
}

fn ass_color_to_hex(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches('&').trim_start_matches(['H', 'h']);
    let hex: String = trimmed.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
    if hex.is_empty() {
        return None;
    }
    let padded = format!("{:0>6}", hex);
    let bgr = &padded[padded.len() - 6..];
    Some(format!("#{}{}{}", &bgr[4..6], &bgr[2..4], &bgr[0..2]).to_ascii_uppercase())
}

fn hex_to_ass_color(value: &str) -> Option<String> {
    let v = value.trim().trim_start_matches('#');
    if v.len() != 6 || !v.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("&H{}{}{}&", &v[4..6], &v[2..4], &v[0..2]).to_ascii_uppercase())
}

fn flag(rest: &str) -> Option<bool> {
    if rest.is_empty() {
        return Some(false);
    }
    rest.parse::<u32>().ok().map(|n| n != 0)
}

fn apply_override(state: &mut State, block: &str) {
    for raw in block.split('\\').skip(1) {
        let tag = raw.trim();
        if tag == "r" || (tag.starts_with('r') && !tag.starts_with("rnd")) {
            *state = State::default();
        } else if let Some(rest) = tag.strip_prefix("fn") {
            state.font = (!rest.trim().is_empty()).then(|| rest.trim().to_string());
        } else if let Some(rest) = tag.strip_prefix("fs").filter(|r| r.chars().all(|c| c.is_ascii_digit() || c == '.')) {
            state.size = (!rest.is_empty()).then(|| rest.to_string());
        } else if let Some(rest) = tag.strip_prefix("1c").or_else(|| tag.strip_prefix('c')).filter(|r| r.is_empty() || r.starts_with(['&', 'H', 'h'])) {
            state.color = ass_color_to_hex(rest);
        } else if let Some(rest) = tag.strip_prefix('b').filter(|r| r.chars().all(|c| c.is_ascii_digit())) {
            state.bold = if rest.is_empty() { false } else { rest.parse::<u32>().map(|n| n == 1 || n >= 500).unwrap_or(false) };
        } else if let Some(v) = tag.strip_prefix('i').and_then(flag) {
            state.italic = v;
        } else if let Some(v) = tag.strip_prefix('u').and_then(flag) {
            state.underline = v;
        } else if let Some(v) = tag.strip_prefix('s').and_then(flag) {
            state.strike = v;
        }
    }
}

fn open_html(state: &State, out: &mut String) {
    if state.color.is_some() || state.font.is_some() || state.size.is_some() {
        out.push_str("<font");
        if let Some(face) = &state.font {
            out.push_str(&format!(" face=\"{face}\""));
        }
        if let Some(size) = &state.size {
            out.push_str(&format!(" size=\"{size}\""));
        }
        if let Some(color) = &state.color {
            out.push_str(&format!(" color=\"{color}\""));
        }
        out.push('>');
    }
    for (on, tag) in [(state.bold, "b"), (state.italic, "i"), (state.underline, "u"), (state.strike, "s")] {
        if on {
            out.push_str(&format!("<{tag}>"));
        }
    }
}

fn close_html(state: &State, out: &mut String) {
    for (on, tag) in [(state.strike, "s"), (state.underline, "u"), (state.italic, "i"), (state.bold, "b")] {
        if on {
            out.push_str(&format!("</{tag}>"));
        }
    }
    if state.color.is_some() || state.font.is_some() || state.size.is_some() {
        out.push_str("</font>");
    }
}

pub fn alignment(text: &str) -> Option<u8> {
    let mut found = None;
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else { break };
        for raw in after[..close].split('\\').skip(1) {
            if let Some(n) = raw.trim().strip_prefix("an").and_then(|d| d.parse::<u8>().ok()).filter(|n| (1..=9).contains(n)) {
                found = Some(n);
            }
        }
        rest = &after[close + 1..];
    }
    found
}

pub fn ass_to_html(text: &str) -> String {
    let mut runs: Vec<(State, String)> = Vec::new();
    let mut state = State::default();
    let mut rest = text;
    while !rest.is_empty() {
        if let Some(stripped) = rest.strip_prefix('{') {
            match stripped.find('}') {
                Some(close) => {
                    apply_override(&mut state, &stripped[..close]);
                    rest = &stripped[close + 1..];
                    continue;
                }
                None => {
                    rest = "";
                    continue;
                }
            }
        }
        let end = rest.find('{').unwrap_or(rest.len());
        let chunk = &rest[..end];
        match runs.last_mut() {
            Some((s, t)) if *s == state => t.push_str(chunk),
            _ => runs.push((state.clone(), chunk.to_string())),
        }
        rest = &rest[end..];
    }
    let mut out = String::new();
    for (s, t) in runs {
        open_html(&s, &mut out);
        out.push_str(&t);
        close_html(&s, &mut out);
    }
    out
}

fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut rest = tag;
    while let Some(eq) = rest.find('=') {
        let key = rest[..eq].split_whitespace().last().unwrap_or("").to_ascii_lowercase();
        let after = rest[eq + 1..].trim_start();
        let (value, next) = match after.chars().next() {
            Some(q @ ('"' | '\'')) => {
                let body = &after[1..];
                let end = body.find(q).unwrap_or(body.len());
                (body[..end].to_string(), body.get(end + 1..).unwrap_or(""))
            }
            _ => {
                let end = after.find(char::is_whitespace).unwrap_or(after.len());
                (after[..end].to_string(), &after[end..])
            }
        };
        found.push((key, value));
        rest = next;
    }
    found
}

#[derive(Default)]
struct FontFrame {
    color: Option<String>,
    face: Option<String>,
    size: Option<String>,
}

fn font_reset(stack: &[FontFrame], frame: &FontFrame) -> String {
    let mut out = String::new();
    if frame.color.is_some() {
        match stack.iter().rev().find_map(|f| f.color.clone()) {
            Some(c) => out.push_str(&format!("\\c{c}")),
            None => out.push_str("\\c"),
        }
    }
    if frame.face.is_some() {
        match stack.iter().rev().find_map(|f| f.face.clone()) {
            Some(f) => out.push_str(&format!("\\fn{f}")),
            None => out.push_str("\\fn"),
        }
    }
    if frame.size.is_some() {
        match stack.iter().rev().find_map(|f| f.size.clone()) {
            Some(s) => out.push_str(&format!("\\fs{s}")),
            None => out.push_str("\\fs"),
        }
    }
    out
}

pub fn html_to_ass(text: &str) -> String {
    if !text.contains('<') {
        return text.to_string();
    }
    let mut out = String::new();
    let mut stack: Vec<FontFrame> = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else {
            out.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let inner = after[..close].trim();
        let closing = inner.starts_with('/');
        let body = inner.trim_start_matches('/').trim();
        let name = body.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        let replacement = match (name.as_str(), closing) {
            ("b" | "i" | "u" | "s", _) => Some(format!("{{\\{name}{}}}", if closing { 0 } else { 1 })),
            ("font", false) => {
                let mut frame = FontFrame::default();
                let mut tags = String::new();
                for (key, value) in attributes(&body[4..]) {
                    match key.as_str() {
                        "color" => {
                            if let Some(c) = hex_to_ass_color(&value) {
                                tags.push_str(&format!("\\c{c}"));
                                frame.color = Some(c);
                            }
                        }
                        "face" => {
                            tags.push_str(&format!("\\fn{value}"));
                            frame.face = Some(value);
                        }
                        "size" => {
                            tags.push_str(&format!("\\fs{value}"));
                            frame.size = Some(value);
                        }
                        _ => {}
                    }
                }
                stack.push(frame);
                Some(if tags.is_empty() { String::new() } else { format!("{{{tags}}}") })
            }
            ("font", true) => {
                let frame = stack.pop().unwrap_or_default();
                let reset = font_reset(&stack, &frame);
                Some(if reset.is_empty() { String::new() } else { format!("{{{reset}}}") })
            }
            _ => None,
        };
        match replacement {
            Some(r) => out.push_str(&r),
            None => out.push_str(&rest[open..open + close + 2]),
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_overrides_become_html() {
        assert_eq!(ass_to_html("{\\i1}Hello{\\i0} world"), "<i>Hello</i> world");
        assert_eq!(ass_to_html("{\\b1\\u1}A{\\b0}B{\\u0}C"), "<b><u>A</u></b><u>B</u>C");
        assert_eq!(ass_to_html("{\\c&H0000FF&}red{\\c} plain"), "<font color=\"#FF0000\">red</font> plain");
        assert_eq!(ass_to_html("{\\fnPyidaungsu\\fs48}Mon{\\r}x"), "<font face=\"Pyidaungsu\" size=\"48\">Mon</font>x");
        assert_eq!(ass_to_html("{\\an8}{\\fscx120}Top\\Nline"), "Top\\Nline");
        assert_eq!(ass_to_html("{\\s1}gone{\\s0}{\\shad2}x"), "<s>gone</s>x");
        assert_eq!(ass_to_html("{\\c&H0000FF&}a{\\clip(0,0,10,10)}b"), "<font color=\"#FF0000\">ab</font>");
        assert_eq!(alignment("{\\pos(1,2)\\an7}x{\\i1}"), Some(7));
        assert_eq!(alignment("plain"), None);
    }

    #[test]
    fn html_becomes_ass_overrides() {
        assert_eq!(html_to_ass("<i>Run!</i>"), "{\\i1}Run!{\\i0}");
        assert_eq!(html_to_ass("<font color=\"#FF0000\">red</font> x"), "{\\c&H0000FF&}red{\\c} x");
        assert_eq!(
            html_to_ass("<font face='Arial' color=#00FF00>a<font color=\"#0000FF\">b</font>c</font>"),
            "{\\fnArial\\c&H00FF00&}a{\\c&HFF0000&}b{\\c&H00FF00&}c{\\c\\fn}"
        );
        assert_eq!(html_to_ass("1 < 2 and <x>"), "1 < 2 and <x>");
        assert_eq!(html_to_ass("plain"), "plain");
    }

    #[test]
    fn colours_round_trip() {
        let html = ass_to_html("{\\1c&H00336699&}x");
        assert_eq!(html, "<font color=\"#996633\">x</font>");
        assert_eq!(html_to_ass(&html), "{\\c&H336699&}x{\\c}");
    }
}
