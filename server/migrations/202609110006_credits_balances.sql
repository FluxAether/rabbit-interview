-- 60,000 integer units = 1 credit = 60,000 ms of STT = 1,000 LLM tokens.
-- Legacy buckets remain as audit records. Each new bucket has a unique source.
START TRANSACTION;
INSERT INTO quota_buckets
    (id, account_id, metric, source_type, source_ref, granted_units, remaining_units, valid_from, valid_until, priority)
SELECT UUID(), old.account_id, 'CREDITS', old.source_type, CONCAT('legacy:', old.id),
    old.remaining_units * IF(old.metric = 'LLM_TOKEN_UNITS', 60, 1),
    old.remaining_units * IF(old.metric = 'LLM_TOKEN_UNITS', 60, 1),
    IF(old.source_type = 'SUBSCRIPTION', UTC_TIMESTAMP(6), old.valid_from),
    IF(old.source_type = 'SUBSCRIPTION', NULL, old.valid_until), old.priority
FROM quota_buckets old
WHERE old.metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS') AND old.remaining_units > 0
    AND (old.valid_until IS NULL OR old.valid_until > UTC_TIMESTAMP(6))
    AND NOT EXISTS (SELECT 1 FROM quota_buckets converted
        WHERE converted.account_id = old.account_id AND converted.metric = 'CREDITS'
            AND converted.source_type = old.source_type AND converted.source_ref = CONCAT('legacy:', old.id));
UPDATE quota_buckets old JOIN quota_buckets converted
    ON converted.account_id = old.account_id AND converted.metric = 'CREDITS'
    AND converted.source_type = old.source_type AND converted.source_ref = CONCAT('legacy:', old.id)
SET old.remaining_units = 0
WHERE old.metric IN ('STT_AUDIO_MS', 'LLM_TOKEN_UNITS');
COMMIT;
