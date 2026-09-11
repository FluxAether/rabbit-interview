-- Stop gateway traffic and settle/release legacy holds before upgrading.
CREATE TEMPORARY TABLE credit_migration_guard (
    active_count BIGINT NOT NULL CHECK (active_count = 0)
);
INSERT INTO credit_migration_guard
SELECT COUNT(*) FROM quota_reservations WHERE state = 'ACTIVE';
DROP TEMPORARY TABLE credit_migration_guard;

ALTER TABLE accounts ADD COLUMN byok_unlocked_at DATETIME(6) NULL;
ALTER TABLE quota_buckets DROP CHECK quota_buckets_metric_ck,
    ADD CONSTRAINT quota_buckets_metric_ck CHECK (metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS', 'CREDITS'));
ALTER TABLE quota_reservations DROP CHECK quota_reservations_metric_ck,
    ADD CONSTRAINT quota_reservations_metric_ck CHECK (metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS', 'CREDITS'));
ALTER TABLE usage_events DROP CHECK usage_events_metric_ck,
    ADD CONSTRAINT usage_events_metric_ck CHECK (charged_metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS', 'CREDITS'));

ALTER TABLE payment_orders
    ADD COLUMN product_kind VARCHAR(16) NOT NULL DEFAULT 'CREDITS',
    ADD COLUMN credit_units BIGINT NOT NULL DEFAULT 0,
    DROP CHECK payment_orders_duration_ck,
    DROP CHECK payment_orders_quota_ck,
    MODIFY duration_days SMALLINT NULL DEFAULT NULL,
    MODIFY stt_units BIGINT NOT NULL DEFAULT 0,
    MODIFY llm_units BIGINT NOT NULL DEFAULT 0;
UPDATE payment_orders SET credit_units = stt_units + llm_units * 60;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_grant_ck CHECK (
    (product_kind = 'CREDITS' AND credit_units > 0) OR
    (product_kind = 'BYOK' AND credit_units = 0)
);
