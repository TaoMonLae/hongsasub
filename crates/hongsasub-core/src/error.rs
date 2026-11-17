use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid time `{0}`")]
    InvalidTime(String),
    #[error("parse error on line {line}: {message}")]
    Parse { line: usize, message: String },
    #[error("unsupported format: {0}")]
    Unsupported(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
