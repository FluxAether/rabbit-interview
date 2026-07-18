// Pure helpers for selecting recording data + rate, used by Stealth Copilot export.
// The bridge logic for falling back to master (floating-started data) lives here.
// Tests drive these real shipped functions with simulated floating master state.

import { chunksToWavBuffer } from './wav';

export interface MasterRecording {
  chunks?: { current: number[][] };
  sampleRate?: { current: number };
}

export function selectDataAndRateForExport(
  recordedChunks: number[][],
  recordedChunksRef: { current: number[][] },
  sampleRateRef: { current: number },
  master: MasterRecording | null | undefined
): { data: number[][]; sampleRate: number; usedMaster: boolean } {
  let data = recordedChunks.length > 0 ? recordedChunks : recordedChunksRef.current;
  let usedMaster = false;
  if ((!data || data.length === 0) && master?.chunks?.current?.length) {
    data = master.chunks.current;
    usedMaster = true;
  }
  const sampleRate = (usedMaster && master?.sampleRate?.current)
    ? master.sampleRate.current
    : (sampleRateRef.current || 16000);
  return { data, sampleRate, usedMaster };
}

// Pure exported computation for exportRecording observable.
// Performs exactly the select + chunksToWavBuffer steps.
// exportRecording will call this then do only side-effects (alert + download).
export function buildExportWav(
  recordedChunks: number[][],
  recordedChunksRef: { current: number[][] },
  sampleRateRef: { current: number },
  master: MasterRecording | null | undefined
): { buffer: ArrayBuffer | null; sampleRate: number; usedMaster: boolean } {
  const sel = selectDataAndRateForExport(recordedChunks, recordedChunksRef, sampleRateRef, master);
  if (!sel.data || sel.data.length === 0) {
    return { buffer: null, sampleRate: sel.sampleRate, usedMaster: sel.usedMaster };
  }
  const buffer = chunksToWavBuffer(sel.data, sel.sampleRate);
  return { buffer, sampleRate: sel.sampleRate, usedMaster: sel.usedMaster };
}
