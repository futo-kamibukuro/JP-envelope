import type { EncodingName } from '../core/charset';
import type { ErrorListMeta, OutputFile, OutputKind } from '../core/outputs';
import type { CandidatePair, DupeGroup, FileInfo, Finding, RowMeta, Settings, Summary } from '../core/types';

export interface LoadData {
  info: FileInfo;
  header: string[];
  preview: string[][];
  rowCount: number;
  maxCols: number;
  parseIssues: number;
  emptyLinesSkipped: number;
}

export interface DiagnoseData {
  header: string[];
  findings: Finding[];
  rowMeta: RowMeta[];
  groups: DupeGroup[];
  candidates: CandidatePair[];
  summary: Summary;
  ranAt: string;
  repNote: string;
  skippedBuckets: string[];
  labels: Record<number, { name: string; address: string; postal: string }>;
}

export interface RowData {
  raw: string[];
  cleaned: string[];
  lines?: { start: number; end: number };
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (pct: number) => void };

export class WorkerClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, data, error, progress } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      if (progress !== undefined) {
        p.onProgress?.(progress);
        return;
      }
      this.pending.delete(id);
      if (ok) p.resolve(data);
      else p.reject(new Error(error));
    };
  }

  private call<T>(type: string, payload: unknown, transfer: Transferable[] = [], onProgress?: (pct: number) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, type, payload }, transfer);
    });
  }

  load(opts: { bytes?: ArrayBuffer; name?: string; encoding: EncodingName | null; delimiter: string | null; hasHeader: boolean }) {
    return this.call<LoadData>('load', opts, opts.bytes ? [opts.bytes] : []);
  }
  diagnose(settings: Settings, onProgress?: (pct: number) => void) {
    return this.call<DiagnoseData>('diagnose', { settings }, [], onProgress);
  }
  row(row: number) {
    return this.call<RowData>('row', { row });
  }
  export(kind: OutputKind, meta: ErrorListMeta) {
    return this.call<{ files: OutputFile[]; unmappable?: [string, number][] }>('export', { kind, meta });
  }
  clear() {
    return this.call<boolean>('clear', {});
  }
}

export function download(file: OutputFile) {
  const blob = new Blob([file.bytes as BlobPart], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
