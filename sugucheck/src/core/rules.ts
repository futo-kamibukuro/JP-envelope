import type { ErrorGroup, FixClass, Severity } from './types';

export interface RuleDef {
  id: string;
  title: string;
  severity: Severity;
  fix: FixClass;
  source: '講義' | '追加';
  group: ErrorGroup;
  recommendation: string;
}

const r = (
  id: string,
  title: string,
  severity: Severity,
  fix: FixClass,
  source: RuleDef['source'],
  group: ErrorGroup,
  recommendation: string,
): RuleDef => ({ id, title, severity, fix, source, group, recommendation });

/** チェック項目一覧（仕様書 6 章）。ID・重大度・自動修正区分・出典は仕様書に準拠 */
export const RULES: RuleDef[] = [
  // 6.1 ファイル・形式
  r('F-01', '文字コード不一致・文字化け', 'E', 'none', '講義', 'char', '文字コードを確認し、元ファイルを再受領してください'),
  r('F-02', '列数不一致（クォート不備・セル内カンマ）', 'E', 'none', '追加', 'format', '元ファイルの該当行を確認し、正しい列区切りで再作成してください'),
  r('F-03', 'セル内改行', 'W', 'suggest', '講義', 'format', '改行を除去してよいか確認してください（建物名の途中等）'),
  r('F-06', '前後空白・制御文字・タブ', 'I', 'safe', '追加', 'format', '自動で除去済み'),
  r('F-07', 'ヘッダ重複・未定義列', 'W', 'none', '追加', 'format', '列名と項目定義の対応を確認してください'),
  // 6.2 Excel自動変換による破損疑い
  r('E-01', '郵便番号の先頭0落ち疑い', 'E', 'suggest', '講義', 'format', '先頭0を補完してよいか確認してください'),
  r('E-02', '電話番号の先頭0落ち疑い', 'E', 'suggest', '講義', 'format', '先頭0を補完してよいか確認してください'),
  r('E-03', '固定桁コードの桁数不足', 'E', 'suggest', '講義', 'format', '0埋めしてよいか確認してください（元データの確認を推奨）'),
  r('E-04', '住所・番地の日付化', 'E', 'none', '講義', 'format', '復元は原則不能です。元ファイルを再受領してください'),
  r('E-05', '指数表記・15桁超の下位桁落ち', 'E', 'none', '追加', 'format', '復元不能です。元ファイルを再受領してください'),
  r('E-06', '数字の全角半角混在', 'I', 'safe', '追加', 'format', '定義に従い自動で統一済み'),
  // 6.3 文字
  r('C-01', 'JIS第1・第2水準外の文字', 'W', 'none', '講義', 'char', '印字できるか確認し、必要なら代替字・外字ファイルを用意してください'),
  r('C-02', '私用領域の文字（外字の疑い）', 'E', 'none', '講義', 'char', '外字ファイルの受領が必要です（テキストとセットで受領）'),
  r('C-03', '機種依存文字', 'W', 'suggest', '追加', 'char', '標準表記へ置換してよいか確認してください'),
  r('C-04', '置換文字・文字化け記号', 'E', 'none', '講義', 'char', '正しい文字を確認してください'),
  r('C-05', '読めない文字の印', 'E', 'none', '講義', 'char', '正しい文字を確認してください'),
  r('C-06', 'ゼロ幅文字・BOM・不可視文字', 'I', 'safe', '追加', 'char', '自動で除去済み'),
  // 6.4 住所
  r('A-01', '郵便番号の形式', 'E', 'safe', '講義', 'address', '正しい郵便番号（7桁）を確認してください'),
  r('A-07', '全角・半角の混在', 'I', 'safe', '講義', 'address', '定義に従い自動で統一済み'),
  r('A-08', '必須項目の空欄', 'E', 'none', '講義', 'address', '値を記入するか、発送対象外としてください'),
  r('A-09', '最大文字数超過', 'W', 'none', '講義', 'address', '印字幅に収まるよう表記を調整してください'),
  // 項目定義の形式・許容値（仕様書 5.1）
  r('V-01', '形式（正規表現）不一致', 'W', 'none', '追加', 'format', '値を確認してください'),
  r('V-02', '許容値外', 'W', 'none', '追加', 'format', '許容値のいずれかに修正してください'),
  // 6.6 重複
  r('D-01', '完全一致の重複', 'I', 'none', '講義', 'dupe', '除外候補（代表レコード以外）'),
  r('D-02', '正規化後の一致', 'I', 'none', '講義', 'dupe', '除外候補（代表レコード以外）'),
  r('D-04', '重複の要確認候補', 'W', 'none', '講義', 'dupe', '同一人物か別人か判断してください（自動では除外しません）'),
];

export const RULE_MAP: Record<string, RuleDef> = Object.fromEntries(RULES.map((x) => [x.id, x]));

export const SAFE_RULES = RULES.filter((x) => x.fix === 'safe').map((x) => x.id);
export const SUGGEST_RULES = RULES.filter((x) => x.fix === 'suggest').map((x) => x.id);

export const CATEGORY_LABELS: Record<string, string> = {
  F: 'ファイル・形式',
  E: 'Excel破損疑い',
  C: '文字',
  A: '住所',
  V: '項目定義',
  D: '重複',
};

export const GROUP_LABELS: Record<ErrorGroup, string> = {
  address: '①住所・郵便番号',
  char: '②文字',
  dupe: '③重複候補',
  format: '④形式・破損疑い',
};

export const FIX_LABELS: Record<FixClass, string> = { safe: '安全', suggest: '推定', none: '不可' };
export const SEVERITY_LABELS: Record<Severity, string> = { E: 'エラー', W: '警告', I: '情報' };
