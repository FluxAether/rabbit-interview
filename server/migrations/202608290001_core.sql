CREATE TABLE accounts (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    external_subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY accounts_external_subject_uq (external_subject),
    CONSTRAINT accounts_status_ck CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE quota_buckets (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    metric VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    source_type VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    source_ref VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    granted_units BIGINT NOT NULL,
    remaining_units BIGINT NOT NULL,
    valid_from DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    valid_until DATETIME(6),
    priority SMALLINT NOT NULL DEFAULT 100,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY quota_buckets_grant_uq (account_id, metric, source_type, source_ref),
    KEY quota_buckets_wallet_idx (account_id, metric, valid_until, priority, id),
    CONSTRAINT quota_buckets_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT quota_buckets_metric_ck CHECK (metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS')),
    CONSTRAINT quota_buckets_source_type_ck CHECK (source_type IN ('FREE_TRIAL', 'SUBSCRIPTION', 'ADDON', 'ADJUSTMENT')),
    CONSTRAINT quota_buckets_granted_ck CHECK (granted_units > 0),
    CONSTRAINT quota_buckets_remaining_ck CHECK (remaining_units >= 0 AND remaining_units <= granted_units),
    CONSTRAINT quota_buckets_validity_ck CHECK (valid_until IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE ai_sessions (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    client_request_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    interview_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    kind VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    audio_source VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    provider VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    model VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    state VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    provider_request_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    terminate_reason VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    pricing_policy_version VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    lease_expires_at DATETIME(6),
    started_at DATETIME(6),
    ended_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY ai_sessions_client_request_uq (account_id, client_request_id),
    KEY ai_sessions_lease_idx (state, lease_expires_at),
    KEY ai_sessions_provider_request_idx (provider, provider_request_id),
    CONSTRAINT ai_sessions_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT ai_sessions_kind_ck CHECK (kind IN ('STT', 'LLM')),
    CONSTRAINT ai_sessions_audio_source_ck CHECK (audio_source IS NULL OR audio_source IN ('SYSTEM', 'MICROPHONE')),
    CONSTRAINT ai_sessions_state_ck CHECK (state IN ('RESERVED', 'CONNECTING', 'ACTIVE', 'ENDING', 'ENDED', 'FAILED', 'ABANDONED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE quota_reservations (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    session_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    metric VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    held_units BIGINT NOT NULL,
    settled_units BIGINT NOT NULL DEFAULT 0,
    state VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'ACTIVE',
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY quota_reservations_session_metric_uq (session_id, metric),
    KEY quota_reservations_reaper_idx (state, expires_at),
    CONSTRAINT quota_reservations_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT quota_reservations_session_fk FOREIGN KEY (session_id) REFERENCES ai_sessions (id),
    CONSTRAINT quota_reservations_metric_ck CHECK (metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS')),
    CONSTRAINT quota_reservations_held_ck CHECK (held_units > 0),
    CONSTRAINT quota_reservations_settled_ck CHECK (settled_units >= 0 AND settled_units <= held_units),
    CONSTRAINT quota_reservations_state_ck CHECK (state IN ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE quota_reservation_allocations (
    reservation_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    bucket_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    allocation_order SMALLINT UNSIGNED NOT NULL,
    reserved_units BIGINT NOT NULL,
    consumed_units BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (reservation_id, bucket_id),
    UNIQUE KEY quota_reservation_allocations_order_uq (reservation_id, allocation_order),
    CONSTRAINT quota_reservation_allocations_reservation_fk FOREIGN KEY (reservation_id) REFERENCES quota_reservations (id),
    CONSTRAINT quota_reservation_allocations_bucket_fk FOREIGN KEY (bucket_id) REFERENCES quota_buckets (id),
    CONSTRAINT quota_reservation_allocations_reserved_ck CHECK (reserved_units > 0),
    CONSTRAINT quota_reservation_allocations_consumed_ck CHECK (consumed_units >= 0 AND consumed_units <= reserved_units)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE idempotency_records (
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    idempotency_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    operation VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    request_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    response_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at DATETIME(6) NOT NULL,
    PRIMARY KEY (account_id, idempotency_key),
    KEY idempotency_records_expiry_idx (expires_at),
    CONSTRAINT idempotency_records_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE usage_events (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    session_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    event_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    usage_status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    received_audio_ms BIGINT NOT NULL DEFAULT 0,
    forwarded_audio_ms BIGINT NOT NULL DEFAULT 0,
    provider_audio_ms BIGINT,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_hit_tokens BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens BIGINT NOT NULL DEFAULT 0,
    charged_metric VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    charged_units BIGINT NOT NULL,
    pricing_policy_version VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    provider_cost_micros BIGINT,
    currency CHAR(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    occurred_at DATETIME(6) NOT NULL,
    retention_until DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY usage_events_session_event_uq (session_id, event_key),
    KEY usage_events_account_time_idx (account_id, occurred_at),
    KEY usage_events_retention_idx (retention_until),
    CONSTRAINT usage_events_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT usage_events_session_fk FOREIGN KEY (session_id) REFERENCES ai_sessions (id),
    CONSTRAINT usage_events_status_ck CHECK (usage_status IN ('FINAL', 'ESTIMATED', 'RECONCILED', 'DISPUTED')),
    CONSTRAINT usage_events_nonnegative_ck CHECK (
        received_audio_ms >= 0 AND forwarded_audio_ms >= 0
        AND (provider_audio_ms IS NULL OR provider_audio_ms >= 0)
        AND input_tokens >= 0 AND output_tokens >= 0 AND cache_hit_tokens >= 0
        AND reasoning_tokens >= 0 AND charged_units >= 0
        AND (provider_cost_micros IS NULL OR provider_cost_micros >= 0)
    ),
    CONSTRAINT usage_events_metric_ck CHECK (charged_metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE security_events (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    event_type VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    metadata JSON NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY security_events_expiry_idx (expires_at),
    CONSTRAINT security_events_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
