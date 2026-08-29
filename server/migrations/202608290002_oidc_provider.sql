ALTER TABLE accounts
    DROP INDEX accounts_external_subject_uq,
    DROP CHECK accounts_status_ck,
    CHANGE COLUMN external_subject legacy_external_subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
    ADD COLUMN email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL AFTER id,
    ADD COLUMN normalized_email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL AFTER email,
    ADD COLUMN display_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL AFTER normalized_email,
    ADD COLUMN password_hash VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL AFTER display_name,
    ADD COLUMN email_verified_at DATETIME(6) NULL AFTER password_hash,
    ADD COLUMN failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at,
    ADD COLUMN locked_until DATETIME(6) NULL AFTER failed_login_count,
    ADD COLUMN totp_secret_ciphertext BLOB NULL AFTER locked_until,
    ADD COLUMN totp_secret_nonce BINARY(12) NULL AFTER totp_secret_ciphertext,
    ADD COLUMN totp_key_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL AFTER totp_secret_nonce,
    ADD COLUMN totp_enabled_at DATETIME(6) NULL AFTER totp_key_id,
    ADD COLUMN totp_last_used_step BIGINT UNSIGNED NULL AFTER totp_enabled_at,
    ADD UNIQUE KEY accounts_normalized_email_uq (normalized_email),
    ADD CONSTRAINT accounts_status_ck CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'));

CREATE TABLE oidc_authorizations (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    request_secret_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    code_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    browser_session_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    client_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    redirect_uri VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    scope VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    client_state VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    nonce VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    code_challenge CHAR(43) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    prompt VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'PENDING',
    auth_time DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6),
    PRIMARY KEY (id),
    UNIQUE KEY oidc_authorizations_request_secret_uq (request_secret_hash),
    UNIQUE KEY oidc_authorizations_code_uq (code_hash),
    KEY oidc_authorizations_expiry_idx (expires_at),
    CONSTRAINT oidc_authorizations_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT oidc_authorizations_status_ck CHECK (status IN ('PENDING', 'CODE_ISSUED', 'CONSUMED', 'DENIED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE oidc_browser_sessions (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    token_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    auth_time DATETIME(6) NOT NULL,
    last_seen_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6),
    pending_totp_ciphertext BLOB,
    pending_totp_nonce BINARY(12),
    pending_totp_key_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY oidc_browser_sessions_token_uq (token_hash),
    KEY oidc_browser_sessions_account_idx (account_id, revoked_at, expires_at),
    KEY oidc_browser_sessions_expiry_idx (expires_at),
    CONSTRAINT oidc_browser_sessions_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

ALTER TABLE oidc_authorizations
    ADD CONSTRAINT oidc_authorizations_browser_session_fk FOREIGN KEY (browser_session_id) REFERENCES oidc_browser_sessions (id);

CREATE TABLE oidc_refresh_tokens (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    token_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    family_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    browser_session_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    client_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    scope VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    replaced_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    issued_at DATETIME(6) NOT NULL,
    last_used_at DATETIME(6),
    expires_at DATETIME(6) NOT NULL,
    family_expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY oidc_refresh_tokens_hash_uq (token_hash),
    KEY oidc_refresh_tokens_family_idx (family_id, revoked_at),
    KEY oidc_refresh_tokens_account_idx (account_id, revoked_at),
    KEY oidc_refresh_tokens_expiry_idx (expires_at),
    CONSTRAINT oidc_refresh_tokens_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT oidc_refresh_tokens_browser_session_fk FOREIGN KEY (browser_session_id) REFERENCES oidc_browser_sessions (id),
    CONSTRAINT oidc_refresh_tokens_replacement_fk FOREIGN KEY (replaced_by_id) REFERENCES oidc_refresh_tokens (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE oidc_action_tokens (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    kind VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    token_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY oidc_action_tokens_hash_uq (token_hash),
    KEY oidc_action_tokens_account_idx (account_id, kind, used_at),
    KEY oidc_action_tokens_expiry_idx (expires_at),
    CONSTRAINT oidc_action_tokens_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
    CONSTRAINT oidc_action_tokens_kind_ck CHECK (kind IN ('INVITE', 'RESET'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE oidc_consents (
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    client_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    scope VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    granted_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6),
    PRIMARY KEY (account_id, client_id),
    CONSTRAINT oidc_consents_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE oidc_recovery_codes (
    id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    account_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    code_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    used_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY oidc_recovery_codes_hash_uq (code_hash),
    KEY oidc_recovery_codes_account_idx (account_id, used_at),
    CONSTRAINT oidc_recovery_codes_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
