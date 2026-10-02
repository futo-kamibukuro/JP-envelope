import { ENCODING_LABELS, type EncodingName } from '../core/charset';
import { FIELD_TYPE_ORDER, FIELD_TYPES, PRESETS, fieldDefFor, type PresetId } from '../core/layout';
import type { FieldType, Settings } from '../core/types';
import { paddedHeader, type LoadOptions } from './App';
import type { LoadData } from './client';
import { VisibleText } from './common';

interface Props {
  load: LoadData;
  opts: LoadOptions;
  onReload: (o: LoadOptions) => void;
  preset: PresetId;
  onPreset: (p: PresetId) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onNext: () => void;
}

export function MappingStep({ load, opts, onReload, preset, onPreset, settings, onSettings, onNext }: Props) {
  const header = paddedHeader(load);
  const info = load.info;

  function setType(i: number, type: FieldType) {
    const columns = settings.columns.slice();
    columns[i] = fieldDefFor(preset, type);
    onSettings({ ...settings, columns });
  }

  return (
    <section class="panel">
      <h2>読込結果の確認</h2>
      <div class="form-row">
        <label>
          文字コード
          <select
            value={opts.encoding ?? ''}
            onChange={(e) => onReload({ ...opts, encoding: ((e.target as HTMLSelectElement).value || null) as EncodingName | null })}
          >
            <option value="">自動判定（{ENCODING_LABELS[info.encodingDetected as EncodingName]}）</option>
            {(Object.keys(ENCODING_LABELS) as EncodingName[]).map((k) => (
              <option value={k}>{ENCODING_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label>
          区切り文字
          <select value={opts.delimiter ?? ''} onChange={(e) => onReload({ ...opts, delimiter: (e.target as HTMLSelectElement).value || null })}>
            <option value="">自動（{info.delimiter === '\t' ? 'タブ' : 'カンマ'}）</option>
            <option value=",">カンマ</option>
            <option value={'\t'}>タブ</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={opts.hasHeader} onChange={(e) => onReload({ ...opts, hasHeader: (e.target as HTMLInputElement).checked })} />
          1行目はヘッダ（列名）
        </label>
      </div>

      <div class="stats">
        <span>ファイル：<b>{info.name}</b></span>
        <span>データ行：<b>{load.rowCount.toLocaleString()}</b> 件</span>
        <span>列数：<b>{header.length}</b></span>
        {info.hasBom && <span>BOMあり</span>}
        {load.emptyLinesSkipped > 0 && <span>空行 {load.emptyLinesSkipped} 行は読み飛ばしました</span>}
      </div>
      {info.decodeErrors > 0 && (
        <div class="alert warn">
          {ENCODING_LABELS[info.encoding as EncodingName]} として読み込めないバイトが {info.decodeErrors} 箇所あります。文字コードの指定を変えて確認してください（F-01）。
        </div>
      )}
      {load.parseIssues > 0 && (
        <div class="alert warn">列数の不一致・クォート不備が {load.parseIssues} 件あります（F-02）。診断結果で該当行を確認できます。</div>
      )}

      <h2>列マッピング（項目定義）</h2>
      <div class="form-row">
        <label>
          プリセット
          <select value={preset} onChange={(e) => onPreset((e.target as HTMLSelectElement).value as PresetId)}>
            {Object.values(PRESETS).map((p) => (
              <option value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <span class="muted">{PRESETS[preset].description}</span>
      </div>
      <p class="muted">
        列名（ヘッダ）から標準種別を推定しています（データの値は推定に使いません）。違っている列は選び直してください。先頭30行を、読み込んだままの文字列で表示しています。
      </p>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="rownum">#</th>
              {header.map((h, i) => (
                <th key={i}>
                  <div class="colname" title={h}>
                    {h || <span class="muted">（空欄）</span>}
                  </div>
                  <select
                    class={settings.columns[i]?.type === 'other' ? 'unmapped' : ''}
                    value={settings.columns[i]?.type ?? 'other'}
                    onChange={(e) => setType(i, (e.target as HTMLSelectElement).value as FieldType)}
                  >
                    {FIELD_TYPE_ORDER.map((t) => (
                      <option value={t}>{FIELD_TYPES[t].label}</option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {load.preview.map((row, r) => (
              <tr key={r}>
                <td class="rownum">{r + 1}</td>
                {header.map((_, c) => (
                  <td key={c}>
                    <VisibleText value={row[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="actions">
        <button class="btn primary" onClick={onNext}>
          次へ：ルール設定
        </button>
      </div>
    </section>
  );
}
