import type { ParsedTable, ParseIssue } from './types';

/** 区切り文字の自動判定（先頭数行のタブとカンマの数を比較） */
export function detectDelimiter(text: string, fileName = ''): string {
  if (/\.tsv$/i.test(fileName)) return '\t';
  const head = text.slice(0, 20000).split(/\r?\n/).slice(0, 10).join('\n');
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

interface RawRecord {
  fields: string[];
  start: number;
  end: number;
  strayQuote: boolean;
  unterminated: boolean;
}

/** RFC 4180 準拠の CSV/TSV パーサー。全列を文字列のまま保持し、型変換は一切しない */
export function parseRecords(text: string, delimiter: string): { records: RawRecord[]; emptyLines: number } {
  const records: RawRecord[] = [];
  let emptyLines = 0;
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let wasQuoted = false;
  let line = 1;
  let start = 1;
  let strayQuote = false;
  const n = text.length;
  let i = 0;

  const endRecord = () => {
    fields.push(field);
    if (fields.length === 1 && fields[0] === '' && !wasQuoted) {
      emptyLines++;
    } else {
      records.push({ fields, start, end: line, strayQuote, unterminated: false });
    }
    fields = [];
    field = '';
    wasQuoted = false;
    strayQuote = false;
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (c === '\r' && text[i + 1] === '\n') {
        field += '\n';
        line++;
        i += 2;
        continue;
      }
      if (c === '\n' || c === '\r') line++;
      field += c === '\r' ? '\n' : c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field === '' && !wasQuoted) {
        inQuotes = true;
        wasQuoted = true;
      } else {
        strayQuote = true;
        field += c;
      }
      i++;
      continue;
    }
    if (c === delimiter) {
      fields.push(field);
      field = '';
      wasQuoted = false;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      endRecord();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line++;
      start = line;
      continue;
    }
    if (wasQuoted) strayQuote = true; // 閉じクォートの後に文字が続く
    field += c;
    i++;
  }
  if (inQuotes) {
    fields.push(field);
    records.push({ fields, start, end: line, strayQuote, unterminated: true });
  } else if (field !== '' || fields.length > 0 || wasQuoted) {
    endRecord();
  }
  return { records, emptyLines };
}

export function parseTable(text: string, delimiter: string, hasHeader: boolean): ParsedTable {
  const { records, emptyLines } = parseRecords(text, delimiter);
  let header: string[];
  let body: RawRecord[];
  if (hasHeader && records.length > 0) {
    header = records[0].fields;
    body = records.slice(1);
  } else {
    const width = records.reduce((m, r) => Math.max(m, r.fields.length), 0);
    header = Array.from({ length: width }, (_, i) => `列${i + 1}`);
    body = records;
  }
  const issues: ParseIssue[] = [];
  const rows: string[][] = [];
  const lines: { start: number; end: number }[] = [];
  body.forEach((rec, idx) => {
    rows.push(rec.fields);
    lines.push({ start: rec.start, end: rec.end });
    const where = rec.start === rec.end ? `元ファイル${rec.start}行目` : `元ファイル${rec.start}〜${rec.end}行目`;
    if (rec.fields.length !== header.length) {
      issues.push({
        row: idx,
        kind: 'colcount',
        detail: `列数 ${rec.fields.length}（期待 ${header.length}）／${where}`,
      });
    }
    if (rec.unterminated) {
      issues.push({ row: idx, kind: 'quote', detail: `クォートが閉じられていません／${where}以降` });
    } else if (rec.strayQuote) {
      issues.push({ row: idx, kind: 'quote', detail: `クォートの位置が不正です／${where}` });
    }
  });
  return { header, rows, lines, issues, delimiter, emptyLinesSkipped: emptyLines };
}

// ---------------------------------------------------------------------------
// 出力

/** CSVインジェクション対策：数式として解釈されうる値の先頭に ' を付ける */
export function guardFormula(v: string): string {
  if (v === '') return v;
  const c = v[0];
  if (c === '=' || c === '@' || c === '＝' || c === '＠' || c === '\t' || c === '\r') return "'" + v;
  if (c === '+' || c === '-' || c === '＋' || c === '－') {
    // 電話番号（+81-3-...）や数値・ハイフンだけの値は数式として評価されても無害なため対象外
    if (/^[+\-＋－][0-9０-９\s\-－()（）]*$/.test(v)) return v;
    return "'" + v;
  }
  return v;
}

export function toCsv(rows: string[][], delimiter = ',', formulaGuard = true): string {
  const out: string[] = [];
  for (const row of rows) {
    out.push(
      row
        .map((v) => {
          const s = formulaGuard ? guardFormula(v ?? '') : (v ?? '');
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(delimiter),
    );
  }
  return out.join('\r\n') + '\r\n';
}
