use std::{
    io,
    net::SocketAddr,
    pin::Pin,
    task::{Context, Poll},
    time::Instant,
};

use axum::{
    body::{to_bytes, Body},
    extract::{connect_info::Connected, ConnectInfo, Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    serve::{IncomingStream, Listener},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
};

use crate::AppState;

const LOG_BODY_CHARS: usize = 4_096;

#[derive(Clone, Copy, Debug)]
pub struct PeerAddr(pub SocketAddr);

pub struct LoggedListener {
    inner: TcpListener,
}

impl LoggedListener {
    pub fn new(inner: TcpListener) -> Self {
        Self { inner }
    }
}

impl Listener for LoggedListener {
    type Io = LoggedStream;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        let (inner, peer) = Listener::accept(&mut self.inner).await;
        tracing::info!(%peer, "connection opened");
        (
            LoggedStream {
                inner,
                peer,
                opened_at: Instant::now(),
            },
            peer,
        )
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.inner.local_addr()
    }
}

pub struct LoggedStream {
    inner: TcpStream,
    peer: SocketAddr,
    opened_at: Instant,
}

impl Drop for LoggedStream {
    fn drop(&mut self) {
        tracing::info!(
            peer = %self.peer,
            duration_ms = self.opened_at.elapsed().as_millis() as u64,
            "connection closed"
        );
    }
}

impl AsyncRead for LoggedStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for LoggedStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }
}

impl Connected<IncomingStream<'_, LoggedListener>> for PeerAddr {
    fn connect_info(stream: IncomingStream<'_, LoggedListener>) -> Self {
        PeerAddr(*stream.remote_addr())
    }
}

pub async fn access_log(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if let Some(ConnectInfo(PeerAddr(peer))) = request.extensions().get::<ConnectInfo<PeerAddr>>().copied() {
        request.extensions_mut().insert(ConnectInfo(peer));
    }
    let method = request.method().clone();
    let path = logged_path(request.uri());
    let peer = peer_addr(&request);
    let started = Instant::now();
    let limit = state.config().max_json_bytes;
    let request_body = match read_request_body(&mut request, limit).await {
        Ok(body) => body,
        Err(response) => return response,
    };

    tracing::info!(
        peer = %DisplayPeer(peer),
        method = %method,
        path = %path,
        body = %request_body,
        "request"
    );

    let response = next.run(request).await;
    let (response, response_body) = read_response_body(response, limit).await;

    tracing::info!(
        peer = %DisplayPeer(peer),
        method = %method,
        path = %path,
        status = response.status().as_u16(),
        duration_ms = started.elapsed().as_millis() as u64,
        body = %response_body,
        "response"
    );
    response
}

async fn read_request_body(request: &mut Request, limit: usize) -> Result<String, Response> {
    if !matches!(
        *request.method(),
        axum::http::Method::POST | axum::http::Method::PUT | axum::http::Method::PATCH
    ) || request.headers().get(header::UPGRADE).is_some()
    {
        return Ok(String::new());
    }

    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    if let Some(length) = content_length(request.headers()) {
        if length > limit {
            return Ok(format!("[too large {length} bytes]"));
        }
    }

    let (parts, body) = std::mem::replace(request, Request::new(Body::empty())).into_parts();
    match to_bytes(body, limit).await {
        Ok(bytes) => {
            let preview = preview_body(&bytes, content_type.as_deref());
            *request = Request::from_parts(parts, Body::from(bytes));
            Ok(preview)
        }
        Err(_) => Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload too large",
        )
            .into_response()),
    }
}

async fn read_response_body(response: Response, limit: usize) -> (Response, String) {
    if is_streaming(&response) {
        return (response, "[stream]".to_owned());
    }
    let Some(length) = content_length(response.headers()) else {
        return (response, "[body omitted]".to_owned());
    };
    if length > limit {
        return (response, format!("[too large {length} bytes]"));
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let (parts, body) = response.into_parts();
    match to_bytes(body, limit).await {
        Ok(bytes) => {
            let preview = preview_body(&bytes, content_type.as_deref());
            (Response::from_parts(parts, Body::from(bytes)), preview)
        }
        Err(_) => (Response::from_parts(parts, Body::empty()), "[unread]".to_owned()),
    }
}

fn is_streaming(response: &Response) -> bool {
    response.status() == StatusCode::SWITCHING_PROTOCOLS
        || response.headers().get(header::UPGRADE).is_some()
        || response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .to_ascii_lowercase()
                    .starts_with("text/event-stream")
            })
}

fn peer_addr(request: &Request) -> Option<SocketAddr> {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(peer)| *peer)
}

fn content_length(headers: &axum::http::HeaderMap) -> Option<usize> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

fn logged_path(uri: &axum::http::Uri) -> String {
    match uri.query() {
        Some(query) => format!("{}?{}", uri.path(), redact_form(query)),
        None => uri.path().to_owned(),
    }
}

fn preview_body(bytes: &[u8], content_type: Option<&str>) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let content_type = content_type.unwrap_or("").to_ascii_lowercase();
    if content_type.contains("application/json") {
        if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(bytes) {
            redact_value(&mut value);
            return truncate(&value.to_string());
        }
    }
    if content_type.contains("application/x-www-form-urlencoded") {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return truncate(&redact_form(text));
        }
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => truncate(text),
        Err(_) => format!("[binary {} bytes]", bytes.len()),
    }
}

fn redact_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if is_sensitive(key) && child.is_string() {
                    *child = serde_json::Value::String("[redacted]".to_owned());
                } else {
                    redact_value(child);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_value(item);
            }
        }
        _ => {}
    }
}

fn redact_form(text: &str) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in url::form_urlencoded::parse(text.as_bytes()) {
        if is_sensitive(&key) {
            serializer.append_pair(&key, "[redacted]");
        } else {
            serializer.append_pair(&key, &value);
        }
    }
    serializer.finish()
}

fn is_sensitive(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().replace('-', "_").as_str(),
        "password"
            | "confirm_password"
            | "old_password"
            | "new_password"
            | "token"
            | "access_token"
            | "refresh_token"
            | "id_token"
            | "code"
            | "code_verifier"
            | "ticket"
            | "ws_ticket"
            | "csrf"
            | "secret"
            | "client_secret"
            | "authorization"
            | "cookie"
            | "request"
            | "x_admin_token"
            | "x_csrf_token"
    )
}

fn truncate(value: &str) -> String {
    match value.char_indices().nth(LOG_BODY_CHARS) {
        Some((idx, _)) => format!("{}…[truncated]", &value[..idx]),
        None => value.to_owned(),
    }
}

struct DisplayPeer(Option<SocketAddr>);

impl std::fmt::Display for DisplayPeer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.0 {
            Some(peer) => write!(f, "{peer}"),
            None => f.write_str("-"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{preview_body, redact_form};

    #[test]
    fn json_preview_redacts_secrets_and_keeps_other_fields() {
        let body = br#"{"email":"user@example.test","password":"hunter2","nested":{"refresh_token":"abc"}}"#;
        let preview = preview_body(body, Some("application/json; charset=utf-8"));
        let value: serde_json::Value = serde_json::from_str(&preview).unwrap();
        assert_eq!(value["email"], "user@example.test");
        assert_eq!(value["password"], "[redacted]");
        assert_eq!(value["nested"]["refresh_token"], "[redacted]");
    }

    #[test]
    fn form_preview_redacts_password_and_request_secret() {
        assert_eq!(
            redact_form("email=user%40example.test&password=hunter2&request=abc"),
            "email=user%40example.test&password=%5Bredacted%5D&request=%5Bredacted%5D"
        );
    }
}
