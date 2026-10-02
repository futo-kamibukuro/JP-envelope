import type { ComponentChildren } from 'preact';
import type { Severity } from '../core/types';

const IDEO_SPACE = String.fromCharCode(0x3000);

/** 改行・タブ・前後の空白を見える形で表示する */
export function VisibleText({ value, max = 80 }: { value: string | undefined; max?: number }) {
  if (value === undefined) return <span class="missing">（列なし）</span>;
  if (value === '') return <span class="empty">　</span>;
  const chars = [...value];
  const truncated = chars.length > max;
  const shown = truncated ? chars.slice(0, max) : chars;
  const lead = shown.findIndex((c) => c !== ' ' && c !== IDEO_SPACE);
  let trail = shown.length - 1;
  while (trail >= 0 && (shown[trail] === ' ' || shown[trail] === IDEO_SPACE)) trail--;
  const parts: ComponentChildren[] = [];
  let buf = '';
  const flush = () => {
    if (buf) parts.push(buf);
    buf = '';
  };
  shown.forEach((c, i) => {
    const edge = lead === -1 || i < lead || i > trail;
    if (c === '\n') {
      flush();
      parts.push(<span class="ws" title="セル内改行">↵</span>);
    } else if (c === '\t') {
      flush();
      parts.push(<span class="ws" title="タブ">⇥</span>);
    } else if (edge && (c === ' ' || c === IDEO_SPACE)) {
      flush();
      parts.push(<span class="ws" title={c === ' ' ? '前後の半角空白' : '前後の全角空白'}>{c === ' ' ? '·' : '□'}</span>);
    } else buf += c;
  });
  flush();
  return (
    <span class="vt" title={value}>
      {parts}
      {truncated && <span class="muted">…</span>}
    </span>
  );
}

export function Sev({ s }: { s: Severity }) {
  return <span class={`sev sev-${s}`}>{s}</span>;
}

export function Card({ label, value, tone, sub }: { label: string; value: string | number; tone?: string; sub?: string }) {
  return (
    <div class={`card ${tone ?? ''}`}>
      <div class="card-label">{label}</div>
      <div class="card-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div class="card-sub">{sub}</div>}
    </div>
  );
}
