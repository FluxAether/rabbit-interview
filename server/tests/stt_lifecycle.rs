mod common;

use std::{io::Read, net::SocketAddr, sync::atomic::Ordering, time::Duration};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use rabbit_gateway::{
    AppState, router,
    entitlement::STT_METRIC,
    protocol::CreateSttSessionResponse,
    providers::{deepgram::DeepgramClient, gemini_live::GeminiLiveClient, volcengine::VolcengineClient,
        stt::{SttAdapter, SttConnect}},
    routing::RouteKind,
};
use serde_json::{json, Value};
use tokio::{net::{TcpListener, TcpStream}, sync::oneshot, time::timeout};
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tokio_util::task::AbortOnDropHandle;
use uuid::Uuid;

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn adapter(kind: &str, url: String) -> Box<dyn SttAdapter> {
    match kind {
        "deepgram" => Box::new(DeepgramClient::new(url, Some("test".into())).unwrap()),
        "gemini_live" => Box::new(GeminiLiveClient::new(url, Some("test".into())).unwrap()),
        "volcengine" => Box::new(VolcengineClient::new(url, Some("test".into()), "test".into()).unwrap()),
        _ => panic!("unknown test provider"),
    }
}

async fn setup(socket: &mut WebSocketStream<TcpStream>, kind: &str) -> anyhow::Result<()> {
    if kind != "deepgram" {
        let first = socket.next().await.unwrap()?;
        if kind == "gemini_live" {
            assert!(serde_json::from_str::<Value>(first.to_text()?)?["setup"].is_object());
            socket.send(Message::text(r#"{"setupComplete":{}}"#)).await?;
        } else {
            assert_eq!(first.into_data()[1], 0x10);
        }
    }
    Ok(())
}

fn transcript(kind: &str, text: &str, final_event: bool) -> Message {
    match kind {
        "deepgram" => Message::text(json!({"type":"Results", "is_final":final_event,
            "from_finalize":final_event, "channel":{"alternatives":[{"transcript":text}]}}).to_string()),
        "gemini_live" => Message::text(json!({"serverContent":{"inputTranscription":{"text":text},
            "turnComplete":final_event}}).to_string()),
        "volcengine" => {
            let payload = json!({"result":{"text":text}}).to_string().into_bytes();
            let mut frame = vec![0x11, if final_event { 0x92 } else { 0x90 }, 0x10, 0];
            frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            frame.extend(payload);
            Message::Binary(frame.into())
        }
        _ => unreachable!(),
    }
}

// None is a keepalive/control message; an empty audio buffer denotes Finish.
fn audio(kind: &str, message: Message) -> anyhow::Result<Option<Vec<u8>>> {
    if message.is_close() { return Ok(None); }
    Ok(match kind {
        "deepgram" if message.is_binary() => Some(message.into_data().to_vec()),
        "deepgram" => {
            let value: Value = serde_json::from_str(message.to_text()?)?;
            (value["type"] == "Finalize").then(Vec::new)
        }
        "gemini_live" => {
            let value: Value = serde_json::from_str(message.to_text()?)?;
            if value["realtimeInput"]["audioStreamEnd"] == true { Some(Vec::new()) }
            else { value.pointer("/realtimeInput/audio/data").and_then(Value::as_str).map(|s| STANDARD.decode(s)).transpose()? }
        }
        "volcengine" if message.is_binary() => {
            let bytes = message.into_data();
            let mut pcm = Vec::new();
            flate2::read::GzDecoder::new(&bytes[8..]).read_to_end(&mut pcm)?;
            Some(pcm)
        }
        _ => None,
    })
}

#[tokio::test]
async fn real_adapters_recover_from_full_duplex_queues_and_preserve_audio_fifo() -> anyhow::Result<()> {
    for kind in ["deepgram", "gemini_live", "volcengine"] {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let url = format!("ws://{}", listener.local_addr()?);
        let (sent, ready) = oneshot::channel();
        let mock = AbortOnDropHandle::new(tokio::spawn(async move {
            let mut socket = accept_async(listener.accept().await?.0).await?;
            setup(&mut socket, kind).await?;
            for index in 0..40 { socket.send(transcript(kind, &format!("event-{index}"), false)).await?; }
            sent.send(()).unwrap();
            let mut received = Vec::new();
            while let Some(message) = socket.next().await {
                if let Some(pcm) = audio(kind, message?)? {
                    if pcm.is_empty() {
                        socket.send(transcript(kind, "tail", true)).await?;
                        break;
                    }
                    received.push(pcm[0]);
                }
            }
            Ok::<_, anyhow::Error>(received)
        }));
        let mut connection = adapter(kind, url).connect(SttConnect {
            session_id: Uuid::new_v4().to_string(), language: "en-US".into(), model: "test".into(),
        }).await?;
        ready.await?;
        // An acknowledged 40-event burst fills the 32-slot queue. Yield until the
        // adapter reaches that await, then observe a genuinely pending audio send.
        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut accepted = 0_u8;
        let mut pending = loop {
            assert!(accepted < 64, "{kind}: command queue did not backpressure");
            let mut send = connection.sink.send_pcm(vec![accepted, 0].into());
            match timeout(Duration::from_millis(20), &mut send).await {
                Err(_) => break send,
                Ok(result) => result?,
            }
            accepted += 1;
        };
        let mut events = Vec::new();
        timeout(Duration::from_secs(2), async {
            let mut sent = false;
            while !sent || events.len() < 40 {
                tokio::select! {
                    result = &mut pending, if !sent => { result?; accepted += 1; sent = true; }
                    event = connection.events.next() => { events.push(event.unwrap()?.text); }
                }
            }
            Ok::<_, anyhow::Error>(())
        }).await??;
        assert_eq!(events, (0..40).map(|i| format!("event-{i}")).collect::<Vec<_>>());
        connection.sink.finish().await?;
        let received = timeout(Duration::from_secs(2), mock).await???;
        assert_eq!(received, (0..accepted).collect::<Vec<_>>(), "{kind}: audio reordered");
        drop(connection);
    }
    Ok(())
}

#[tokio::test]
async fn gemini_cancel_during_resumption_closes_both_sockets() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("ws://{}", listener.local_addr()?);
    let (opened, pending) = oneshot::channel();
    let mock = AbortOnDropHandle::new(tokio::spawn(async move {
        let mut first = accept_async(listener.accept().await?.0).await?;
        setup(&mut first, "gemini_live").await?;
        first.send(Message::text(r#"{"sessionResumptionUpdate":{"resumable":true,"newHandle":"test-resume"}}"#)).await?;
        first.send(Message::text(r#"{"goAway":{"timeLeft":"1s"}}"#)).await?;
        let mut second = accept_async(listener.accept().await?.0).await?;
        let setup = second.next().await.unwrap()?;
        assert_eq!(serde_json::from_str::<Value>(setup.to_text()?)?["setup"]["sessionResumption"]["handle"], "test-resume");
        opened.send(()).unwrap();
        let (a, b) = tokio::join!(first.next(), second.next());
        assert!(a.is_none() || a.unwrap().is_err());
        assert!(b.is_none() || b.unwrap().is_err());
        Ok::<_, anyhow::Error>(())
    }));
    let connection = adapter("gemini_live", url).connect(SttConnect {
        session_id: Uuid::new_v4().to_string(), language: "en-US".into(), model: "test".into(),
    }).await?;
    timeout(Duration::from_secs(2), pending).await??;
    drop(connection);
    timeout(Duration::from_secs(2), mock).await???;
    Ok(())
}

#[tokio::test]
async fn gemini_go_away_without_handle_opens_fresh_session() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("ws://{}", listener.local_addr()?);
    let mock = AbortOnDropHandle::new(tokio::spawn(async move {
        let mut first = accept_async(listener.accept().await?.0).await?;
        setup(&mut first, "gemini_live").await?;
        first.send(Message::text(r#"{"goAway":{"timeLeft":"2s"}}"#)).await?;
        let mut second = accept_async(listener.accept().await?.0).await?;
        let setup_msg = second.next().await.unwrap()?;
        let setup: Value = serde_json::from_str(setup_msg.to_text()?)?;
        assert!(setup["setup"]["sessionResumption"].get("handle").is_none(), "{setup}");
        second.send(Message::text(r#"{"setupComplete":{}}"#)).await?;
        let _ = first.send(Message::Close(None)).await;
        second.send(transcript("gemini_live", "after-rotate", true)).await?;
        Ok::<_, anyhow::Error>(())
    }));
    let mut connection = adapter("gemini_live", url).connect(SttConnect {
        session_id: Uuid::new_v4().to_string(), language: "en-US".into(), model: "test".into(),
    }).await?;
    let event = timeout(Duration::from_secs(2), connection.events.next()).await?.unwrap()?;
    assert_eq!(event.text, "after-rotate");
    drop(connection);
    timeout(Duration::from_secs(2), mock).await???;
    Ok(())
}

#[tokio::test]
async fn gemini_provider_close_reconnects_without_dropping_session() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("ws://{}", listener.local_addr()?);
    let mock = AbortOnDropHandle::new(tokio::spawn(async move {
        let mut first = accept_async(listener.accept().await?.0).await?;
        setup(&mut first, "gemini_live").await?;
        first.send(Message::Close(None)).await?;
        let mut second = accept_async(listener.accept().await?.0).await?;
        setup(&mut second, "gemini_live").await?;
        second.send(transcript("gemini_live", "after-close", true)).await?;
        Ok::<_, anyhow::Error>(())
    }));
    let mut connection = adapter("gemini_live", url).connect(SttConnect {
        session_id: Uuid::new_v4().to_string(), language: "en-US".into(), model: "test".into(),
    }).await?;
    let event = timeout(Duration::from_secs(2), connection.events.next()).await?.unwrap()?;
    assert_eq!(event.text, "after-close");
    drop(connection);
    timeout(Duration::from_secs(2), mock).await???;
    Ok(())
}

struct Gateway {
    state: AppState,
    url: String,
    task: AbortOnDropHandle<std::io::Result<()>>,
    _keys: common::TestConfig,
}

impl Gateway {
    async fn start(mut keys: common::TestConfig, upstream: &str, max_session: Duration) -> anyhow::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let url = format!("http://{}", listener.local_addr()?);
        keys.config.gateway_public_url = url.clone();
        keys.config.hosted_stt_enabled = true;
        keys.config.deepgram_api_key = Some("test".into());
        keys.config.deepgram_stt_models = vec!["test".into()];
        keys.config.deepgram_stt_url = upstream.to_owned();
        keys.config.max_stt_session = max_session;
        let state = keys.state().await?;
        state.routing().switch(RouteKind::Stt, "deepgram", "test", "integration-test").await?;
        let shutdown = state.shutdown().clone();
        let service = router(state.clone()).into_make_service_with_connect_info::<SocketAddr>();
        let task = AbortOnDropHandle::new(tokio::spawn(async move {
            axum::serve(listener, service).with_graceful_shutdown(shutdown.cancelled_owned()).await
        }));
        Ok(Self {state, url, task, _keys:keys})
    }

    async fn account(&self, units: i64) -> anyhow::Result<(String, String)> {
        let id = Uuid::new_v4().to_string();
        let email = format!("{id}@example.test");
        sqlx::query("INSERT INTO accounts (id, email, normalized_email, status, password_hash) VALUES (?, ?, ?, 'ACTIVE', ?)")
            .bind(&id).bind(&email).bind(&email).bind(self.state.auth().hash_password("correct horse battery staple").await?)
            .execute(self.state.auth().pool()).await?;
        self.state.entitlement().grant_adjustment(&id, STT_METRIC, units, "WS regression", None, "integration-test").await?;
        let identity = self.state.auth().identity_by_id(&id).await?;
        let token = self.state.auth().issue_token_pair(&identity, "openid", None, chrono::Utc::now(), None)?.access_token;
        Ok((id, token))
    }

    async fn create(&self, token: &str) -> anyhow::Result<CreateSttSessionResponse> {
        Ok(reqwest::Client::new().post(format!("{}/v1/stt/sessions", self.url))
            .bearer_auth(token).header("Idempotency-Key", Uuid::new_v4().to_string())
            .json(&json!({"client_request_id":Uuid::new_v4().to_string(), "source":"microphone", "language":"en-US",
                "audio":{"encoding":"pcm_s16le","sample_rate":16000,"channels":1}}))
            .send().await?.error_for_status()?.json().await?)
    }

    async fn idle(&self) -> anyhow::Result<()> {
        timeout(Duration::from_secs(12), self.state.tracker().wait()).await?;
        assert_eq!(self.state.metrics().stt_active.load(Ordering::Relaxed), 0);
        assert_eq!(self.state.concurrency().available_permits(), self.state.config().global_concurrency_limit);
        Ok(())
    }

    async fn stop(self) -> anyhow::Result<()> {
        self.state.shutdown().cancel();
        self.state.tracker().close();
        self.idle().await?;
        timeout(Duration::from_secs(3), self.task).await???;
        self.state.auth().pool().close().await;
        Ok(())
    }
}

async fn connect(session: &CreateSttSessionResponse) -> anyhow::Result<Client> {
    Ok(connect_async(format!("{}?ticket={}", session.ws_url, session.ws_ticket)).await?.0)
}

async fn next_json(client: &mut Client) -> anyhow::Result<Value> {
    timeout(Duration::from_secs(12), async {
        while let Some(message) = client.next().await {
            if let Message::Text(text) = message? { return Ok(serde_json::from_str(&text)?); }
        }
        anyhow::bail!("WS ended before notification")
    }).await?
}

async fn usage(state: &AppState, session: &str) -> anyhow::Result<(i64, i64)> {
    Ok(sqlx::query_as("SELECT COUNT(*), CAST(COALESCE(SUM(received_audio_ms), 0) AS SIGNED) FROM usage_events WHERE session_id = ? AND event_key = 'final'")
        .bind(session).fetch_one(state.auth().pool()).await?)
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn gateway_upgrade_audio_stop_validation_and_admission_cleanup() -> anyhow::Result<()> {
    let upstream = TcpListener::bind("127.0.0.1:0").await?;
    let upstream_url = format!("ws://{}", upstream.local_addr()?);
    let mock = AbortOnDropHandle::new(tokio::spawn(async move {
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                socket = upstream.accept() => {
                    let (socket, _) = socket?;
                    tasks.spawn(async move {
                        let mut socket = accept_async(socket).await?;
                        while let Some(message) = socket.next().await {
                            let message = message?;
                            if message.is_close() { break; }
                            if let Some(pcm) = audio("deepgram", message)? {
                                socket.send(transcript("deepgram", if pcm.is_empty() {"tail"} else {"audio"}, pcm.is_empty())).await?;
                            }
                        }
                        Ok::<_, anyhow::Error>(())
                    });
                }
                _ = tasks.join_next(), if !tasks.is_empty() => {}
            }
        }
        #[allow(unreachable_code)]
        Ok::<_, anyhow::Error>(())
    }));
    let gateway = Gateway::start(common::TestConfig::new()?, &upstream_url, Duration::from_secs(30)).await?;
    let (account, token) = gateway.account(600_000).await?;
    assert!(gateway.create("invalid-access-token").await.is_err());
    for (frames, size, reason, charged) in [(2, 640, "user_stop", 40), (1, 1, "invalid_audio_format", 0), (101, 2, "user_stop", 6)] {
        let session = gateway.create(&token).await?;
        let mut client = connect(&session).await?;
        assert_eq!(next_json(&mut client).await?["type"], "stt.ready");
        assert!(connect(&session).await.is_err(), "ticket replay succeeded");
        for _ in 0..frames { client.send(Message::Binary(vec![0;size].into())).await?; }
        client.send(Message::text(r#"{"type":"stt.stop"}"#)).await?;
        let mut seq = 1;
        loop {
            let event = next_json(&mut client).await?;
            seq += 1;
            assert_eq!(event["seq"], seq);
            if event["type"] == "session.ended" {
                assert_eq!(event["reason"], reason);
                assert_eq!(event["accepted_audio_ms"], charged);
                break;
            }
            assert_eq!(event["type"], "transcript");
        }
        drop(client);
        gateway.state.tracker().close();
        gateway.idle().await?;
        assert_eq!(usage(&gateway.state, &session.session_id).await?, (1, charged));
    }
    let before = gateway.state.entitlement().balances(&account).await?[STT_METRIC];
    let permits = gateway.state.concurrency().clone().acquire_many_owned(100).await?;
    let rejected = gateway.create(&token).await?;
    let mut client = connect(&rejected).await?;
    let _ = timeout(Duration::from_secs(8), client.next()).await?;
    drop(client);
    drop(permits);
    gateway.idle().await?;
    assert_eq!(gateway.state.entitlement().balances(&account).await?[STT_METRIC], before);
    assert_eq!(usage(&gateway.state, &rejected.session_id).await?.0, 0);
    gateway.stop().await?;
    drop(mock);
    Ok(())
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn stalled_handshake_deadline_and_shutdown_release_unused_reservations() -> anyhow::Result<()> {
    for shutdown in [false, true] {
        let upstream = TcpListener::bind("127.0.0.1:0").await?;
        let url = format!("ws://{}", upstream.local_addr()?);
        let (opened, ready) = oneshot::channel();
        let mock = AbortOnDropHandle::new(tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let (mut socket, _) = upstream.accept().await?;
            opened.send(()).unwrap();
            let mut bytes = Vec::new();
            socket.read_to_end(&mut bytes).await?;
            Ok::<_, anyhow::Error>(())
        }));
        let gateway = Gateway::start(common::TestConfig::new()?, &url, Duration::from_millis(300)).await?;
        let (account, token) = gateway.account(120_000).await?;
        let session = gateway.create(&token).await?;
        let mut client = connect(&session).await?;
        ready.await?;
        if shutdown { gateway.state.shutdown().cancel(); }
        let _ = timeout(Duration::from_secs(7), client.next()).await?;
        drop(client);
        timeout(Duration::from_secs(2), mock).await???;
        gateway.state.tracker().close();
        gateway.idle().await?;
        assert_eq!(gateway.state.entitlement().balances(&account).await?[STT_METRIC], 120_000);
        assert_eq!(usage(&gateway.state, &session.session_id).await?.0, 0);
        gateway.stop().await?;
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires isolated TEST_DATABASE_URL; load durations are opt-in environment variables"]
async fn mixed_load_http_stt_llm_and_passwords() -> anyhow::Result<()> {
    use std::{sync::Arc, time::Instant};
    use rabbit_gateway::entitlement::LLM_METRIC;
    let seconds: u64 = std::env::var("GATEWAY_LOAD_SECONDS").unwrap_or_else(|_| "2".into()).parse()?;
    let levels: Vec<usize> = std::env::var("GATEWAY_LOAD_CONNECTIONS").unwrap_or_else(|_| "2".into())
        .split(',').map(str::parse).collect::<Result<_, _>>()?;
    let soak: u64 = std::env::var("GATEWAY_LOAD_SOAK_SECONDS").unwrap_or_else(|_| seconds.to_string()).parse()?;
    assert!(seconds <= 1800 && soak <= 3600 && levels.iter().all(|n| *n > 0 && *n <= 80));
    let upstream = TcpListener::bind("127.0.0.1:0").await?;
    let upstream_url = format!("ws://{}", upstream.local_addr()?);
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let live = active.clone();
    let mock = AbortOnDropHandle::new(tokio::spawn(async move {
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                socket = upstream.accept() => {
                    let socket = socket?.0;
                    let live = live.clone();
                    tasks.spawn(async move {
                        struct Guard(Arc<std::sync::atomic::AtomicUsize>);
                        impl Drop for Guard { fn drop(&mut self) { self.0.fetch_sub(1, Ordering::Relaxed); } }
                        live.fetch_add(1, Ordering::Relaxed);
                        let _guard = Guard(live);
                        let mut socket = accept_async(socket).await?;
                        let mut count = 0;
                        while let Some(message) = socket.next().await {
                            let message = message?;
                            if message.is_close() { break; }
                            if let Some(pcm) = audio("deepgram", message)? {
                                count += 1;
                                if pcm.is_empty() {
                                    socket.send(transcript("deepgram", "tail", true)).await?;
                                } else if count % 50 == 0 {
                                    let timestamp = u64::from_le_bytes(pcm[..8].try_into()?);
                                    socket.send(transcript("deepgram", &timestamp.to_string(), false)).await?;
                                }
                            }
                        }
                        Ok::<_, anyhow::Error>(())
                    });
                }
                _ = tasks.join_next(), if !tasks.is_empty() => {}
            }
        }
        #[allow(unreachable_code)]
        Ok::<_, anyhow::Error>(())
    }));
    let llm_listener = TcpListener::bind("127.0.0.1:0").await?;
    let llm_url = format!("http://{}", llm_listener.local_addr()?);
    let llm_app = axum::Router::new().route("/", axum::routing::post(|| async {
        let stream = futures_util::stream::unfold(0_u8, |index| async move {
            if index > 16 { return None; }
            if index > 0 { tokio::time::sleep(Duration::from_millis(500)).await; }
            let value = match index {
                0 => json!({"type":"response.created","response":{"id":"mock-response"}}),
                16 => json!({"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":15,"total_tokens":25}}}),
                _ => json!({"type":"response.output_text.delta","delta":"test "}),
            };
            Some((Ok::<_, std::convert::Infallible>(axum::response::sse::Event::default().data(value.to_string())), index + 1))
        });
        axum::response::Sse::new(stream)
    }));
    let llm_mock = AbortOnDropHandle::new(tokio::spawn(async move { axum::serve(llm_listener, llm_app).await }));
    let mut keys = common::TestConfig::new()?;
    keys.config.hosted_llm_enabled = true;
    keys.config.openai_api_key = Some("test".into());
    keys.config.openai_llm_url = llm_url;
    keys.config.openai_llm_models = vec!["test".into()];
    let gateway = Gateway::start(keys, &upstream_url, Duration::from_secs(3700)).await?;
    gateway.state.routing().switch(RouteKind::Llm, "openai", "test", "integration-test").await?;
    gateway.state.start_reaper();
    let (account, _) = gateway.account(1_000_000_000).await?;
    gateway.state.entitlement().grant_adjustment(&account, LLM_METRIC, 100_000_000, "load fixture", None, "integration-test").await?;
    let identity = Arc::new(gateway.state.auth().identity_by_id(&account).await?);
    let http = reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build()?;
    let mut baseline = Vec::new();
    for _ in 0..100 {
        let start = Instant::now();
        http.get(format!("{}/healthz", gateway.url)).send().await?.error_for_status()?;
        baseline.push(start.elapsed().as_micros() as u64);
    }
    baseline.sort_unstable();
    println!("load baseline: http_p99_us={} pid={} runtime_workers=2", baseline[99], std::process::id());
    for (tier, &connections) in levels.iter().enumerate() {
        let duration = Duration::from_secs(if tier + 1 == levels.len() { soak } else { seconds });
        let token = gateway.state.auth().issue_token_pair(&identity, "openid", None, chrono::Utc::now(), None)?.access_token;
        let start = Instant::now();
        let mut clients = Vec::new();
        for _ in 0..connections {
            let session = gateway.create(&token).await?;
            let mut client = connect(&session).await?;
            assert_eq!(next_json(&mut client).await?["type"], "stt.ready");
            clients.push((session, client));
        }
        let until = tokio::time::Instant::now() + duration;
        let mut ws_tasks = tokio::task::JoinSet::new();
        for (session, mut client) in clients {
            ws_tasks.spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_millis(20));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                let mut frames = 0_i64;
                let mut latency = Vec::new();
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep_until(until) => break,
                        _ = ticker.tick() => {
                            let mut pcm = vec![0; 640];
                            pcm[..8].copy_from_slice(&(start.elapsed().as_micros() as u64).to_le_bytes());
                            client.send(Message::Binary(pcm.into())).await?;
                            frames += 1;
                        }
                        message = client.next() => {
                            let message = message.ok_or_else(|| anyhow::anyhow!("early WS close"))??;
                            if let Message::Text(text) = message {
                                let event: Value = serde_json::from_str(&text)?;
                                assert_eq!(event["type"], "transcript", "unexpected session termination during load");
                                let sent: u64 = event["text"].as_str().unwrap().parse()?;
                                latency.push((start.elapsed().as_micros() as u64).saturating_sub(sent));
                            }
                        }
                    }
                }
                client.send(Message::text(r#"{"type":"stt.stop"}"#)).await?;
                loop {
                    let event = next_json(&mut client).await?;
                    if event["type"] == "session.ended" {
                        assert_eq!(event["reason"], "user_stop");
                        assert_eq!(event["accepted_audio_ms"], frames * 20);
                        break;
                    }
                }
                Ok::<_, anyhow::Error>((session.session_id, frames * 20, latency))
            });
        }
        let mut llm_tasks = tokio::task::JoinSet::new();
        for _ in 0..10 {
            let (state, identity, http, url) = (gateway.state.clone(), identity.clone(), http.clone(), gateway.url.clone());
            llm_tasks.spawn(async move {
                let mut count = 0;
                while tokio::time::Instant::now() < until {
                    let token = state.auth().issue_token_pair(&identity, "openid", None, chrono::Utc::now(), None)?.access_token;
                    let id = Uuid::new_v4().to_string();
                    let text = http.post(format!("{url}/v1/llm/answers")).bearer_auth(token).header("Idempotency-Key", &id)
                        .json(&json!({"request_id":id,"request_type":"interviewer-question","question":"test","max_output_tokens":128}))
                        .send().await?.error_for_status()?.text().await?;
                    assert!(text.contains("answer.completed") && !text.contains("answer.error"), "LLM load failed");
                    assert!(state.cancellation(&id).await.is_none());
                    count += 1;
                }
                Ok::<_, anyhow::Error>(count)
            });
        }
        let mut http_latency = Vec::new();
        let mut password_statuses = std::collections::BTreeMap::<u16, usize>::new();
        let mut probe = tokio::time::interval(Duration::from_millis(50));
        probe.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut password_tick = tokio::time::interval(Duration::from_secs(65));
        let mut password_tasks = tokio::task::JoinSet::new();
        while tokio::time::Instant::now() < until {
            tokio::select! {
                _ = probe.tick() => {
                    let started = Instant::now();
                    let path = if http_latency.len() % 2 == 0 { "healthz" } else { "readyz" };
                    http.get(format!("{}/{path}", gateway.url)).send().await?.error_for_status()?;
                    http_latency.push(started.elapsed().as_micros() as u64);
                }
                _ = password_tick.tick() => {
                    let response = http.get(format!("{}/oauth2/authorize", gateway.url)).query(&[
                        ("response_type","code"), ("client_id","rabbit-desktop"),
                        ("redirect_uri","rabbitinterview://auth/callback"), ("scope","openid"),
                        ("state","load"), ("code_challenge","E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), ("code_challenge_method","S256"),
                    ]).send().await?;
                    assert_eq!(response.status(), reqwest::StatusCode::SEE_OTHER);
                    let location = url::Url::parse(response.headers()["location"].to_str()?)?;
                    let request = url::form_urlencoded::parse(location.fragment().unwrap().as_bytes()).find(|(k,_)| k == "request").unwrap().1.into_owned();
                    let context: Value = http.post(format!("{}/oauth2/interaction", gateway.url)).form(&[("request",&request)])
                        .send().await?.error_for_status()?.json().await?;
                    for _ in 0..6 {
                        let (http, url, request, csrf) = (http.clone(), gateway.url.clone(), request.clone(), context["csrf"].as_str().unwrap().to_owned());
                        password_tasks.spawn(async move {
                            Ok::<_, anyhow::Error>(http.post(format!("{url}/oauth2/login"))
                                .form(&[("request",request),("csrf",csrf),("email","unknown-load@example.test".into()),("password","load password attempt".into())])
                                .send().await?.status().as_u16())
                        });
                    }
                }
                result = password_tasks.join_next(), if !password_tasks.is_empty() => {
                    let status = result.unwrap()??;
                    assert!(matches!(status, 401 | 429));
                    *password_statuses.entry(status).or_default() += 1;
                }
            }
        }
        while let Some(result) = password_tasks.join_next().await { *password_statuses.entry(result??).or_default() += 1; }
        let mut ws_latency = Vec::new();
        let mut audio_ms = 0;
        while let Some(result) = ws_tasks.join_next().await {
            let (session, accepted, latency) = result??;
            assert_eq!(usage(&gateway.state, &session).await?, (1, accepted));
            audio_ms += accepted;
            ws_latency.extend(latency);
        }
        let mut llm_count = 0;
        while let Some(result) = llm_tasks.join_next().await { llm_count += result??; }
        timeout(Duration::from_secs(12), async {
            while gateway.state.concurrency().available_permits() != 100 || active.load(Ordering::Relaxed) != 0 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await?;
        assert_eq!(gateway.state.metrics().stt_active.load(Ordering::Relaxed), 0);
        assert_eq!(gateway.state.metrics().llm_active.load(Ordering::Relaxed), 0);
        let invalid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quota_reservations WHERE account_id = ? AND state != 'SETTLED'")
            .bind(&account).fetch_one(gateway.state.auth().pool()).await?;
        assert_eq!(invalid, 0, "load reservations were reclaimed or remained active");
        assert!(gateway.state.entitlement().balances(&account).await?.values().all(|n| *n >= 0));
        http_latency.sort_unstable();
        ws_latency.sort_unstable();
        let p99 = http_latency[http_latency.len() * 99 / 100];
        println!("load tier: stt={connections} seconds={} llm_completed={llm_count} audio_ms={audio_ms} http_samples={} http_p50_us={} http_p95_us={} http_p99_us={p99} ws_p99_us={} passwords={password_statuses:?} permits=100 upstream_active=0",
            duration.as_secs(), http_latency.len(), http_latency[http_latency.len()/2], http_latency[http_latency.len()*95/100],
            ws_latency.get(ws_latency.len()*99/100).copied().unwrap_or(0));
        assert!(p99 <= 250_000, "local HTTP p99 exceeded 250 ms");
    }
    gateway.stop().await?;
    drop(llm_mock);
    drop(mock);
    Ok(())
}
