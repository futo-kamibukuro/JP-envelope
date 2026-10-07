/**
 * 文字コード関連：文字コード判定・デコード、CP932エンコード、JIS X 0208 水準判定。
 * 文字表はブラウザ標準の TextDecoder（WHATWG Encoding Standard）から実行時に生成する。
 */

export type EncodingName = 'utf-8' | 'shift_jis' | 'euc-jp';

export const ENCODING_LABELS: Record<EncodingName, string> = {
  'utf-8': 'UTF-8',
  shift_jis: 'Shift_JIS（CP932）',
  'euc-jp': 'EUC-JP',
};

export interface DecodeResult {
  text: string;
  encoding: EncodingName;
  detected: EncodingName;
  hasBom: boolean;
  errors: number;
}

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++;
  return n;
}

function countHalfKana(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xff61 && c <= 0xff9f) n++;
  }
  return n;
}

/** 文字コードを自動判定する（UTF-8 BOM → UTF-8 厳密 → SJIS/EUC の比較） */
export function detectEncoding(bytes: Uint8Array): EncodingName {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    /* not utf-8 */
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024));
  const sj = new TextDecoder('shift_jis').decode(sample);
  const eu = new TextDecoder('euc-jp').decode(sample);
  const sjErr = countReplacement(sj);
  const euErr = countReplacement(eu);
  if (sjErr !== euErr) return sjErr < euErr ? 'shift_jis' : 'euc-jp';
  // EUC-JP を SJIS で読むと半角カナが大量に出る
  return countHalfKana(sj) <= countHalfKana(eu) ? 'shift_jis' : 'euc-jp';
}

export function decodeBytes(bytes: Uint8Array, forced?: EncodingName | null): DecodeResult {
  const detected = detectEncoding(bytes);
  const encoding = forced ?? detected;
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let body = bytes;
  if (encoding === 'utf-8' && hasBom) body = bytes.subarray(3);
  const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(body);
  // UTF-8 として正しく読めた場合、本文中の置換文字はデータそのもの（C-04で指摘）でありデコード失敗ではない
  let errors = countReplacement(text);
  if (encoding === 'utf-8' && errors > 0) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(body);
      errors = 0;
    } catch {
      /* 実際に読めないバイトがある */
    }
  }
  return { text, encoding, detected, hasBom, errors };
}

// ---------------------------------------------------------------------------
// 文字表

interface Tables {
  jis0208: Set<number>;
  /** CP932 で表現できる2バイト文字 → [lead, trail] */
  cp932: Map<number, number>;
  /** CP932 の2バイト文字の出所 */
  cp932Origin: Map<number, 'nec' | 'ibm'>;
}

let tables: Tables | null = null;

/** JIS X 0208 の符号位置と Unicode の対応差異（JIS 系と Microsoft 系）を吸収 */
const JIS0208_VARIANTS = [
  0x2014, 0x2015, 0x301c, 0xff5e, 0x2016, 0x2225, 0x2212, 0xff0d, 0x00a2, 0xffe0, 0x00a3, 0xffe1, 0x00ac,
  0xffe2, 0x00a5, 0x203e, 0xff3c,
];

function buildTables(): Tables {
  // JIS X 0208：EUC-JP の 1〜8 区（記号・英数・かな等）と 16〜84 区（第1・第2水準漢字）
  const euc = new TextDecoder('euc-jp');
  const bytes: number[] = [];
  for (let row = 1; row <= 84; row++) {
    if (row >= 9 && row <= 15) continue; // 13区（NEC特殊文字）等は JIS X 0208 外
    for (let cell = 1; cell <= 94; cell++) bytes.push(0xa0 + row, 0xa0 + cell);
  }
  const decoded = euc.decode(new Uint8Array(bytes));
  const jis0208 = new Set<number>();
  for (const ch of decoded) {
    const cp = ch.codePointAt(0)!;
    if (cp !== 0xfffd) jis0208.add(cp);
  }
  for (const v of JIS0208_VARIANTS) jis0208.add(v);

  // CP932（WHATWG Shift_JIS）の逆引き表
  const sjis = new TextDecoder('shift_jis');
  const cp932 = new Map<number, number>();
  const cp932Origin = new Map<number, 'nec' | 'ibm'>();
  const pair = new Uint8Array(2);
  const deferred: [number, number][] = [];
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead >= 0xa0 && lead <= 0xdf) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const s = sjis.decode(pair);
      if (s.length !== 1 || s === '\ufffd') continue;
      const cp = s.charCodeAt(0);
      const code = (lead << 8) | trail;
      // WHATWG の符号化規則：NEC選定IBM拡張（ED/EE区）より IBM拡張（FA〜FC）を優先
      if (lead === 0xed || lead === 0xee) {
        deferred.push([cp, code]);
        continue;
      }
      if (!cp932.has(cp)) cp932.set(cp, code);
      if (!jis0208.has(cp) && !(cp >= 0xe000 && cp <= 0xf8ff) && !cp932Origin.has(cp)) {
        cp932Origin.set(cp, lead === 0x87 ? 'nec' : 'ibm');
      }
    }
  }
  for (const [cp, code] of deferred) {
    if (!cp932.has(cp)) cp932.set(cp, code);
    if (!jis0208.has(cp) && !cp932Origin.has(cp)) cp932Origin.set(cp, 'ibm');
  }
  return { jis0208, cp932, cp932Origin };
}

function getTables(): Tables {
  if (!tables) tables = buildTables();
  return tables;
}

// ---------------------------------------------------------------------------
// CP932 エンコード

export interface EncodeResult {
  bytes: Uint8Array;
  unmappable: Map<string, number>;
}

export function encodeCp932(text: string): EncodeResult {
  const { cp932 } = getTables();
  const out = new Uint8Array(text.length * 2);
  let n = 0;
  const unmappable = new Map<string, number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out[n++] = cp;
    } else if (cp === 0xa5) {
      out[n++] = 0x5c;
    } else if (cp === 0x203e) {
      out[n++] = 0x7e;
    } else if (cp >= 0xff61 && cp <= 0xff9f) {
      out[n++] = cp - 0xff61 + 0xa1;
    } else {
      const code = cp932.get(cp === 0x2212 ? 0xff0d : cp);
      if (code !== undefined) {
        out[n++] = code >> 8;
        out[n++] = code & 0xff;
      } else {
        out[n++] = 0x3f; // '?'
        unmappable.set(ch, (unmappable.get(ch) ?? 0) + 1);
      }
    }
  }
  return { bytes: out.subarray(0, n), unmappable };
}

// ---------------------------------------------------------------------------
// 文字の分類（C-01 / C-02 / C-04）

export type CharClass =
  | 'ok'
  | 'pua' // 私用領域（外字の疑い）
  | 'replacement' // 置換文字
  | 'nec' // CP932 の NEC 特殊文字（13区）
  | 'ibm' // CP932 の IBM 拡張文字
  | 'level34' // 第3・第4水準の可能性（CJK統合漢字等）
  | 'outside'; // 範囲外

export function isPua(cp: number): boolean {
  return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
}

function isCjkIdeograph(cp: number): boolean {
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x3134f)
  );
}

export function classifyChar(cp: number): CharClass {
  if (cp >= 0x20 && cp <= 0x7e) return 'ok';
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return 'ok';
  if (cp >= 0xff61 && cp <= 0xff9f) return 'ok'; // JIS X 0201 半角カナ
  const t = getTables();
  if (t.jis0208.has(cp)) return 'ok';
  if (cp === 0xfffd) return 'replacement';
  if (isPua(cp)) return 'pua';
  const origin = t.cp932Origin.get(cp);
  if (origin) return origin;
  if (isCjkIdeograph(cp)) return 'level34';
  return 'outside';
}

export const CHAR_CLASS_LABELS: Record<CharClass, string> = {
  ok: '第1・第2水準内',
  pua: '私用領域（外字の疑い）',
  replacement: '置換文字',
  nec: '範囲外（CP932のNEC特殊文字。第1・第2水準ではない）',
  ibm: '範囲外（CP932のIBM拡張文字。第1・第2水準ではない）',
  level34: '第3・第4水準の可能性（CP932では表現不可）',
  outside: '範囲外（JIS第1〜第4水準外の可能性）',
};

export function codePointLabel(ch: string): string {
  return 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}
