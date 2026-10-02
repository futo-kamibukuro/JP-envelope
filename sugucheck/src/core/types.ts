/** 重大度：E＝エラー（発送不可・破損疑い）／W＝警告（要確認）／I＝情報 */
export type Severity = 'E' | 'W' | 'I';
/** 自動修正区分：safe＝安全（自動適用）／suggest＝推定（提案のみ）／none＝不可 */
export type FixClass = 'safe' | 'suggest' | 'none';
/** エラーリストの事象区分：①住所・郵便番号 ②文字 ③重複候補 ④形式・破損疑い */
export type ErrorGroup = 'address' | 'char' | 'dupe' | 'format';

export type FieldType =
  | 'postal'
  | 'pref'
  | 'city'
  | 'street'
  | 'building'
  | 'address_full'
  | 'company'
  | 'dept'
  | 'title'
  | 'name'
  | 'name_last'
  | 'name_first'
  | 'name_kana'
  | 'tel'
  | 'email'
  | 'gender'
  | 'member_id'
  | 'code'
  | 'updated'
  | 'other';

export type CharWidth = 'full' | 'half' | 'mixed';

/** 項目定義（仕様書 5.1） */
export interface FieldDef {
  type: FieldType;
  required: boolean;
  maxLength: number | null;
  width: CharWidth;
  /** 形式（正規表現。空なら未使用） */
  pattern: string;
  /** 許容値（カンマ区切り。空なら未使用） */
  allowed: string;
  /** 固定桁数（コード列用。E-03） */
  fixedDigits: number | null;
}

export type DedupeKeyId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
export type Tolerance = 'strict' | 'standard' | 'loose';
export type RepRule = 'latest' | 'filled' | 'first';

export interface DedupeSettings {
  /** 適用順に並べた重複キー */
  keys: DedupeKeyId[];
  /** P6（ユーザー定義）で使う列 */
  customColumns: number[];
  tolerance: Tolerance;
  rep: RepRule;
  /** 漢数字→算用数字の統一（誤変換の危険があるためオプション） */
  kanjiNumerals: boolean;
  /** ヶ／ケ／が、ノ／の 等の統一（オプション） */
  kanaVariants: boolean;
}

export interface Settings {
  layoutName: string;
  /** 列ごとの項目定義（列インデックス順） */
  columns: FieldDef[];
  /** 住所列がすべて空欄なら A-08 とする */
  requireAddress: boolean;
  dedupe: DedupeSettings;
  /** 既定ONの「安全」修正のうち、無効にしたルールID */
  disabledSafe: string[];
  /** 既定OFFの「推定」修正のうち、一括適用するルールID */
  autoSuggest: string[];
  /** 個別に承認した提案（キー：`行:列:ルールID`） */
  accepted: string[];
  /** 「読めない文字」の印（C-05） */
  unreadableMarks: string;
  /** 郵便番号をハイフン付き（123-4567）に統一するか */
  postalHyphen: boolean;
}

export interface Finding {
  /** データ行インデックス（0始まり）。ファイル全体の指摘は -1 */
  row: number;
  /** 列インデックス。行全体・ファイル全体の指摘は -1 */
  col: number;
  ruleId: string;
  severity: Severity;
  message: string;
  recommendation: string;
  /** 修正前の値 */
  before?: string;
  /** 修正後（適用済み）または修正案（提案）の値 */
  after?: string;
  /** fixed＝修正適用済み／proposed＝修正案あり・未適用／open＝修正しない */
  status: 'fixed' | 'proposed' | 'open';
  /** 修正が自動（安全）か承認（推定）か */
  fixedBy?: 'safe' | 'accepted';
  /** 重複関連：相手の行インデックス */
  relatedRows?: number[];
}

export interface ParseIssue {
  row: number;
  kind: 'colcount' | 'quote';
  detail: string;
}

export interface ParsedTable {
  header: string[];
  rows: string[][];
  /** 各データ行の元ファイル上の物理行（1始まり） */
  lines: { start: number; end: number }[];
  issues: ParseIssue[];
  delimiter: string;
  emptyLinesSkipped: number;
}

export interface FileInfo {
  name: string;
  size: number;
  sha256: string;
  encoding: string;
  encodingDetected: string;
  decodeErrors: number;
  hasBom: boolean;
  delimiter: string;
  hasHeader: boolean;
}

export interface DupeGroup {
  id: string;
  members: number[];
  rep: number;
}

export interface CandidatePair {
  id: string;
  a: number;
  b: number;
  reasons: string[];
}

export interface RowMeta {
  groupId: string;
  excluded: boolean;
  excludeRule: string;
  candidateIds: string[];
  householdId: string;
  modified: boolean;
}

export interface RuleCount {
  ruleId: string;
  open: number;
  proposed: number;
  fixed: number;
}

export interface Summary {
  totalRows: number;
  unresolved: Record<Severity, number>;
  fixed: number;
  proposed: number;
  rowsWithE: number;
  rowsWithW: number;
  byRule: RuleCount[];
  dupeGroups: number;
  excluded: number;
  candidatePairs: number;
  candidateRows: number;
  households: number;
  shippable: number;
  fileLevel: number;
  skippedKeyBuckets: string[];
}

export interface DiagnoseResult {
  header: string[];
  cleaned: string[][];
  findings: Finding[];
  rowMeta: RowMeta[];
  groups: DupeGroup[];
  candidates: CandidatePair[];
  summary: Summary;
  ranAt: string;
}
