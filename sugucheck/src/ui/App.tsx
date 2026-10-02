import { useMemo, useState } from 'preact/hooks';
import type { EncodingName } from '../core/charset';
import { defaultSettings, type PresetId } from '../core/layout';
import type { Settings } from '../core/types';
import { WorkerClient, type DiagnoseData, type LoadData } from './client';
import { MappingStep } from './MappingStep';
import { ResultsStep } from './ResultsStep';
import { SettingsStep } from './SettingsStep';
import { UploadStep } from './UploadStep';

export type Step = 'upload' | 'mapping' | 'settings' | 'results';

export interface LoadOptions {
  encoding: EncodingName | null;
  delimiter: string | null;
  hasHeader: boolean;
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: '1. アップロード' },
  { id: 'mapping', label: '2. 読込結果・列マッピング' },
  { id: 'settings', label: '3. ルール設定' },
  { id: 'results', label: '4. 診断結果・ダウンロード' },
];

const MAX_SIZE = 200 * 1024 * 1024;

export function paddedHeader(load: LoadData): string[] {
  return Array.from({ length: load.maxCols }, (_, i) => load.header[i] ?? `（余剰列${i - load.header.length + 1}）`);
}

export function App() {
  const client = useMemo(() => new WorkerClient(), []);
  const [step, setStep] = useState<Step>('upload');
  const [load, setLoad] = useState<LoadData | null>(null);
  const [opts, setOpts] = useState<LoadOptions>({ encoding: null, delimiter: null, hasHeader: true });
  const [preset, setPreset] = useState<PresetId>('dm');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [result, setResult] = useState<DiagnoseData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    setProgress(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function openFile(file: File | { name: string; bytes: ArrayBuffer }) {
    const name = file.name;
    if (/\.xlsm$/i.test(name)) return setError('マクロ付きファイル（.xlsm）は受け付けません。');
    if (/\.(xlsx|xls)$/i.test(name)) return setError('Excelファイルは v0.2 で対応予定です。現在は CSV／TSV で保存してから読み込んでください。');
    if (!/\.(csv|tsv|txt)$/i.test(name)) return setError('CSV／TSV ファイル（.csv .tsv .txt）を選択してください。');
    const size = file instanceof File ? file.size : file.bytes.byteLength;
    if (size > MAX_SIZE) return setError(`ファイルサイズが上限（${MAX_SIZE / 1024 / 1024}MB）を超えています。`);
    if (size === 0) return setError('空のファイルです。');
    await guard('ファイルを読み込んでいます', async () => {
      const bytes = file instanceof File ? await file.arrayBuffer() : file.bytes;
      const fresh: LoadOptions = { encoding: null, delimiter: null, hasHeader: true };
      const data = await client.load({ bytes, name, ...fresh });
      setOpts(fresh);
      setLoad(data);
      setSettings(defaultSettings(paddedHeader(data), preset));
      setResult(null);
      setStep('mapping');
    });
  }

  async function reload(next: LoadOptions) {
    await guard('再読込しています', async () => {
      const data = await client.load(next);
      setOpts(next);
      const sameHeader = load && JSON.stringify(paddedHeader(load)) === JSON.stringify(paddedHeader(data));
      setLoad(data);
      if (!sameHeader || !settings) setSettings(defaultSettings(paddedHeader(data), preset));
      setResult(null);
    });
  }

  async function run(next: Settings) {
    setSettings(next);
    await guard('診断しています', async () => {
      const res = await client.diagnose(next, (p) => setProgress(p));
      setResult(res);
      setStep('results');
    });
  }

  async function clearAll() {
    await client.clear();
    setLoad(null);
    setSettings(null);
    setResult(null);
    setError(null);
    setStep('upload');
  }

  const enabled = (s: Step) =>
    s === 'upload' || (s === 'mapping' && !!load) || (s === 'settings' && !!load) || (s === 'results' && !!result);

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="logo">✓</span>
          <div>
            <h1>SuguCheck</h1>
            <div class="sub">DM発送用リストの事前診断・安全なクレンジング</div>
          </div>
        </div>
        <div class="privacy" title="アップロードしたファイルはこのブラウザの中だけで処理されます。サーバーや生成AIには送信しません。">
          🔒 ブラウザ内で処理・外部送信なし
        </div>
        {load && (
          <button class="btn ghost" onClick={clearAll} title="読み込んだデータと診断結果をメモリから消去します">
            データを消去
          </button>
        )}
      </header>

      <nav class="steps">
        {STEPS.map((s) => (
          <button key={s.id} class={`step ${step === s.id ? 'active' : ''}`} disabled={!enabled(s.id) || !!busy} onClick={() => setStep(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>

      {error && (
        <div class="alert error" role="alert">
          {error}
          <button class="close" onClick={() => setError(null)} aria-label="閉じる">×</button>
        </div>
      )}

      {busy && (
        <div class="busy" role="status">
          <div class="spinner" />
          <span>{busy}…{progress !== null ? ` ${progress}%` : ''}</span>
          {progress !== null && (
            <div class="progress">
              <div style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      <main class={busy ? 'dim' : ''}>
        {step === 'upload' && <UploadStep onFile={openFile} />}
        {step === 'mapping' && load && settings && (
          <MappingStep
            load={load}
            opts={opts}
            onReload={reload}
            preset={preset}
            onPreset={(p) => {
              setPreset(p);
              setSettings(defaultSettings(paddedHeader(load), p));
            }}
            settings={settings}
            onSettings={setSettings}
            onNext={() => setStep('settings')}
          />
        )}
        {step === 'settings' && load && settings && (
          <SettingsStep load={load} settings={settings} onSettings={setSettings} onRun={run} />
        )}
        {step === 'results' && load && settings && result && (
          <ResultsStep client={client} load={load} settings={settings} result={result} onRerun={run} onError={setError} />
        )}
      </main>

      <footer class="footer">
        SuguCheck v0.1（MVP）— ルールベースで判定し、すべての指摘にルールIDを付けています。機械が判断できないものは自動で決めず、エラーリストで人の判断に回します。
      </footer>
    </div>
  );
}
