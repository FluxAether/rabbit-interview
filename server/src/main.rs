use std::{io::ErrorKind, time::Duration};

use oncue_gateway::{
    access::{LoggedListener, PeerAddr},
    config::Config,
    router, AppState,
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_dotenv()?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let config = Config::from_env()?;
    let listen_addr = config.listen_addr;
    let state = AppState::new(config).await?;
    state.start_reaper();
    let app = router(state.clone());
    let listener = LoggedListener::new(tokio::net::TcpListener::bind(listen_addr).await?);
    tracing::info!(%listen_addr, "gateway listening");

    let shutdown = state.shutdown().clone();
    tokio::spawn(async move {
        wait_for_signal().await;
        shutdown.cancel();
    });

    let server_shutdown = state.shutdown().clone();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<PeerAddr>(),
    )
    .with_graceful_shutdown(server_shutdown.cancelled_owned())
    .await?;
    state.tracker().close();
    if tokio::time::timeout(Duration::from_secs(15), state.tracker().wait())
        .await
        .is_err()
    {
        tracing::warn!("timed out waiting for tracked stream tasks");
    }
    Ok(())
}

fn load_dotenv() -> anyhow::Result<()> {
    match dotenvy::dotenv() {
        Ok(_) => Ok(()),
        Err(error) if dotenv_not_found(&error) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn dotenv_not_found(error: &dotenvy::Error) -> bool {
    matches!(error, dotenvy::Error::Io(error) if error.kind() == ErrorKind::NotFound)
}

async fn wait_for_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::dotenv_not_found;
    use std::io::{Error, ErrorKind};

    #[test]
    fn only_missing_dotenv_files_are_optional() {
        assert!(dotenv_not_found(&dotenvy::Error::Io(Error::from(
            ErrorKind::NotFound
        ))));
        assert!(!dotenv_not_found(&dotenvy::Error::Io(Error::from(
            ErrorKind::PermissionDenied
        ))));
    }
}
