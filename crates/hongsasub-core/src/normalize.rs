use unicode_normalization::UnicodeNormalization;

const INVISIBLE: [char; 4] = ['\u{200B}', '\u{FEFF}', '\u{2060}', '\u{00AD}'];

pub fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;
    for c in text.chars() {
        match c {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

pub fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

pub fn leading_tags(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while rest.starts_with('{') {
        match rest.find('}') {
            Some(end) => {
                out.push_str(&rest[..=end]);
                rest = &rest[end + 1..];
            }
            None => break,
        }
    }
    out
}

fn plain(text: &str) -> String {
    strip_html(&strip_tags(text)).replace("\\N", " ").replace("\\n", " ").replace("\\h", " ")
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn normalize_source(text: &str) -> String {
    let s: String = plain(text)
        .nfc()
        .filter(|c| !INVISIBLE.contains(c))
        .map(|c| match c {
            '\u{2018}' | '\u{2019}' | '\u{02BC}' => '\'',
            '\u{201C}' | '\u{201D}' => '"',
            '\u{2013}' | '\u{2014}' => '-',
            '\u{2026}' => '.',
            _ => c,
        })
        .collect::<String>()
        .to_lowercase();
    collapse(&s.replace("...", "."))
}

pub fn clean_target(text: &str) -> String {
    let s: String = strip_tags(text).nfc().filter(|c| !INVISIBLE.contains(c)).collect();
    s.split("\\N").map(collapse).collect::<Vec<_>>().join("\\N").trim().to_string()
}

pub fn normalize_target(text: &str) -> String {
    collapse(&clean_target(text).replace("\\N", " "))
}

pub fn tokens(normalized: &str) -> Vec<String> {
    normalized
        .split(|c: char| c.is_whitespace() || (c.is_ascii_punctuation() && c != '\''))
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_normalization() {
        assert_eq!(normalize_source("{\\i1}Don\u{2019}t  GO\\Nthere\u{2026}{\\i0}"), "don't go there.");
        assert_eq!(normalize_source("<i>Run!</i>"), "run!");
    }

    #[test]
    fn target_cleanup_removes_invisible_marks() {
        assert_eq!(clean_target("\u{1000}\u{200B}\u{1031}  \\N  \u{1000}"), "\u{1000}\u{1031}\\N\u{1000}");
        assert_eq!(normalize_target("\u{1000}\\N\u{1001}"), "\u{1000} \u{1001}");
    }

    #[test]
    fn leading_tag_extraction() {
        assert_eq!(leading_tags("{\\an8}{\\i1}Hi"), "{\\an8}{\\i1}");
        assert_eq!(leading_tags("Hi"), "");
    }

    #[test]
    fn tokenization() {
        assert_eq!(tokens("don't go, now!"), vec!["don't", "go", "now"]);
    }
}
