"use client";

import React, { useMemo, useState } from "react";
import katex from "katex";
import { Check, Copy, AlertCircle } from "lucide-react";
import { detectKhmerErrors, KhmerIssue } from "../utils/khmerValidator";

interface MathRendererProps {
  content: string;
  className?: string;
  allowCopyFormula?: boolean;
  highlightErrors?: boolean;
}

/**
 * Parses mixed text and LaTeX formulas ($...$ for inline, $$...$$ for display),
 * renders equations with KaTeX, and highlights broken Khmer Unicode sequences with red wavy lines.
 */
export const MathRenderer: React.FC<MathRendererProps> = ({
  content,
  className = "",
  allowCopyFormula = true,
  highlightErrors = true,
}) => {
  const [copiedMath, setCopiedMath] = useState<string | null>(null);

  const handleCopy = (mathText: string) => {
    navigator.clipboard.writeText(mathText);
    setCopiedMath(mathText);
    setTimeout(() => setCopiedMath(null), 2000);
  };

  /**
   * Helper that checks plain text segments and renders red wavy lines on broken sequences.
   */
  const renderTextWithKhmerErrorHighlights = (text: string) => {
    if (!highlightErrors) {
      return <span className="whitespace-pre-wrap">{text}</span>;
    }

    const issues = detectKhmerErrors(text);
    if (issues.length === 0) {
      return <span className="whitespace-pre-wrap">{text}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastIdx = 0;

    issues.forEach((issue, idx) => {
      // Preceding safe text
      if (issue.start > lastIdx) {
        elements.push(
          <span key={`text-${idx}`} className="whitespace-pre-wrap">
            {text.slice(lastIdx, issue.start)}
          </span>
        );
      }

      // Red wavy error highlighted fragment
      elements.push(
        <span
          key={`err-${idx}`}
          title={`⚠️ [Khmer Unicode Warning]: ${issue.message}`}
          className="relative inline-block underline decoration-wavy decoration-rose-500 decoration-2 underline-offset-4 text-rose-200 bg-rose-500/15 px-1 py-0.5 rounded cursor-help font-khmer group mx-0.5"
        >
          {issue.text}
          {/* Floating Tooltip */}
          <span className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1 rounded-lg bg-[#070A12] border border-rose-500/40 text-rose-300 text-[10px] font-sans font-medium whitespace-nowrap z-30 shadow-2xl pointer-events-none">
            {issue.message}
          </span>
        </span>
      );

      lastIdx = issue.end;
    });

    // Remaining trailing text
    if (lastIdx < text.length) {
      elements.push(
        <span key="trailing-text" className="whitespace-pre-wrap">
          {text.slice(lastIdx)}
        </span>
      );
    }

    return <>{elements}</>;
  };

  const renderedElements = useMemo(() => {
    if (!content) return [];

    // Split content by display math ($$...$$) and inline math ($...$)
    const regex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g;
    const parts = content.split(regex);

    return parts.map((part, index) => {
      if (part.startsWith("$$") && part.endsWith("$$") && part.length >= 4) {
        const math = part.slice(2, -2).trim();
        try {
          const html = katex.renderToString(math, {
            displayMode: true,
            throwOnError: false,
          });
          return (
            <div
              key={index}
              className="group relative my-3 py-2.5 px-4 bg-[#070A12] rounded-xl border border-indigo-500/20 overflow-x-auto text-indigo-100 text-center shadow-inner"
            >
              {allowCopyFormula && (
                <button
                  onClick={() => handleCopy(math)}
                  title="Copy LaTeX formula"
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] flex items-center space-x-1"
                >
                  {copiedMath === math ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              )}
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          );
        } catch {
          return (
            <span
              key={index}
              title="LaTeX parsing error"
              className="font-mono text-rose-300 bg-rose-950/40 px-1.5 py-0.5 rounded text-xs border border-rose-500/30 underline decoration-wavy decoration-rose-500 underline-offset-4"
            >
              {part}
            </span>
          );
        }
      } else if (part.startsWith("$") && part.endsWith("$") && part.length >= 2) {
        const math = part.slice(1, -1).trim();
        try {
          const html = katex.renderToString(math, {
            displayMode: false,
            throwOnError: false,
          });
          return (
            <span
              key={index}
              className="inline-block px-1 py-0.5 text-indigo-200 font-medium"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return (
            <span
              key={index}
              title="LaTeX parsing error"
              className="font-mono text-rose-300 bg-rose-950/40 px-1.5 py-0.5 rounded text-xs border border-rose-500/30 underline decoration-wavy decoration-rose-500 underline-offset-4"
            >
              {part}
            </span>
          );
        }
      } else {
        return (
          <React.Fragment key={index}>
            {renderTextWithKhmerErrorHighlights(part)}
          </React.Fragment>
        );
      }
    });
  }, [content, highlightErrors, allowCopyFormula, copiedMath]);

  return <div className={`leading-relaxed ${className}`}>{renderedElements}</div>;
};
