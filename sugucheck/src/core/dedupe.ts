import { DEDUPE_KEYS, FIELD_TYPES } from './layout';
import { digitsOnly, editDistance, normalizeAddress, normalizeBasic, normalizeEmail, normalizeName } from './normalize';
import { RULE_MAP } from './rules';
import type { CandidatePair, DedupeKeyId, DupeGroup, FieldDef, Finding, Settings } from './types';

/** 重複判定に使う正規化済みの値 */
interface Rec {
  name: string;
  surname: string;
  kana: string;
  addr: string;
  postal: string;
  email: string;
  tel: string;
  member: string;
  custom: string;
  filled: number;
  updated: number;
  rawKey: string;
  empty: boolean;
}

export interface DedupeOutput {
  groups: DupeGroup[];
  candidates: CandidatePair[];
  groupOf: string[];
  excluded: (string | null)[];
  candidateIdsOf: string[][];
  householdOf: string[];
  findings: Finding[];
  skippedBuckets: string[];
  repNote: string;
}

/** 1つのキー値を共有する件数がこれを超える場合は仮値（例：none@example.com）とみなし照合しない */
const MAX_BUCKET = 50;
/** 同一住所ブロックで近似氏名を総当たりする上限件数 */
const MAX_BLOCK = 100;

function parseDate(s: string): number {
  const m = s.normalize('NFKC').match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return -Infinity;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  return Number(y) * 1e10 + Number(mo) * 1e8 + Number(d) * 1e6 + Number(h) * 1e4 + Number(mi) * 100 + Number(se);
}

function buildRecords(raw: string[][], cleaned: string[][], cols: FieldDef[], settings: Settings): Rec[] {
  const opts = { kanjiNumerals: settings.dedupe.kanjiNumerals, kanaVariants: settings.dedupe.kanaVariants };
  const idx = (t: FieldDef['type']) => cols.map((c, i) => (c.type === t ? i : -1)).filter((i) => i >= 0);
  const nameCols = idx('name');
  const lastCols = idx('name_last');
  const firstCols = idx('name_first');
  const addrCols = cols.map((c, i) => (FIELD_TYPES[c.type].address ? i : -1)).filter((i) => i >= 0);
  const first = (row: string[], is: number[]) => is.map((i) => row[i] ?? '').find((v) => v !== '') ?? '';
  const join = (row: string[], is: number[]) => is.map((i) => row[i] ?? '').join(' ');

  return cleaned.map((row, r) => {
    const nameRaw = nameCols.length ? join(row, nameCols) : `${join(row, lastCols)} ${join(row, firstCols)}`;
    const surnameRaw = lastCols.length ? join(row, lastCols) : nameRaw.trim().split(/[\s　]+/).length >= 2 ? nameRaw.trim().split(/[\s　]+/)[0] : '';
    const updatedCol = cols.findIndex((c) => c.type === 'updated');
    return {
      name: normalizeName(nameRaw),
      surname: normalizeName(surnameRaw),
      kana: normalizeName(first(row, idx('name_kana'))),
      addr: normalizeAddress(addrCols.map((i) => row[i] ?? '').join(''), opts),
      postal: digitsOnly(first(row, idx('postal'))),
      email: normalizeEmail(first(row, idx('email'))),
      tel: digitsOnly(first(row, idx('tel'))),
      member: normalizeBasic(first(row, idx('member_id'))),
      custom: settings.dedupe.customColumns.map((i) => normalizeBasic(row[i] ?? '')).join('|'),
      filled: row.filter((v) => v !== '').length,
      updated: updatedCol >= 0 ? parseDate(row[updatedCol] ?? '') : -Infinity,
      rawKey: raw[r].join('\u0000'),
      empty: row.every((v) => v === ''),
    };
  });
}

function keyValue(rec: Rec, key: DedupeKeyId): string {
  switch (key) {
    case 'P1': return rec.addr && rec.name ? `${rec.addr}|${rec.name}` : '';
    case 'P2': return rec.postal && rec.name ? `${rec.postal}|${rec.name}` : '';
    case 'P3': return rec.email;
    case 'P4': return rec.tel && rec.name ? `${rec.tel}|${rec.name}` : '';
    case 'P5': return rec.member;
    case 'P6': return rec.custom.replace(/\|/g, '') ? rec.custom : '';
  }
}

export function dedupe(raw: string[][], cleaned: string[][], cols: FieldDef[], settings: Settings): DedupeOutput {
  const n = cleaned.length;
  const recs = buildRecords(raw, cleaned, cols, settings);
  const tol = settings.dedupe.tolerance;

  // Union-Find（グループは代表を根とし、メンバー一覧を保持）
  const parent = Array.from({ length: n }, (_, i) => i);
  const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const linkedBy: string[] = Array(n).fill('');
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (ra > rb) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    members[ra].push(...members[rb]);
    members[rb] = [];
  };

  /** 2件の間で、同一人物と確定できない矛盾を返す */
  const conflict = (a: Rec, b: Rec): string | null => {
    if (a.name && b.name && a.name !== b.name) return '氏名が異なる';
    if (tol !== 'loose') {
      if (a.addr && b.addr && a.addr !== b.addr) return '住所が異なる';
      if (a.postal && b.postal && a.postal !== b.postal) return '郵便番号が異なる';
    }
    return null;
  };

  const candidateMap = new Map<string, { a: number; b: number; reasons: string[] }>();
  const addCandidate = (x: number, y: number, reason: string) => {
    const [a, b] = x < y ? [x, y] : [y, x];
    const k = `${a}:${b}`;
    const c = candidateMap.get(k);
    if (c) {
      if (!c.reasons.includes(reason)) c.reasons.push(reason);
    } else candidateMap.set(k, { a, b, reasons: [reason] });
  };

  // D-01 完全一致
  const exact = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (recs[i].empty) continue;
    const first = exact.get(recs[i].rawKey);
    if (first === undefined) exact.set(recs[i].rawKey, i);
    else {
      union(first, i);
      linkedBy[i] = '完全一致';
    }
  }

  // D-02 / D-03 正規化後のキーで多段照合
  const skippedBuckets: string[] = [];
  for (const key of settings.dedupe.keys) {
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const kv = keyValue(recs[i], key);
      if (!kv) continue;
      const b = buckets.get(kv);
      if (b) b.push(i);
      else buckets.set(kv, [i]);
    }
    let skipped = 0;
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      if (list.length > MAX_BUCKET) {
        skipped++;
        continue;
      }
      const head = list[0];
      for (const i of list.slice(1)) {
        const ra = find(head);
        const rb = find(i);
        if (ra === rb) continue;
        let why: string | null = null;
        outer: for (const x of members[ra]) {
          for (const y of members[rb]) {
            why = conflict(recs[x], recs[y]);
            if (why) break outer;
          }
        }
        if (why) addCandidate(head, i, `${DEDUPE_KEYS[key].label}は一致するが${why}`);
        else {
          union(head, i);
          if (!linkedBy[i]) linkedBy[i] = DEDUPE_KEYS[key].label;
        }
      }
    }
    if (skipped) skippedBuckets.push(`${DEDUPE_KEYS[key].label}：同一値が${MAX_BUCKET}件を超えるキー ${skipped} 種を照合対象外にしました（仮値の可能性）`);
  }

  // D-04 要確認候補：同一住所ブロック内の近似氏名
  const blocks = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (!recs[i].addr) continue;
    const b = blocks.get(recs[i].addr);
    if (b) b.push(i);
    else blocks.set(recs[i].addr, [i]);
  }
  for (const list of blocks.values()) {
    if (list.length < 2 || list.length > MAX_BLOCK) continue;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x];
        const j = list[y];
        if (find(i) === find(j)) continue;
        const a = recs[i];
        const b = recs[j];
        if (!a.name || !b.name || a.name === b.name) continue;
        const d = editDistance(a.name, b.name, 2);
        const minLen = Math.min([...a.name].length, [...b.name].length);
        if (d === 1 && minLen >= 2) addCandidate(i, j, '同一住所で氏名が1字違い（入力ミス・家族・別人の判断不能）');
        else if (tol === 'strict') {
          if (d === 2 && minLen >= 3) addCandidate(i, j, '同一住所で氏名が2字違い');
          else if (a.surname && a.surname === b.surname) addCandidate(i, j, '同一住所・同姓で名が異なる');
          else if (a.kana && a.kana === b.kana) addCandidate(i, j, '同一住所でカナ氏名が一致');
        }
      }
    }
  }

  // 代表レコードの選定（D-05）
  const updatedAvailable = cols.some((c) => c.type === 'updated');
  const rep = settings.dedupe.rep === 'latest' && !updatedAvailable ? 'first' : settings.dedupe.rep;
  const repNote =
    settings.dedupe.rep === 'latest' && !updatedAvailable
      ? '更新日列がないため「先頭」で代表を選定'
      : { latest: '最新更新日優先', filled: '入力項目数優先', first: '先頭' }[rep];
  const pickRep = (ms: number[]): number => {
    const sorted = [...ms].sort((x, y) => x - y);
    if (rep === 'first') return sorted[0];
    let best = sorted[0];
    for (const m of sorted) {
      const better = rep === 'filled' ? recs[m].filled > recs[best].filled : recs[m].updated > recs[best].updated;
      if (better) best = m;
    }
    return best;
  };

  const groupOf: string[] = Array(n).fill('');
  const excluded: (string | null)[] = Array(n).fill(null);
  const findings: Finding[] = [];
  const groups: DupeGroup[] = [];
  for (let i = 0; i < n; i++) {
    if (find(i) !== i || members[i].length < 2) continue;
    const ms = [...members[i]].sort((x, y) => x - y);
    const id = `G${String(groups.length + 1).padStart(5, '0')}`;
    const r = pickRep(ms);
    groups.push({ id, members: ms, rep: r });
    for (const m of ms) {
      groupOf[m] = id;
      if (m === r) continue;
      const ruleId = recs[m].rawKey === recs[r].rawKey ? 'D-01' : 'D-02';
      excluded[m] = ruleId;
      const via = ruleId === 'D-01' ? '完全一致' : linkedBy[m] || '正規化後の一致';
      findings.push({
        row: m, col: -1, ruleId, severity: RULE_MAP[ruleId].severity,
        message: `グループ${id}：代表 行ID ${r + 1} と重複（${via}）。除外候補`,
        recommendation: RULE_MAP[ruleId].recommendation, status: 'open', relatedRows: [r],
      });
    }
  }

  // 要確認候補（同じグループに入ったものは除く）
  const candidates: CandidatePair[] = [];
  const candidateIdsOf: string[][] = Array.from({ length: n }, () => []);
  // 重複グループのメンバー同士の候補は、グループの代表どうしの候補にまとめる
  const repOfRoot = new Map<number, number>(groups.map((g) => [find(g.rep), g.rep]));
  const repOf = (x: number) => repOfRoot.get(find(x)) ?? x;
  const collapsed = new Map<string, { a: number; b: number; reasons: string[] }>();
  for (const p of candidateMap.values()) {
    if (find(p.a) === find(p.b)) continue;
    const [a, b] = [repOf(p.a), repOf(p.b)].sort((x, y) => x - y);
    const k = `${a}:${b}`;
    const c = collapsed.get(k);
    if (c) for (const r of p.reasons) !c.reasons.includes(r) && c.reasons.push(r);
    else collapsed.set(k, { a, b, reasons: [...p.reasons] });
  }
  const sortedPairs = [...collapsed.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  for (const p of sortedPairs) {
    const id = `C${String(candidates.length + 1).padStart(5, '0')}`;
    candidates.push({ id, a: p.a, b: p.b, reasons: p.reasons });
    for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
      candidateIdsOf[x].push(id);
      findings.push({
        row: x, col: -1, ruleId: 'D-04', severity: RULE_MAP['D-04'].severity,
        message: `${id}：行ID ${y + 1} と重複の可能性（${p.reasons.join('／')}）`,
        recommendation: RULE_MAP['D-04'].recommendation, status: 'open', relatedRows: [y],
      });
    }
  }

  // 同一世帯：同じ住所に別人（別グループ）が複数いる
  const householdOf: string[] = Array(n).fill('');
  let hh = 0;
  for (const list of blocks.values()) {
    const persons = new Set(list.map((i) => find(i)));
    if (persons.size < 2) continue;
    const id = `H${String(++hh).padStart(5, '0')}`;
    for (const i of list) householdOf[i] = id;
  }

  return { groups, candidates, groupOf, excluded, candidateIdsOf, householdOf, findings, skippedBuckets, repNote };
}
