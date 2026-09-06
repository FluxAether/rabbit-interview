use std::{future::Future, time::Duration};

use bytes::Bytes;
use futures_util::{future::BoxFuture, stream::BoxStream, Sink, SinkExt};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use tokio_util::task::AbortOnDropHandle;

use crate::error::AppError;

pub type SttEventStream = BoxStream<'static, Result<SttEvent, AppError>>;
pub(crate) struct SttEventSender(mpsc::Sender<Result<SttEvent, AppError>>);
pub(crate) const STT_COMMAND_CAPACITY: usize = 16;
pub(crate) const STT_IO_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn timed<T>(phase: &'static str, duration: Duration, work: impl Future<Output = Result<T, AppError>>) -> Result<T, AppError> {
    tokio::time::timeout(duration, work).await.map_err(|_| {
        tracing::warn!(phase, elapsed_ms = duration.as_millis() as u64, "STT operation timed out");
        AppError::ProviderUnavailable
    })?
}

impl SttEventSender {
    pub(crate) async fn send(&self, event: Result<SttEvent, AppError>) -> Result<(), AppError> {
        timed("provider_event", STT_IO_TIMEOUT, async {
            self.0.send(event).await.map_err(|_| AppError::ProviderUnavailable)
        }).await
    }
}

pub(crate) trait SttSocketExt: Sink<Message, Error = WebSocketError> + Unpin + Send {
    fn send_stt(&mut self, message: Message) -> BoxFuture<'_, Result<(), AppError>> {
        Box::pin(timed("provider_write", STT_IO_TIMEOUT, async move {
            self.send(message).await.map_err(map_websocket_error)
        }))
    }

    fn close_stt(&mut self) -> BoxFuture<'_, Result<(), AppError>> {
        Box::pin(timed("provider_close", STT_IO_TIMEOUT, async move {
            self.close().await.map_err(map_websocket_error)
        }))
    }
}

impl<T: Sink<Message, Error = WebSocketError> + Unpin + Send> SttSocketExt for T {}

#[derive(Clone, Debug)]
pub struct SttConnect {
    pub session_id: String,
    pub language: String,
    pub model: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SttEvent {
    pub text: String,
    pub boundary: &'static str,
    pub provider_offset_ms: Option<i64>,
    pub terminal: bool,
}

pub struct SttConnection {
    pub provider_request_id: Option<String>,
    pub sink: Box<dyn SttSink>,
    pub events: SttEventStream,
    pub(crate) worker: AbortOnDropHandle<()>,
}

impl SttConnection {
    pub(crate) fn spawn(provider_request_id: Option<String>, sink: Box<dyn SttSink>, events: SttEventStream, work: impl Future<Output = ()> + Send + 'static) -> Self {
        use tracing::Instrument;
        Self { provider_request_id, sink, events, worker: AbortOnDropHandle::new(tokio::spawn(work.in_current_span())) }
    }
}

pub trait SttAdapter: Send + Sync + 'static {
    fn connect(&self, request: SttConnect) -> BoxFuture<'static, Result<SttConnection, AppError>>;
}

pub trait SttSink: Send + 'static {
    fn send_pcm(&mut self, pcm: Bytes) -> BoxFuture<'static, Result<(), AppError>>;
    fn finish(&mut self) -> BoxFuture<'static, Result<(), AppError>>;
    fn close(&mut self) -> BoxFuture<'static, Result<(), AppError>>;
}

pub(crate) enum SttCommand {
    Audio(Bytes),
    Finish,
    Close,
}

struct ChannelSink {
    sender: mpsc::Sender<SttCommand>,
}

impl SttSink for ChannelSink {
    fn send_pcm(&mut self, pcm: Bytes) -> BoxFuture<'static, Result<(), AppError>> {
        send_command(self.sender.clone(), SttCommand::Audio(pcm))
    }

    fn finish(&mut self) -> BoxFuture<'static, Result<(), AppError>> {
        send_command(self.sender.clone(), SttCommand::Finish)
    }

    fn close(&mut self) -> BoxFuture<'static, Result<(), AppError>> {
        send_command(self.sender.clone(), SttCommand::Close)
    }
}

fn send_command(
    sender: mpsc::Sender<SttCommand>,
    command: SttCommand,
) -> BoxFuture<'static, Result<(), AppError>> {
    Box::pin(async move {
        sender
            .send(command)
            .await
            .map_err(|_| AppError::ProviderUnavailable)
    })
}

pub(crate) fn command_channel() -> (Box<dyn SttSink>, mpsc::Receiver<SttCommand>) {
    let (sender, receiver) = mpsc::channel(STT_COMMAND_CAPACITY);
    (Box::new(ChannelSink { sender }), receiver)
}

pub(crate) fn event_channel() -> (SttEventSender, SttEventStream) {
    let (sender, receiver) = mpsc::channel(32);
    (SttEventSender(sender), Box::pin(ReceiverStream::new(receiver)))
}

pub(crate) fn map_websocket_error(error: WebSocketError) -> AppError {
    match error {
        WebSocketError::Http(response)
            if response.status() == axum::http::StatusCode::TOO_MANY_REQUESTS =>
        {
            AppError::RateLimited
        }
        WebSocketError::Http(response) if response.status().is_client_error() => {
            AppError::ProviderRejected
        }
        WebSocketError::Capacity(_)
        | WebSocketError::Protocol(_)
        | WebSocketError::Utf8(_)
        | WebSocketError::AttackAttempt => AppError::ProviderProtocol,
        _ => AppError::ProviderUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use bytes::Bytes;

    use super::{command_channel, SttCommand, STT_COMMAND_CAPACITY};

    #[tokio::test]
    async fn cancellation_drops_full_queue_worker_and_does_not_enqueue_pending_audio() {
        use futures_util::StreamExt;
        let (mut sink, mut commands) = command_channel();
        for _ in 0..STT_COMMAND_CAPACITY {
            sink.send_pcm(Bytes::from_static(&[0, 0])).await.unwrap();
        }
        let mut pending = sink.send_pcm(Bytes::from_static(&[1, 1]));
        assert!(matches!(futures_util::poll!(&mut pending), std::task::Poll::Pending));
        drop(pending);
        for _ in 0..STT_COMMAND_CAPACITY {
            assert!(matches!(commands.recv().await, Some(SttCommand::Audio(_))));
        }
        assert!(commands.try_recv().is_err());

        let (sender, mut events) = super::event_channel();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (dropped, exited) = tokio::sync::oneshot::channel::<()>();
        let connection = super::SttConnection::spawn(None, sink, Box::pin(futures_util::stream::empty()), async move {
            let _guard = dropped;
            started.send(()).unwrap();
            loop { sender.send(Err(crate::error::AppError::ProviderUnavailable)).await.unwrap(); }
        });
        ready.await.unwrap();
        assert!(events.next().await.is_some());
        drop(connection);
        assert!(tokio::time::timeout(Duration::from_secs(1), exited).await.unwrap().is_err());
    }

    #[tokio::test]
    async fn command_queue_is_bounded_and_fifo() {
        let (mut sink, mut commands) = command_channel();
        for value in 0..STT_COMMAND_CAPACITY {
            sink.send_pcm(Bytes::from(vec![value as u8])).await.unwrap();
        }

        let mut overflow = sink.send_pcm(Bytes::from(vec![STT_COMMAND_CAPACITY as u8]));
        assert!(
            tokio::time::timeout(Duration::from_millis(10), overflow.as_mut())
                .await
                .is_err()
        );

        let mut received = Vec::new();
        let Some(SttCommand::Audio(first)) = commands.recv().await else {
            panic!("expected buffered audio");
        };
        received.push(first[0]);
        tokio::time::timeout(Duration::from_millis(100), overflow.as_mut())
            .await
            .expect("queue did not accept audio after capacity became available")
            .unwrap();
        while received.len() <= STT_COMMAND_CAPACITY {
            let Some(SttCommand::Audio(pcm)) = commands.recv().await else {
                panic!("expected buffered audio");
            };
            received.push(pcm[0]);
        }
        assert_eq!(
            received,
            (0..=STT_COMMAND_CAPACITY as u8).collect::<Vec<_>>()
        );
    }
}
