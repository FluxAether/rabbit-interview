import { execSync } from 'node:child_process';

/**
 * High-precision latency collector
 */
export class LatencyCollector {
  constructor(unit = 'ms') {
    this.unit = unit;
    this.samples = [];
    this._sorted = true;
  }

  record(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      this.samples.push(value);
      this._sorted = false;
    }
  }

  recordFrom(startTimeBigInt) {
    const elapsedNs = Number(process.hrtime.bigint() - startTimeBigInt);
    const value = this.unit === 'ms' ? elapsedNs / 1e6 : elapsedNs / 1e3;
    this.record(value);
    return value;
  }

  _sort() {
    if (!this._sorted) {
      this.samples.sort((a, b) => a - b);
      this._sorted = true;
    }
  }

  get count() {
    return this.samples.length;
  }

  min() {
    if (this.samples.length === 0) return 0;
    this._sort();
    return this.samples[0];
  }

  max() {
    if (this.samples.length === 0) return 0;
    this._sort();
    return this.samples[this.samples.length - 1];
  }

  mean() {
    if (this.samples.length === 0) return 0;
    const sum = this.samples.reduce((acc, val) => acc + val, 0);
    return sum / this.samples.length;
  }

  percentile(p) {
    if (this.samples.length === 0) return 0;
    this._sort();
    const rank = Math.min(
      Math.max(0, Math.ceil((p / 100) * this.samples.length) - 1),
      this.samples.length - 1
    );
    return this.samples[rank];
  }

  summary() {
    return {
      count: this.count,
      unit: this.unit,
      min: this.min(),
      mean: this.mean(),
      p50: this.percentile(50),
      p90: this.percentile(90),
      p95: this.percentile(95),
      p99: this.percentile(99),
      p999: this.percentile(99.9),
      max: this.max(),
    };
  }
}

/**
 * HTTP Status code tracker
 */
export class StatusCodeTracker {
  constructor() {
    this.counts = new Map();
    this.total = 0;
  }

  record(statusCode) {
    const code = Number(statusCode) || 0;
    this.counts.set(code, (this.counts.get(code) || 0) + 1);
    this.total++;
  }

  summary() {
    const result = {};
    const sortedCodes = Array.from(this.counts.keys()).sort((a, b) => a - b);
    for (const code of sortedCodes) {
      const count = this.counts.get(code);
      const pct = this.total > 0 ? ((count / this.total) * 100).toFixed(1) : '0.0';
      result[code] = { count, percentage: `${pct}%` };
    }
    return result;
  }
}

/**
 * WebSocket metrics tracker
 */
export class WebSocketMetrics {
  constructor() {
    this.connecting = 0;
    this.connected = 0;
    this.failedConnect = 0;
    this.closedNormally = 0;
    this.closedAbnormally = 0;
    this.closeCodes = new Map();
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.audioFramesSent = 0;
    this.audioBytesSent = 0;
    this.transcriptsReceived = 0;
    this.handshakeLatency = new LatencyCollector('ms');
    this.firstTranscriptLatency = new LatencyCollector('ms');
    this.roundtripLatency = new LatencyCollector('ms');
  }

  recordConnect(durationMs) {
    this.connected++;
    this.handshakeLatency.record(durationMs);
  }

  recordConnectFailure() {
    this.failedConnect++;
  }

  recordClose(code) {
    const c = Number(code) || 1006;
    this.closeCodes.set(c, (this.closeCodes.get(c) || 0) + 1);
    if (c === 1000) {
      this.closedNormally++;
    } else {
      this.closedAbnormally++;
    }
  }

  summary() {
    return {
      connected: this.connected,
      failedConnect: this.failedConnect,
      closedNormally: this.closedNormally,
      closedAbnormally: this.closedAbnormally,
      closeCodes: Object.fromEntries(this.closeCodes),
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      audioFramesSent: this.audioFramesSent,
      audioBytesSent: this.audioBytesSent,
      transcriptsReceived: this.transcriptsReceived,
      handshake: this.handshakeLatency.summary(),
      firstTranscript: this.firstTranscriptLatency.summary(),
      roundtrip: this.roundtripLatency.summary(),
    };
  }
}

/**
 * Resource and Database Auditor
 */
export class ResourceAuditor {
  constructor(options = {}) {
    this.gatewayUrl = options.gatewayUrl || 'http://127.0.0.1:8787';
    this.dbUrl = options.dbUrl || process.env.DATABASE_URL || 'mysql://root:root960826@127.0.0.1:3306/rabbit-interview';
  }

  async fetchGatewayMetrics() {
    try {
      const res = await fetch(`${this.gatewayUrl}/metrics`);
      if (!res.ok) return null;
      const text = await res.text();
      const metrics = {};
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, val] = trimmed.split(/\s+/);
        if (key && val !== undefined) {
          metrics[key] = parseFloat(val);
        }
      }
      return metrics;
    } catch {
      return null;
    }
  }

  async fetchDatabaseSnapshot() {
    try {
      const parsedUrl = new URL(this.dbUrl);
      const user = decodeURIComponent(parsedUrl.username || 'root');
      const pass = decodeURIComponent(parsedUrl.password || '');
      const db = parsedUrl.pathname.replace(/^\//, '') || 'rabbit-interview';

      // Use docker exec mysql or direct mysql client
      const query = `
        SELECT state, count(*) as count FROM quota_reservations GROUP BY state;
        SELECT count(*) as total_usage_events FROM usage_events;
      `;

      const cmd = `docker exec -i -e MYSQL_PWD='${pass}' mysql mysql --batch --skip-column-names -u'${user}' '${db}' -e "${query.replace(/\n/g, ' ')}"`;
      const output = execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      
      const lines = output.trim().split('\n');
      const reservations = {};
      let totalUsageEvents = 0;

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length === 2 && isNaN(parts[0])) {
          reservations[parts[0]] = parseInt(parts[1], 10);
        } else if (parts.length === 1 && !isNaN(parts[0])) {
          totalUsageEvents = parseInt(parts[0], 10);
        }
      }

      return {
        available: true,
        reservations,
        totalUsageEvents,
      };
    } catch (err) {
      return {
        available: false,
        error: err.message,
      };
    }
  }

  async takeSnapshot() {
    const [gateway, db] = await Promise.all([
      this.fetchGatewayMetrics(),
      this.fetchDatabaseSnapshot(),
    ]);

    return {
      timestamp: Date.now(),
      gateway,
      db,
    };
  }

  diff(before, after) {
    const diffResult = {
      leakedPermits: 0,
      activeSttDelta: 0,
      activeLlmDelta: 0,
      reservationsDelta: {},
      usageEventsDelta: 0,
      clean: true,
    };

    if (before.gateway && after.gateway) {
      const beforeStt = (before.gateway.oncue_stt_active || 0) + (before.gateway.rabbit_stt_active || 0);
      const afterStt = (after.gateway.oncue_stt_active || 0) + (after.gateway.rabbit_stt_active || 0);
      const beforeLlm = (before.gateway.oncue_llm_active || 0) + (before.gateway.rabbit_llm_active || 0);
      const afterLlm = (after.gateway.oncue_llm_active || 0) + (after.gateway.rabbit_llm_active || 0);

      diffResult.activeSttDelta = afterStt - beforeStt;
      diffResult.activeLlmDelta = afterLlm - beforeLlm;

      if (diffResult.activeSttDelta !== 0 || diffResult.activeLlmDelta !== 0) {
        diffResult.clean = false;
        diffResult.leakedPermits = diffResult.activeSttDelta + diffResult.activeLlmDelta;
      }
    }

    if (before.db?.available && after.db?.available) {
      const states = new Set([
        ...Object.keys(before.db.reservations || {}),
        ...Object.keys(after.db.reservations || {}),
      ]);

      for (const s of states) {
        const b = before.db.reservations[s] || 0;
        const a = after.db.reservations[s] || 0;
        diffResult.reservationsDelta[s] = a - b;
      }

      // Check if uncompleted reservations (RESERVED/ACTIVE) increased
      const orphaned = (diffResult.reservationsDelta['RESERVED'] || 0) +
                        (diffResult.reservationsDelta['ACTIVE'] || 0);
      if (orphaned > 0) {
        diffResult.clean = false;
      }

      diffResult.usageEventsDelta = (after.db.totalUsageEvents || 0) - (before.db.totalUsageEvents || 0);
    }

    return diffResult;
  }
}

/**
 * Format helper for console tables
 */
export function formatTable(title, headers, rows) {
  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, String(row[i] ?? '').length), 0);
    return Math.max(h.length, maxRow);
  });

  const sep = '+' + colWidths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  const headerLine = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';

  const rowLines = rows.map((row) => {
    return '| ' + row.map((cell, i) => String(cell ?? '').padEnd(colWidths[i])).join(' | ') + ' |';
  });

  return [
    `\n=== ${title} ===`,
    sep,
    headerLine,
    sep,
    ...rowLines,
    sep,
  ].join('\n');
}

/**
 * Generate Markdown Report section
 */
export function generateMarkdown(title, headers, rows) {
  const headerLine = '| ' + headers.join(' | ') + ' |';
  const sepLine = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const rowLines = rows.map((r) => '| ' + r.map((c) => String(c ?? '')).join(' | ') + ' |');

  return [`### ${title}`, '', headerLine, sepLine, ...rowLines, ''].join('\n');
}
