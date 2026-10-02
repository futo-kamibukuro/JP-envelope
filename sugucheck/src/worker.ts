/// <reference lib="webworker" />
/**
 * 診断処理はすべてこの Web Worker 内（＝利用者のブラウザ内）で行う。
 * 顧客データをサーバーや外部サービスへ送信する処理は一切ない。
 */
import { decodeBytes, type EncodingName } from './core/charset';
import { detectDelimiter, parseTable } from './core/csv';
import { diagnose, type DiagnoseExtras } from './core/engine';
import { buildOutput, DEFAULT_DEPARTMENTS, type ErrorListMeta, type ExportContext, type OutputKind, nameAndAddress } from './core/outputs';
import type { DiagnoseResult, FileInfo, ParsedTable, Settings } from './core/types';

interface State {
  bytes?: Uint8Array;
  name?: string;
  sha256?: string;
  table?: ParsedTable;
  info?: FileInfo;
  settings?: Settings;
  result?: DiagnoseResult & DiagnoseExtras;
}

let state: State = {};

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function ctx(meta?: ErrorListMeta): ExportContext {
  if (!state.result || !state.info || !state.settings || !state.table) throw new Error('診断結果がありません');
  return {
    info: state.info,
    settings: state.settings,
    result: state.result,
    lines: state.table.lines,
    meta: meta ?? { deadline: '', departments: DEFAULT_DEPARTMENTS },
  };
}

const handlers: Record<string, (p: any, progress: (pct: number) => void) => Promise<{ data: unknown; transfer?: Transferable[] }>> = {
  async load(p: { bytes?: ArrayBuffer; name?: string; encoding: EncodingName | null; delimiter: string | null; hasHeader: boolean }) {
    if (p.bytes) {
      state = { bytes: new Uint8Array(p.bytes), name: p.name };
      state.sha256 = await sha256(state.bytes!);
    }
    if (!state.bytes) throw new Error('ファイルが読み込まれていません');
    const dec = decodeBytes(state.bytes, p.encoding);
    const delimiter = p.delimiter ?? detectDelimiter(dec.text, state.name);
    const table = parseTable(dec.text, delimiter, p.hasHeader);
    state.table = table;
    state.result = undefined;
    state.info = {
      name: state.name ?? '',
      size: state.bytes.length,
      sha256: state.sha256 ?? '',
      encoding: dec.encoding,
      encodingDetected: dec.detected,
      decodeErrors: dec.errors,
      hasBom: dec.hasBom,
      delimiter,
      hasHeader: p.hasHeader,
    };
    return {
      data: {
        info: state.info,
        header: table.header,
        preview: table.rows.slice(0, 30),
        rowCount: table.rows.length,
        maxCols: table.rows.reduce((m, r) => Math.max(m, r.length), table.header.length),
        parseIssues: table.issues.length,
        emptyLinesSkipped: table.emptyLinesSkipped,
      },
    };
  },

  async diagnose(p: { settings: Settings }, progress) {
    if (!state.table || !state.info) throw new Error('ファイルが読み込まれていません');
    state.settings = p.settings;
    const result = diagnose(state.table, state.info, p.settings, progress);
    state.result = result;
    // 重複関連の行だけ、画面表示用に氏名・住所を添える
    const involved = new Set<number>();
    for (const g of result.groups) g.members.forEach((m) => involved.add(m));
    for (const c of result.candidates) involved.add(c.a).add(c.b);
    const c = ctx();
    const labels: Record<number, { name: string; address: string; postal: string }> = {};
    for (const r of involved) labels[r] = nameAndAddress(c, r);
    return {
      data: {
        header: result.header,
        findings: result.findings,
        rowMeta: result.rowMeta,
        groups: result.groups,
        candidates: result.candidates,
        summary: result.summary,
        ranAt: result.ranAt,
        repNote: result.repNote,
        skippedBuckets: result.skippedBuckets,
        labels,
      },
    };
  },

  async row(p: { row: number }) {
    if (!state.table || !state.result) throw new Error('診断結果がありません');
    return {
      data: {
        raw: state.table.rows[p.row] ?? [],
        cleaned: state.result.cleaned[p.row] ?? [],
        lines: state.table.lines[p.row],
      },
    };
  },

  async export(p: { kind: OutputKind; meta: ErrorListMeta }) {
    const out = buildOutput(ctx(p.meta), p.kind);
    return { data: out, transfer: out.files.map((f) => f.bytes.buffer as ArrayBuffer) };
  },

  async clear() {
    state = {};
    return { data: true };
  },
};

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data as { id: number; type: string; payload: unknown };
  try {
    const h = handlers[type];
    if (!h) throw new Error(`unknown request: ${type}`);
    const { data, transfer } = await h(payload, (pct) => post({ id, progress: pct }));
    post({ id, ok: true, data }, transfer ?? []);
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
