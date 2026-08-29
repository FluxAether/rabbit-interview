FROM rust:1.98-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home rabbit
COPY --from=build /build/target/release/rabbit-gateway /usr/local/bin/rabbit-gateway
ENV RUST_LOG=info,tower_http=info
EXPOSE 8787
USER rabbit
ENTRYPOINT ["rabbit-gateway"]
