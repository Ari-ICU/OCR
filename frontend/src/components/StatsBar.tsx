"use client";

import React, { useState, useEffect } from "react";
import { Download, Copy, Check, FileDown, Layers, Sparkles, Search, Filter, FileCode, Edit3, FileText } from "lucide-react";
import { PageResult } from "./PageCard";

interface StatsBarProps {
  totalPages: number;
  completedPages: number;
  pages: PageResult[];
  filename: string;
  isProcessing: boolean;
  filterStatus: "all" | "completed" | "formulas";
  setFilterStatus: (val: "all" | "completed" | "formulas") => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
}

export const StatsBar: React.FC<StatsBarProps> = ({
  totalPages,
  completedPages,
  pages,
  filename,
  isProcessing,
  filterStatus,
  setFilterStatus,
  searchQuery,
  setSearchQuery,
}) => {
  const [copied, setCopied] = useState(false);
  const defaultBaseName = filename ? filename.replace(/\.pdf$/i, "") : "khmer_restored_document";
  const [customFileName, setCustomFileName] = useState<string>(defaultBaseName);

  // Sync custom filename when a new PDF file is uploaded
  useEffect(() => {
    if (filename) {
      setCustomFileName(filename.replace(/\.pdf$/i, ""));
    }
  }, [filename]);

  const getCleanFileName = () => {
    const raw = customFileName.trim();
    if (!raw) return defaultBaseName;
    return raw.replace(/\.(txt|md|json|pdf)$/i, "").trim() || defaultBaseName;
  };

  const getFullCorrectedText = () => {
    return pages
      .map((p) => {
        const isBlank = p.model_used === "blank-skipped" || (!p.corrected_text && !p.raw_text);
        const isEnglish = p.model_used === "english-skipped" || (p.corrected_text && p.corrected_text.includes("English Page - Skipped"));
        const content = isBlank
          ? "[ទំព័រទទេ / Blank Page]"
          : isEnglish
          ? "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]"
          : (p.corrected_text || p.raw_text);
        return `=== Page ${p.page_number} ===\n\n${content}\n`;
      })
      .join("\n");
  };

  const saveFileWithPicker = async (
    content: string,
    suggestedName: string,
    mimeType: string,
    extension: string,
    description: string
  ) => {
    // 1. Try modern File System Access API (Opens native OS "Save As..." dialog with folder browser)
    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${suggestedName}.${extension}`,
          types: [
            {
              description: description,
              accept: {
                [mimeType]: [`.${extension}`],
              },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return;
      } catch (err: any) {
        // If user cancelled the folder/file picker dialog, abort cleanly
        if (err?.name === "AbortError") return;
      }
    }

    // 2. Fallback for browsers that don't support showSaveFilePicker (standard browser download)
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${suggestedName}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyAll = () => {
    const text = getFullCorrectedText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = async () => {
    const text = getFullCorrectedText();
    const cleanName = getCleanFileName();
    await saveFileWithPicker(text, cleanName, "text/plain", "txt", "Plain Text Document (.txt)");
  };

  const handleDownloadMarkdown = async () => {
    const cleanName = getCleanFileName();
    const lines = [`# ${cleanName} - Khmer OCR & AI Restoration`, ""];
    for (const p of pages) {
      const isBlank = p.model_used === "blank-skipped" || (!p.corrected_text && !p.raw_text);
      const isEnglish = p.model_used === "english-skipped" || (p.corrected_text && p.corrected_text.includes("English Page - Skipped"));
      const content = isBlank
        ? "*[ទំព័រទទេ / Blank Page]*"
        : isEnglish
        ? "*[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]*"
        : (p.corrected_text || p.raw_text);
      lines.push(`## Page ${p.page_number}\n\n${content}\n`);
    }
    await saveFileWithPicker(lines.join("\n"), cleanName, "text/markdown", "md", "Markdown Document (.md)");
  };

  const handleDownloadJson = async () => {
    const cleanName = getCleanFileName();
    const data = {
      filename: `${cleanName}.pdf`,
      total_pages: totalPages,
      extracted_at: new Date().toISOString(),
      pages: pages.map((p) => ({
        page_number: p.page_number,
        raw_text: p.raw_text,
        corrected_text: p.corrected_text,
        model_used: p.model_used,
        elapsed_seconds: p.elapsed_seconds,
        tokens_used: p.tokens_used || 0,
        success: p.success,
      })),
    };
    await saveFileWithPicker(JSON.stringify(data, null, 2), cleanName, "application/json", "json", "JSON Data File (.json)");
  };

  const progressPercent =
    totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

  const totalChars = pages.reduce(
    (acc, p) => acc + (p.corrected_text || p.raw_text || "").length,
    0
  );

  const totalTokens = pages.reduce(
    (acc, p) => acc + (p.tokens_used || 0),
    0
  );

  const formulaPagesCount = pages.filter((p) => p.has_formulas).length;

  return (
    <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-5">
      {/* Top row: Progress info & Download Buttons */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="h-11 w-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-md">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h3 className="font-bold text-white text-base">Extraction & Restoration Progress</h3>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-semibold font-mono">
                {completedPages} / {totalPages} Pages
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium pt-0.5 flex items-center space-x-2 flex-wrap">
              <span>{totalChars.toLocaleString()} Khmer characters</span>
              {totalTokens > 0 && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-amber-400/90 font-mono font-semibold">🪙 {totalTokens.toLocaleString()} tokens consumed</span>
                </>
              )}
              <span className="text-slate-600">•</span>
              <span>{formulaPagesCount} pages with LaTeX formulas</span>
            </p>
          </div>
        </div>

        {/* Action & Download Controls */}
        <div className="flex items-center space-x-2 w-full lg:w-auto flex-wrap gap-y-2.5">
          {/* Editable File Name Input */}
          <div className="flex items-center space-x-1.5 bg-[#070A12] border border-slate-700/80 hover:border-indigo-500/60 focus-within:border-indigo-500 rounded-xl px-2.5 py-1.5 transition-all shadow-inner group">
            <FileText className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <input
              type="text"
              value={customFileName}
              onChange={(e) => setCustomFileName(e.target.value)}
              placeholder="Filename..."
              className="bg-transparent text-xs text-slate-100 font-medium focus:outline-none w-36 sm:w-48 placeholder:text-slate-600"
              title="Edit export filename for TXT, MD, and JSON downloads"
            />
            <span className="text-[10px] text-slate-500 font-mono select-none pr-1">
              .ext
            </span>
          </div>

          <button
            onClick={handleCopyAll}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all disabled:opacity-50"
            title="Copy all extracted text to clipboard"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "Copied All" : "Copy All"}</span>
          </button>

          <button
            onClick={handleDownloadTxt}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50"
            title={`Download as ${getCleanFileName()}.txt`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>TXT</span>
          </button>

          <button
            onClick={handleDownloadMarkdown}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition-all disabled:opacity-50"
            title={`Download as ${getCleanFileName()}.md`}
          >
            <FileDown className="h-3.5 w-3.5 text-indigo-400" />
            <span>Markdown (.MD)</span>
          </button>

          <button
            onClick={handleDownloadJson}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all disabled:opacity-50"
            title={`Download as ${getCleanFileName()}.json`}
          >
            <FileCode className="h-3.5 w-3.5 text-amber-400" />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400 font-mono">
          <span className="flex items-center space-x-2">
            {isProcessing ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-amber-300 font-sans">Processing pages concurrently with Gemini AI...</span>
              </>
            ) : completedPages === totalPages && totalPages > 0 ? (
              <span className="text-emerald-400 font-sans">✓ All pages successfully extracted & restored</span>
            ) : (
              <span className="font-sans">Ready</span>
            )}
          </span>
          <span className="font-semibold text-white">{progressPercent}%</span>
        </div>
        <div className="w-full h-2.5 rounded-full bg-[#070A12] overflow-hidden border border-slate-800">
          <div
            className="h-full bg-indigo-500 transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-1.5 bg-[#070A12] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${
              filterStatus === "all"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All ({pages.length})
          </button>
          <button
            onClick={() => setFilterStatus("completed")}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${
              filterStatus === "completed"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Restored ({pages.filter((p) => p.corrected_text && !p.isProcessing).length})
          </button>
          <button
            onClick={() => setFilterStatus("formulas")}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${
              filterStatus === "formulas"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Formulas ({formulaPagesCount})
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in pages..."
            className="w-full bg-[#070A12] border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2 text-slate-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

