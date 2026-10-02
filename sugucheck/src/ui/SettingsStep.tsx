import { useState } from 'preact/hooks';
import { DEDUPE_KEYS, FIELD_TYPE_ORDER, FIELD_TYPES } from '../core/layout';
import { RULE_MAP, SAFE_RULES, SUGGEST_RULES } from '../core/rules';
import type { CharWidth, DedupeKeyId, FieldDef, FieldType, RepRule, Settings, Tolerance } from '../core/types';
import { paddedHeader } from './App';
import type { LoadData } from './client';

interface Props {
  load: LoadData;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onRun: (s: Settings) => void;
}

const ALL_KEYS: DedupeKeyId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

export function SettingsStep({ load, settings, onSettings, onRun }: Props) {
  const header = paddedHeader(load);
  const s = settings;
  const [jsonMsg, setJsonMsg] = useState<string | null>(null);

  const setCol = (i: number, patch: Partial<FieldDef>) => {
    const columns = s.columns.slice();
    columns[i] = { ...columns[i], ...patch };
    onSettings({ ...s, columns });
  };
  const setDedupe = (patch: Partial<Settings['dedupe']>) => onSettings({ ...s, dedupe: { ...s.dedupe, ...patch } });
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const num = (v: string) => (v.trim() === '' || Number(v) <= 0 ? null : Math.floor(Number(v)));

  const moveKey = (k: DedupeKeyId, dir: -1 | 1) => {
    const keys = s.dedupe.keys.slice();
    const i = keys.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setDedupe({ keys });
  };
  const orderedKeys = [...s.dedupe.keys, ...ALL_KEYS.filter((k) => !s.dedupe.keys.includes(k))];

  async function importJson(file: File) {
    try {
      const j = JSON.parse(await file.text());
      const imported = j.settings as Settings;
      if (!imported || !Array.isArray(imported.columns)) throw new Error('実行条件JSONの形式ではありません');
      const sameHeader = JSON.stringify(j.header) === JSON.stringify(header);
      onSettings({ ...imported, columns: header.map((_, i) => imported.columns[i] ?? s.columns[i]) });
      setJsonMsg(sameHeader ? '実行条件を読み込みました。' : '実行条件を読み込みました（列名が異なるため、列の対応を確認してください）。');
    } catch (e) {
      setJsonMsg(`読み込めませんでした：${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <section class="panel">
      <div class="row space">
        <h2>項目定義（レイアウト）</h2>
        <label class="btn ghost small">
          実行条件JSONを読み込む
          <input type="file" accept=".json,application/json" hidden onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) importJson(f);
            (e.target as HTMLInputElement).value = '';
          }} />
        </label>
      </div>
      {jsonMsg && <div class="alert info">{jsonMsg}</div>}
      <p class="muted">診断はこの定義に従って行います。実行条件は結果に記録され、同じ条件で再現できます。</p>
      <div class="form-row">
        <label>
          項目定義名
          <input type="text" value={s.layoutName} onInput={(e) => onSettings({ ...s, layoutName: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <div class="table-wrap">
        <table class="grid defs">
          <thead>
            <tr>
              <th>列</th><th>列名</th><th>標準種別</th><th>必須</th><th>最大文字数</th><th>文字種</th><th>固定桁</th><th title="例：\d{3}-\d{4}">形式（正規表現）</th><th title="カンマ区切り。例：1,2">許容値（カンマ区切り）</th>
            </tr>
          </thead>
          <tbody>
            {header.map((h, i) => {
              const f = s.columns[i];
              const off = f.type === 'other';
              return (
                <tr key={i} class={off ? 'off' : ''}>
                  <td class="rownum">{i + 1}</td>
                  <td class="colname" title={h}>{h}</td>
                  <td>
                    <select value={f.type} onChange={(e) => setCol(i, { type: (e.target as HTMLSelectElement).value as FieldType })}>
                      {FIELD_TYPE_ORDER.map((t) => <option value={t}>{FIELD_TYPES[t].label}</option>)}
                    </select>
                  </td>
                  <td class="center"><input type="checkbox" disabled={off} checked={f.required} onChange={(e) => setCol(i, { required: (e.target as HTMLInputElement).checked })} /></td>
                  <td><input class="num" type="number" min="1" disabled={off} value={f.maxLength ?? ''} onInput={(e) => setCol(i, { maxLength: num((e.target as HTMLInputElement).value) })} /></td>
                  <td>
                    <select disabled={off} value={f.width} onChange={(e) => setCol(i, { width: (e.target as HTMLSelectElement).value as CharWidth })}>
                      <option value="mixed">混在可</option>
                      <option value="full">全角</option>
                      <option value="half">半角</option>
                    </select>
                  </td>
                  <td><input class="num" type="number" min="1" disabled={off} value={f.fixedDigits ?? ''} onInput={(e) => setCol(i, { fixedDigits: num((e.target as HTMLInputElement).value) })} /></td>
                  <td><input type="text" disabled={off} value={f.pattern} onInput={(e) => setCol(i, { pattern: (e.target as HTMLInputElement).value })} /></td>
                  <td><input type="text" disabled={off} value={f.allowed} onInput={(e) => setCol(i, { allowed: (e.target as HTMLInputElement).value })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="form-row">
        <label class="check">
          <input type="checkbox" checked={s.requireAddress} onChange={(e) => onSettings({ ...s, requireAddress: (e.target as HTMLInputElement).checked })} />
          住所列がすべて空欄の行をエラーにする（A-08）
        </label>
        <label class="check">
          <input type="checkbox" checked={s.postalHyphen} onChange={(e) => onSettings({ ...s, postalHyphen: (e.target as HTMLInputElement).checked })} />
          郵便番号をハイフン付き（123-4567）に統一する（A-01）
        </label>
        <label>
          読めない文字の印（C-05）
          <input type="text" class="short" value={s.unreadableMarks} onInput={(e) => onSettings({ ...s, unreadableMarks: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <p class="muted">固定桁：コード列の本来の桁数（例：管理番号が9桁なら 9）。桁数が足りない値を先頭0落ちの疑い（E-03）として検出します。</p>

      <h2>重複（名寄せ）</h2>
      <div class="cols2">
        <div>
          <h3>重複キー（上から順に多段適用）</h3>
          <ul class="keylist">
            {orderedKeys.map((k) => {
              const on = s.dedupe.keys.includes(k);
              return (
                <li key={k} class={on ? '' : 'off'}>
                  <label class="check">
                    <input type="checkbox" checked={on} onChange={(e) => {
                      const checked = (e.target as HTMLInputElement).checked;
                      setDedupe({ keys: checked ? [...s.dedupe.keys, k] : s.dedupe.keys.filter((x) => x !== k) });
                    }} />
                    {DEDUPE_KEYS[k].label}
                    {DEDUPE_KEYS[k].note && <span class="muted">（{DEDUPE_KEYS[k].note}）</span>}
                  </label>
                  {on && (
                    <span class="updown">
                      <button class="btn tiny" onClick={() => moveKey(k, -1)} aria-label="上へ">▲</button>
                      <button class="btn tiny" onClick={() => moveKey(k, 1)} aria-label="下へ">▼</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {s.dedupe.keys.includes('P6') && (
            <div class="p6">
              <div class="muted">P6 に使う列：</div>
              {header.map((h, i) => (
                <label class="check inline">
                  <input type="checkbox" checked={s.dedupe.customColumns.includes(i)} onChange={(e) => {
                    const on = (e.target as HTMLInputElement).checked;
                    setDedupe({ customColumns: on ? [...s.dedupe.customColumns, i].sort((a, b) => a - b) : s.dedupe.customColumns.filter((x) => x !== i) });
                  }} />
                  {h}
                </label>
              ))}
            </div>
          )}
          <p class="muted">完全一致（D-01）は常に検出します。キーが一致しても氏名・住所などが食い違う場合は除外せず、要確認候補（D-04）にします。</p>
        </div>
        <div>
          <h3>許容度（案件に合わせて選択）</h3>
          {([
            ['strict', '厳格（金額の絡む通知向け）', '近似氏名（2字違い）・同姓・カナ一致も要確認候補に回す'],
            ['standard', '標準', '同一住所で氏名1字違いを要確認候補に回す'],
            ['loose', '緩め（案内向け）', 'キーが一致すれば、住所・郵便番号の食い違いは同一人物とみなす（氏名の相違は常に要確認）'],
          ] as [Tolerance, string, string][]).map(([v, label, note]) => (
            <label class="radio">
              <input type="radio" name="tol" checked={s.dedupe.tolerance === v} onChange={() => setDedupe({ tolerance: v })} />
              <span><b>{label}</b><br /><span class="muted">{note}</span></span>
            </label>
          ))}
          <h3>代表レコードの選定（D-05）</h3>
          <select value={s.dedupe.rep} onChange={(e) => setDedupe({ rep: (e.target as HTMLSelectElement).value as RepRule })}>
            <option value="first">先頭（ファイル上で最初の行）</option>
            <option value="filled">入力項目数が多い行</option>
            <option value="latest">最新更新日の行（「更新日」列が必要）</option>
          </select>
          <h3>正規化オプション（D-02）</h3>
          <label class="check">
            <input type="checkbox" checked={s.dedupe.kanjiNumerals} onChange={(e) => setDedupe({ kanjiNumerals: (e.target as HTMLInputElement).checked })} />
            漢数字と算用数字を統一（一丁目→1丁目。誤変換の危険あり）
          </label>
          <label class="check">
            <input type="checkbox" checked={s.dedupe.kanaVariants} onChange={(e) => setDedupe({ kanaVariants: (e.target as HTMLInputElement).checked })} />
            ヶ／ケ／が、ノ／の を統一（霞ヶ関＝霞が関）
          </label>
          <p class="muted">全角半角・スペース・丁目／番地／号とハイフン・メールの大文字小文字は常に統一して比較します。</p>
        </div>
      </div>

      <h2>自動修正</h2>
      <div class="cols2">
        <div>
          <h3>安全（既定で自動適用・ログに記録）</h3>
          {SAFE_RULES.map((id) => (
            <label class="check">
              <input type="checkbox" checked={!s.disabledSafe.includes(id)} onChange={(e) => onSettings({ ...s, disabledSafe: toggle(s.disabledSafe, id, !(e.target as HTMLInputElement).checked) })} />
              {id} {RULE_MAP[id].title}
            </label>
          ))}
        </div>
        <div>
          <h3>推定（既定は提案のみ。ONにすると一括適用）</h3>
          {SUGGEST_RULES.map((id) => (
            <label class="check">
              <input type="checkbox" checked={s.autoSuggest.includes(id)} onChange={(e) => onSettings({ ...s, autoSuggest: toggle(s.autoSuggest, id, (e.target as HTMLInputElement).checked) })} />
              {id} {RULE_MAP[id].title}
            </label>
          ))}
          <p class="muted">診断結果の明細から、提案を1件ずつ選んで適用することもできます。日付化・文字化け・外字・判断が必要な重複は修正しません。</p>
        </div>
      </div>

      <div class="actions">
        <button class="btn primary big" onClick={() => onRun(s)}>
          診断を実行（{load.rowCount.toLocaleString()} 件）
        </button>
      </div>
    </section>
  );
}
