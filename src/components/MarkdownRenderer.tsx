import React, { useState, useMemo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import python from 'highlight.js/lib/languages/python';
import diff from 'highlight.js/lib/languages/diff';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import { Copy, Check } from 'lucide-react';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const highlightedHtml = useMemo(() => {
    const cleanLang = (language || '').toLowerCase();
    try {
      if (cleanLang && hljs.getLanguage(cleanLang)) {
        return hljs.highlight(code, { language: cleanLang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return '';
    }
  }, [code, language]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be restricted in sandboxed iframes
    }
  };

  return (
    <div className="my-3 rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] overflow-hidden">
      <div className="px-3 py-1.5 bg-[var(--gr-surface-elevated)] border-b border-[var(--gr-border)] flex items-center justify-between gap-2 text-[12px]">
        <span className="font-mono text-[var(--gr-muted)]">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--gr-muted)] hover:text-[var(--gr-text)] transition-colors duration-150 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[var(--gr-accent-text)]" />
              <span className="text-[var(--gr-accent-text)]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono">
        {highlightedHtml ? (
          <code
            className="hljs font-mono"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <code className="font-mono text-[var(--gr-text)]">{code}</code>
        )}
      </pre>
    </div>
  );
};

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isStreaming = false,
  className = '',
}) => {
  const components: Components = useMemo(
    () => ({
      h1: ({ children }) => (
        <h1 className="text-[18px] font-semibold text-[var(--gr-text)] mt-4 mb-2 first:mt-0 leading-snug">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-[16px] font-semibold text-[var(--gr-text)] mt-4 mb-2 first:mt-0 leading-snug">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-[14px] font-semibold text-[var(--gr-text)] mt-3.5 mb-1.5 first:mt-0 leading-snug">
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 className="text-[13px] font-semibold text-[var(--gr-text)] mt-3 mb-1 first:mt-0">
          {children}
        </h4>
      ),
      p: ({ children }) => (
        <p className="text-[14px] text-[var(--gr-text)] leading-[1.65] my-2 first:mt-0 last:mb-0">
          {children}
        </p>
      ),
      ul: ({ children }) => (
        <ul className="my-2 pl-5 list-disc space-y-1.5 text-[14px] text-[var(--gr-text)] leading-[1.65]">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-2 pl-5 list-decimal space-y-1.5 text-[14px] text-[var(--gr-text)] leading-[1.65]">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="pl-0.5">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-3 pl-3.5 border-l-2 border-[#E0A458] text-[var(--gr-muted)] italic">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-4 border-t border-[var(--gr-border)]" />,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--gr-accent-text)] underline underline-offset-2 hover:opacity-80"
        >
          {children}
        </a>
      ),
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto rounded-lg border border-[var(--gr-border)]">
          <table className="w-full text-left border-collapse text-[12px]">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-[var(--gr-surface-elevated)] border-b border-[var(--gr-border)] text-[var(--gr-muted)]">
          {children}
        </thead>
      ),
      th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
      td: ({ children }) => (
        <td className="px-3 py-2 border-t border-[var(--gr-border)] text-[var(--gr-text)]">
          {children}
        </td>
      ),
      pre: ({ children }) => <>{children}</>,
      code: ({ className: codeClassName, children, ...props }) => {
        const match = /language-([A-Za-z0-9_-]+)/.exec(codeClassName || '');
        const textValue = String(children ?? '').replace(/\n$/, '');
        const isBlock = Boolean(match) || textValue.includes('\n');

        if (isBlock) {
          return <CodeBlock language={match?.[1] || ''} code={textValue} />;
        }

        return (
          <code
            {...props}
            className="px-1.5 py-0.5 rounded bg-[var(--gr-surface-elevated)] border border-[var(--gr-border)]/60 font-mono text-[0.88em] text-[var(--gr-text)]"
          >
            {children}
          </code>
        );
      },
    }),
    []
  );

  return (
    <div className={`max-w-[70ch] break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span
          aria-label="Generating response"
          className="inline-block w-2 h-4 ml-1 align-middle bg-[#E0A458] animate-pulse rounded-xs"
        />
      )}
    </div>
  );
};
