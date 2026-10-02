import { useEffect, useMemo, useState } from 'preact/hooks';
import { proposalKey } from '../core/checks';
import { DEFAULT_DEPARTMENTS, type ErrorListMeta, type OutputKind } from '../core/outputs';
import { CATEGORY_LABELS, FIX_LABELS, GROUP_LABELS, RULE_MAP, RULES, SEVERITY_LABELS } from '../core/rules';
import type { ErrorGroup, Finding, Settings } from '../core/types';
import { download, type DiagnoseData, type LoadData, type RowData, type WorkerClient } from './client';
import { Card, Sev, VisibleText } from './common';

interface Props {
  client: WorkerClient;
  load: LoadData;
  settings: Settings;
  result: DiagnoseData;
  onRerun: (s: Settings) => void;
  onError: (msg: string) => void;
}

type Tab = 'summary' | 'details' | 'dupes' | 'download';
type StatusFilter = 'unresolved' | 'proposed' | 'fixed' | 'all';

const PAGE = 100;

export function ResultsStep({ client, load, settings, result, onRerun, onError }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [sev, setSev] = useState('');
  const [rule, setRule] = useState('');
  const [status, setStatus] = useState<StatusFilter>('unresolved');
  const [q, setQ] = useState('');
  const [rowFilter, setRowFilter] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowView, setRowView] = useState<number | null>(null);

  useEffect(() => setSelected(new Set()), [result]);
  useEffect(() => setPage(0), [sev, rule, status, q, rowFilter]);

  const sm = result.summary;
  const header = result.header;
  const accepted = useMemo(() => new Set(settings.accepted), [settings.accepted]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return result.findings.filter((f) => {
      if (sev && f.severity !== sev) return false;
      if (rule && (rule.length === 1 ? !f.ruleId.startsWith(rule) : f.ruleId !== rule)) return false;
      if (status === 'unresolved' && f.status === 'fixed') return false;
      if (status === 'proposed' && f.status !== 'proposed') return false;
      if (status === 'fixed' && f.status !== 'fixed') return false;
      if (rowFilter !== null && f.row !== rowFilter) return false;
      if (ql && !`${f.message} ${f.before ?? ''} ${f.after ?? ''}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [result, sev, rule, status, q, rowFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const showRule = (id: string, st: StatusFilter = 'all') => {
    setRule(id);
    setSev('');
    setStatus(st);
    setRowFilter(null);
    setQ('');
    setTab('details');
  };

  const applySelected = () => onRerun({ ...settings, accepted: [...new Set([...settings.accepted, ...selected])] });
  const revoke = (f: Finding) => onRerun({ ...settings, accepted: settings.accepted.filter((k) => k !== proposalKey(f.row, f.col, f.ruleId)) });

  const colName = (c: number) => (c < 0 ? '—' : header[c] ?? `列${c + 1}`);
  const rowLink = (r: number) =>
    r < 0 ? <span class="muted">ファイル全体</span> : <button class="link" onClick={() => setRowView(r)}>{r + 1}</button>;

  return (
    <section class="panel">
      <div class="cards">
        <Card label="総件数" value={sm.totalRows} />
        <Card label="発送可能見込み" value={sm.shippable} tone="ok" sub="E・W・除外候補を除く" />
        <Card label="エラー（E）" value={sm.unresolved.E} tone="err" sub={`${sm.rowsWithE.toLocaleString()} 行`} />
        <Card label="警告（W）" value={sm.unresolved.W} tone="warn" sub={`${sm.rowsWithW.toLocaleString()} 行`} />
        <Card label="除外候補" value={sm.excluded} sub={`重複 ${sm.dupeGroups.toLocaleString()} グループ`} />
        <Card label="要確認候補" value={`${sm.candidatePairs.toLocaleString()} 組`} tone={sm.candidatePairs ? 'warn' : ''} />
        <Card label="自動修正済み" value={sm.fixed} sub={`修正案 ${sm.proposed.toLocaleString()} 件`} />
      </div>

      <nav class="tabs">
        {([['summary', 'サマリー'], ['details', `明細（${result.findings.length.toLocaleString()}）`], ['dupes', '重複'], ['download', 'ダウンロード']] as [Tab, string][]).map(([id, label]) => (
          <button class={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === 'summary' && (
        <div>
          {sm.skippedKeyBuckets.map((s) => <div class="alert warn">{s}</div>)}
          <table class="grid rules">
            <thead>
              <tr><th>ルールID</th><th>内容</th><th>重大度</th><th>自動修正</th><th>出典</th><th class="n">未解決</th><th class="n">修正案あり</th><th class="n">修正済み</th></tr>
            </thead>
            <tbody>
              {Object.keys(CATEGORY_LABELS).map((cat) => {
                const rows = RULES.filter((r) => r.id.startsWith(cat));
                return [
                  <tr class="cat"><td colSpan={8}><button class="link" onClick={() => showRule(cat, 'unresolved')}>{cat}：{CATEGORY_LABELS[cat]}</button></td></tr>,
                  ...rows.map((r) => {
                    const c = sm.byRule.find((x) => x.ruleId === r.id)!;
                    const total = c.open + c.proposed + c.fixed;
                    return (
                      <tr class={total ? '' : 'zero'}>
                        <td><button class="link" onClick={() => showRule(r.id)}>{r.id}</button></td>
                        <td>{r.title}</td>
                        <td><Sev s={r.severity} /></td>
                        <td>{FIX_LABELS[r.fix]}</td>
                        <td>{r.source}</td>
                        <td class="n">{(c.open + c.proposed).toLocaleString()}</td>
                        <td class="n">{c.proposed ? <button class="link" onClick={() => showRule(r.id, 'proposed')}>{c.proposed.toLocaleString()}</button> : 0}</td>
                        <td class="n">{c.fixed ? <button class="link" onClick={() => showRule(r.id, 'fixed')}>{c.fixed.toLocaleString()}</button> : 0}</td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
          <p class="muted">
            重大度：E＝エラー（発送不可・破損疑い）／W＝警告（要確認）／I＝情報。自動修正：安全＝自動適用／推定＝提案のみ／不可＝修正しない。代表レコード：{result.repNote}。
          </p>
        </div>
      )}

      {tab === 'details' && (
        <div>
          <div class="filters">
            <select value={sev} onChange={(e) => setSev((e.target as HTMLSelectElement).value)}>
              <option value="">重大度：すべて</option>
              {(['E', 'W', 'I'] as const).map((s) => <option value={s}>{s}（{SEVERITY_LABELS[s]}）</option>)}
            </select>
            <select value={rule} onChange={(e) => setRule((e.target as HTMLSelectElement).value)}>
              <option value="">ルール：すべて</option>
              {Object.keys(CATEGORY_LABELS).map((c) => <option value={c}>{c}：{CATEGORY_LABELS[c]}（カテゴリ）</option>)}
              {RULES.map((r) => <option value={r.id}>{r.id} {r.title}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as StatusFilter)}>
              <option value="unresolved">未解決（修正案あり含む）</option>
              <option value="proposed">修正案あり（未適用）</option>
              <option value="fixed">修正済み（修正ログ）</option>
              <option value="all">すべて</option>
            </select>
            <input type="search" placeholder="値・内容で検索" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <input
              type="number"
              min="1"
              class="short"
              placeholder="行ID"
              value={rowFilter === null ? '' : rowFilter + 1}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setRowFilter(v === '' ? null : Number(v) - 1);
              }}
            />
            {rowFilter !== null && rowFilter >= 0 && rowFilter < sm.totalRows && (
              <button class="btn small" onClick={() => setRowView(rowFilter)}>行 {rowFilter + 1} を表示</button>
            )}
          </div>

          <div class="row space">
            <span class="muted">{filtered.length.toLocaleString()} 件</span>
            <div class="row gap">
              <button
                class="btn small"
                onClick={() => setSelected(new Set([...selected, ...filtered.filter((f) => f.status === 'proposed').map((f) => proposalKey(f.row, f.col, f.ruleId))]))}
              >
                絞り込み中の修正案をすべて選択
              </button>
              {selected.size > 0 && <button class="btn small ghost" onClick={() => setSelected(new Set())}>選択解除</button>}
              <button class="btn small primary" disabled={!selected.size} onClick={applySelected}>
                選択した修正案を適用して再診断（{selected.size}）
              </button>
            </div>
          </div>

          <div class="table-wrap tall">
            <table class="grid findings">
              <thead>
                <tr><th></th><th>行ID</th><th>項目</th><th>ルール</th><th>重大度</th><th>内容</th><th>現在の値／修正前</th><th>修正案／修正後</th><th>状態</th></tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const key = proposalKey(f.row, f.col, f.ruleId);
                  return (
                    <tr class={`st-${f.status}`}>
                      <td>
                        {f.status === 'proposed' && (
                          <input type="checkbox" checked={selected.has(key)} onChange={(e) => {
                            const next = new Set(selected);
                            if ((e.target as HTMLInputElement).checked) next.add(key);
                            else next.delete(key);
                            setSelected(next);
                          }} />
                        )}
                      </td>
                      <td>{rowLink(f.row)}</td>
                      <td>{colName(f.col)}</td>
                      <td title={RULE_MAP[f.ruleId].title}>{f.ruleId}</td>
                      <td><Sev s={f.severity} /></td>
                      <td class="msg">
                        {f.message}
                        {f.relatedRows?.map((r) => <> <button class="link" onClick={() => setRowView(r)}>→行{r + 1}</button></>)}
                        <div class="muted">{f.recommendation}</div>
                      </td>
                      <td>{f.before !== undefined && <VisibleText value={f.before} max={40} />}</td>
                      <td>{f.after !== undefined && <VisibleText value={f.after} max={40} />}</td>
                      <td class="nowrap">
                        {f.status === 'fixed' ? (f.fixedBy === 'accepted' ? '承認済み' : '自動修正') : f.status === 'proposed' ? '修正案あり' : '未解決'}
                        {f.status === 'fixed' && f.fixedBy === 'accepted' && accepted.has(key) && (
                          <button class="btn tiny ghost" onClick={() => revoke(f)}>取消</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={9} class="muted center">該当する指摘はありません</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div class="pager">
              <button class="btn small" disabled={page === 0} onClick={() => setPage(0)}>«</button>
              <button class="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
              <span>{page + 1} / {pages}</span>
              <button class="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
              <button class="btn small" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
            </div>
          )}
        </div>
      )}

      {tab === 'dupes' && <DupesTab result={result} onRow={setRowView} />}

      {tab === 'download' && <DownloadTab client={client} result={result} onError={onError} />}

      {rowView !== null && (
        <RowDialog client={client} row={rowView} header={header} result={result} onClose={() => setRowView(null)} onRow={setRowView} />
      )}
      <div class="muted small-note">対象：{load.info.name}（{load.rowCount.toLocaleString()} 件）</div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function DupesTab({ result, onRow }: { result: DiagnoseData; onRow: (r: number) => void }) {
  const L = result.labels;
  const link = (r: number) => <button class="link" onClick={() => onRow(r)}>{r + 1}</button>;
  return (
    <div>
      <h3>要確認候補（D-04）— 自動では除外しません</h3>
      <table class="grid">
        <thead><tr><th>候補ID</th><th>行ID</th><th>氏名</th><th>住所</th><th>相手の行ID</th><th>相手の氏名</th><th>相手の住所</th><th>理由</th></tr></thead>
        <tbody>
          {result.candidates.map((c) => (
            <tr>
              <td>{c.id}</td><td>{link(c.a)}</td><td>{L[c.a]?.name}</td><td>{L[c.a]?.address}</td>
              <td>{link(c.b)}</td><td>{L[c.b]?.name}</td><td>{L[c.b]?.address}</td><td>{c.reasons.join('／')}</td>
            </tr>
          ))}
          {!result.candidates.length && <tr><td colSpan={8} class="muted center">要確認候補はありません</td></tr>}
        </tbody>
      </table>

      <h3>重複グループ（D-01 完全一致／D-02 正規化後の一致）</h3>
      <table class="grid">
        <thead><tr><th>グループID</th><th>行ID</th><th>区分</th><th>氏名</th><th>郵便番号</th><th>住所</th></tr></thead>
        <tbody>
          {result.groups.flatMap((g) =>
            g.members.map((m, i) => (
              <tr class={i === 0 ? 'group-first' : ''}>
                <td>{i === 0 ? g.id : ''}</td>
                <td>{link(m)}</td>
                <td>{m === g.rep ? <b>代表</b> : `除外候補（${result.rowMeta[m].excludeRule}）`}</td>
                <td>{L[m]?.name}</td><td>{L[m]?.postal}</td><td>{L[m]?.address}</td>
              </tr>
            )),
          )}
          {!result.groups.length && <tr><td colSpan={6} class="muted center">重複はありません</td></tr>}
        </tbody>
      </table>
      <p class="muted">同一世帯（同じ住所に別の氏名）：{result.summary.households.toLocaleString()} 件の住所。重複ではないため除外しません（クレンジング済みデータの「同一世帯ID」列）。</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DownloadTab({ client, result, onError }: { client: WorkerClient; result: DiagnoseData; onError: (m: string) => void }) {
  const [deadline, setDeadline] = useState('');
  const [depts, setDepts] = useState<Record<ErrorGroup, string>>({ ...DEFAULT_DEPARTMENTS });
  const [busy, setBusy] = useState<OutputKind | null>(null);
  const [unmappable, setUnmappable] = useState<[string, number][] | null>(null);

  async function get(kind: OutputKind) {
    setBusy(kind);
    try {
      const meta: ErrorListMeta = { deadline, departments: depts };
      const out = await client.export(kind, meta);
      if (out.unmappable) setUnmappable(out.unmappable);
      out.files.forEach(download);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const items: [OutputKind, string, string][] = [
    ['zip', '一式（zip）', 'レポート・クレンジング済みデータ（xlsx／CSV 2種）・エラーリスト・修正ログ・実行条件・注意文'],
    ['report', '診断レポート（HTML）', 'ブラウザで開いて印刷するとPDFにできます'],
    ['cleansed-xlsx', 'クレンジング済みデータ（xlsx）', '全セル文字列。実行条件・修正ログのシート付き。Excelで開いても先頭0が保たれます'],
    ['cleansed-csv-utf8', 'クレンジング済みデータ（CSV・UTF-8 BOM付き）', ''],
    ['cleansed-csv-cp932', 'クレンジング済みデータ（CSV・Shift_JIS／CP932）', 'CP932で表現できない文字は「?」になります'],
    ['errorlist', 'エラーリスト（xlsx・事象別シート）', '判断欄（採用／修正値／除外／そのまま）付き。クライアントへ戻す用'],
    ['fixlog', '修正ログ（CSV）', '自動修正・承認済み修正の修正前／修正後／ルールID'],
    ['conditions', '実行条件（JSON）', '「ルール設定」で読み込むと同じ条件で再実行できます'],
  ];

  return (
    <div>
      <h3>エラーリストのヘッダ</h3>
      <div class="form-row">
        <label>
          回答期限
          <input type="date" value={deadline} onInput={(e) => setDeadline((e.target as HTMLInputElement).value)} />
        </label>
        {(Object.keys(GROUP_LABELS) as ErrorGroup[]).map((g) => (
          <label>
            {GROUP_LABELS[g]} 担当部署
            <input type="text" class="short" value={depts[g]} onInput={(e) => setDepts({ ...depts, [g]: (e.target as HTMLInputElement).value })} />
          </label>
        ))}
      </div>
      <div class="alert warn">
        CSVをExcelでダブルクリックして開くと、先頭0落ち・日付化などが再発します。確認はテキストエディタで行うか、xlsx版をご利用ください（一式zipには注意文を同梱しています）。
      </div>
      <ul class="downloads">
        {items.map(([kind, label, note]) => (
          <li>
            <button class={`btn ${kind === 'zip' ? 'primary' : ''}`} disabled={!!busy} onClick={() => get(kind)}>
              {busy === kind ? '作成中…' : label}
            </button>
            <span class="muted">{note}</span>
          </li>
        ))}
      </ul>
      {unmappable && unmappable.length > 0 && (
        <div class="alert warn">
          Shift_JIS（CP932）で表現できず「?」に置き換えた文字：{unmappable.map(([c, n]) => `${c}（${n}）`).join('、')}
        </div>
      )}
      <p class="muted">実行日時：{new Date(result.ranAt).toLocaleString('ja-JP')}。ダウンロードしたファイルの保管・削除は、契約・社内規程に従ってください。</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RowDialog({ client, row, header, result, onClose, onRow }: {
  client: WorkerClient; row: number; header: string[]; result: DiagnoseData; onClose: () => void; onRow: (r: number) => void;
}) {
  const [data, setData] = useState<RowData | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    client.row(row).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [row]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const meta = result.rowMeta[row];
  const fs = result.findings.filter((f) => f.row === row);
  return (
    <div class="modal-back" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div class="row space">
          <h3>行ID {row + 1}{data?.lines ? `（元ファイル ${data.lines.start === data.lines.end ? data.lines.start : `${data.lines.start}〜${data.lines.end}`} 行目）` : ''}</h3>
          <button class="close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        {meta && (
          <div class="stats">
            {meta.groupId && <span>重複グループ：<b>{meta.groupId}</b></span>}
            {meta.excluded && <span class="tag warn">除外候補（{meta.excludeRule}）</span>}
            {meta.candidateIds.length > 0 && <span class="tag warn">要確認：{meta.candidateIds.join('、')}</span>}
            {meta.householdId && <span>同一世帯：{meta.householdId}</span>}
            {meta.modified && <span class="tag">修正あり</span>}
          </div>
        )}
        {!data ? (
          <div class="muted">読み込み中…</div>
        ) : (
          <table class="grid">
            <thead><tr><th>項目</th><th>元の値</th><th>クレンジング後</th><th>指摘</th></tr></thead>
            <tbody>
              {header.map((h, c) => {
                const changed = (data.raw[c] ?? '') !== (data.cleaned[c] ?? '');
                const cf = fs.filter((f) => f.col === c);
                return (
                  <tr class={changed ? 'changed' : ''}>
                    <td class="colname">{h}</td>
                    <td><VisibleText value={data.raw[c]} max={200} /></td>
                    <td><VisibleText value={data.cleaned[c]} max={200} /></td>
                    <td>{cf.map((f) => <div><Sev s={f.severity} /> {f.ruleId}{f.status === 'fixed' ? '（修正済み）' : f.status === 'proposed' ? '（修正案あり）' : ''}</div>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {fs.filter((f) => f.col < 0).map((f) => (
          <div class="rowfinding">
            <Sev s={f.severity} /> {f.ruleId} {f.message}
            {f.relatedRows?.map((r) => <> <button class="link" onClick={() => onRow(r)}>→行{r + 1}</button></>)}
          </div>
        ))}
      </div>
    </div>
  );
}
