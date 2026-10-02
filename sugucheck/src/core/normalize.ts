/** 全角・半角の変換と、重複判定用の正規化 */

const HALF_KANA =
  '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const FULL_KANA =
  '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
const HALF_TO_FULL_KANA = new Map<string, string>();
for (let i = 0; i < HALF_KANA.length; i++) HALF_TO_FULL_KANA.set(HALF_KANA[i], FULL_KANA[i]);

const DAKUTEN_BASE = 'カキクケコサシスセソタチツテトハヒフヘホウ';
const HANDAKUTEN_BASE = 'ハヒフヘホ';

/** 半角英数記号・半角カナ・半角スペースを全角へ */
export function toFullWidth(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = ch.charCodeAt(0);
    if (c === 0x20) out += '　';
    else if (c > 0x20 && c < 0x7f) out += String.fromCharCode(c + 0xfee0);
    else if (c >= 0xff61 && c <= 0xff9f) {
      const next = s[i + 1];
      if (ch === 'ﾞ' || ch === 'ﾟ') {
        out += ch === 'ﾞ' ? '゛' : '゜';
        continue;
      }
      const full = HALF_TO_FULL_KANA.get(ch) ?? ch;
      if (next === 'ﾞ' && DAKUTEN_BASE.includes(full)) {
        out += full === 'ウ' ? 'ヴ' : String.fromCharCode(full.charCodeAt(0) + 1);
        i++;
      } else if (next === 'ﾟ' && HANDAKUTEN_BASE.includes(full)) {
        out += String.fromCharCode(full.charCodeAt(0) + 2);
        i++;
      } else out += full;
    } else out += ch;
  }
  return out;
}

/** 全角英数記号・全角スペースを半角へ（カナはそのまま） */
export function toHalfWidth(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x3000) out += ' ';
    else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
    else out += s[i];
  }
  return out;
}

/** 数字系項目のハイフン類を半角ハイフンへ */
export function unifyHyphens(s: string): string {
  return s.replace(/[‐‑‒–—―−－ｰ]/g, '-').replace(/(?<=\d)ー(?=\d)/g, '-');
}

export function hasFullDigit(s: string): boolean {
  return /[０-９]/.test(s);
}
export function hasHalfDigit(s: string): boolean {
  return /[0-9]/.test(s);
}

// ---------------------------------------------------------------------------
// 漢数字

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const KANJI_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

export function kanjiToNumber(s: string): number | null {
  if (!s) return null;
  if (![...s].some((c) => c in KANJI_UNITS)) {
    let v = '';
    for (const c of s) {
      if (!(c in KANJI_DIGITS)) return null;
      v += KANJI_DIGITS[c];
    }
    return Number(v);
  }
  let total = 0;
  let cur = 0;
  for (const c of s) {
    if (c in KANJI_DIGITS) cur = KANJI_DIGITS[c];
    else if (c in KANJI_UNITS) {
      total += (cur || 1) * KANJI_UNITS[c];
      cur = 0;
    } else return null;
  }
  return total + cur;
}

/** 丁目・番地・号・の・ハイフンの直前にある漢数字を算用数字へ */
export function convertKanjiNumerals(s: string): string {
  return s.replace(/[〇零一二三四五六七八九十百千]+(?=丁目|番地|番|号|の|-)/g, (m) => {
    const n = kanjiToNumber(m);
    return n === null ? m : String(n);
  });
}

// ---------------------------------------------------------------------------
// 重複判定用の正規化（D-02）

export interface NormalizeOptions {
  kanjiNumerals: boolean;
  kanaVariants: boolean;
}

/** 全半角統一（NFKC）とスペース除去 */
export function normalizeBasic(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

export function normalizeName(s: string): string {
  return normalizeBasic(s);
}

export function normalizeAddress(s: string, opts: NormalizeOptions): string {
  let v = normalizeBasic(s);
  v = v.replace(/[‐‑‒–—―−]/g, '-').replace(/(?<=\d)[ー]+(?=\d)/g, '-');
  if (opts.kanjiNumerals) v = convertKanjiNumerals(v);
  if (opts.kanaVariants) {
    v = v.replace(/(?<=[一-鿿])[ヶヵケが](?=[一-鿿])/g, 'ケ');
    v = v.replace(/(?<=[一-鿿])[ノの](?=[一-鿿])/g, 'の');
  }
  v = v
    .replace(/(\d+)丁目/g, '$1-')
    .replace(/(\d+)番地?/g, '$1-')
    .replace(/(\d+)号/g, '$1-')
    .replace(/(\d)-?の(?=\d)/g, '$1-')
    .replace(/-+/g, '-')
    .replace(/-+(?!\d)/g, '');
  return v;
}

export function normalizeEmail(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase();
}

export function digitsOnly(s: string): string {
  return s.normalize('NFKC').replace(/\D/g, '');
}

/** レーベンシュタイン距離（上限 max を超えたら max+1 を返す） */
export function editDistance(a: string, b: string, max = 3): number {
  const A = [...a];
  const B = [...b];
  if (Math.abs(A.length - B.length) > max) return max + 1;
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[B.length];
}
