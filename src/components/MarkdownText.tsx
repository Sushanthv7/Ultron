import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownTextProps {
  content: string;
}

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.85em] text-amber-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-white/10 bg-[#07090E]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-xs text-slate-400">
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-red-500"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2.5 text-[15px] leading-[1.65] text-slate-200">
      {segments.map((segment, index) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const inner = segment.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const lang = firstNewline !== -1 ? inner.slice(0, firstNewline).trim() : '';
          const code = firstNewline !== -1 ? inner.slice(firstNewline + 1) : inner;
          return <CodeBlock key={index} code={code.replace(/\n$/, '')} lang={lang} />;
        }

        const lines = segment.split('\n');
        const blocks: React.ReactNode[] = [];
        let listBuffer: { ordered: boolean; items: string[] } | null = null;

        const flushList = (keyPrefix: string) => {
          if (!listBuffer) return;
          if (listBuffer.ordered) {
            blocks.push(
              <ol
                key={`${keyPrefix}-ol`}
                className="list-decimal space-y-1.5 pl-5 text-slate-200"
              >
                {listBuffer.items.map((item, idx) => (
                  <li key={idx}>{renderInline(item)}</li>
                ))}
              </ol>,
            );
          } else {
            blocks.push(
              <ul
                key={`${keyPrefix}-ul`}
                className="list-disc space-y-1.5 pl-5 text-slate-200"
              >
                {listBuffer.items.map((item, idx) => (
                  <li key={idx}>{renderInline(item)}</li>
                ))}
              </ul>,
            );
          }
          listBuffer = null;
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();
          const keyPrefix = `${index}-${lineIdx}`;

          if (!trimmed) {
            flushList(keyPrefix);
            return;
          }

          const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
          if (headingMatch) {
            flushList(keyPrefix);
            const level = headingMatch[1].length;
            const headingText = headingMatch[2];
            blocks.push(
              <div
                key={keyPrefix}
                className={
                  level === 1
                    ? 'pt-1 font-display text-lg font-semibold text-white'
                    : 'pt-1 font-display text-base font-semibold text-slate-100'
                }
              >
                {renderInline(headingText)}
              </div>,
            );
            return;
          }

          const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
          if (ulMatch) {
            if (!listBuffer || listBuffer.ordered) {
              flushList(keyPrefix);
              listBuffer = { ordered: false, items: [] };
            }
            listBuffer.items.push(ulMatch[1]);
            return;
          }

          const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
          if (olMatch) {
            if (!listBuffer || !listBuffer.ordered) {
              flushList(keyPrefix);
              listBuffer = { ordered: true, items: [] };
            }
            listBuffer.items.push(olMatch[1]);
            return;
          }

          flushList(keyPrefix);
          blocks.push(
            <p key={keyPrefix} className="text-slate-200">
              {renderInline(trimmed)}
            </p>,
          );
        });

        flushList(`${index}-end`);
        return <React.Fragment key={index}>{blocks}</React.Fragment>;
      })}
    </div>
  );
}
