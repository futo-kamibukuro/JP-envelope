import { describe, expect, it } from 'vitest';
import { decodeBytes, encodeCp932, classifyChar } from '../src/core/charset';
import { parseTable, toCsv, guardFormula } from '../src/core/csv';
import { diagnose } from '../src/core/engine';
import { defaultSettings, inferFieldType } from '../src/core/layout';
import { normalizeAddress, toFullWidth, kanjiToNumber } from '../src/core/normalize';
import type { FileInfo, Settings } from '../src/core/types';

const info = (over: Partial<FileInfo> = {}): FileInfo => ({
  name: 'test.csv', size: 0, sha256: '', encoding: 'utf-8', encodingDetected: 'utf-8',
  decodeErrors: 0, hasBom: false, delimiter: ',', hasHeader: true, ...over,
});

function run(csv: string, tweak?: (s: Settings) => void) {
  const table = parseTable(csv, ',', true);
  const settings = defaultSettings(table.header, 'dm');
  tweak?.(settings);
  return { table, settings, result: diagnose(table, info(), settings) };
}

const ruleRows = (findings: { ruleId: string; row: number }[], id: string) =>
  [...new Set(findings.filter((f) => f.ruleId === id).map((f) => f.row))];

// ---------------------------------------------------------------------------
describe('T1 名寄せ（講義の6件の例）', () => {
  const csv = [
    '郵便番号,都道府県,市区町村,番地,建物名,氏名',
    '100-0005,東京都,千代田区,丸の内１－１－１,,山田　太郎',
    '100-0005,東京都,千代田区,丸の内１－１－１,,山田　太郎',
    '100-0005,東京都,千代田区丸の内,１－１－１,,山田　太郎',
    '100-0005,東京都,千代田区,丸の内１－１－１,,山田　太朗',
    '100-0005,東京都,千代田区,丸の内1-1-1,,山田太郎',
    '100-0005,東京都,千代田区,丸の内1丁目1番地1号,,山田　太郎',
  ].join('\n');

  it('1が代表、2はD-01、3・5・6はD-02で除外候補、4はD-04の要確認候補', () => {
    const { result } = run(csv);
    const m = result.rowMeta;
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].rep).toBe(0);
    expect(m[0].excluded).toBe(false);
    expect(m[1].excludeRule).toBe('D-01');
    expect(m[2].excludeRule).toBe('D-02');
    expect(m[4].excludeRule).toBe('D-02');
    expect(m[5].excludeRule).toBe('D-02');
    expect(m[3].excluded).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect([result.candidates[0].a, result.candidates[0].b]).toEqual([0, 3]);
  });

  it('6は P2（郵便番号＋氏名）だけでも、P1（番地の正規化）だけでも検出できる', () => {
    for (const keys of [['P2'], ['P1']] as const) {
      const { result } = run(csv, (s) => (s.dedupe.keys = [...keys]));
      expect(result.rowMeta[5].excluded).toBe(true);
    }
  });

  it('要確認候補は、いかなる設定でも自動で除外されない', () => {
    for (const tolerance of ['strict', 'standard', 'loose'] as const) {
      for (const keys of [['P1', 'P2', 'P3'], ['P2'], ['P3', 'P2', 'P1']] as const) {
        const { result } = run(csv, (s) => {
          s.dedupe.tolerance = tolerance;
          s.dedupe.keys = [...keys];
          s.autoSuggest = ['F-03', 'E-01', 'E-02', 'E-03', 'C-03'];
        });
        expect(result.rowMeta[3].excluded).toBe(false);
        expect(result.findings.some((f) => f.row === 3 && f.ruleId === 'D-04')).toBe(true);
      }
    }
  });

  it('同じ住所で氏名が異なる場合は同一世帯、同名でも住所が異なれば重複としない', () => {
    const { result } = run(
      [
        '郵便番号,都道府県,市区町村,番地,建物名,氏名',
        '100-0005,東京都,千代田区,丸の内1-1-1,,山田　太郎',
        '100-0005,東京都,千代田区,丸の内1-1-1,,鈴木　花子',
        '150-0001,東京都,渋谷区,神宮前1-1-1,,山田　太郎',
      ].join('\n'),
      (s) => (s.dedupe.keys = ['P1', 'P3']),
    );
    expect(result.groups).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.rowMeta[0].householdId).toBeTruthy();
    expect(result.rowMeta[0].householdId).toBe(result.rowMeta[1].householdId);
    expect(result.rowMeta[2].householdId).toBe('');
  });

  it('P2一致でも住所が異なれば、標準では要確認候補・緩めでは除外候補', () => {
    const csv2 = [
      '郵便番号,都道府県,市区町村,番地,建物名,氏名',
      '100-0005,東京都,千代田区,丸の内1-1-1,,山田　太郎',
      '100-0005,東京都,千代田区,丸の内2-2-2,,山田　太郎',
    ].join('\n');
    const std = run(csv2).result;
    expect(std.rowMeta[1].excluded).toBe(false);
    expect(std.candidates).toHaveLength(1);
    const loose = run(csv2, (s) => (s.dedupe.tolerance = 'loose')).result;
    expect(loose.rowMeta[1].excluded).toBe(true);
  });

  it('代表レコードの選定（入力項目数優先・最新更新日優先）', () => {
    const csv3 = [
      '郵便番号,番地,氏名,電話,更新日',
      '100-0005,丸の内1-1-1,山田太郎,,2024/01/01',
      '100-0005,丸の内1-1-1,山田太郎,03-1234-5678,2023/05/01',
      '100-0005,丸の内1-1-1,山田太郎,,2025/03/01',
    ].join('\n');
    expect(run(csv3, (s) => (s.dedupe.rep = 'filled')).result.groups[0].rep).toBe(1);
    expect(run(csv3, (s) => (s.dedupe.rep = 'latest')).result.groups[0].rep).toBe(2);
    expect(run(csv3, (s) => (s.dedupe.rep = 'first')).result.groups[0].rep).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('T2 Excel破損', () => {
  const csv = ['郵便番号,番地,電話,番号,コード', '600001,2001/2/3,312345678,2983428,1'].join('\n');
  const tweak = (s: Settings) => {
    s.columns[3].fixedDigits = 9;
    s.columns[4].fixedDigits = 2;
  };

  it('E-01〜E-04 を検出し、提案のみで自動修正しない', () => {
    const { result } = run(csv, tweak);
    const f = (id: string) => result.findings.filter((x) => x.ruleId === id);
    expect(f('E-01')[0]).toMatchObject({ status: 'proposed', before: '600001', after: '060-0001' });
    expect(f('E-02')[0]).toMatchObject({ status: 'proposed', after: '0312345678' });
    expect(f('E-03').map((x) => x.after)).toEqual(['002983428', '01']);
    expect(f('E-04')[0]).toMatchObject({ status: 'open', before: '2001/2/3' });
    expect(f('E-04')[0].after).toBeUndefined();
    expect(result.cleaned[0]).toEqual(['600001', '2001/2/3', '312345678', '2983428', '1']);
  });

  it('提案を承認すると適用され、修正ログ（fixed）に元値が残る', () => {
    const { result } = run(csv, (s) => {
      tweak(s);
      s.accepted = ['0:0:E-01', '0:3:E-03'];
    });
    expect(result.cleaned[0][0]).toBe('060-0001');
    expect(result.cleaned[0][3]).toBe('002983428');
    const log = result.findings.filter((x) => x.status === 'fixed');
    expect(log.find((x) => x.ruleId === 'E-01')).toMatchObject({ before: '600001', after: '060-0001', fixedBy: 'accepted' });
    expect(result.rowMeta[0].modified).toBe(true);
  });

  it('E-04 は m月d日・シリアル値も検出、E-05 は指数表記・桁落ちを検出', () => {
    const { result } = run(['番地,建物名,会員ID', '1月2日,丸の内ビル,1.23E+11', '36925,,12345678901234500000'].join('\n'));
    expect(ruleRows(result.findings, 'E-04')).toEqual([0, 1]);
    expect(ruleRows(result.findings, 'E-05')).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
describe('T3 ファイル形式', () => {
  it('クォートされたセル内改行は F-03、クォートなしの改行は F-02', () => {
    const csv = '郵便番号,番地,氏名\n100-0005,"丸の内1-1-1\n丸の内ビル",山田\n100-0005,丸の内1-1-1\n丸の内ビル,山田\n';
    const table = parseTable(csv, ',', true);
    expect(table.rows).toHaveLength(3);
    const result = diagnose(table, info(), defaultSettings(table.header, 'dm'));
    expect(ruleRows(result.findings, 'F-03')).toEqual([0]);
    expect(ruleRows(result.findings, 'F-02')).toEqual([1, 2]);
    expect(result.findings.find((f) => f.ruleId === 'F-03')!.after).toBe('丸の内1-1-1丸の内ビル');
  });

  it('F-06 前後空白・制御文字は安全に自動除去され、ログに残る', () => {
    const { result } = run('氏名,番地\n  山田太郎 ,丸の内1-1-1\x07\n');
    const f06 = result.findings.filter((f) => f.ruleId === 'F-06');
    expect(f06).toHaveLength(2);
    expect(f06.every((f) => f.status === 'fixed')).toBe(true);
    expect(result.cleaned[0][0]).toBe('山田太郎');
  });

  it('ヘッダ重複・未定義列は F-07', () => {
    const { result } = run('氏名,氏名,備考\na,b,c\n');
    expect(result.findings.filter((f) => f.ruleId === 'F-07')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe('T6 文字', () => {
  const pua = String.fromCodePoint(0xe000);
  const rep = String.fromCodePoint(0xfffd);
  const csv = ['氏名', `山田${pua}`, '髙橋﨑子', '山■太郎', '①㈱山田', `山${rep}`, '𠮷田'].join('\n');
  const { result } = run(csv);
  const at = (row: number) => result.findings.filter((f) => f.row === row).map((f) => f.ruleId);

  it('私用領域 → C-02', () => expect(at(0)).toContain('C-02'));
  it('髙・﨑（IBM拡張）→ C-01（範囲外として分類）', () => {
    expect(at(1)).toContain('C-01');
    expect(result.findings.find((f) => f.row === 1 && f.ruleId === 'C-01')!.message).toContain('IBM拡張');
  });
  it('■ → C-05', () => expect(at(2)).toContain('C-05'));
  it('①・㈱ → C-03（置換案つき）', () => {
    const f = result.findings.find((x) => x.row === 3 && x.ruleId === 'C-03')!;
    expect(f.after).toBe('（１）（株）山田');
    expect(at(3)).not.toContain('C-01');
  });
  it('置換文字 → C-04', () => expect(at(4)).toContain('C-04'));
  it('CP932外の漢字 → 第3・第4水準の可能性', () => {
    expect(result.findings.find((f) => f.row === 5 && f.ruleId === 'C-01')!.message).toContain('第3・第4水準');
  });
  it('第1・第2水準の文字・半角カナ・ASCII は指摘しない', () => {
    for (const ch of '亜熙ｱA～〜－ー') expect(classifyChar(ch.codePointAt(0)!)).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
describe('文字コード・CSV', () => {
  it('Shift_JIS / EUC-JP / UTF-8 BOM を判定できる', () => {
    const text = '郵便番号,氏名\n100-0005,山田太郎\n';
    const sj = encodeCp932(text).bytes;
    expect(decodeBytes(sj)).toMatchObject({ encoding: 'shift_jis', text, errors: 0 });
    const euc = new Uint8Array([0xc5, 0xec, 0xb5, 0xfe, 0xc5, 0xd4, 0x2c, 0xbb, 0xb3, 0xc5, 0xc4]); // 東京都,山田
    expect(decodeBytes(euc)).toMatchObject({ encoding: 'euc-jp', text: '東京都,山田' });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect(decodeBytes(bom)).toMatchObject({ encoding: 'utf-8', hasBom: true, text });
  });

  it('CP932 で表現できない文字を検出する', () => {
    const r = encodeCp932('髙𠮷');
    expect(r.unmappable.get('𠮷')).toBe(1);
    expect(r.unmappable.has('髙')).toBe(false);
  });

  it('全列を文字列として保持し、先頭0を落とさない', () => {
    const t = parseTable('コード\n001\n"0600001"\n', ',', true);
    expect(t.rows).toEqual([['001'], ['0600001']]);
  });

  it('CSVインジェクション対策（電話番号の＋表記は除外）', () => {
    expect(guardFormula('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(guardFormula('@cmd')).toBe("'@cmd");
    expect(guardFormula('+81-3-1234-5678')).toBe('+81-3-1234-5678');
    expect(guardFormula('+cmd|x')).toBe("'+cmd|x");
    expect(toCsv([['a"b', '1']])).toBe('"a""b","1"\r\n');
  });
});

describe('正規化・項目推定', () => {
  it('番地表記の正規化', () => {
    const o = { kanjiNumerals: false, kanaVariants: false };
    expect(normalizeAddress('丸の内1丁目1番地1号', o)).toBe(normalizeAddress('丸の内１－１－１', o));
    expect(normalizeAddress('丸の内一丁目一番一号', { ...o, kanjiNumerals: true })).toBe('丸の内1-1-1');
    expect(normalizeAddress('霞ヶ関1-1', { ...o, kanaVariants: true })).toBe(normalizeAddress('霞が関1-1', { ...o, kanaVariants: true }));
    expect(kanjiToNumber('二十三')).toBe(23);
  });
  it('半角カナの全角化（濁点結合）', () => expect(toFullWidth('ｶﾞｰﾃﾞﾝ 1-2')).toBe('ガーデン　１－２'));
  it('ヘッダ名から標準種別を推定する', () => {
    expect(['郵便番号', '都道府県', '住所1', '住所2', '氏名', 'フリガナ', '電話番号', 'E-mail', '会員番号', 'Default Address Zip'].map(inferFieldType)).toEqual([
      'postal', 'pref', 'street', 'building', 'name', 'name_kana', 'tel', 'email', 'member_id', 'postal',
    ]);
  });
});

describe('共通の受入基準', () => {
  it('同条件で再実行すると同じ結果になる', () => {
    const csv = '郵便番号,番地,氏名\n600001,1-1-1,山田\n600001,１－１－１,山田\n';
    const a = run(csv).result;
    const b = run(csv).result;
    expect(JSON.stringify({ ...a, ranAt: '' })).toBe(JSON.stringify({ ...b, ranAt: '' }));
  });
  it('発送可能見込み件数は E・W・除外候補を除いた件数', () => {
    const { result } = run(['郵便番号,都道府県,市区町村,番地,建物名,氏名', '100-0005,東京都,千代田区,丸の内1-1-1,,山田太郎', '100-0005,東京都,千代田区,丸の内1-1-1,,山田太郎', ',東京都,千代田区,丸の内1-1-2,,鈴木'].join('\n'));
    expect(result.summary.shippable).toBe(1);
    expect(result.summary.excluded).toBe(1);
  });
});
