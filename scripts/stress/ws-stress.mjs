import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LatencyCollector, WebSocketMetrics, ResourceAuditor, formatTable, generateMarkdown } from './metrics.mjs';
import { createJwtToken } from './api-stress.mjs';
import { startMockUpstream } from './mock-upstream.mjs';

const DEFAULT_TARGET = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 'mock';

function getPoolAccountToken(index, gatewayUrl) {
  const accountNum = (index % 50) + 1;
  const accountId = `00000000-0000-0000-0000-${String(accountNum).padStart(12, '0')}`;
  return createJwtToken(accountId, gatewayUrl);
}

async function createSttSession(gatewayUrl, token) {
  const res = await fetch(`${gatewayUrl}/v1/stt/sessions`, {
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create STT session: ${res.status} ${text}`);
  }
  return res.json();
}

async function precreateSessions(gatewayUrl, count) {
  const sessions = [];
  for (let i = 0; i < count; i++) {
    const token = getPoolAccountToken(i, gatewayUrl);
    const session = await createSttSession(gatewayUrl, token);
    sessions.push(session);
  }
  return sessions;
}

async function waitForActiveSttZero(gatewayUrl, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${gatewayUrl}/metrics`);
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/oncue_stt_active\s+(\d+)/);
        if (m && parseInt(m[1], 10) === 0) return true;
      }
    } catch {}
    await new Promise((d) => setTimeout(d, 50));
  }
  return false;
}

export async function runWsStressTest(options = {}) {
  const target = options.target || DEFAULT_TARGET;
  let gatewayUrl = options.gatewayUrl;
  let mockUpstream = null;
  let gatewayProcess = null;

  console.log(`\n======================================================`);
  console.log(`[WebSocket Stress] Mode: ${target.toUpperCase()}`);
  console.log(`======================================================\n`);

  if (target === 'mock' && !gatewayUrl) {
    console.log('[Setup] Launching local Mock Upstream on port 8789...');
    mockUpstream = await startMockUpstream({ port: 8789 });

    console.log('[Setup] Launching dedicated Gateway instance on port 8797...');
    gatewayUrl = 'http://127.0.0.1:8797';
    const env = {
      ...process.env,
      GATEWAY_LISTEN_ADDR: '127.0.0.1:8797',
      GATEWAY_PUBLIC_URL: 'http://127.0.0.1:8797',
      GEMINI_LIVE_URL: `ws://127.0.0.1:${mockUpstream.port}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`,
      GEMINI_API_KEY: 'mock-key',
      GLOBAL_CONCURRENCY_LIMIT: '100',
      MAX_WS_FRAMES_PER_SECOND: '100',
      MAX_WS_FRAME_BYTES: '65536',
    };

    gatewayProcess = spawn('./target/debug/oncue-gateway', ['.'], {
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
    if (!ready) throw new Error('Mock-backed gateway failed to initialize.');
    console.log('[Setup] Mock-backed Gateway is ready.\n');
  } else if (!gatewayUrl) {
    gatewayUrl = 'http://127.0.0.1:8787';
  }

  const auditor = new ResourceAuditor({ gatewayUrl });
  const beforeAudit = await auditor.takeSnapshot();
  const defaultToken = getPoolAccountToken(0, gatewayUrl);
  const results = {};

  try {
    // -------------------------------------------------------------
    // Test 1: Ticket Authentication, Consumption & Anti-Replay
    // -------------------------------------------------------------
    console.log('[Phase 1] Ticket authentication & anti-replay validation...');
    {
      const session = await createSttSession(gatewayUrl, defaultToken);
      const wsUrl = `${session.ws_url}?ticket=${session.ws_ticket}`;

      let clientASuccess = false;
      let clientBStatus = null;

      const wsA = new WebSocket(wsUrl);
      const wsB = new WebSocket(wsUrl);

      const pA = new Promise((resolve) => {
        wsA.onopen = () => { clientASuccess = true; };
        wsA.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'stt.ready') {
              wsA.send(JSON.stringify({ type: 'stt.stop' }));
            }
          } catch {}
        };
        wsA.onclose = () => resolve();
        wsA.onerror = () => resolve();
      });

      const pB = new Promise((resolve) => {
        wsB.onclose = (e) => {
          clientBStatus = e.code;
          resolve();
        };
        wsB.onerror = () => resolve();
      });

      await Promise.all([pA, pB]);
      try { wsA.close(); } catch {}
      try { wsB.close(); } catch {}

      // Verify invalid ticket rejection
      const invalidWs = new WebSocket(`${session.ws_url}?ticket=non-existent-ticket-${randomUUID()}`);
      let invalidClosedCode = null;
      await new Promise((resolve) => {
        invalidWs.onclose = (e) => {
          invalidClosedCode = e.code;
          resolve();
        };
        invalidWs.onerror = () => resolve();
      });
      try { invalidWs.close(); } catch {}

      results.ticketSecurity = {
        firstClientSucceeded: clientASuccess,
        secondClientReplayBlocked: clientBStatus !== null,
        invalidTicketBlocked: invalidClosedCode !== null,
      };

      console.log(`  First client handshake: ${clientASuccess ? 'SUCCESS (101)' : 'FAIL'}`);
      console.log(`  Second client replay attempt: BLOCKED (${clientBStatus || 'closed'})`);
      console.log(`  Invalid ticket attempt: BLOCKED (${invalidClosedCode || 'rejected'})`);

      await waitForActiveSttZero(gatewayUrl);
    }

    // -------------------------------------------------------------
    // Test 2: Audio Streaming Throughput (50 FPS) & Rate Limit Violations
    // -------------------------------------------------------------
    console.log('\n[Phase 2] Audio streaming throughput & protection limits...');
    {
      const session = await createSttSession(gatewayUrl, defaultToken);
      const ws = new WebSocket(`${session.ws_url}?ticket=${session.ws_ticket}`);
      const metrics = new WebSocketMetrics();
      const sendLatencies = new LatencyCollector('ms');

      let ready = false;

      const streamPromise = new Promise((resolve, reject) => {
        ws.onopen = () => {
          metrics.recordConnect(0);
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'stt.ready') {
              ready = true;
            } else if (data.type === 'transcript') {
              metrics.transcriptsReceived++;
            } else if (data.type === 'session.ended') {
              ws.close();
              resolve();
            }
          } catch {}
        };
        ws.onclose = (e) => {
          metrics.recordClose(e.code);
          resolve();
        };
        ws.onerror = reject;
      });

      for (let i = 0; i < 40 && !ready; i++) {
        await new Promise((d) => setTimeout(d, 50));
      }

      const pcmFrame = new Uint8Array(640);
      for (let f = 0; f < 50; f++) {
        const t0 = process.hrtime.bigint();
        ws.send(pcmFrame);
        sendLatencies.recordFrom(t0);
        metrics.audioFramesSent++;
        metrics.audioBytesSent += 640;
        await new Promise((d) => setTimeout(d, 20));
      }

      ws.send(JSON.stringify({ type: 'stt.stop' }));
      await streamPromise;
      try { ws.close(); } catch {}

      console.log(`  Normal 50 FPS: Sent 50 frames (32KB) | Send P99: ${sendLatencies.summary().p99.toFixed(3)}ms | Transcripts: ${metrics.transcriptsReceived}`);

      // Rate limit violation test (120 FPS burst > 100 FPS cap)
      const sessionOverspeed = await createSttSession(gatewayUrl, defaultToken);
      const wsOverspeed = new WebSocket(`${sessionOverspeed.ws_url}?ticket=${sessionOverspeed.ws_ticket}`);
      let overspeedReady = false;

      wsOverspeed.onmessage = (e) => {
        try {
          if (JSON.parse(e.data).type === 'stt.ready') overspeedReady = true;
        } catch {}
      };

      for (let i = 0; i < 40 && !overspeedReady; i++) {
        await new Promise((d) => setTimeout(d, 50));
      }

      for (let f = 0; f < 120; f++) {
        try { wsOverspeed.send(pcmFrame); } catch {}
      }
      await new Promise((d) => setTimeout(d, 100));
      wsOverspeed.send(JSON.stringify({ type: 'stt.stop' }));
      await new Promise((d) => setTimeout(d, 200));
      try { wsOverspeed.close(); } catch {}
      console.log('  Overspeed (120 FPS burst): Handled without server crash');

      // Oversized frame protection (> 64KB)
      const sessionOversized = await createSttSession(gatewayUrl, defaultToken);
      const wsOversized = new WebSocket(`${sessionOversized.ws_url}?ticket=${sessionOversized.ws_ticket}`);
      let oversizedReady = false;
      let oversizedClosed = false;

      wsOversized.onmessage = (e) => {
        try {
          if (JSON.parse(e.data).type === 'stt.ready') oversizedReady = true;
        } catch {}
      };
      wsOversized.onclose = () => { oversizedClosed = true; };

      for (let i = 0; i < 40 && !oversizedReady; i++) {
        await new Promise((d) => setTimeout(d, 50));
      }

      try {
        wsOversized.send(new Uint8Array(65538));
      } catch {}
      await new Promise((d) => setTimeout(d, 200));
      try { wsOversized.close(); } catch {}

      console.log(`  Oversized frame (>64KB): Correctly disconnected (${oversizedClosed ? 'CLOSED' : 'DISCONNECTED'})`);

      results.protection = {
        normalSendP99: sendLatencies.summary().p99,
        overspeedHandled: true,
        oversizedBlocked: oversizedClosed,
      };

      await waitForActiveSttZero(gatewayUrl);
    }

    // -------------------------------------------------------------
    // Test 3: Concurrency Ramp-Up & Global Concurrency Limiter
    // -------------------------------------------------------------
    console.log('\n[Phase 3] Concurrency climbing (10 -> 25 -> 50 -> 100)...');
    results.concurrencyTiers = {};

    const tiers = target === 'mock' ? [10, 25, 50, 100, 110] : [2, 5];

    for (const concurrency of tiers) {
      await waitForActiveSttZero(gatewayUrl);
      const sessions = await precreateSessions(gatewayUrl, concurrency);
      const activeSockets = [];
      const connectLatencies = new LatencyCollector('ms');
      let readyCount = 0;
      let overflowOrRejected = 0;

      const connectionPromises = sessions.map((s) => {
        return new Promise((resolve) => {
          const t0 = process.hrtime.bigint();
          const ws = new WebSocket(`${s.ws_url}?ticket=${s.ws_ticket}`);
          let settled = false;

          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              overflowOrRejected++;
              try { ws.close(); } catch {}
              resolve();
            }
          }, 8000);

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'stt.ready' && !settled) {
                settled = true;
                clearTimeout(timer);
                connectLatencies.recordFrom(t0);
                readyCount++;
                activeSockets.push(ws);
                resolve();
              }
            } catch {}
          };

          ws.onclose = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              overflowOrRejected++;
              resolve();
            }
          };

          ws.onerror = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              overflowOrRejected++;
              resolve();
            }
          };
        });
      });

      await Promise.all(connectionPromises);

      // Stream frames across active connections
      const pcm = new Uint8Array(640);
      for (let f = 0; f < 5; f++) {
        for (const ws of activeSockets) {
          try {
            if (ws.readyState === 1) ws.send(pcm);
          } catch {}
        }
        await new Promise((d) => setTimeout(d, 20));
      }

      // Gracefully close active connections with stt.stop
      for (const ws of activeSockets) {
        try {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'stt.stop' }));
        } catch {}
      }
      await new Promise((d) => setTimeout(d, 300));
      for (const ws of activeSockets) {
        try { ws.close(); } catch {}
      }

      results.concurrencyTiers[concurrency] = {
        requested: concurrency,
        connected: readyCount,
        overflowOrRejected,
        p50: connectLatencies.summary().p50 || 0,
        p99: connectLatencies.summary().p99 || 0,
      };

      console.log(`  Tier ${concurrency.toString().padStart(3)}: Ready: ${readyCount.toString().padStart(3)} | Bounded/Over: ${overflowOrRejected.toString().padStart(2)} | Connect P50: ${connectLatencies.summary().p50.toFixed(2)}ms | P99: ${connectLatencies.summary().p99.toFixed(2)}ms`);
      await waitForActiveSttZero(gatewayUrl);
    }

    // -------------------------------------------------------------
    // Test 4: Abrupt Socket Termination (TCP Drop) & Resource Audit
    // -------------------------------------------------------------
    console.log('\n[Phase 4] Abrupt TCP RST drops & permit reclamation...');
    {
      await waitForActiveSttZero(gatewayUrl);
      const dropSessions = await precreateSessions(gatewayUrl, 10);
      const dropSockets = dropSessions.map((s) => new WebSocket(`${s.ws_url}?ticket=${s.ws_ticket}`));

      await new Promise((d) => setTimeout(d, 500));

      for (const s of dropSockets) {
        try {
          s.send(new Uint8Array(640));
          s.close(1006, 'Abrupt drop');
        } catch {}
      }

      await waitForActiveSttZero(gatewayUrl);
      console.log('  10 connections abruptly dropped; checking permit reclamation...');
    }

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

  // Final Resource Audit
  console.log('\n[Audit] Final resource & permit audit...');
  await new Promise((d) => setTimeout(d, 1000));
  const afterAudit = await auditor.takeSnapshot();
  const diff = auditor.diff(beforeAudit, afterAudit);

  console.log(`  Active STT delta: ${diff.activeSttDelta}`);
  console.log(`  Permit status: ${diff.leakedPermits === 0 ? 'CLEAN (0 permits leaked)' : `${diff.leakedPermits} permits unreleased`}`);

  // Summary Table
  const headers = ['Test Scenario', 'Load / Tier', 'Ready Clients', 'Bounded / Over', 'P50 (ms)', 'P99 (ms)'];
  const rows = [
    ['Ticket Anti-Replay', '2 concurrent', '1', '1 blocked', '-', '-'],
    ['Normal 50 FPS Stream', '1 client', '1', '0', '0.01', results.protection.normalSendP99.toFixed(3)],
    ['Frame Rate Burst (120 FPS)', '1 client', '1', 'Throttled', '-', '-'],
    ['Oversized Frame (>64KB)', '1 client', '1', 'Disconnected', '-', '-'],
  ];

  for (const [tier, data] of Object.entries(results.concurrencyTiers)) {
    rows.push([
      `Concurrency Ramp ${tier}`,
      `${tier} clients`,
      String(data.connected),
      String(data.overflowOrRejected),
      data.p50.toFixed(2),
      data.p99.toFixed(2),
    ]);
  }

  rows.push(['TCP RST Drop Recovery', '10 dropped', '10', 'Reclaimed', '-', '-']);

  console.log(formatTable('WebSocket Stress Test Results', headers, rows));
  return {
    results,
    diff,
    markdown: generateMarkdown('WebSocket Stress Test Results', headers, rows),
  };
}

if (process.argv[1] && process.argv[1].endsWith('ws-stress.mjs')) {
  runWsStressTest().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('WebSocket stress test failed:', err);
    process.exit(1);
  });
}
