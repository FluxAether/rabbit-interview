import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { LatencyCollector, formatTable, generateMarkdown } from './metrics.mjs';

function loadStateModule() {
  const code = readFileSync('src/lib/copilotSessionState.ts', 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export /gm, '');

  const fn = new Function(`${transpiled}\nreturn { createInitialSnapshot, reduceCopilotSnapshot, createCopilotSnapshotPatch, applyCopilotSnapshotPatch, orderCopilotMessagesForDisplay };`);
  return fn();
}

const {
  createInitialSnapshot,
  reduceCopilotSnapshot,
  createCopilotSnapshotPatch,
  applyCopilotSnapshotPatch,
  orderCopilotMessagesForDisplay,
} = loadStateModule();

export async function runAppStateStressTest(options = {}) {
  const eventCount = options.eventCount ?? 10000;
  const tokenBurstCount = options.tokenBurstCount ?? 500;
  const sessionCycleCount = options.sessionCycleCount ?? 1000;

  console.log(`\n======================================================`);
  console.log(`[App State Stress] Starting client state reduction tests`);
  console.log(`Events: ${eventCount} | Token bursts: ${tokenBurstCount} | Cycles: ${sessionCycleCount}`);
  console.log(`======================================================\n`);

  const results = {};

  // -------------------------------------------------------------
  // Test 1: High-frequency transcript events injection (10,000 actions)
  // -------------------------------------------------------------
  {
    console.log(`[Test 1] Injecting ${eventCount} transcript updates...`);
    const initialMem = process.memoryUsage();
    const latencies = new LatencyCollector('ms');
    let state = createInitialSnapshot();
    const sessionId = 42;

    state = reduceCopilotSnapshot(state, { type: 'start', sessionId });
    state = reduceCopilotSnapshot(state, { type: 'started', sessionId, mode: 'microphone' });

    let currentMsgId = 1;
    let messageText = '';

    const startTime = Date.now();
    for (let i = 0; i < eventCount; i++) {
      const isFinal = (i + 1) % 20 === 0;
      messageText += `word${i % 100} `;

      const t0 = process.hrtime.bigint();
      state = reduceCopilotSnapshot(state, {
        type: 'message',
        sessionId,
        message: {
          id: currentMsgId,
          role: 'interviewer',
          source: 'microphone-stt',
          text: messageText,
          createdAt: Date.now(),
        },
      });
      latencies.recordFrom(t0);

      if (isFinal) {
        currentMsgId++;
        messageText = '';
      }
    }
    const elapsedTotalMs = Date.now() - startTime;
    const finalMem = process.memoryUsage();
    const summary = latencies.summary();

    // Verify ordering and message count
    const ordered = orderCopilotMessagesForDisplay(state.messages);
    assert.equal(ordered.length, state.messages.length, 'Display order must preserve message count');
    assert.equal(state.revision, eventCount + 2, 'Revision must accurately match action count');

    const rssDeltaMb = ((finalMem.rss - initialMem.rss) / (1024 * 1024)).toFixed(2);
    const heapDeltaMb = ((finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024)).toFixed(2);

    results.transcripts = {
      eventCount,
      elapsedTotalMs,
      opsPerSec: Math.round((eventCount / elapsedTotalMs) * 1000),
      summary,
      rssDeltaMb,
      heapDeltaMb,
    };

    console.log(`✓ Completed in ${elapsedTotalMs}ms (~${results.transcripts.opsPerSec} ops/sec)`);
    console.log(`  P50: ${summary.p50.toFixed(4)}ms | P90: ${summary.p90.toFixed(4)}ms | P99: ${summary.p99.toFixed(4)}ms | Max: ${summary.max.toFixed(4)}ms`);
    console.log(`  Heap delta: ${heapDeltaMb}MB | RSS delta: ${rssDeltaMb}MB`);
  }

  // -------------------------------------------------------------
  // Test 2: LLM Streaming Token Burst with Throttled Patch Updates
  // -------------------------------------------------------------
  {
    console.log(`\n[Test 2] Simulating LLM streaming token burst (${tokenBurstCount} tokens)...`);
    const sessionId = 42;
    let state = createInitialSnapshot();
    state = reduceCopilotSnapshot(state, { type: 'start', sessionId });
    state = reduceCopilotSnapshot(state, { type: 'started', sessionId, mode: 'microphone' });

    const answerId = 999;
    let fullText = '';
    const patchLatencies = new LatencyCollector('ms');
    const applyLatencies = new LatencyCollector('ms');

    // Simulate 40ms UI throttling publish interval
    let uiDispatchedCount = 0;
    let lastDispatchedState = state;
    let clientReplicatedState = state;

    for (let i = 0; i < tokenBurstCount; i++) {
      const delta = `tok${i} `;
      fullText += delta;

      state = reduceCopilotSnapshot(state, {
        type: 'stream-answer',
        sessionId,
        suggestion: { id: answerId, text: fullText, category: 'AI' },
      });

      // Every 40 tokens (representing 40ms interval with 1000 tokens/sec burst)
      if ((i + 1) % 40 === 0 || i === tokenBurstCount - 1) {
        uiDispatchedCount++;
        const t0 = process.hrtime.bigint();
        const patch = createCopilotSnapshotPatch(lastDispatchedState, state);
        patchLatencies.recordFrom(t0);

        if (patch) {
          const t1 = process.hrtime.bigint();
          const replicated = applyCopilotSnapshotPatch(clientReplicatedState, patch);
          applyLatencies.recordFrom(t1);

          assert(replicated !== null, 'Patch application must not fail on in-order revisions');
          clientReplicatedState = replicated;
        } else {
          clientReplicatedState = state;
        }
        lastDispatchedState = state;
      }
    }

    state = reduceCopilotSnapshot(state, {
      type: 'complete-answer',
      sessionId,
      answerId,
      answer: fullText,
      suggestions: [{ id: answerId, text: fullText, category: 'AI' }],
    });

    // Final reconciliation
    const finalPatch = createCopilotSnapshotPatch(lastDispatchedState, state);
    if (finalPatch) {
      clientReplicatedState = applyCopilotSnapshotPatch(clientReplicatedState, finalPatch);
    }

    const answerMsg = clientReplicatedState.messages.find((m) => m.id === answerId);
    assert.equal(answerMsg?.text, fullText, 'Replicated answer text must match full stream text');

    results.llmTokens = {
      tokenCount: tokenBurstCount,
      uiDispatchedCount,
      throttleSavingsPct: (((tokenBurstCount - uiDispatchedCount) / tokenBurstCount) * 100).toFixed(1),
      patchLatency: patchLatencies.summary(),
      applyLatency: applyLatencies.summary(),
    };

    console.log(`✓ 500 tokens condensed into ${uiDispatchedCount} UI patches (Saved ${results.llmTokens.throttleSavingsPct}% React renders)`);
    console.log(`  Patch generation P99: ${patchLatencies.summary().p99.toFixed(4)}ms | Apply P99: ${applyLatencies.summary().p99.toFixed(4)}ms`);
  }

  // -------------------------------------------------------------
  // Test 3: Rapid Session Switching, Cancellations and Interleaving
  // -------------------------------------------------------------
  {
    console.log(`\n[Test 3] Stressing ${sessionCycleCount} session switches & cancellations...`);
    let state = createInitialSnapshot();
    let currentSession = 100;
    let ignoredStaleActions = 0;
    const cycleLatencies = new LatencyCollector('ms');

    for (let cycle = 0; cycle < sessionCycleCount; cycle++) {
      const t0 = process.hrtime.bigint();
      const nextSession = currentSession + 1;

      // 1. Start new session
      state = reduceCopilotSnapshot(state, { type: 'start', sessionId: nextSession });
      state = reduceCopilotSnapshot(state, { type: 'started', sessionId: nextSession, mode: 'microphone' });

      // 2. Start streaming an answer
      const answerId = 5000 + cycle;
      state = reduceCopilotSnapshot(state, {
        type: 'stream-answer',
        sessionId: nextSession,
        suggestion: { id: answerId, text: 'partial answer', category: 'AI' },
      });

      // 3. Stale session action arrives (should be safely dropped)
      const prevRevision = state.revision;
      state = reduceCopilotSnapshot(state, {
        type: 'stream-answer',
        sessionId: currentSession, // stale!
        suggestion: { id: 9999, text: 'stale text', category: 'AI' },
      });
      if (state.revision === prevRevision) {
        ignoredStaleActions++;
      }

      // 4. Cancel active answer
      state = reduceCopilotSnapshot(state, {
        type: 'cancel-answer',
        sessionId: nextSession,
        answerId,
      });
      assert.equal(state.activeAnswerId, null, 'Active answer must be null after cancellation');

      // 5. Complete session
      state = reduceCopilotSnapshot(state, { type: 'stop' });
      state = reduceCopilotSnapshot(state, { type: 'stopped' });

      currentSession = nextSession;
      cycleLatencies.recordFrom(t0);
    }

    assert.equal(ignoredStaleActions, sessionCycleCount, 'Every stale action must be rejected');
    assert.equal(state.phase, 'idle', 'Final state phase must be idle');
    assert.equal(state.activeAnswerId, null, 'No orphaned active answer');

    results.cycles = {
      sessionCycleCount,
      ignoredStaleActions,
      summary: cycleLatencies.summary(),
    };

    console.log(`✓ Completed ${sessionCycleCount} interleaved cycles (100% stale actions quarantined)`);
    console.log(`  Cycle P50: ${cycleLatencies.summary().p50.toFixed(4)}ms | P99: ${cycleLatencies.summary().p99.toFixed(4)}ms`);
  }

  // -------------------------------------------------------------
  // Summary Tables
  // -------------------------------------------------------------
  const reportHeaders = ['Test Phase', 'Workload', 'Throughput', 'P50 (ms)', 'P90 (ms)', 'P99 (ms)', 'Max (ms)'];
  const reportRows = [
    [
      'Transcript Injection',
      `${results.transcripts.eventCount} events`,
      `${results.transcripts.opsPerSec} ops/s`,
      results.transcripts.summary.p50.toFixed(4),
      results.transcripts.summary.p90.toFixed(4),
      results.transcripts.summary.p99.toFixed(4),
      results.transcripts.summary.max.toFixed(4),
    ],
    [
      'Patch Generation',
      `${results.llmTokens.uiDispatchedCount} patches`,
      `-`,
      results.llmTokens.patchLatency.p50.toFixed(4),
      results.llmTokens.patchLatency.p90.toFixed(4),
      results.llmTokens.patchLatency.p99.toFixed(4),
      results.llmTokens.patchLatency.max.toFixed(4),
    ],
    [
      'Session Lifecycle',
      `${results.cycles.sessionCycleCount} cycles`,
      `-`,
      results.cycles.summary.p50.toFixed(4),
      results.cycles.summary.p90.toFixed(4),
      results.cycles.summary.p99.toFixed(4),
      results.cycles.summary.max.toFixed(4),
    ],
  ];

  console.log(formatTable('App State Machine Stress Test Results', reportHeaders, reportRows));
  return { results, markdown: generateMarkdown('App State Machine Stress Test Results', reportHeaders, reportRows) };
}

if (process.argv[1] && process.argv[1].endsWith('app-state-stress.mjs')) {
  runAppStateStressTest().catch((err) => {
    console.error('App state stress test failed:', err);
    process.exit(1);
  });
}
