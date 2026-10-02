import { processCell, type CheckContext, type ColumnPlan } from './checks';
import { dedupe } from './dedupe';
import { FIELD_TYPES } from './layout';
import { RULE_MAP, RULES } from './rules';
import type { DiagnoseResult, FieldDef, FileInfo, Finding, ParsedTable, RowMeta, RuleCount, Settings, Summary } from './types';

const OTHER: FieldDef = { type: 'other', required: false, maxLength: null, width: 'mixed', pattern: '', allowed: '', fixedDigits: null };

function fileFinding(ruleId: string, message: string, col = -1): Finding {
  const rule = RULE_MAP[ruleId];
  return { row: -1, col, ruleId, severity: rule.severity, message, recommendation: rule.recommendation, status: 'open' };
}

export interface DiagnoseExtras {
  repNote: string;
  skippedBuckets: string[];
}

/** 診断を実行する。同じ入力・同じ設定なら常に同じ結果を返す（実行日時を除く） */
export function diagnose(
  table: ParsedTable,
  info: FileInfo,
  settings: Settings,
  onProgress?: (pct: number) => void,
): DiagnoseResult & DiagnoseExtras {
  const width = table.rows.reduce((m, r) => Math.max(m, r.length), table.header.length);
  const header = Array.from({ length: width }, (_, i) => (i < table.header.length ? table.header[i] : `（余剰列${i - table.header.length + 1}）`));
  const fields = header.map((_, i) => settings.columns[i] ?? OTHER);
  const findings: Finding[] = [];

  // ファイル全体の指摘
  if (info.decodeErrors > 0) {
    findings.push(fileFinding('F-01', `${info.encoding} として読み込めないバイトが ${info.decodeErrors} 箇所あります（文字コード不一致の疑い）`));
  }
  const seen = new Map<string, number>();
  header.forEach((h, i) => {
    if (i >= table.header.length) return;
    const key = h.trim();
    if (key === '' && info.hasHeader) findings.push(fileFinding('F-07', `${i + 1}列目のヘッダが空欄です`, i));
    else if (seen.has(key)) findings.push(fileFinding('F-07', `ヘッダ「${key}」が重複しています（${seen.get(key)! + 1}列目と${i + 1}列目）`, i));
    else seen.set(key, i);
    if (fields[i].type === 'other' && key !== '') findings.push(fileFinding('F-07', `列「${key}」は項目定義に対応していません（未定義列。チェック対象外）`, i));
  });

  const plans: ColumnPlan[] = fields.map((field, i) => {
    let pattern: RegExp | null = null;
    if (field.pattern) {
      try {
        pattern = new RegExp(`^(?:${field.pattern})$`, 'u');
      } catch {
        findings.push(fileFinding('V-01', `${i + 1}列目「${header[i]}」の形式（正規表現）が不正なため、形式チェックを行いませんでした`, i));
      }
    }
    const allowed = field.allowed.trim() ? field.allowed.split(/[,、，]/).map((x) => x.trim()).filter(Boolean) : null;
    return { field, pattern, allowed };
  });

  const ctx: CheckContext = {
    settings,
    accepted: new Set(settings.accepted),
    autoSuggest: new Set(settings.autoSuggest),
    disabledSafe: new Set(settings.disabledSafe),
    marks: new Set([...settings.unreadableMarks].filter((c) => c.trim())),
    findings,
  };

  const issuesByRow = new Map<number, string[]>();
  for (const is of table.issues) {
    if (!issuesByRow.has(is.row)) issuesByRow.set(is.row, []);
    issuesByRow.get(is.row)!.push(is.detail);
  }

  const addrCols = fields.map((f, i) => (FIELD_TYPES[f.type].address ? i : -1)).filter((i) => i >= 0);
  const raw: string[][] = [];
  const cleaned: string[][] = [];
  const total = table.rows.length;
  for (let r = 0; r < total; r++) {
    const src = table.rows[r];
    const rawRow = Array.from({ length: width }, (_, c) => src[c] ?? '');
    raw.push(rawRow);
    for (const d of issuesByRow.get(r) ?? []) {
      findings.push({ row: r, col: -1, ruleId: 'F-02', severity: 'E', message: d, recommendation: RULE_MAP['F-02'].recommendation, status: 'open' });
    }
    const out = rawRow.map((v, c) => processCell(v, r, c, plans[c], ctx));
    // A-08 必須項目の空欄
    out.forEach((v, c) => {
      if (fields[c].required && v === '') {
        findings.push({ row: r, col: c, ruleId: 'A-08', severity: 'E', message: `必須項目「${header[c]}」が空欄です`, recommendation: RULE_MAP['A-08'].recommendation, status: 'open', before: '' });
      }
    });
    if (settings.requireAddress && addrCols.length && addrCols.every((c) => out[c] === '')) {
      findings.push({ row: r, col: addrCols[0], ruleId: 'A-08', severity: 'E', message: '住所が空欄です', recommendation: RULE_MAP['A-08'].recommendation, status: 'open', before: '' });
    }
    cleaned.push(out);
    if (onProgress && r % 2000 === 0) onProgress(Math.round((r / Math.max(total, 1)) * 80));
  }

  onProgress?.(85);
  const dd = dedupe(raw, cleaned, fields, settings);
  findings.push(...dd.findings);
  onProgress?.(95);

  // 行・列順に並べる（ファイル全体の指摘が先頭）
  findings.sort((a, b) => a.row - b.row || a.col - b.col);

  const rowMeta: RowMeta[] = cleaned.map((_, r) => ({
    groupId: dd.groupOf[r],
    excluded: dd.excluded[r] !== null,
    excludeRule: dd.excluded[r] ?? '',
    candidateIds: dd.candidateIdsOf[r],
    householdId: dd.householdOf[r],
    modified: false,
  }));

  const summary = summarize(findings, rowMeta, total, dd.groups.length, dd.candidates.length, dd.skippedBuckets);
  for (const f of findings) if (f.row >= 0 && f.status === 'fixed') rowMeta[f.row].modified = true;
  summary.households = new Set(dd.householdOf.filter(Boolean)).size;

  onProgress?.(100);
  return {
    header,
    cleaned,
    findings,
    rowMeta,
    groups: dd.groups,
    candidates: dd.candidates,
    summary,
    ranAt: new Date().toISOString(),
    repNote: dd.repNote,
    skippedBuckets: dd.skippedBuckets,
  };
}

export function isUnresolved(f: Finding): boolean {
  return f.status !== 'fixed';
}

function summarize(
  findings: Finding[],
  rowMeta: RowMeta[],
  totalRows: number,
  dupeGroups: number,
  candidatePairs: number,
  skippedKeyBuckets: string[],
): Summary {
  const unresolved = { E: 0, W: 0, I: 0 };
  const byRuleMap = new Map<string, RuleCount>(RULES.map((r) => [r.id, { ruleId: r.id, open: 0, proposed: 0, fixed: 0 }]));
  const rowE = new Set<number>();
  const rowW = new Set<number>();
  const candRows = new Set<number>();
  let fixed = 0;
  let proposed = 0;
  let fileLevel = 0;
  for (const f of findings) {
    const rc = byRuleMap.get(f.ruleId)!;
    rc[f.status === 'fixed' ? 'fixed' : f.status === 'proposed' ? 'proposed' : 'open']++;
    if (f.row < 0) fileLevel++;
    if (f.status === 'fixed') {
      fixed++;
      continue;
    }
    if (f.status === 'proposed') proposed++;
    unresolved[f.severity]++;
    if (f.row >= 0 && f.severity === 'E') rowE.add(f.row);
    if (f.row >= 0 && f.severity === 'W') rowW.add(f.row);
    if (f.ruleId === 'D-04') candRows.add(f.row);
  }
  let shippable = 0;
  let excluded = 0;
  rowMeta.forEach((m, r) => {
    if (m.excluded) excluded++;
    else if (!rowE.has(r) && !rowW.has(r)) shippable++;
  });
  return {
    totalRows,
    unresolved,
    fixed,
    proposed,
    rowsWithE: rowE.size,
    rowsWithW: rowW.size,
    byRule: [...byRuleMap.values()],
    dupeGroups,
    excluded,
    candidatePairs,
    candidateRows: candRows.size,
    households: 0,
    shippable,
    fileLevel,
    skippedKeyBuckets,
  };
}
