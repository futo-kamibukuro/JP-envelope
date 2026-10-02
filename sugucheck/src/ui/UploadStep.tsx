import { useState } from 'preact/hooks';

interface Props {
  onFile: (f: File | { name: string; bytes: ArrayBuffer }) => void;
}

export function UploadStep({ onFile }: Props) {
  const [over, setOver] = useState(false);

  async function loadSample() {
    const res = await fetch('./samples/sample_dm_list.csv');
    onFile({ name: 'sample_dm_list.csv', bytes: await res.arrayBuffer() });
  }

  return (
    <section class="panel">
      <h2>リストファイルを選択</h2>
      <label
        class={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) onFile(f);
        }}
      >
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) onFile(f);
            (e.target as HTMLInputElement).value = '';
          }}
        />
        <div class="dz-icon">📄</div>
        <div class="dz-main">ここにCSV／TSVファイルをドロップ、またはクリックして選択</div>
        <div class="dz-sub">UTF-8（BOM有無）・Shift_JIS（CP932）・EUC-JP を自動判定します。全列を文字列として読み込み、先頭0や桁を変えません。</div>
      </label>
      <div class="row gap">
        <button class="btn" onClick={loadSample}>サンプルデータで試す</button>
        <span class="muted">講義の事例（名寄せ6件・Excel破損・外字など）を含むサンプルです</span>
      </div>

      <div class="info-grid">
        <div>
          <h3>対応ファイル（v0.1）</h3>
          <ul>
            <li>CSV／TSV（.csv .tsv .txt）、上限200MB・10万行程度を想定</li>
            <li>Excel（.xlsx）は v0.2 で対応予定。マクロ付き（.xlsm）は受け付けません</li>
          </ul>
        </div>
        <div>
          <h3>個人情報の取り扱い</h3>
          <ul>
            <li>ファイルはこのブラウザのメモリ内だけで処理し、サーバーや生成AIには送信しません</li>
            <li>ブラウザに保存もしません。「データを消去」またはタブを閉じると消えます</li>
          </ul>
        </div>
        <div>
          <h3>処理の方針</h3>
          <ul>
            <li>確実に安全な修正だけを自動で行い、すべて修正ログに残します</li>
            <li>判断が必要なものはエラーリスト（事象別）にしてクライアントに戻します</li>
            <li>重複はレコードを削除せず、除外候補フラグを付けます</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
