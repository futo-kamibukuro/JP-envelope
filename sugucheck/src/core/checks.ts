import { CHAR_CLASS_LABELS, classifyChar, codePointLabel, type CharClass } from './charset';
import { FIELD_TYPES } from './layout';
import { MACHINE_DEPENDENT, replaceMachineDependent } from './machineDependent';
import { toFullWidth, toHalfWidth, unifyHyphens } from './normalize';
import { RULE_MAP } from './rules';
import type { FieldDef, Finding, Settings } from './types';

/** 列ごとに事前計算しておく情報 */
export interface ColumnPlan {
  field: FieldDef;
  pattern: RegExp | null;
  allowed: string[] | null;
}

export interface CheckContext {
  settings: Settings;
  accepted: Set<string>;
  autoSuggest: Set<string>;
  disabledSafe: Set<string>;
  marks: Set<string>;
  findings: Finding[];
}

function push(ctx: CheckContext, f: Omit<Finding, 'severity' | 'recommendation'> & { severity?: Finding['severity'] }) {
  const rule = RULE_MAP[f.ruleId];
  ctx.findings.push({ severity: rule.severity, recommendation: rule.recommendation, ...f });
}

/** 「安全」修正：既定で適用し、ログに残す */
function safeFix(ctx: CheckContext, row: number, col: number, ruleId: string, message: string, before: string, after: string): string {
  if (before === after) return before;
  if (ctx.disabledSafe.has(ruleId)) {
    push(ctx, { row, col, ruleId, message, before, after, status: 'proposed' });
    return before;
  }
  push(ctx, { row, col, ruleId, message, before, after, status: 'fixed', fixedBy: 'safe' });
  return after;
}

export function proposalKey(row: number, col: number, ruleId: string): string {
  return `${row}:${col}:${ruleId}`;
}

/** 「推定」修正：提案のみ。承認済み（または一括適用ON）の場合だけ適用する */
function suggest(ctx: CheckContext, row: number, col: number, ruleId: string, message: string, before: string, after: string): string {
  if (ctx.autoSuggest.has(ruleId) || ctx.accepted.has(proposalKey(row, col, ruleId))) {
    push(ctx, { row, col, ruleId, message, before, after, status: 'fixed', fixedBy: 'accepted' });
    return after;
  }
  push(ctx, { row, col, ruleId, message, before, after, status: 'proposed' });
  return before;
}

function flag(ctx: CheckContext, row: number, col: number, ruleId: string, message: string, value: string) {
  push(ctx, { row, col, ruleId, message, before: value, status: 'open' });
}

// ---------------------------------------------------------------------------

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const HAS_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad\u180e\u2028\u2029]/g;
const HAS_INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad\u180e\u2028\u2029]/;
const EDGE_SPACE = /^[ \t\u3000\n\r]+|[ \t\u3000\n\r]+$/g;

const DATE_PATTERNS: [RegExp, string][] = [
  [/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/, '日付形式（yyyy/m/d）'],
  [/^\d{4}年\d{1,2}月\d{1,2}日$/, '日付形式（yyyy年m月d日）'],
  [/^\d{1,2}月\d{1,2}日$/, '日付形式（m月d日）'],
  [/^\d{1,2}\/\d{1,2}$/, '日付形式（m/d）'],
  [/^\d{1,2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(-\d{2,4})?$/i, '日付形式（d-mmm）'],
  [/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{2,4}$/i, '日付形式（mmm-yy）'],
];

const MOJIBAKE_SJIS = /[縺繧繝譁蜷螟荳莨驕蛟蝣邨蜊鬮]/g;
const MOJIBAKE_LATIN = /[\u00c3\u00c2\u00e2\u00e3\u00e5\u00e6\u00e7\u00e8\u00e9\u00ef][\u0080-\u00bf\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/;

function sameWidthDigit(sample: string, d: string): string {
  return /[０-９]/.test(sample) ? toFullWidth(d) : d;
}

/** セル単位のチェックと修正。修正後の値を返す */
export function processCell(value: string, row: number, col: number, plan: ColumnPlan, ctx: CheckContext): string {
  const field = plan.field;
  const meta = FIELD_TYPES[field.type];
  let v = value;

  // F-06 前後空白・制御文字・タブ（安全）
  let t = v.replace(CONTROL, '').replace(EDGE_SPACE, '');
  t = t.replace(/\t/g, ' ');
  if (t !== v) {
    const parts: string[] = [];
    if (HAS_CONTROL.test(v)) parts.push('制御文字');
    if (v.replace(EDGE_SPACE, '') !== v) parts.push('前後空白');
    if (/\t/.test(v.replace(EDGE_SPACE, ''))) parts.push('タブ');
    v = safeFix(ctx, row, col, 'F-06', `${parts.join('・') || '空白'}を除去`, v, t);
  }

  // C-06 ゼロ幅文字・BOM・不可視文字（安全）
  if (HAS_INVISIBLE.test(v)) {
    v = safeFix(ctx, row, col, 'C-06', '不可視文字を除去', v, v.replace(INVISIBLE, ''));
  }

  if (v === '') return v;

  // F-03 セル内改行（推定）
  if (/\n/.test(v)) {
    v = suggest(ctx, row, col, 'F-03', 'セル内に改行があります（改行を除去する案）', v, v.replace(/\s*\n\s*/g, ''));
  }

  // E-04 住所・番地の日付化（不可）— 書き換える前の値で判定。破損疑いの値は以降も書き換えない
  let corrupted = false;
  if (meta.address) {
    const n = v.normalize('NFKC').trim();
    let hit = DATE_PATTERNS.find(([re]) => re.test(n))?.[1];
    if (!hit && field.type === 'street' && /^\d{5}(\.\d+)?$/.test(n)) {
      const num = Number(n);
      if (num >= 20000 && num <= 60000) hit = 'Excelの日付シリアル値';
    }
    if (hit) {
      flag(ctx, row, col, 'E-04', `住所欄が${hit}に変換されている疑い`, v);
      corrupted = true;
    }
  }

  // E-05 指数表記・15桁超の下位桁落ち（不可）
  {
    const n = v.normalize('NFKC').trim();
    if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(n)) {
      flag(ctx, row, col, 'E-05', '指数表記になっています（下位桁が失われています）', v);
      corrupted = true;
    } else if (/^\d{16,}$/.test(n) && /^0+$/.test(n.slice(15))) {
      flag(ctx, row, col, 'E-05', '15桁を超える数値の下位桁が0になっています（桁落ちの疑い）', v);
      corrupted = true;
    }
  }

  // E-06 / A-07 全角・半角の統一（安全）
  if (!corrupted && field.width !== 'mixed' && field.type !== 'other') {
    const ruleId = meta.numeric ? 'E-06' : 'A-07';
    let target = field.width === 'half' ? toHalfWidth(v) : toFullWidth(v);
    if (meta.numeric && field.width === 'half') target = unifyHyphens(target);
    if (target !== v) v = safeFix(ctx, row, col, ruleId, field.width === 'half' ? '半角に統一' : '全角に統一', v, target);
  }

  // 郵便番号：A-01 形式統一（安全）／E-01 先頭0落ち（推定）
  if (field.type === 'postal') {
    const s = v.normalize('NFKC').replace(/^'/, '').trim();
    const d = s.replace(/[-\s]/g, '');
    const fmt = (x: string) => (ctx.settings.postalHyphen ? `${x.slice(0, 3)}-${x.slice(3)}` : x);
    if (/^\d{7}$/.test(d)) {
      if (fmt(d) !== v) v = safeFix(ctx, row, col, 'A-01', '郵便番号の形式を統一', v, fmt(d));
    } else if (/^\d{5,6}$/.test(d) && !s.includes('-')) {
      v = suggest(ctx, row, col, 'E-01', `郵便番号が${d.length}桁です（先頭0落ちの疑い。0補完の案）`, v, fmt(d.padStart(7, '0')));
    } else {
      flag(ctx, row, col, 'A-01', '郵便番号の形式が不正です（7桁ではありません）', v);
    }
  }

  // E-02 電話番号の先頭0落ち（推定）
  if (field.type === 'tel') {
    const d = v.normalize('NFKC').trim();
    if (/^\d+$/.test(d) && !d.startsWith('0') && (d.length === 9 || d.length === 10)) {
      v = suggest(ctx, row, col, 'E-02', `電話番号が${d.length}桁で先頭が0ではありません（先頭0落ちの疑い）`, v, sameWidthDigit(v, '0') + v);
    }
  }

  // E-03 固定桁コードの桁数不足（推定）
  if (field.fixedDigits && field.fixedDigits > 0) {
    const d = v.normalize('NFKC').trim();
    if (/^\d+$/.test(d) && d.length < field.fixedDigits) {
      const pad = '0'.repeat(field.fixedDigits - d.length);
      v = suggest(ctx, row, col, 'E-03', `${field.fixedDigits}桁のはずが${d.length}桁です（先頭0落ちの疑い。0埋めの案）`, v, sameWidthDigit(v, pad) + v);
    }
  }

  // 文字のチェック（C-01〜C-05、F-01）
  v = checkChars(v, row, col, plan, ctx);

  // V-01 形式／V-02 許容値
  if (plan.pattern && !plan.pattern.test(v)) flag(ctx, row, col, 'V-01', `形式（${field.pattern}）に一致しません`, v);
  if (plan.allowed && !plan.allowed.includes(v)) flag(ctx, row, col, 'V-02', `許容値（${plan.allowed.join('、')}）以外の値です`, v);

  // A-09 最大文字数超過
  if (field.maxLength && [...v].length > field.maxLength) {
    flag(ctx, row, col, 'A-09', `${[...v].length}文字（上限${field.maxLength}文字）`, v);
  }
  return v;
}

function checkChars(value: string, row: number, col: number, plan: ColumnPlan, ctx: CheckContext): string {
  let v = value;
  // C-03 機種依存文字（推定）
  const md = [...new Set([...v].filter((ch) => MACHINE_DEPENDENT.has(ch)))];
  if (md.length) {
    let after = replaceMachineDependent(v);
    if (plan.field.width === 'full') after = toFullWidth(after);
    else if (plan.field.width === 'half') after = toHalfWidth(after);
    v = suggest(ctx, row, col, 'C-03', `機種依存文字：${md.join(' ')}（標準表記へ置換する案）`, v, after);
  }

  const groups = new Map<CharClass, Set<string>>();
  let geta = false;
  const marks = new Set<string>();
  for (const ch of v) {
    if (ctx.marks.has(ch)) marks.add(ch);
    if (ch === '〓') geta = true;
    if (MACHINE_DEPENDENT.has(ch)) continue;
    const cls = classifyChar(ch.codePointAt(0)!);
    if (cls === 'ok') continue;
    if (!groups.has(cls)) groups.set(cls, new Set());
    groups.get(cls)!.add(ch);
  }
  const list = (s: Set<string>) => [...s].map((ch) => `${ch}（${codePointLabel(ch)}）`).join('、');

  const pua = groups.get('pua');
  if (pua) flag(ctx, row, col, 'C-02', `私用領域の文字：${list(pua)}`, v);

  const rep = groups.get('replacement');
  if (rep || geta) flag(ctx, row, col, 'C-04', `置換文字・化け記号：${[rep ? '\uFFFD（U+FFFD）' : '', geta ? '〓（ゲタ記号）' : ''].filter(Boolean).join('、')}`, v);

  const c01 = (['ibm', 'nec', 'level34', 'outside'] as CharClass[])
    .filter((c) => groups.has(c))
    .map((c) => `${CHAR_CLASS_LABELS[c]}：${list(groups.get(c)!)}`);
  if (c01.length) flag(ctx, row, col, 'C-01', c01.join(' ／ '), v);

  if (marks.size) flag(ctx, row, col, 'C-05', `読めない文字の印：${[...marks].join('')}`, v);

  // F-01 典型的な文字化けパターン
  const sj = v.match(MOJIBAKE_SJIS)?.length ?? 0;
  if ((sj >= 2 && sj / [...v].length >= 0.2) || MOJIBAKE_LATIN.test(v)) {
    flag(ctx, row, col, 'F-01', '文字化けの典型パターンを検出しました（文字コード不一致の疑い）', v);
  }
  return v;
}
