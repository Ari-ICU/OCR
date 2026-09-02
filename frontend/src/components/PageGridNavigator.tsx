"use client";

import React from "react";
import { PageResult } from "./PageCard";
import {
  FileText,
  RefreshCw,
  AlertTriangle,
  AlertCircle
} from "lucide-react";
import { detectKhmerErrors } from "../utils/khmerValidator";

interface PageGridNavigatorProps {
  pages: PageResult[];
  activePage?: number;
  onSelectPage: (pageNum: number) => void;
  onRetryFailedPages?: (model?: string) => void;
  onRetryRedLineErrors?: (model?: string) => void;
  isRetryingFailed?: boolean;
  retryingPagesCount?: number;
}

export const PageGridNavigator: React.FC<PageGridNavigatorProps> = ({
  pages,
  activePage,
  onSelectPage,
  onRetryFailedPages,
  onRetryRedLineErrors,
  isRetryingFailed = false,
  retryingPagesCount = 0,
}) => {
  if (pages.length <= 1) return null;

  // Calculate failed / raw mode pages
  const failedPages = pages.filter(
    (p) => !p.isProcessing && (!p.success || p.model_used === "fallback-raw" || !!p.error)
  );
  const failedCount = failedPages.length;

  // Calculate pages with Red Line Errors (Khmer Unicode / OCR anomalies) or failures
  const redLineErrorPages = pages.filter((p) => {
    if (p.isProcessing) return false;
    if (!p.success || p.model_used === "fallback-raw" || !!p.error) return true;
    const text = p.corrected_text || p.raw_text;
    const isDone = !!p.corrected_text;
    return isDone && detectKhmerErrors(text).length > 0;
  });
  const redLineErrorCount = redLineErrorPages.length;

  return (
    <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs text-slate-400 font-medium">
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          <span className="flex items-center space-x-1.5 text-white font-semibold">
            <FileText className="h-3.5 w-3.5 text-indigo-400" />
            <span>Page Navigator ({pages.length} Pages)</span>
          </span>

          {/* Action 1: Re-run Red Line Errors Button */}
          {onRetryRedLineErrors && redLineErrorCount > 0 && (
            <button
              type="button"
              onClick={() => onRetryRedLineErrors()}
              disabled={isRetryingFailed}
              className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-bold text-[11px] flex items-center space-x-1.5 transition active:scale-95 shadow-sm disabled:opacity-50"
              title="Re-run AI OCR on pages with red wavy line errors / Khmer Unicode anomalies"
            >
              <AlertCircle className={`h-3.5 w-3.5 text-rose-400 ${isRetryingFailed ? "animate-spin" : ""}`} />
              <span>
                {isRetryingFailed
                  ? `Re-running (${retryingPagesCount || redLineErrorCount})...`
                  : `Re-run Red Line Errors (${redLineErrorCount})`}
              </span>
            </button>
          )}

          {/* Action 2: Re-run Failed (if different from red line error count) */}
          {onRetryFailedPages && failedCount > 0 && redLineErrorCount === 0 && (
            <button
              type="button"
              onClick={() => onRetryFailedPages()}
              disabled={isRetryingFailed}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-[11px] flex items-center space-x-1.5 transition active:scale-95 shadow-sm disabled:opacity-50"
              title="Re-run AI OCR on failed / raw mode pages"
            >
              <RefreshCw className={`h-3 w-3 ${isRetryingFailed ? "animate-spin" : ""}`} />
              <span>{isRetryingFailed ? "Re-running..." : `Re-run Failed (${failedCount})`}</span>
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-3 text-[11px] text-slate-400 flex-wrap gap-y-1">
          <span className="flex items-center space-x-1" title="Pages with red border have Khmer Unicode / OCR spelling warnings">
            <span className="h-2 w-2 rounded-full bg-rose-500 inline-block shadow-sm ring-1 ring-rose-300/40" />
            <span>Red = Error / Warning</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="h-2 w-2 rounded-full bg-purple-400 inline-block shadow-sm" />
            <span>Purple Dot = Formulas</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="h-2 w-2 rounded-sm bg-indigo-600/60 inline-block" />
            <span>Restored</span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-1">
        {pages.map((p) => {
          const isDone = !!p.corrected_text && !p.isProcessing;
          const isProcessing = !!p.isProcessing;
          const isFailed = !isDone && !isProcessing && !p.success;
          
          const text = p.corrected_text || p.raw_text;
          const errorCount = isDone ? detectKhmerErrors(text).length : 0;
          const hasErrors = errorCount > 0;
          const isActive = activePage === p.page_number;

          return (
            <button
              key={p.page_number}
              onClick={() => onSelectPage(p.page_number)}
              title={`Jump to Page ${p.page_number}${
                hasErrors ? ` (${errorCount} Unicode/OCR red line error${errorCount > 1 ? 's' : ''})` : ''
              }${p.has_formulas ? ' (Contains LaTeX formulas)' : ''}${p.model_used ? ` [Model: ${p.model_used}]` : ''}`}
              className={`relative h-8 min-w-8 px-2 rounded-lg text-xs font-mono font-bold transition-all flex items-center justify-center border ${
                isProcessing
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-300 animate-pulse shadow-sm"
                  : isDone
                  ? hasErrors
                    ? "bg-indigo-600/20 border-rose-500/60 text-indigo-200 hover:bg-indigo-600/30 ring-1 ring-rose-500/40"
                    : "bg-indigo-600/20 border-indigo-500/30 text-indigo-200 hover:bg-indigo-600/40"
                  : isFailed
                  ? "bg-rose-500/25 border-rose-500/60 text-rose-200 shadow-sm"
                  : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
              } ${isActive ? "ring-2 ring-indigo-400 border-indigo-400 font-extrabold" : ""}`}
            >
              {/* Red Dot on Top-Left: Khmer Unicode / Spelling Anomaly */}
              {hasErrors && (
                <span
                  title={`${errorCount} potential Khmer Unicode / OCR red line issue${errorCount > 1 ? 's' : ''}`}
                  className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[#0D1322] shadow-sm animate-pulse"
                />
              )}

              <span>{p.page_number}</span>

              {/* Purple Dot on Top-Right: LaTeX STEM Formulas */}
              {p.has_formulas && (
                <span 
                  title="Page contains mathematical/scientific formulas"
                  className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-purple-400 ring-2 ring-[#0D1322] shadow-sm" 
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
