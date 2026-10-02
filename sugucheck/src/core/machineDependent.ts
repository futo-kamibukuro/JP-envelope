/** 機種依存文字（C-03）と標準表記への置換案 */
const pairs: [string, string][] = [];

const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
[...circled].forEach((c, i) => pairs.push([c, `（${i + 1}）`]));

const romanUpper = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ';
const romanLower = 'ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ';
const romanText = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
[...romanUpper].forEach((c, i) => pairs.push([c, romanText[i]]));
[...romanLower].forEach((c, i) => pairs.push([c, romanText[i].toLowerCase()]));

pairs.push(
  ['㈱', '（株）'], ['㈲', '（有）'], ['㈹', '（代）'],
  ['㊤', '（上）'], ['㊥', '（中）'], ['㊦', '（下）'], ['㊧', '（左）'], ['㊨', '（右）'],
  ['㍉', 'ミリ'], ['㌔', 'キロ'], ['㌢', 'センチ'], ['㍍', 'メートル'], ['㌘', 'グラム'], ['㌧', 'トン'],
  ['㌃', 'アール'], ['㌶', 'ヘクタール'], ['㍑', 'リットル'], ['㍗', 'ワット'], ['㌍', 'カロリー'],
  ['㌦', 'ドル'], ['㌣', 'セント'], ['㌫', 'パーセント'], ['㍊', 'ミリバール'], ['㌻', 'ページ'],
  ['㎜', 'mm'], ['㎝', 'cm'], ['㎞', 'km'], ['㎎', 'mg'], ['㎏', 'kg'], ['㏄', 'cc'], ['㎡', 'm2'],
  ['№', 'No.'], ['㏍', 'K.K.'], ['℡', 'TEL'],
  ['㍾', '明治'], ['㍽', '大正'], ['㍼', '昭和'], ['㍻', '平成'], ['㋿', '令和'],
);

export const MACHINE_DEPENDENT = new Map<string, string>(pairs);

export function replaceMachineDependent(s: string): string {
  let out = '';
  for (const ch of s) out += MACHINE_DEPENDENT.get(ch) ?? ch;
  return out;
}
