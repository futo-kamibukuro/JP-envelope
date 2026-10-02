/**
 * 最小構成の xlsx 書き出し。全セルを文字列（inlineStr）で書き、
 * 既定の書式も「文字列（@）」にして、Excel で開いても先頭0・桁が保持されるようにする。
 */
import { zipSync, strToU8 } from 'fflate';

export type CellStyle = 'normal' | 'header' | 'title' | 'input' | 'label';

export interface SheetRow {
  cells: string[];
  style?: CellStyle;
  /** セルごとの書式（style より優先） */
  cellStyles?: (CellStyle | undefined)[];
}

export interface Sheet {
  name: string;
  rows: SheetRow[];
  colWidths?: number[];
  /** 固定する行数（見出し行） */
  freezeRows?: number;
  /** オートフィルタ範囲の見出し行（1始まり） */
  autoFilterRow?: number;
  /** リスト入力規則 */
  validations?: { col: number; fromRow: number; toRow: number; values: string[] }[];
}

const STYLE_INDEX: Record<CellStyle, number> = { normal: 0, header: 1, title: 2, input: 3, label: 4 };

export function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** XML 1.0 で使えない制御文字は OOXML のエスケープ（_xHHHH_）で表す */
export function xmlText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) {
      out += '_x' + c.toString(16).toUpperCase().padStart(4, '0') + '_';
    } else if (ch === '_' && /^_x[0-9A-Fa-f]{4}_/.test(s.slice(i, i + 7))) {
      out += '_x005F_';
    } else out += ch;
  }
  return out;
}

const MAX_CELL = 32767;

function sheetXml(sheet: Sheet): Uint8Array {
  const chunks: Uint8Array[] = [];
  let buf = '';
  const flush = () => {
    if (buf) chunks.push(strToU8(buf));
    buf = '';
  };
  const ncol = sheet.rows.reduce((m, r) => Math.max(m, r.cells.length), 1);
  const cols = Array.from({ length: ncol }, (_, i) => colName(i));

  buf += '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  buf += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  if (sheet.freezeRows) {
    buf += `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  }
  buf += '<sheetFormatPr defaultRowHeight="18"/>';
  buf += '<cols>';
  for (let i = 0; i < ncol; i++) {
    const w = sheet.colWidths?.[i] ?? 14;
    buf += `<col min="${i + 1}" max="${i + 1}" width="${w}" style="0" customWidth="1"/>`;
  }
  buf += '</cols><sheetData>';
  sheet.rows.forEach((row, r) => {
    buf += `<row r="${r + 1}">`;
    row.cells.forEach((v, c) => {
      const st = STYLE_INDEX[row.cellStyles?.[c] ?? row.style ?? 'normal'];
      const ref = cols[c] + (r + 1);
      if (v === '' || v === undefined || v === null) {
        if (st) buf += `<c r="${ref}" s="${st}"/>`;
        return;
      }
      const text = v.length > MAX_CELL ? v.slice(0, MAX_CELL) : v;
      const space = /^[\s]|[\s]$/.test(text) ? ' xml:space="preserve"' : '';
      buf += `<c r="${ref}" s="${st}" t="inlineStr"><is><t${space}>${xmlText(text)}</t></is></c>`;
    });
    buf += '</row>';
    if (buf.length > 1 << 20) flush();
  });
  buf += '</sheetData>';
  if (sheet.autoFilterRow) {
    buf += `<autoFilter ref="A${sheet.autoFilterRow}:${colName(ncol - 1)}${Math.max(sheet.rows.length, sheet.autoFilterRow)}"/>`;
  }
  if (sheet.validations?.length) {
    buf += `<dataValidations count="${sheet.validations.length}">`;
    for (const v of sheet.validations) {
      const list = v.values.map((x) => x.replace(/"/g, '')).join(',');
      buf += `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${colName(v.col)}${v.fromRow}:${colName(v.col)}${Math.max(v.toRow, v.fromRow)}"><formula1>${xmlText(`"${list}"`)}</formula1></dataValidation>`;
    }
    buf += '</dataValidations>';
  }
  buf += '</worksheet>';
  flush();
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="14"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDE6F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF5CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function safeSheetName(name: string, used: Set<string>): string {
  let s = name.replace(/[\[\]:*?\/\\]/g, '_').slice(0, 31) || 'Sheet';
  let k = 2;
  const baseName = s;
  while (used.has(s)) s = `${baseName.slice(0, 28)}(${k++})`;
  used.add(s);
  return s;
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
  );
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  files['xl/workbook.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' +
      (sheets.some((s) => s.autoFilterRow)
        ? '<definedNames>' +
          sheets
            .map((s, i) =>
              s.autoFilterRow
                ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlText(names[i].replace(/'/g, "''"))}'!$A$${s.autoFilterRow}:$${colName(s.rows.reduce((m, r) => Math.max(m, r.cells.length), 1) - 1)}$${Math.max(s.rows.length, s.autoFilterRow)}</definedName>`
                : '',
            )
            .join('') +
          '</definedNames>'
        : '') +
      '</workbook>',
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  files['xl/styles.xml'] = strToU8(STYLES);
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s)));
  return zipSync(files, { level: 6 });
}
