import http from 'node:http';
import { createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class MinimalWebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.onMessage = null;
    this.onClose = null;

    socket.on('data', (chunk) => this._handleData(chunk));
    socket.on('close', () => this._handleClose(1006, 'Socket closed'));
    socket.on('error', (err) => {
      this._handleClose(1006, err.message);
    });
  }

  _handleClose(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    if (this.onClose) this.onClose(code, reason);
  }

  _handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const byte0 = this.buffer[0];
      const byte1 = this.buffer[1];
      // Opcode and masking
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) return;
        // Read lower 32 bits for safety in JS
        const hi = this.buffer.readUInt32BE(offset);
        const lo = this.buffer.readUInt32BE(offset + 4);
        if (hi !== 0) {
          this.close(1009, 'Frame too large');
          return;
        }
        payloadLen = lo;
        offset += 8;
      }

      let mask = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) return;

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (masked && mask) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4];
        }
      }

      if (opcode === 0x8) {
        // Close
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.toString('utf8', 2) : '';
        this.close(code, reason);
      } else if (opcode === 0x9) {
        // Ping -> Pong
        this.sendFrame(0xa, payload);
      } else if (opcode === 0x1) {
        // Text
        const text = payload.toString('utf8');
        if (this.onMessage) this.onMessage({ type: 'text', data: text });
      } else if (opcode === 0x2) {
        // Binary
        if (this.onMessage) this.onMessage({ type: 'binary', data: payload });
      }
    }
  }

  sendFrame(opcode, payload = Buffer.alloc(0)) {
    if (this.closed || !this.socket.writable) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = len;
    } else if (len <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  sendBinary(buffer) {
    this.sendFrame(0x2, buffer);
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    try {
      const reasonBuf = Buffer.from(reason, 'utf8');
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      this.sendFrame(0x8, payload);
      this.socket.end();
      setTimeout(() => {
        try { this.socket.destroy(); } catch {}
      }, 50);
    } catch {
      // socket might be already closed
    }
    this._handleClose(code, reason);
  }
}

export function startMockUpstream(options = {}) {
  const port = options.port ?? 8789;
  const host = options.host ?? '127.0.0.1';
  const transcriptIntervalFrames = options.transcriptIntervalFrames ?? 25; // every 500ms at 50fps
  const deltaDelayMs = options.deltaDelayMs ?? 20;

  const metrics = {
    activeWsConnections: 0,
    totalWsConnections: 0,
    wsFramesReceived: 0,
    wsAudioBytesReceived: 0,
    wsTranscriptsSent: 0,
    sseRequestsTotal: 0,
    sseRequestsActive: 0,
    sseDeltasSent: 0,
    sseCompletedTotal: 0,
    sseAbortedTotal: 0,
  };

  const activeSockets = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    // Health check
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', metrics }));
      return;
    }

    // Reset metrics
    if (req.method === 'POST' && url.pathname === '/reset-metrics') {
      metrics.totalWsConnections = 0;
      metrics.wsFramesReceived = 0;
      metrics.wsAudioBytesReceived = 0;
      metrics.wsTranscriptsSent = 0;
      metrics.sseRequestsTotal = 0;
      metrics.sseDeltasSent = 0;
      metrics.sseCompletedTotal = 0;
      metrics.sseAbortedTotal = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // LLM SSE Endpoints
    // 1) Gemini interactions endpoint (/v1beta/interactions)
    // 2) OpenAI / responses endpoint (/v1/responses)
    // 3) Chat completions endpoint (/v1/chat/completions)
    const isLlmPath = url.pathname.includes('/interactions') ||
                      url.pathname.includes('/responses') ||
                      url.pathname.includes('/chat/completions') ||
                      url.pathname.includes('/messages');

    if (req.method === 'POST' && isLlmPath) {
      metrics.sseRequestsTotal++;
      metrics.sseRequestsActive++;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Mock-Upstream': 'true',
      });

      let aborted = false;
      const cleanUp = () => {
        if (aborted) return;
        aborted = true;
        metrics.sseRequestsActive = Math.max(0, metrics.sseRequestsActive - 1);
      };

      req.on('close', () => {
        if (!res.writableEnded) {
          cleanUp();
          metrics.sseAbortedTotal++;
        }
      });

      // Stream events according to Gemini Interactions API format
      const interactionId = `mock-interaction-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      res.write(`data: ${JSON.stringify({
        event_type: 'interaction.created',
        interaction: { id: interactionId, status: 'in_progress' }
      })}\n\n`);

      const deltas = [
        'To answer your question, ',
        'we should consider ',
        'the system architecture, ',
        'high concurrency requirements, ',
        'and robust error handling. ',
        'First, network latency must be bounded. ',
        'Second, resource cleanup is critical. ',
        'Finally, metrics should be verified.'
      ];

      let step = 0;
      const timer = setInterval(() => {
        if (aborted || res.writableEnded) {
          clearInterval(timer);
          return;
        }

        if (step < deltas.length) {
          const deltaText = deltas[step++];
          metrics.sseDeltasSent++;
          res.write(`data: ${JSON.stringify({
            event_type: 'step.delta',
            delta: { type: 'text', text: deltaText }
          })}\n\n`);
        } else {
          clearInterval(timer);
          metrics.sseCompletedTotal++;
          res.write(`data: ${JSON.stringify({
            event_type: 'interaction.completed',
            interaction: {
              status: 'complete',
              usage: {
                total_input_tokens: 28,
                total_output_tokens: 42,
                total_thought_tokens: 0,
                total_tokens: 70,
              }
            }
          })}\n\n`);
          res.end();
          cleanUp();
        }
      }, deltaDelayMs);

      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
  });

  server.on('upgrade', (req, socket, head) => {
    if (head && head.length > 0) socket.unshift(head);
    const upgrade = req.headers['upgrade'];
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n');

    socket.write(responseHeaders);

    const ws = new MinimalWebSocketConnection(socket);
    activeSockets.add(ws);
    metrics.activeWsConnections++;
    metrics.totalWsConnections++;

    let frameCount = 0;
    let totalSamples = 0;

    ws.onMessage = ({ type, data }) => {
      metrics.wsFramesReceived++;

      if (type === 'text') {
        try {
          const json = JSON.parse(data);

          // Gemini Live Setup
          if (json.setup) {
            ws.sendText(JSON.stringify({
              setupComplete: {},
            }));
            return;
          }

          // Gemini Live Realtime Input
          if (json.realtimeInput) {
            if (json.realtimeInput.audioStreamEnd) {
              metrics.wsTranscriptsSent++;
              ws.sendText(JSON.stringify({
                serverContent: {
                  inputTranscription: {
                    text: `final transcript after ${frameCount} frames`,
                  },
                },
              }));
              setTimeout(() => {
                try { ws.close(1000, 'Stream finished'); } catch {}
              }, 20);
              return;
            }

            if (json.realtimeInput.audio && json.realtimeInput.audio.data) {
              const audioBytes = Buffer.from(json.realtimeInput.audio.data, 'base64');
              metrics.wsAudioBytesReceived += audioBytes.length;
              frameCount++;
              totalSamples += audioBytes.length / 2;

              if (frameCount % transcriptIntervalFrames === 0) {
                metrics.wsTranscriptsSent++;
                const isFinal = frameCount % (transcriptIntervalFrames * 4) === 0;
                if (isFinal) {
                  ws.sendText(JSON.stringify({
                    serverContent: {
                      inputTranscription: {
                        text: `utterance final at frame ${frameCount}`,
                      },
                    },
                  }));
                } else {
                  ws.sendText(JSON.stringify({
                    serverContent: {
                      interimInputTranscription: {
                        text: `interim partial at frame ${frameCount}`,
                      },
                    },
                  }));
                }
              }
            }
          }

          // Deepgram or generic stop
          if (json.type === 'CloseStream' || json.type === 'stt.stop') {
            metrics.wsTranscriptsSent++;
            ws.sendText(JSON.stringify({
              type: 'Results',
              channel: { alternatives: [{ transcript: 'session completed' }] },
              is_final: true,
            }));
          }
        } catch {
          // ignore non-json text
        }
      } else if (type === 'binary') {
        // Raw PCM binary streaming (e.g. Deepgram or direct audio)
        metrics.wsAudioBytesReceived += data.length;
        frameCount++;
        totalSamples += data.length / 2;

        if (frameCount % transcriptIntervalFrames === 0) {
          metrics.wsTranscriptsSent++;
          ws.sendText(JSON.stringify({
            type: 'Results',
            channel: { alternatives: [{ transcript: `raw frame ${frameCount}` }] },
            is_final: frameCount % (transcriptIntervalFrames * 4) === 0,
          }));
        }
      }
    };

    ws.onClose = () => {
      activeSockets.delete(ws);
      metrics.activeWsConnections = Math.max(0, metrics.activeWsConnections - 1);
    };
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = address.port;
      const url = `http://${host}:${actualPort}`;
      const wsUrl = `ws://${host}:${actualPort}`;

      resolve({
        server,
        port: actualPort,
        url,
        wsUrl,
        metrics,
        close: async () => {
          for (const s of activeSockets) {
            try { s.close(1000, 'Server closing'); } catch {}
          }
          activeSockets.clear();
          await new Promise((done) => server.close(done));
        },
      });
    });
    server.on('error', reject);
  });
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('mock-upstream.mjs')) {
  const port = parseInt(process.env.MOCK_PORT || '8789', 10);
  const upstream = await startMockUpstream({ port });
  console.log(`[Mock Upstream] Listening on ${upstream.url} (WS: ${upstream.wsUrl})`);
  process.on('SIGINT', async () => {
    console.log('\n[Mock Upstream] Shutting down...');
    await upstream.close();
    process.exit(0);
  });
}
