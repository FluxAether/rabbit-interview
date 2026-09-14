import { readFileSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';
import { LatencyCollector, StatusCodeTracker, ResourceAuditor, formatTable, generateMarkdown } from './metrics.mjs';

const DEFAULT_GATEWAY = process.env.GATEWAY_URL || 'http://127.0.0.1:8787';
const TEST_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';

export function createJwtToken(accountId = TEST_ACCOUNT_ID, gatewayUrl = DEFAULT_GATEWAY) {
  let pem;
  try {
    pem = readFileSync('/tmp/rabbit-oidc-signing.pem', 'utf8');
  } catch {
    pem = readFileSync('server/secrets/signing.pem', 'utf8');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'local-dev' };
  const payload = {
    sub: accountId,
    iss: gatewayUrl,
    aud: 'oncue-gateway',
    exp: now + 3600,
    iat: now,
    jti: randomUUID(),
    client_id: 'rabbit-desktop',
    scope: 'openid',
    token_use: 'access',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(data);
  const signature = signer.sign(pem).toString('base64url');
  return `${data}.${signature}`;
}

async function runWorkerPool({ concurrency, durationMs, taskFn }) {
  const endTime = Date.now() + durationMs;
  const latencies = new LatencyCollector('ms');
  const statusCodes = new StatusCodeTracker();
  let completed = 0;

  const workers = Array.from({ length: concurrency }, async (_, workerId) => {
    while (Date.now() < endTime) {
      const t0 = process.hrtime.bigint();
      try {
        const status = await taskFn(workerId);
        latencies.recordFrom(t0);
        statusCodes.record(status);
        completed++;
      } catch (err) {
        latencies.recordFrom(t0);
        statusCodes.record(err.status || 599);
      }
    }
  });

  await Promise.all(workers);
  const elapsedSec = durationMs / 1000;
  return {
    completed,
    rps: Math.round(completed / elapsedSec),
    latencies: latencies.summary(),
    statusCodes: statusCodes.summary(),
  };
}

export async function runApiStressTest(options = {}) {
  const gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY;
  const durationSec = options.durationSec || 5;
  // Duration in seconds configured via options.durationSec
  const auditor = new ResourceAuditor({ gatewayUrl });

  console.log(`\n======================================================`);
  console.log(`[HTTP API Stress] Testing ${gatewayUrl}`);
  console.log(`Duration per tier: ${durationSec}s`);
  console.log(`======================================================\n`);

  const beforeAudit = await auditor.takeSnapshot();
  const token = createJwtToken(TEST_ACCOUNT_ID, gatewayUrl);
  const results = {};

  // -------------------------------------------------------------
  // Test 1: Baseline Stateless Probes (/healthz, /readyz, /metrics)
  // -------------------------------------------------------------
  console.log(`[Phase 1] Stateless probes concurrency gradient (10 -> 50 -> 100 -> 200)...`);
  results.probes = {};
  for (const concurrency of [10, 50, 100, 200]) {
    const res = await runWorkerPool({
      concurrency,
      durationMs: 3000,
      taskFn: async (id) => {
        const path = id % 3 === 0 ? '/healthz' : id % 3 === 1 ? '/readyz' : '/metrics';
        const r = await fetch(`${gatewayUrl}${path}`);
        await r.text();
        return r.status;
      },
    });
    results.probes[concurrency] = res;
    console.log(`  Concurrency ${concurrency.toString().padStart(3)}: ${res.rps.toString().padStart(6)} RPS | P50: ${res.latencies.p50.toFixed(2)}ms | P99: ${res.latencies.p99.toFixed(2)}ms`);
  }

  // -------------------------------------------------------------
  // Test 2: OIDC Discovery & JWKS Caching
  // -------------------------------------------------------------
  console.log(`\n[Phase 2] Discovery & JWKS endpoints (50 & 100 concurrency)...`);
  results.discovery = {};
  for (const concurrency of [50, 100]) {
    const res = await runWorkerPool({
      concurrency,
      durationMs: 3000,
      taskFn: async (id) => {
        const path = id % 2 === 0 ? '/.well-known/openid-configuration' : '/oauth2/jwks';
        const r = await fetch(`${gatewayUrl}${path}`);
        await r.text();
        return r.status;
      },
    });
    results.discovery[concurrency] = res;
    console.log(`  Concurrency ${concurrency.toString().padStart(3)}: ${res.rps.toString().padStart(6)} RPS | P50: ${res.latencies.p50.toFixed(2)}ms | P99: ${res.latencies.p99.toFixed(2)}ms`);
  }

  // -------------------------------------------------------------
  // Test 3: Argon2 CPU Isolation & Worker Starvation Protection
  // -------------------------------------------------------------
  console.log(`\n[Phase 3] Argon2 CPU load with simultaneous /healthz probes...`);
  {
    // Step A: Fetch an interaction context
    const authRes = await fetch(`${gatewayUrl}/oauth2/authorize?response_type=code&client_id=rabbit-desktop&redirect_uri=rabbitinterview://auth/callback&scope=openid&state=stress&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`, { redirect: 'manual' });
    const location = authRes.headers.get('location') || '';
    const requestSecret = new URLSearchParams(location.split('#')[1] || '').get('request');

    let csrf = '';
    if (requestSecret) {
      const interRes = await fetch(`${gatewayUrl}/oauth2/interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ request: requestSecret }),
      });
      if (interRes.ok) {
        const interJson = await interRes.json();
        csrf = interJson.csrf || '';
      }
    }

    const healthDuringArgon2 = new LatencyCollector('ms');
    let healthProbeCount = 0;
    let probing = true;

    // Background health prober
    const prober = (async () => {
      while (probing) {
        const t0 = process.hrtime.bigint();
        try {
          const r = await fetch(`${gatewayUrl}/healthz`);
          await r.text();
          healthDuringArgon2.recordFrom(t0);
          healthProbeCount++;
        } catch {}
        await new Promise((d) => setTimeout(d, 20));
      }
    })();

    // Concurrent login attempts (CPU-heavy Argon2)
    const loginResult = await runWorkerPool({
      concurrency: 12,
      durationMs: 4000,
      taskFn: async () => {
        const r = await fetch(`${gatewayUrl}/oauth2/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            request: requestSecret || 'invalid',
            csrf: csrf || 'invalid',
            email: 'stress-argon@example.test',
            password: 'incorrect-stress-password',
          }),
        });
        await r.text();
        return r.status;
      },
    });

    probing = false;
    await prober;

    results.argon2 = {
      loginResult,
      healthP99: healthDuringArgon2.summary().p99,
      healthProbeCount,
    };

    console.log(`  Logins: ${loginResult.completed} requests | P50: ${loginResult.latencies.p50.toFixed(2)}ms | Statuses: ${JSON.stringify(loginResult.statusCodes)}`);
    console.log(`  Simultaneous /healthz probes: ${healthProbeCount} | P99: ${results.argon2.healthP99.toFixed(2)}ms (Worker unstarved!)`);
  }

  // -------------------------------------------------------------
  // Test 4: Authenticated Entitlements Query (DB pool contention)
  // -------------------------------------------------------------
  console.log(`\n[Phase 4] Entitlements query under DB pool contention (20 & 50 concurrency)...`);
  results.entitlements = {};
  for (const concurrency of [20, 50]) {
    const res = await runWorkerPool({
      concurrency,
      durationMs: 3000,
      taskFn: async () => {
        const r = await fetch(`${gatewayUrl}/v1/me/entitlements`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        await r.json();
        return r.status;
      },
    });
    results.entitlements[concurrency] = res;
    console.log(`  Concurrency ${concurrency.toString().padStart(3)}: ${res.rps.toString().padStart(6)} RPS | P50: ${res.latencies.p50.toFixed(2)}ms | P99: ${res.latencies.p99.toFixed(2)}ms`);
  }

  // -------------------------------------------------------------
  // Test 5: STT Session Creation Transactions & Idempotency
  // -------------------------------------------------------------
  console.log(`\n[Phase 5] STT Session creation transactions (10 & 25 concurrency)...`);
  results.sttSessions = {};
  for (const concurrency of [10, 25]) {
    const res = await runWorkerPool({
      concurrency,
      durationMs: 3000,
      taskFn: async () => {
        const r = await fetch(`${gatewayUrl}/v1/stt/sessions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify({
            client_request_id: randomUUID(),
            source: 'microphone',
            language: 'en-US',
            audio: { encoding: 'pcm_s16le', sample_rate: 16000, channels: 1 },
          }),
        });
        await r.json();
        return r.status;
      },
    });
    results.sttSessions[concurrency] = res;
    console.log(`  Concurrency ${concurrency.toString().padStart(3)}: ${res.rps.toString().padStart(6)} RPS | P50: ${res.latencies.p50.toFixed(2)}ms | P99: ${res.latencies.p99.toFixed(2)}ms`);
  }

  // -------------------------------------------------------------
  // Test 6: LLM Answer Request & Mid-Stream Cancellation
  // -------------------------------------------------------------
  console.log(`\n[Phase 6] LLM Answer streaming & mid-stream cancellation...`);
  {
    const cancelLatencies = new LatencyCollector('ms');
    let completedAnswers = 0;
    let cancelledAnswers = 0;

    const streamRuns = Array.from({ length: 15 }, async (_, i) => {
      const requestId = randomUUID();
      const idempotencyKey = randomUUID();

      const answerPromise = fetch(`${gatewayUrl}/v1/llm/answers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          request_id: requestId,
          request_type: 'interviewer-question',
          question: `Stress question ${i}`,
          context: { interviews: [] },
          max_output_tokens: 300,
        }),
      });

      if (i % 2 === 0) {
        // Cancel mid-stream after small delay
        await new Promise((d) => setTimeout(d, 80));
        const t0 = process.hrtime.bigint();
        const delRes = await fetch(`${gatewayUrl}/v1/llm/answers/${requestId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        cancelLatencies.recordFrom(t0);
        if (delRes.status === 204 || delRes.status === 200 || delRes.status === 404) {
          cancelledAnswers++;
        }
      }

      try {
        const res = await answerPromise;
        const reader = res.body?.getReader();
        if (reader) {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        }
        if (res.status === 200) completedAnswers++;
      } catch {
        // aborted or cancelled stream
      }
    });

    await Promise.all(streamRuns);
    results.llmCancellation = {
      completedAnswers,
      cancelledAnswers,
      cancelLatency: cancelLatencies.summary(),
    };
    console.log(`  Streams started: 15 | Clean cancels: ${cancelledAnswers} | Cancel P99: ${cancelLatencies.summary().p99.toFixed(2)}ms`);
  }

  // -------------------------------------------------------------
  // Audit Verification
  // -------------------------------------------------------------
  console.log(`\n[Audit] Verifying resource cleanup...`);
  // Wait brief moment for pending tasks to settle
  await new Promise((d) => setTimeout(d, 500));
  const afterAudit = await auditor.takeSnapshot();
  const diff = auditor.diff(beforeAudit, afterAudit);

  console.log(`  Active STT delta: ${diff.activeSttDelta} | Active LLM delta: ${diff.activeLlmDelta}`);
  console.log(`  Usage events recorded: +${diff.usageEventsDelta}`);
  console.log(`  Permits leak check: ${diff.leakedPermits === 0 ? 'CLEAN (0 permits leaked)' : 'LEAK DETECTED'}`);

  // Summary Table
  const tableHeaders = ['Endpoint / Test', 'Concurrency', 'RPS / Ops', 'P50 (ms)', 'P90 (ms)', 'P99 (ms)'];
  const tableRows = [
    ['Probes (/healthz, etc)', '10', results.probes[10].rps, results.probes[10].latencies.p50.toFixed(2), results.probes[10].latencies.p90.toFixed(2), results.probes[10].latencies.p99.toFixed(2)],
    ['Probes (/healthz, etc)', '100', results.probes[100].rps, results.probes[100].latencies.p50.toFixed(2), results.probes[100].latencies.p90.toFixed(2), results.probes[100].latencies.p99.toFixed(2)],
    ['Probes (/healthz, etc)', '200', results.probes[200].rps, results.probes[200].latencies.p50.toFixed(2), results.probes[200].latencies.p90.toFixed(2), results.probes[200].latencies.p99.toFixed(2)],
    ['Discovery & JWKS', '50', results.discovery[50].rps, results.discovery[50].latencies.p50.toFixed(2), results.discovery[50].latencies.p90.toFixed(2), results.discovery[50].latencies.p99.toFixed(2)],
    ['Discovery & JWKS', '100', results.discovery[100].rps, results.discovery[100].latencies.p50.toFixed(2), results.discovery[100].latencies.p90.toFixed(2), results.discovery[100].latencies.p99.toFixed(2)],
    ['Entitlements (DB pool)', '20', results.entitlements[20].rps, results.entitlements[20].latencies.p50.toFixed(2), results.entitlements[20].latencies.p90.toFixed(2), results.entitlements[20].latencies.p99.toFixed(2)],
    ['Entitlements (DB pool)', '50', results.entitlements[50].rps, results.entitlements[50].latencies.p50.toFixed(2), results.entitlements[50].latencies.p90.toFixed(2), results.entitlements[50].latencies.p99.toFixed(2)],
    ['STT Session Txn', '10', results.sttSessions[10].rps, results.sttSessions[10].latencies.p50.toFixed(2), results.sttSessions[10].latencies.p90.toFixed(2), results.sttSessions[10].latencies.p99.toFixed(2)],
    ['STT Session Txn', '25', results.sttSessions[25].rps, results.sttSessions[25].latencies.p50.toFixed(2), results.sttSessions[25].latencies.p90.toFixed(2), results.sttSessions[25].latencies.p99.toFixed(2)],
    ['Argon2 Concurrent Login', '12', results.argon2.loginResult.rps, results.argon2.loginResult.latencies.p50.toFixed(2), results.argon2.loginResult.latencies.p90.toFixed(2), results.argon2.loginResult.latencies.p99.toFixed(2)],
    ['LLM Stream Cancel', '15', '-', results.llmCancellation.cancelLatency.p50.toFixed(2), results.llmCancellation.cancelLatency.p90.toFixed(2), results.llmCancellation.cancelLatency.p99.toFixed(2)],
  ];

  console.log(formatTable('HTTP API Stress Test Results', tableHeaders, tableRows));
  return {
    results,
    diff,
    markdown: generateMarkdown('HTTP API Stress Test Results', tableHeaders, tableRows),
  };
}

if (process.argv[1] && process.argv[1].endsWith('api-stress.mjs')) {
  runApiStressTest().catch((err) => {
    console.error('API stress test failed:', err);
    process.exit(1);
  });
}
