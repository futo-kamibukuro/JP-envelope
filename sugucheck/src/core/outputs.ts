import { strToU8, zipSync } from 'fflate';
import { ENCODING_LABELS, encodeCp932, type EncodingName } from './charset';
import { toCsv } from './csv';
import type { DiagnoseExtras } from './engine';
import { DEDUPE_KEYS, FIELD_TYPES } from './layout';
import { FIX_LABELS, GROUP_LABELS, RULE_MAP, RULES, SEVERITY_LABELS } from './rules';
import type { DiagnoseResult, ErrorGroup, FileInfo, Finding, Settings } from './types';
import { buildXlsx, type Sheet, type SheetRow } from './xlsx';

export const TOOL_NAME = 'SuguCheck';
export const TOOL_VERSION = '0.1.0';

export interface ErrorListMeta {
  deadline: string;
  departments: Record<ErrorGroup, string>;
}

export interface ExportContext {
  info: FileInfo;
  settings: Settings;
  result: DiagnoseResult & DiagnoseExtras;
  lines: { start: number; end: number }[];
  meta: ErrorListMeta;
}

export const DEFAULT_DEPARTMENTS: Record<ErrorGroup, string> = {
  address: '営業',
  char: 'システム',
  dupe: '営業',
  format: 'システム',
};

export const JUDGMENTS = ['採用', '修正値', '除外', 'そのまま'];

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'list';
}

const rowId = (r: number) => (r < 0 ? '（ファイル全体）' : String(r + 1));
const lineOf = (ctx: ExportContext, r: number) => {
  if (r < 0) return '';
  const l = ctx.lines[r];
  if (!l) return '';
  return l.start === l.end ? String(l.start) : `${l.start}-${l.end}`;
};
const colLabel = (ctx: ExportContext, c: number) => (c < 0 ? '（行全体）' : ctx.result.header[c] ?? `列${c + 1}`);

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// 実行条件・サマリー

export function conditionRows(ctx: ExportContext): [string, string][] {
  const { info, settings, result } = ctx;
  const s = settings;
  const rows: [string, string][] = [
    ['ツール', `${TOOL_NAME} v${TOOL_VERSION}（ルールベース・生成AI不使用）`],
    ['実行日時', fmtDate(result.ranAt)],
    ['ファイル名', info.name],
    ['ファイルサイズ', `${info.size.toLocaleString()} バイト`],
    ['SHA-256', info.sha256],
    ['文字コード', `${ENCODING_LABELS[info.encoding as EncodingName] ?? info.encoding}（自動判定：${ENCODING_LABELS[info.encodingDetected as EncodingName] ?? info.encodingDetected}）${info.hasBom ? '・BOMあり' : ''}`],
    ['区切り文字', info.delimiter === '\t' ? 'タブ' : 'カンマ'],
    ['ヘッダ行', info.hasHeader ? 'あり' : 'なし'],
    ['項目定義', s.layoutName],
  ];
  result.header.forEach((h, i) => {
    const f = s.columns[i];
    if (!f) return;
    const parts = [FIELD_TYPES[f.type].label];
    if (f.type !== 'other') {
      parts.push(f.required ? '必須' : '任意');
      parts.push({ full: '全角', half: '半角', mixed: '混在可' }[f.width]);
      if (f.maxLength) parts.push(`最大${f.maxLength}文字`);
      if (f.fixedDigits) parts.push(`固定${f.fixedDigits}桁`);
      if (f.pattern) parts.push(`形式 ${f.pattern}`);
      if (f.allowed) parts.push(`許容値 ${f.allowed}`);
    }
    rows.push([`列${i + 1}「${h}」`, parts.join('／')]);
  });
  rows.push(
    ['住所の必須', s.requireAddress ? '住所列がすべて空欄ならエラー' : 'チェックしない'],
    ['郵便番号の形式', s.postalHyphen ? 'ハイフンあり（123-4567）' : 'ハイフンなし（1234567）'],
    ['重複キー（適用順）', s.dedupe.keys.map((k) => DEDUPE_KEYS[k].label).join(' → ') || '（なし：完全一致のみ）'],
    ['P6 ユーザー定義の列', s.dedupe.customColumns.map((i) => result.header[i]).join('＋') || '（未設定）'],
    ['重複の許容度', { strict: '厳格（金額の絡む通知向け）', standard: '標準', loose: '緩め（案内向け）' }[s.dedupe.tolerance]],
    ['代表レコードの選定', result.repNote],
    ['正規化オプション', [s.dedupe.kanjiNumerals ? '漢数字→算用数字' : '', s.dedupe.kanaVariants ? 'ヶ／ケ／が等の統一' : ''].filter(Boolean).join('、') || 'なし'],
    ['安全修正の無効化', s.disabledSafe.join('、') || 'なし（すべて適用）'],
    ['推定修正の一括適用', s.autoSuggest.join('、') || 'なし（提案のみ）'],
    ['個別に承認した提案', s.accepted.length ? `${s.accepted.length}件：${s.accepted.join(' ')}` : 'なし'],
    ['読めない文字の印', s.unreadableMarks || '（なし）'],
  );
  for (const sk of result.skippedBuckets) rows.push(['照合対象外', sk]);
  return rows;
}

export function summaryRows(ctx: ExportContext): [string, string][] {
  const sm = ctx.result.summary;
  return [
    ['総件数', sm.totalRows.toLocaleString()],
    ['エラー（E）未解決', sm.unresolved.E.toLocaleString()],
    ['警告（W）未解決', sm.unresolved.W.toLocaleString()],
    ['情報（I）', sm.unresolved.I.toLocaleString()],
    ['自動修正・承認済み修正', sm.fixed.toLocaleString()],
    ['修正案（未適用）', sm.proposed.toLocaleString()],
    ['エラーのある行', sm.rowsWithE.toLocaleString()],
    ['警告のある行', sm.rowsWithW.toLocaleString()],
    ['重複グループ数', sm.dupeGroups.toLocaleString()],
    ['除外候補件数', sm.excluded.toLocaleString()],
    ['要確認候補（組）', sm.candidatePairs.toLocaleString()],
    ['同一世帯（住所）', sm.households.toLocaleString()],
    ['発送可能見込み件数（E・W・除外候補を除く）', sm.shippable.toLocaleString()],
  ];
}

// ---------------------------------------------------------------------------
// クレンジング済みデータ

export const EXTRA_COLUMNS = ['行ID', 'チェック結果コード', '重複グループID', '除外候補フラグ', '除外理由', '要確認候補ID', '同一世帯ID', '修正有無'];

export function rowCodes(findings: Finding[], nrows: number): string[] {
  const sets: Set<string>[] = Array.from({ length: nrows }, () => new Set());
  for (const f of findings) if (f.row >= 0 && f.status !== 'fixed') sets[f.row].add(f.ruleId);
  return sets.map((s) => [...s].sort().join(';'));
}

export function cleansedTable(ctx: ExportContext): string[][] {
  const { result } = ctx;
  const codes = rowCodes(result.findings, result.cleaned.length);
  const out: string[][] = [[...result.header, ...EXTRA_COLUMNS]];
  result.cleaned.forEach((row, r) => {
    const m = result.rowMeta[r];
    out.push([
      ...row,
      String(r + 1),
      codes[r],
      m.groupId,
      m.excluded ? '1' : '',
      m.excludeRule,
      m.candidateIds.join(';'),
      m.householdId,
      m.modified ? '1' : '',
    ]);
  });
  return out;
}

export function fixLogTable(ctx: ExportContext): string[][] {
  const out = [['行ID', '元ファイル行', '列', '項目名', 'ルールID', 'ルール名', '区分', '修正前', '修正後']];
  for (const f of ctx.result.findings) {
    if (f.status !== 'fixed') continue;
    out.push([
      rowId(f.row), lineOf(ctx, f.row), f.col >= 0 ? String(f.col + 1) : '', colLabel(ctx, f.col), f.ruleId,
      RULE_MAP[f.ruleId].title, f.fixedBy === 'accepted' ? '推定（承認・一括適用）' : '安全（自動）', f.before ?? '', f.after ?? '',
    ]);
  }
  return out;
}

const pairRows = (rows: [string, string][]): SheetRow[] => rows.map(([k, v]) => ({ cells: [k, v], cellStyles: ['label', 'normal'] }));

export function cleansedXlsx(ctx: ExportContext): Uint8Array {
  const table = cleansedTable(ctx);
  const ncolData = ctx.result.header.length;
  const sheets: Sheet[] = [
    {
      name: 'データ',
      rows: table.map((cells, i) => ({ cells, style: i === 0 ? 'header' : undefined })),
      freezeRows: 1,
      autoFilterRow: 1,
      colWidths: table[0].map((_, i) => (i < ncolData ? 16 : 12)),
    },
    {
      name: '実行条件・サマリー',
      rows: [
        { cells: ['診断サマリー'], style: 'title' },
        ...pairRows(summaryRows(ctx)),
        { cells: [] },
        { cells: ['実行条件'], style: 'title' },
        ...pairRows(conditionRows(ctx)),
        { cells: [] },
        { cells: ['ご注意'], style: 'title' },
        ...noticeLines(ctx, false).map((l) => ({ cells: [l] })),
      ],
      colWidths: [34, 100],
    },
    {
      name: '修正ログ',
      rows: fixLogTable(ctx).map((cells, i) => ({ cells, style: i === 0 ? 'header' : undefined })),
      freezeRows: 1,
      autoFilterRow: 1,
      colWidths: [8, 10, 6, 14, 8, 22, 18, 30, 30],
    },
  ];
  return buildXlsx(sheets);
}

export interface CsvOutput {
  bytes: Uint8Array;
  unmappable: [string, number][];
}

export function cleansedCsv(ctx: ExportContext, enc: 'utf8bom' | 'cp932'): CsvOutput {
  const text = toCsv(cleansedTable(ctx));
  if (enc === 'utf8bom') {
    const body = strToU8(text);
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return { bytes: out, unmappable: [] };
  }
  const r = encodeCp932(text);
  return { bytes: r.bytes, unmappable: [...r.unmappable.entries()] };
}

export function fixLogCsv(ctx: ExportContext): Uint8Array {
  const body = strToU8(toCsv(fixLogTable(ctx)));
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

// ---------------------------------------------------------------------------
// エラーリスト（事象別）

export function nameAndAddress(ctx: ExportContext, r: number): { name: string; address: string; postal: string } {
  const { header, cleaned } = ctx.result;
  const cols = ctx.settings.columns;
  const row = cleaned[r] ?? [];
  const pick = (pred: (t: string) => boolean) => header.map((_, i) => (cols[i] && pred(cols[i].type) ? row[i] : '')).filter(Boolean);
  return {
    name: pick((t) => t === 'name' || t === 'name_last' || t === 'name_first').join(' '),
    address: pick((t) => FIELD_TYPES[t as keyof typeof FIELD_TYPES].address).join(' '),
    postal: pick((t) => t === 'postal').join(' '),
  };
}

function errorSheetHeader(ctx: ExportContext, group: ErrorGroup, how: string): SheetRow[] {
  return [
    { cells: [`エラーリスト ${GROUP_LABELS[group]}`], style: 'title' },
    { cells: ['回答期限', ctx.meta.deadline], cellStyles: ['label', 'input'] },
    { cells: ['担当部署', ctx.meta.departments[group]], cellStyles: ['label', 'input'] },
    { cells: ['対象ファイル', `${ctx.info.name}（${fmtDate(ctx.result.ranAt)} 診断）`], cellStyles: ['label', 'normal'] },
    { cells: ['記入方法', how], cellStyles: ['label', 'normal'] },
    { cells: [] },
  ];
}

const HEADER_ROW = 7;

export function errorListSheets(ctx: ExportContext): Sheet[] {
  const { result } = ctx;
  const how = '「判断」列で 採用（修正案を採用）／修正値（「修正値」列に正しい値を記入）／除外（発送しない）／そのまま を選んでください';
  const sheets: Sheet[] = [];
  for (const group of ['address', 'char', 'dupe', 'format'] as ErrorGroup[]) {
    if (group === 'dupe') {
      sheets.push(dupeSheet(ctx));
      continue;
    }
    const items = result.findings.filter((f) => f.status !== 'fixed' && f.severity !== 'I' && RULE_MAP[f.ruleId].group === group);
    const head = ['行ID', '元ファイル行', 'ルールID', '重大度', '該当項目', '現在の値', '問題内容', '推奨対応', '修正案', '判断', '修正値', '備考'];
    const rows: SheetRow[] = [...errorSheetHeader(ctx, group, how), { cells: head, style: 'header' }];
    for (const f of items) {
      rows.push({
        cells: [
          rowId(f.row), lineOf(ctx, f.row), f.ruleId, `${f.severity}（${SEVERITY_LABELS[f.severity]}）`, colLabel(ctx, f.col),
          f.before ?? '', `${RULE_MAP[f.ruleId].title}：${f.message}`, f.recommendation, f.status === 'proposed' ? f.after ?? '' : '', '', '', '',
        ],
        cellStyles: [, , , , , , , , , 'input', 'input', 'input'],
      });
    }
    sheets.push({
      name: GROUP_LABELS[group],
      rows,
      freezeRows: HEADER_ROW,
      autoFilterRow: HEADER_ROW,
      colWidths: [8, 10, 7, 10, 14, 28, 46, 34, 20, 10, 20, 20],
      validations: [{ col: 9, fromRow: HEADER_ROW + 1, toRow: HEADER_ROW + Math.max(items.length, 1), values: JUDGMENTS }],
    });
  }
  sheets.push(excludedSheet(ctx));
  return sheets;
}

function dupeSheet(ctx: ExportContext): Sheet {
  const { result } = ctx;
  const how = '同一人物か別人かを判断し、行ごとに 採用（発送する）／除外（発送しない）／そのまま を選んでください。自動では除外していません';
  const head = ['候補ID', '行ID', '元ファイル行', '相手の行ID', '理由', '氏名', '郵便番号', '住所', '判断', '修正値', '備考'];
  const rows: SheetRow[] = [...errorSheetHeader(ctx, 'dupe', how), { cells: head, style: 'header' }];
  for (const c of result.candidates) {
    for (const [x, y] of [[c.a, c.b], [c.b, c.a]]) {
      const na = nameAndAddress(ctx, x);
      rows.push({
        cells: [c.id, rowId(x), lineOf(ctx, x), rowId(y), c.reasons.join('／'), na.name, na.postal, na.address, '', '', ''],
        cellStyles: [, , , , , , , , 'input', 'input', 'input'],
      });
    }
  }
  const n = rows.length - HEADER_ROW;
  return {
    name: GROUP_LABELS.dupe,
    rows,
    freezeRows: HEADER_ROW,
    autoFilterRow: HEADER_ROW,
    colWidths: [9, 8, 10, 10, 40, 18, 10, 40, 10, 16, 20],
    validations: [{ col: 8, fromRow: HEADER_ROW + 1, toRow: HEADER_ROW + Math.max(n, 1), values: JUDGMENTS }],
  };
}

function excludedSheet(ctx: ExportContext): Sheet {
  const { result } = ctx;
  const rows: SheetRow[] = [
    { cells: ['除外候補（参考）'], style: 'title' },
    { cells: ['確定できる重複（完全一致・正規化後の一致）です。代表レコード以外に除外候補フラグを付けています。レコードは削除していません'] },
    { cells: [] },
    { cells: ['グループID', '行ID', '区分', 'ルールID', '氏名', '郵便番号', '住所', '判断', '備考'], style: 'header' },
  ];
  for (const g of result.groups) {
    for (const m of g.members) {
      const na = nameAndAddress(ctx, m);
      const rule = m === g.rep ? '' : result.rowMeta[m].excludeRule;
      rows.push({
        cells: [g.id, rowId(m), m === g.rep ? '代表' : '除外候補', rule, na.name, na.postal, na.address, '', ''],
        cellStyles: [, , , , , , , 'input', 'input'],
      });
    }
  }
  return { name: '除外候補（参考）', rows, freezeRows: 4, autoFilterRow: 4, colWidths: [10, 8, 10, 8, 18, 10, 40, 10, 20] };
}

export function errorListXlsx(ctx: ExportContext): Uint8Array {
  return buildXlsx(errorListSheets(ctx));
}

// ---------------------------------------------------------------------------
// 注意文・レポート

export function noticeLines(ctx: ExportContext, includeCp932: boolean, unmappable: [string, number][] = []): string[] {
  const lines = [
    `${TOOL_NAME} 出力ファイルについてのご注意`,
    '',
    '■ CSVファイルをExcelでダブルクリックして開かないでください',
    '  郵便番号・電話番号・コードの先頭0落ち、番地の日付化、長い数値の指数表記化などが再発します。',
    '  内容の確認はテキストエディタで行うか、xlsx版（全セルを文字列として保存）をご利用ください。',
    '  Excelで開く必要がある場合は「データ」→「テキストまたはCSVから」で、全列を「文字列」に指定して読み込んでください。',
    '',
    '■ CSVインジェクション対策',
    "  CSVでは = + - @ で始まる値の先頭に ' を付けています（電話番号など数字・記号のみの値は対象外）。",
    '',
    '■ 元の値の保持',
    '  自動修正・承認済み修正はすべて「修正ログ」に修正前・修正後・ルールIDを記録しています。',
    '  重複はレコードを削除せず、「除外候補フラグ」を付けています。',
  ];
  if (ctx.result.summary.candidatePairs > 0) {
    lines.push('', '■ 要確認候補', `  重複の可能性がある ${ctx.result.summary.candidatePairs} 組は自動で除外していません。エラーリスト「③重複候補」で判断してください。`);
  }
  if (includeCp932) {
    lines.push('', '■ Shift_JIS（CP932）版について');
    if (unmappable.length) {
      lines.push('  次の文字はCP932で表現できないため「?」に置き換えています。UTF-8版またはxlsx版を確認してください：');
      lines.push('  ' + unmappable.map(([ch, n]) => `${ch}（${n}箇所）`).join('、'));
    } else lines.push('  すべての文字をCP932で表現できました。');
  }
  return lines;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function reportHtml(ctx: ExportContext): string {
  const sm = ctx.result.summary;
  const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const ruleRows = RULES.map((r) => {
    const c = sm.byRule.find((x) => x.ruleId === r.id)!;
    if (!c.open && !c.proposed && !c.fixed) return '';
    return `<tr><td>${r.id}</td><td>${esc(r.title)}</td><td class="sev-${r.severity}">${r.severity}</td><td>${FIX_LABELS[r.fix]}</td><td>${r.source}</td><td class="n">${c.open + c.proposed}</td><td class="n">${c.proposed}</td><td class="n">${c.fixed}</td></tr>`;
  }).join('');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${esc(TOOL_NAME)} 診断レポート ${esc(ctx.info.name)}</title>
<style>
body{font-family:"Hiragino Sans","Yu Gothic",Meiryo,sans-serif;margin:32px;color:#1f2933;line-height:1.6}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;border-bottom:2px solid #2f5d8a;padding-bottom:4px;margin-top:32px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c9d2dc;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#eef2f7;width:30%}td.n{text-align:right}.cards{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.card{border:1px solid #c9d2dc;border-radius:8px;padding:10px 16px;min-width:140px}.card b{display:block;font-size:22px}
.sev-E{color:#b42318;font-weight:bold}.sev-W{color:#b54708;font-weight:bold}.sev-I{color:#475467}
.rules th{width:auto}.muted{color:#667085;font-size:12px}
@media print{body{margin:12mm}h2{break-after:avoid}}
</style></head><body>
<h1>${esc(TOOL_NAME)} 診断レポート</h1>
<div class="muted">${esc(ctx.info.name)} ／ ${esc(fmtDate(ctx.result.ranAt))} 実行</div>
<div class="cards">
<div class="card">総件数<b>${sm.totalRows.toLocaleString()}</b></div>
<div class="card">発送可能見込み<b>${sm.shippable.toLocaleString()}</b></div>
<div class="card">エラー（E）<b class="sev-E">${sm.unresolved.E.toLocaleString()}</b></div>
<div class="card">警告（W）<b class="sev-W">${sm.unresolved.W.toLocaleString()}</b></div>
<div class="card">除外候補<b>${sm.excluded.toLocaleString()}</b></div>
<div class="card">要確認候補<b>${sm.candidatePairs.toLocaleString()}組</b></div>
<div class="card">自動修正<b>${sm.fixed.toLocaleString()}</b></div>
</div>
<h2>サマリー</h2><table>${kv(summaryRows(ctx))}</table>
<h2>カテゴリ別・ルール別の件数</h2>
<table class="rules"><tr><th>ルールID</th><th>内容</th><th>重大度</th><th>自動修正</th><th>出典</th><th>未解決</th><th>うち修正案あり</th><th>修正済み</th></tr>${ruleRows || '<tr><td colspan="8">指摘はありません</td></tr>'}</table>
<p class="muted">重大度：E＝エラー（発送不可・破損疑い）／W＝警告（要確認）／I＝情報。自動修正：安全＝自動適用／推定＝提案のみ／不可＝修正しない。出典：講義＝アテナ社セミナー／追加＝実務上の追加提案。</p>
<h2>実行条件</h2><p class="muted">同じファイル・同じ条件で再実行すると同じ結果になります（実行条件JSONを読み込むと条件を再現できます）。</p>
<table>${kv(conditionRows(ctx))}</table>
</body></html>`;
}

export function conditionsJson(ctx: ExportContext): string {
  return JSON.stringify(
    {
      tool: `${TOOL_NAME} v${TOOL_VERSION}`,
      file: { name: ctx.info.name, size: ctx.info.size, sha256: ctx.info.sha256, encoding: ctx.info.encoding, delimiter: ctx.info.delimiter, hasHeader: ctx.info.hasHeader },
      header: ctx.result.header,
      settings: ctx.settings,
      ranAt: ctx.result.ranAt,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export type OutputKind = 'report' | 'cleansed-xlsx' | 'cleansed-csv-utf8' | 'cleansed-csv-cp932' | 'errorlist' | 'fixlog' | 'conditions' | 'zip';

export function buildOutput(ctx: ExportContext, kind: OutputKind): { files: OutputFile[]; unmappable?: [string, number][] } {
  const b = baseName(ctx.info.name);
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  switch (kind) {
    case 'report':
      return { files: [{ name: `${b}_診断レポート.html`, bytes: strToU8(reportHtml(ctx)), mime: 'text/html' }] };
    case 'cleansed-xlsx':
      return { files: [{ name: `${b}_クレンジング済み.xlsx`, bytes: cleansedXlsx(ctx), mime: XLSX }] };
    case 'cleansed-csv-utf8': {
      const r = cleansedCsv(ctx, 'utf8bom');
      return { files: [{ name: `${b}_クレンジング済み_UTF8.csv`, bytes: r.bytes, mime: 'text/csv' }] };
    }
    case 'cleansed-csv-cp932': {
      const r = cleansedCsv(ctx, 'cp932');
      return { files: [{ name: `${b}_クレンジング済み_SJIS.csv`, bytes: r.bytes, mime: 'text/csv' }], unmappable: r.unmappable };
    }
    case 'errorlist':
      return { files: [{ name: `${b}_エラーリスト.xlsx`, bytes: errorListXlsx(ctx), mime: XLSX }] };
    case 'fixlog':
      return { files: [{ name: `${b}_修正ログ.csv`, bytes: fixLogCsv(ctx), mime: 'text/csv' }] };
    case 'conditions':
      return { files: [{ name: `${b}_実行条件.json`, bytes: strToU8(conditionsJson(ctx)), mime: 'application/json' }] };
    case 'zip': {
      const cp = cleansedCsv(ctx, 'cp932');
      const entries: Record<string, Uint8Array> = {
        [`${b}_診断レポート.html`]: strToU8(reportHtml(ctx)),
        [`${b}_クレンジング済み.xlsx`]: cleansedXlsx(ctx),
        [`${b}_クレンジング済み_UTF8.csv`]: cleansedCsv(ctx, 'utf8bom').bytes,
        [`${b}_クレンジング済み_SJIS.csv`]: cp.bytes,
        [`${b}_エラーリスト.xlsx`]: errorListXlsx(ctx),
        [`${b}_修正ログ.csv`]: fixLogCsv(ctx),
        [`${b}_実行条件.json`]: strToU8(conditionsJson(ctx)),
        ['はじめにお読みください（注意）.txt']: strToU8(noticeLines(ctx, true, cp.unmappable).join('\r\n') + '\r\n'),
      };
      return { files: [{ name: `${b}_SuguCheck一式.zip`, bytes: zipSync(entries, { level: 6 }), mime: 'application/zip' }], unmappable: cp.unmappable };
    }
  }
}
