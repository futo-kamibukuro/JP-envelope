import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseTable } from '../src/core/csv';
import { diagnose } from '../src/core/engine';
import { defaultSettings } from '../src/core/layout';
import { buildOutput, DEFAULT_DEPARTMENTS, type ExportContext } from '../src/core/outputs';
import type { FileInfo } from '../src/core/types';

function ctxFor(csv: string, tweak?: (s: ReturnType<typeof defaultSettings>) => void): ExportContext {
  const table = parseTable(csv, ',', true);
  const settings = defaultSettings(table.header, 'dm');
  tweak?.(settings);
  const info: FileInfo = { name: 'sample.csv', size: csv.length, sha256: 'x', encoding: 'utf-8', encodingDetected: 'utf-8', decodeErrors: 0, hasBom: false, delimiter: ',', hasHeader: true };
  return { info, settings, result: diagnose(table, info, settings), lines: table.lines, meta: { deadline: '2026-10-31', departments: DEFAULT_DEPARTMENTS } };
}

const csv = ['管理番号,郵便番号,番地,氏名,電話', '002983428,0600001,丸の内1-1-1,山田　太郎,0312345678', '000001,600001,=HYPERLINK("x"),𠮷田,+81-3-1234-5678', '000001,600001,=HYPERLINK("x"),𠮷田,+81-3-1234-5678'].join('\n');

describe('T7 出力の再破損防止', () => {
  const ctx = ctxFor(csv, (s) => (s.columns[0].fixedDigits = 9));

  it('xlsx では全セルが文字列で、先頭0が保持される', () => {
    const files = unzipSync(buildOutput(ctx, 'cleansed-xlsx').files[0].bytes);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<t>002983428</t>');
    expect(sheet).toContain('<t>060-0001</t>');
    expect(sheet).not.toMatch(/<c [^>]*t="n"/);
    expect(sheet).not.toMatch(/<v>/);
    expect(strFromU8(files['xl/styles.xml'])).toContain('numFmtId="49"');
  });

  it('CSV出力の注意文が一式zipに同梱される', () => {
    const zip = unzipSync(buildOutput(ctx, 'zip').files[0].bytes);
    const names = Object.keys(zip);
    const notice = names.find((n) => n.includes('注意'));
    expect(notice).toBeTruthy();
    const text = strFromU8(zip[notice!]);
    expect(text).toContain('Excelでダブルクリックして開かないでください');
    expect(text).toContain('𠮷'); // CP932で表現できない文字の一覧
    expect(names.length).toBe(8);
  });

  it('CSV は全項目をクォートし、数式になりうる値をガードする', () => {
    const text = strFromU8(buildOutput(ctx, 'cleansed-csv-utf8').files[0].bytes.subarray(3));
    expect(text).toContain('"\'＝ＨＹＰＥＲＬＩＮＫ（＂ｘ＂）"');
    expect(text).toContain('"+81-3-1234-5678"');
    expect(text.split('\r\n')[1].startsWith('"002983428","060-0001"')).toBe(true);
  });

  it('エラーリストは事象別のシートに分かれ、判断欄と回答期限を持つ', () => {
    const files = unzipSync(buildOutput(ctx, 'errorlist').files[0].bytes);
    const wb = strFromU8(files['xl/workbook.xml']);
    for (const n of ['①住所・郵便番号', '②文字', '③重複候補', '④形式・破損疑い']) expect(wb).toContain(n);
    const s1 = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(s1).toContain('2026-10-31');
    expect(s1).toContain('判断');
    expect(s1).toContain('dataValidation');
  });
});
