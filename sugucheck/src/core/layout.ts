import type { CharWidth, FieldDef, FieldType, Settings } from './types';

export interface FieldTypeMeta {
  label: string;
  /** 住所を構成する列か（住所結合・E-04・A-07の対象） */
  address: boolean;
  /** 数字主体の列か（E-06の対象） */
  numeric: boolean;
  /** ヘッダ名からの推定パターン（ヘッダ名のみを使い、データ値は使わない） */
  patterns: RegExp[];
}

export const FIELD_TYPES: Record<FieldType, FieldTypeMeta> = {
  postal: { label: '郵便番号', address: false, numeric: true, patterns: [/郵便|〒|^zip|postal|postcode|address zip/i] },
  pref: { label: '都道府県', address: true, numeric: false, patterns: [/都道府県|^県$|province(?! code)|prefecture/i] },
  city: { label: '市区町村', address: true, numeric: false, patterns: [/市区町村|市区郡|市町村|^市区|city/i] },
  street: { label: '番地', address: true, numeric: false, patterns: [/番地|町域|丁目|住所[1１]|address ?1/i] },
  building: { label: '建物名', address: true, numeric: false, patterns: [/建物|ビル|マンション|住所[2２３3]|address ?2/i] },
  address_full: { label: '住所（一括）', address: true, numeric: false, patterns: [/^(宛先)?住所$|^所在地$|^address$/i] },
  company: { label: '会社名', address: false, numeric: false, patterns: [/会社|法人|社名|団体|company/i] },
  dept: { label: '部署', address: false, numeric: false, patterns: [/部署|所属|部門|department/i] },
  title: { label: '役職', address: false, numeric: false, patterns: [/役職|肩書|職位|job title/i] },
  name: { label: '氏名', address: false, numeric: false, patterns: [/^(宛名|氏名|名前|お名前|顧客名|担当者名?|name|full ?name)$/i] },
  name_last: { label: '姓', address: false, numeric: false, patterns: [/^姓$|^苗字$|last ?name|family ?name/i] },
  name_first: { label: '名', address: false, numeric: false, patterns: [/^名$|first ?name|given ?name/i] },
  name_kana: { label: '氏名カナ', address: false, numeric: false, patterns: [/カナ|かな|フリガナ|ふりがな|kana/i] },
  tel: { label: '電話', address: false, numeric: true, patterns: [/電話|tel|phone|携帯/i] },
  email: { label: 'メール', address: false, numeric: false, patterns: [/メール|^e-?mail( address)?$/i] },
  gender: { label: '性別', address: false, numeric: false, patterns: [/性別|gender|sex/i] },
  member_id: { label: '会員ID', address: false, numeric: false, patterns: [/会員|顧客(ID|番号|コード)|customer id/i] },
  code: { label: '管理番号・コード', address: false, numeric: true, patterns: [/管理番号|コード|番号|code|^id$/i] },
  updated: { label: '更新日', address: false, numeric: false, patterns: [/更新|最終|updated|modified/i] },
  other: { label: 'その他（チェック対象外）', address: false, numeric: false, patterns: [] },
};

export const FIELD_TYPE_ORDER: FieldType[] = [
  'postal', 'pref', 'city', 'street', 'building', 'address_full', 'company', 'dept', 'title',
  'name', 'name_last', 'name_first', 'name_kana', 'tel', 'email', 'gender', 'member_id', 'code', 'updated', 'other',
];

// 判定順：より具体的な種別を先に試す
const INFER_ORDER: FieldType[] = [
  'name_kana', 'postal', 'email', 'tel', 'updated', 'pref', 'city', 'building', 'street', 'address_full',
  'company', 'dept', 'title', 'name_last', 'name_first', 'name', 'gender', 'member_id', 'code',
];

export function inferFieldType(header: string): FieldType {
  const h = header.normalize('NFKC').trim();
  for (const t of INFER_ORDER) {
    if (FIELD_TYPES[t].patterns.some((p) => p.test(h))) return t;
  }
  return 'other';
}

export type PresetId = 'dm' | 'ec';

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  requireAddress: boolean;
  defaults: (t: FieldType) => Omit<FieldDef, 'type'>;
}

const base = (width: CharWidth, required = false, maxLength: number | null = null): Omit<FieldDef, 'type'> => ({
  required, maxLength, width, pattern: '', allowed: '', fixedDigits: null,
});

export const PRESETS: Record<PresetId, Preset> = {
  dm: {
    id: 'dm',
    label: 'DM宛名（標準）',
    description: '住所4分割、会社3分割、氏名、郵便番号、電話。住所・氏名は全角、数字系は半角に統一',
    requireAddress: true,
    defaults: (t) => {
      switch (t) {
        case 'postal': return base('half', true, 8);
        case 'pref': return base('full', false, 4);
        case 'city': return base('full', false, 20);
        case 'street': return base('full', false, 30);
        case 'building': return base('full', false, 30);
        case 'address_full': return base('full', false, 60);
        case 'company': return base('full', false, 30);
        case 'dept': return base('full', false, 20);
        case 'title': return base('full', false, 15);
        case 'name': return base('full', true, 20);
        case 'name_last': return base('full', true, 10);
        case 'name_first': return base('full', false, 10);
        case 'name_kana': return base('full', false, 30);
        case 'tel': return base('half', false, 15);
        case 'email': return base('half');
        case 'gender': return { ...base('half'), allowed: '1,2' };
        case 'member_id': return base('half');
        case 'code': return base('half');
        default: return base('mixed');
      }
    },
  },
  ec: {
    id: 'ec',
    label: 'EC顧客（Shopify顧客エクスポート形式）',
    description: '列名の対応は実物のエクスポートファイルで要確認。表記は原則そのまま（数字系のみ半角）',
    requireAddress: true,
    defaults: (t) => {
      switch (t) {
        case 'postal': return base('half', true, 8);
        case 'name': return base('mixed', true);
        case 'name_last': return base('mixed', true);
        case 'tel': return base('half');
        case 'email': return base('half');
        case 'member_id': return base('half');
        default: return base('mixed');
      }
    },
  },
};

export function fieldDefFor(preset: PresetId, type: FieldType): FieldDef {
  return { type, ...PRESETS[preset].defaults(type) };
}

/** ヘッダ名から項目定義を組み立てる */
export function buildColumns(header: string[], preset: PresetId): FieldDef[] {
  const cols = header.map((h) => fieldDefFor(preset, inferFieldType(h)));
  // 姓・名が分かれている場合、「名」は必須にしない／氏名と姓が両方あれば姓の必須は外す
  const hasName = cols.some((c) => c.type === 'name');
  if (hasName) for (const c of cols) if (c.type === 'name_last') c.required = false;
  return cols;
}

export function defaultSettings(header: string[], preset: PresetId): Settings {
  return {
    layoutName: PRESETS[preset].label,
    columns: buildColumns(header, preset),
    requireAddress: PRESETS[preset].requireAddress,
    dedupe: {
      keys: ['P1', 'P2', 'P3'],
      customColumns: [],
      tolerance: 'standard',
      rep: 'first',
      kanjiNumerals: false,
      kanaVariants: false,
    },
    disabledSafe: [],
    autoSuggest: [],
    accepted: [],
    unreadableMarks: '■',
    postalHyphen: true,
  };
}

export const DEDUPE_KEYS: Record<string, { label: string; note: string }> = {
  P1: { label: 'P1：住所＋氏名', note: '' },
  P2: { label: 'P2：郵便番号＋氏名', note: '番地の表記ゆれの影響を受けない' },
  P3: { label: 'P3：メールアドレス', note: '' },
  P4: { label: 'P4：電話番号＋氏名', note: '' },
  P5: { label: 'P5：会員ID', note: '' },
  P6: { label: 'P6：ユーザー定義', note: '選択した列の組み合わせ' },
};
