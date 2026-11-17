use crate::error::{CoreError, Result};

pub fn parse_ass(value: &str) -> Result<i64> {
    let v = value.trim();
    let err = || CoreError::InvalidTime(v.to_string());
    let mut parts = v.split(':');
    let h: i64 = parts.next().ok_or_else(err)?.trim().parse().map_err(|_| err())?;
    let m: i64 = parts.next().ok_or_else(err)?.trim().parse().map_err(|_| err())?;
    let rest = parts.next().ok_or_else(err)?;
    if parts.next().is_some() {
        return Err(err());
    }
    let (s, frac) = match rest.split_once('.') {
        Some((s, f)) => (s, f),
        None => (rest, "0"),
    };
    let s: i64 = s.trim().parse().map_err(|_| err())?;
    let frac_ms = fraction_to_ms(frac).ok_or_else(err)?;
    Ok(((h * 60 + m) * 60 + s) * 1000 + frac_ms)
}

pub fn parse_srt(value: &str) -> Result<i64> {
    let v = value.trim();
    let err = || CoreError::InvalidTime(v.to_string());
    let normalized = v.replace('.', ",");
    let (hms, frac) = normalized.split_once(',').unwrap_or((normalized.as_str(), "0"));
    let mut parts = hms.split(':');
    let h: i64 = parts.next().ok_or_else(err)?.trim().parse().map_err(|_| err())?;
    let m: i64 = parts.next().ok_or_else(err)?.trim().parse().map_err(|_| err())?;
    let s: i64 = parts.next().ok_or_else(err)?.trim().parse().map_err(|_| err())?;
    let frac_ms = fraction_to_ms(frac).ok_or_else(err)?;
    Ok(((h * 60 + m) * 60 + s) * 1000 + frac_ms)
}

fn fraction_to_ms(frac: &str) -> Option<i64> {
    let digits: String = frac.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return Some(0);
    }
    let mut padded = digits.clone();
    while padded.len() < 3 {
        padded.push('0');
    }
    padded[..3].parse().ok()
}

pub fn format_ass(ms: i64) -> String {
    let ms = ms.max(0);
    let cs = (ms + 5) / 10;
    let h = cs / 360_000;
    let m = (cs / 6_000) % 60;
    let s = (cs / 100) % 60;
    let c = cs % 100;
    format!("{}:{:02}:{:02}.{:02}", h, m, s, c)
}

pub fn format_srt(ms: i64) -> String {
    let ms = ms.max(0);
    let h = ms / 3_600_000;
    let m = (ms / 60_000) % 60;
    let s = (ms / 1000) % 60;
    let f = ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_round_trip() {
        let t = parse_ass("1:02:03.45").unwrap();
        assert_eq!(t, 3_723_450);
        assert_eq!(format_ass(t), "1:02:03.45");
    }

    #[test]
    fn srt_round_trip() {
        let t = parse_srt("01:02:03,456").unwrap();
        assert_eq!(t, 3_723_456);
        assert_eq!(format_srt(t), "01:02:03,456");
        assert_eq!(parse_srt("00:00:01.5").unwrap(), 1500);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_ass("abc").is_err());
        assert!(parse_srt("1:2").is_err());
    }
}
