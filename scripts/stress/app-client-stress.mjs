import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LatencyCollector, ResourceAuditor, formatTable, generateMarkdown } from './metrics.mjs';
import { createJwtToken } from './api-stress.mjs';
import { startMockUpstream } from './mock-upstream.mjs';

const DEFAULT_TARGET = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 'mock';
const DEFAULT_CLIENTS = parseInt(process.argv.find((a) => a.startsWith('--clients='))?.split('=')[1] || '10', 10);
const DEFAULT_DURATION = parseInt(process.argv.find((a) => a.startsWith('--duration='))?.split('=')[1] || '5', 10);

function getAccountToken(index, gatewayUrl) {
  const accountNum = (index % 50) + 1;
  const accountId = `00000000-0000-0000-0000-${String(accountNum).padStart(12, '0')}`;
  return {
    accountId,
    token: createJwtToken(accountId, gatewayUrl),
  };
}

async function simulateVirtualClient({ id, gatewayUrl, durationSec, latencies, metrics }) {
  const { accountId, token } = getAccountToken(id, gatewayUrl);

  // 1. Check entitlements before
  const entRes1 = await fetch(`${gatewayUrl}/v1/me/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!entRes1.ok) throw new Error(`Entitlements failed: ${entRes1.status}`);
  const entData1 = await entRes1.json();
  const initialCredits = entData1.balances.CREDITS || 0;

  // 2. Create STT session
  const t0Session = process.hrtime.bigint();
  const sessionRes = await fetch(`${gatewayUrl}/v1/stt/sessions`, {
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
  if (!sessionRes.ok) throw new Error(`Session create failed: ${sessionRes.status}`);
  const session = await sessionRes.json();
  latencies.sessionCreate.recordFrom(t0Session);

  // 3. Connect WebSocket & wait for stt.ready
  const t0Ws = process.hrtime.bigint();
  const ws = new WebSocket(`${session.ws_url}?ticket=${session.ws_ticket}`);

  let ready = false;
  let firstTranscript = false;
  let transcriptsCount = 0;
  let sessionEnded = null;

  const wsReadyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS connect timeout for client ${id}`)), 10000);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stt.ready' && !ready) {
          ready = true;
          clearTimeout(timer);
          latencies.wsHandshake.recordFrom(t0Ws);
          resolve();
        } else if (msg.type === 'transcript') {
          transcriptsCount++;
          if (!firstTranscript) {
            firstTranscript = true;
            latencies.firstTranscript.recordFrom(t0Ws);
          }
        } else if (msg.type === 'session.ended') {
          sessionEnded = msg;
        }
      } catch {}
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WS error on client ${id}: ${err.message}`));
    };
  });

  await wsReadyPromise;

  // 4. Stream Audio at 50 FPS concurrently with LLM answer request
  const frameCount = durationSec * 50;
  const pcmFrame = new Uint8Array(640);

  // Background audio sender
  const audioTask = (async () => {
    for (let f = 0; f < frameCount; f++) {
      if (ws.readyState === 1) {
        ws.send(pcmFrame);
        metrics.totalAudioFrames++;
        metrics.totalAudioBytes += 640;
      }
      await new Promise((d) => setTimeout(d, 20));
    }
  })();

  // Trigger LLM request after 1 second of audio
  await new Promise((d) => setTimeout(d, 1000));

  const t0Llm = process.hrtime.bigint();
  const llmRequestId = randomUUID();
  let firstTokenReceived = false;
  let totalDeltas = 0;

  const llmRes = await fetch(`${gatewayUrl}/v1/llm/answers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      request_id: llmRequestId,
      question: `Candidate question from client ${id}`,
      context: { interviews: [] },
      max_output_tokens: 300,
      request_type: 'interviewer-question',
    }),
  });

  if (llmRes.ok && llmRes.body) {
    const reader = llmRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (text.includes('answer.delta')) {
        totalDeltas++;
        metrics.totalLlmTokens++;
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          latencies.llmFirstToken.recordFrom(t0Llm);
        }
      }
    }
    latencies.llmComplete.recordFrom(t0Llm);
  }

  // Await audio streaming completion
  await audioTask;

  // 5. Send stt.stop and await session.ended
  const t0Stop = Date.now();
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'stt.stop' }));
  }

  while (!sessionEnded && Date.now() - t0Stop < 5000) {
    await new Promise((d) => setTimeout(d, 50));
  }
  try { ws.close(); } catch {}

  // 6. Verify final entitlements balance
  await new Promise((d) => setTimeout(d, 500)); // allow settlement to commit
  const entRes2 = await fetch(`${gatewayUrl}/v1/me/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const entData2 = await entRes2.json();
  const finalCredits = entData2.balances?.CREDITS || 0;

  metrics.completedClients++;
  return {
    id,
    accountId,
    transcriptsCount,
    acceptedAudioMs: sessionEnded?.accepted_audio_ms || 0,
    totalDeltas,
    initialCredits,
    finalCredits,
    creditsDeducted: Math.max(0, initialCredits - finalCredits),
  };
}

export async function runAppClientStressTest(options = {}) {
  const clientCount = options.clients || DEFAULT_CLIENTS;
  const durationSec = options.duration || DEFAULT_DURATION;
  const target = options.target || DEFAULT_TARGET;
  let gatewayUrl = options.gatewayUrl;
  let mockUpstream = null;
  let gatewayProcess = null;

  console.log(`\n======================================================`);
  console.log(`[App Client E2E Stress] Simulating ${clientCount} virtual desktop clients`);
  console.log(`Duration: ${durationSec}s | Target: ${target.toUpperCase()}`);
  console.log(`======================================================\n`);

  if (target === 'mock' && !gatewayUrl) {
    console.log('[Setup] Launching Mock Upstream on port 8789...');
    mockUpstream = await startMockUpstream({ port: 8789 });

    console.log('[Setup] Launching dedicated Gateway on port 8797...');
    gatewayUrl = 'http://127.0.0.1:8797';
    const env = {
      ...process.env,
      GATEWAY_LISTEN_ADDR: '127.0.0.1:8797',
      GATEWAY_PUBLIC_URL: 'http://127.0.0.1:8797',
      GEMINI_LIVE_URL: `ws://127.0.0.1:${mockUpstream.port}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`,
      GEMINI_LLM_URL: `http://127.0.0.1:${mockUpstream.port}/v1beta/interactions`,
      GEMINI_API_KEY: 'mock-key',
      GLOBAL_CONCURRENCY_LIMIT: '100',
    };

    gatewayProcess = spawn('./target/debug/rabbit-gateway', ['.'], {
      cwd: 'server',
      env,
      stdio: 'ignore',
    });

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${gatewayUrl}/healthz`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((d) => setTimeout(d, 200));
    }
    if (!ready) throw new Error('Mock gateway failed to start.');
    console.log('[Setup] Dedicated Gateway is ready.\n');
  } else if (!gatewayUrl) {
    gatewayUrl = 'http://127.0.0.1:8787';
  }

  const auditor = new ResourceAuditor({ gatewayUrl });
  const beforeAudit = await auditor.takeSnapshot();

  const latencies = {
    sessionCreate: new LatencyCollector('ms'),
    wsHandshake: new LatencyCollector('ms'),
    firstTranscript: new LatencyCollector('ms'),
    llmFirstToken: new LatencyCollector('ms'),
    llmComplete: new LatencyCollector('ms'),
  };

  const metrics = {
    totalAudioFrames: 0,
    totalAudioBytes: 0,
    totalLlmTokens: 0,
    completedClients: 0,
  };

  console.log(`[Simulation] Spawning ${clientCount} full-duplex virtual client workers...`);
  const startTime = Date.now();

  let clientResults = [];
  try {
    const workers = Array.from({ length: clientCount }, (_, i) => {
      return simulateVirtualClient({
        id: i,
        gatewayUrl,
        durationSec,
        latencies,
        metrics,
      });
    });

    clientResults = await Promise.all(workers);
  } finally {
    if (gatewayProcess) {
      gatewayProcess.kill('SIGTERM');
      await new Promise((d) => {
        gatewayProcess.once('exit', d);
        setTimeout(d, 1000);
      });
    }
    if (mockUpstream) {
      await mockUpstream.close();
    }
  }

  const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n[Simulation] All ${clientCount} virtual clients finished in ${totalElapsedSec}s.`);

  // Audit
  console.log('\n[Audit] Final resource & permit audit...');
  await new Promise((d) => setTimeout(d, 1000));
  const afterAudit = await auditor.takeSnapshot();
  const diff = auditor.diff(beforeAudit, afterAudit);

  console.log(`  Completed clients: ${metrics.completedClients} / ${clientCount}`);
  console.log(`  Total audio streamed: ${(metrics.totalAudioBytes / 1024).toFixed(1)} KB (${metrics.totalAudioFrames} frames)`);
  console.log(`  Total LLM deltas: ${metrics.totalLlmTokens}`);
  console.log(`  Active STT delta: ${diff.activeSttDelta}`);
  console.log(`  Permit leak check: ${diff.leakedPermits === 0 ? 'CLEAN (0 permits leaked)' : `${diff.leakedPermits} unreleased`}`);

  // Summary Table
  const tableHeaders = ['Operation / Milestone', 'Total Count', 'P50 (ms)', 'P90 (ms)', 'P99 (ms)', 'Max (ms)'];
  const tableRows = [
    [
      'STT Session Txn',
      `${clientCount} sessions`,
      latencies.sessionCreate.summary().p50.toFixed(2),
      latencies.sessionCreate.summary().p90.toFixed(2),
      latencies.sessionCreate.summary().p99.toFixed(2),
      latencies.sessionCreate.summary().max.toFixed(2),
    ],
    [
      'WS Handshake & Ready',
      `${clientCount} handshakes`,
      latencies.wsHandshake.summary().p50.toFixed(2),
      latencies.wsHandshake.summary().p90.toFixed(2),
      latencies.wsHandshake.summary().p99.toFixed(2),
      latencies.wsHandshake.summary().max.toFixed(2),
    ],
    [
      'First Transcript Latency',
      `${clientCount} streams`,
      latencies.firstTranscript.summary().p50.toFixed(2),
      latencies.firstTranscript.summary().p90.toFixed(2),
      latencies.firstTranscript.summary().p99.toFixed(2),
      latencies.firstTranscript.summary().max.toFixed(2),
    ],
    [
      'LLM Time to First Token',
      `${clientCount} answers`,
      latencies.llmFirstToken.summary().p50.toFixed(2),
      latencies.llmFirstToken.summary().p90.toFixed(2),
      latencies.llmFirstToken.summary().p99.toFixed(2),
      latencies.llmFirstToken.summary().max.toFixed(2),
    ],
    [
      'LLM Answer Completion',
      `${clientCount} answers`,
      latencies.llmComplete.summary().p50.toFixed(2),
      latencies.llmComplete.summary().p90.toFixed(2),
      latencies.llmComplete.summary().p99.toFixed(2),
      latencies.llmComplete.summary().max.toFixed(2),
    ],
  ];

  console.log(formatTable('Virtual App Client E2E Stress Results', tableHeaders, tableRows));

  return {
    clientResults,
    metrics,
    latencies,
    diff,
    markdown: generateMarkdown('Virtual App Client E2E Stress Results', tableHeaders, tableRows),
  };
}

if (process.argv[1] && process.argv[1].endsWith('app-client-stress.mjs')) {
  runAppClientStressTest().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('App client stress test failed:', err);
    process.exit(1);
  });
}
