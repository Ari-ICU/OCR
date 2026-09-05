"use client";

import React, { useRef } from "react";
import {
  FileText,
  Image as ImageIcon,
  Files,
  Plus,
  X,
  RotateCcw,
  Layers,
  ArrowRight,
  Zap,
  Sparkles,
} from "lucide-react";
import { FileBreakdownItem } from "../../types";

interface ActiveFileTrayProps {
  activeFileList: File[];
  isMultiple: boolean;
  isAllPdfs: boolean;
  isImageFile: boolean;
  totalFileSize: number;
  totalPdfPages: number;
  existingPagesCount: number;
  sessionRestored?: boolean;
  isProcessing: boolean;
  multiPdfMode: "merged" | "batch";
  setMultiPdfMode?: (mode: "merged" | "batch") => void;
  filesBreakdown: FileBreakdownItem[];
  onRemoveFile?: (index: number) => void;
  onAddFiles?: (files: File[]) => void;
  onClearFile: () => void;
  onClearExtractedPages?: () => void;
  startPage: number;
  setStartPage: (p: number) => void;
  endPage: number | null;
  setEndPage: (p: number | null) => void;
  startInput: string;
  endInput: string;
  onStartInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStartInputBlur: () => void;
  onEndInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEndInputBlur: () => void;
  concurrency: number;
  setConcurrency: (val: number) => void;
  onStartProcessing: () => void;
  formatFileSize: (bytes: number) => string;
  existingPageNumbers: number[];
}

export const ActiveFileTray: React.FC<ActiveFileTrayProps> = ({
  activeFileList,
  isMultiple,
  isAllPdfs,
  isImageFile,
  totalFileSize,
  totalPdfPages,
  existingPagesCount,
  sessionRestored,
  isProcessing,
  multiPdfMode,
  setMultiPdfMode,
  filesBreakdown,
  onRemoveFile,
  onAddFiles,
  onClearFile,
  onClearExtractedPages,
  startPage,
  setStartPage,
  endPage,
  setEndPage,
  startInput,
  endInput,
  onStartInputChange,
  onStartInputBlur,
  onEndInputChange,
  onEndInputBlur,
  concurrency,
  setConcurrency,
  onStartProcessing,
  formatFileSize,
  existingPageNumbers,
}) => {
  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAddFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onAddFiles) {
      onAddFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const maxExtractedPage = existingPageNumbers.length > 0 ? Math.max(...existingPageNumbers) : 0;
  const nextStart = Math.min(maxExtractedPage + 1, totalPdfPages || 1);
  const currentSpan = Math.max(1, (endPage || 1) - startPage + 1);

  const handleSetAllRemaining = () => {
    setStartPage(nextStart);
    setEndPage(totalPdfPages || null);
  };

  const handleSetNextBatch = () => {
    setStartPage(nextStart);
    setEndPage(Math.min(nextStart + currentSpan - 1, totalPdfPages || nextStart));
  };

  return (
    <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4">
      {/* File Information Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center space-x-3.5">
          <div className="h-11 w-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 shadow-md">
            {isImageFile ? <ImageIcon className="h-5 w-5 text-indigo-400" /> : isMultiple ? <Files className="h-5 w-5 text-indigo-400" /> : <FileText className="h-5 w-5" />}
          </div>
          <div className="overflow-hidden">
            <h4 className="text-sm font-semibold text-white truncate max-w-xs sm:max-w-md">
              {isMultiple
                ? isAllPdfs
                  ? `${activeFileList.length} PDF Documents Selected`
                  : isImageFile
                  ? `${activeFileList.length} Images Selected`
                  : `${activeFileList.length} Files Selected`
                : activeFileList[0]?.name}
            </h4>
            <div className="flex items-center space-x-2 text-xs text-slate-400 font-medium pt-0.5 flex-wrap gap-y-1">
              <span>{formatFileSize(totalFileSize)}</span>
              <span>•</span>
              <span>
                {totalPdfPages > 0
                  ? `${totalPdfPages} Total Pages (${activeFileList.length} ${activeFileList.length === 1 ? "File" : "Files"})`
                  : `${activeFileList.length} File${activeFileList.length > 1 ? "s" : ""}`}
              </span>
              {existingPagesCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    {existingPagesCount} Pages Restored
                  </span>
                </>
              )}
              {sessionRestored && (
                <>
                  <span>•</span>
                  <span className="text-indigo-300 font-medium bg-indigo-500/15 px-2 py-0.5 rounded-md border border-indigo-500/25">
                    💾 Auto-Saved
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
          {existingPagesCount > 0 && onClearExtractedPages && !isProcessing && (
            <button
              type="button"
              onClick={onClearExtractedPages}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 transition-all cursor-pointer"
              title="Clear extracted pages to start fresh"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset / Clear</span>
            </button>
          )}

          {!isProcessing && (
            <button
              type="button"
              onClick={onClearFile}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700 transition-colors cursor-pointer"
              title="Clear files and choose different document"
            >
              <X className="h-3.5 w-3.5" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* MULTI-FILE TRAY: Displays all uploaded PDFs / images with individual remove & "+ Add More" */}
      {activeFileList.length > 0 && (
        <div className="bg-[#070A12] border border-slate-800/90 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold">
              <Files className="h-4 w-4 text-indigo-400" />
              <span>Uploaded Files ({activeFileList.length})</span>
            </div>

            {setMultiPdfMode && isMultiple && (
              <div className="flex items-center bg-slate-900/90 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setMultiPdfMode("merged")}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                    multiPdfMode === "merged"
                      ? "bg-indigo-600 text-white shadow-sm font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title="Merge all PDFs sequentially into one continuous document"
                >
                  <Layers className="h-3 w-3" />
                  <span>Merged Document</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setMultiPdfMode("batch")}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                    multiPdfMode === "batch"
                      ? "bg-indigo-600 text-white shadow-sm font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title="Keep PDFs separate with document tabs and ZIP export"
                >
                  <Files className="h-3 w-3" />
                  <span>Batch Queue</span>
                </button>
              </div>
            )}

            {!isProcessing && onAddFiles && (
              <div>
                <input
                  type="file"
                  ref={addFileInputRef}
                  onChange={handleAddFileInputChange}
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tiff,application/pdf,image/*"
                  multiple
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => addFileInputRef.current?.click()}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs text-indigo-300 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition-all font-medium cursor-pointer"
                  title="Add more PDF or image files to the current selection"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add More PDFs</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
            {activeFileList.map((file, idx) => {
              const bd = filesBreakdown.find((b) => b.filename === file.name);
              const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
              return (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center space-x-2 bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 transition-colors group"
                >
                  {isPdf ? (
                    <FileText className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                  )}
                  <span className="font-mono text-[11px] truncate max-w-[160px] sm:max-w-[220px]" title={file.name}>
                    {file.name}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {formatFileSize(file.size)}
                  </span>
                  {bd && bd.pages > 0 ? (
                    <span className="text-[10px] bg-indigo-950/70 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 font-mono font-medium">
                      {bd.pages} {bd.pages === 1 ? "page" : "pages"}
                    </span>
                  ) : (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700 font-mono animate-pulse">
                      reading...
                    </span>
                  )}
                  {!isProcessing && onRemoveFile && activeFileList.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveFile(idx)}
                      className="text-slate-500 hover:text-rose-400 p-0.5 rounded transition-colors cursor-pointer"
                      title={`Remove ${file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {isMultiple && (
            <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 flex items-center justify-between flex-wrap gap-1">
              <span>
                {multiPdfMode === "merged" ? (
                  <span className="text-indigo-300">
                    ⚡ <strong>Merged Mode:</strong> All {activeFileList.length} documents will be unified into 1 sequence (Pages 1 to {totalPdfPages || activeFileList.length}).
                  </span>
                ) : (
                  <span className="text-emerald-300">
                    📁 <strong>Batch Mode:</strong> Documents will be tracked individually with document filter tabs &amp; Batch ZIP download.
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-500">
                Total: {activeFileList.length} files • {formatFileSize(totalFileSize)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Configuration Controls Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
        {/* Page Range Selection with Free-Type Numeric Inputs */}
        <div className="bg-[#070A12] border border-slate-800 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center space-x-1.5">
              <Layers className="h-3.5 w-3.5 text-purple-400" />
              <span>Page Range</span>
            </span>

            {maxExtractedPage > 0 && maxExtractedPage < totalPdfPages && (
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleSetAllRemaining}
                  className="inline-flex items-center space-x-1 text-[10px] text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 rounded-md border border-indigo-500/30 font-medium transition-all cursor-pointer"
                  title="Continue all remaining unfinished pages to the end"
                >
                  <span>Continue: {nextStart}-{totalPdfPages}</span>
                  <ArrowRight className="h-2.5 w-2.5" />
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleSetNextBatch}
                  className="inline-flex items-center space-x-1 text-[10px] text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 px-1.5 py-0.5 rounded-md border border-emerald-500/30 font-medium transition-all cursor-pointer"
                  title="Process next small chunk"
                >
                  <span>+{currentSpan} pgs</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 flex-1">
              <span className="text-[11px] text-slate-500 font-medium select-none">From:</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isProcessing}
                value={startInput}
                onChange={onStartInputChange}
                onBlur={onStartInputBlur}
                placeholder="1"
                className="w-full bg-slate-800 border border-slate-700 hover:border-indigo-500 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-white text-center focus:outline-none font-mono font-semibold transition-all shadow-inner"
              />
            </div>

            <div className="flex items-center space-x-1.5 flex-1">
              <span className="text-[11px] text-slate-500 font-medium select-none">To:</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isProcessing}
                placeholder={totalPdfPages > 0 ? String(totalPdfPages) : "End"}
                value={endInput}
                onChange={onEndInputChange}
                onBlur={onEndInputBlur}
                className="w-full bg-slate-800 border border-slate-700 hover:border-indigo-500 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-white text-center focus:outline-none font-mono font-semibold transition-all shadow-inner placeholder:text-slate-500"
              />
            </div>
          </div>
        </div>

        {/* Speed & Concurrency Selector */}
        <div className="bg-[#070A12] border border-slate-800 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center space-x-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>Concurrency Speed</span>
            </span>
            <span className="text-[10px] text-amber-400 font-mono">{concurrency} Workers</span>
          </div>
          <div className="flex space-x-1.5">
            {[1, 2].map((speed) => (
              <button
                key={speed}
                type="button"
                disabled={isProcessing}
                onClick={() => setConcurrency(speed)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all text-center cursor-pointer ${
                  concurrency === speed
                    ? "bg-amber-600/90 text-white shadow-md font-bold"
                    : "text-slate-400 hover:text-white bg-slate-800/60"
                }`}
              >
                {speed}x {speed === 1 ? "(1 Worker)" : "(2 Workers)"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Action Trigger Button */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-slate-400 font-medium text-center sm:text-left">
          {existingPagesCount > 0 ? (
            <span className="text-indigo-300">
              ⚡ Auto-Resume: Extracting pages <strong>{startPage} to {endPage || totalPdfPages || startPage}</strong> ({existingPagesCount} completed pages will be auto-skipped).
            </span>
          ) : (
            <span>
              Extracting {isMultiple ? `${activeFileList.length} documents` : "document"} (pages <strong>{startPage} to {endPage || totalPdfPages || startPage}</strong>)
            </span>
          )}
        </div>

        <button
          onClick={onStartProcessing}
          disabled={isProcessing}
          className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-semibold text-white transition-all cursor-pointer ${
            isProcessing
              ? "bg-indigo-600/50 cursor-not-allowed opacity-80"
              : "bg-indigo-600 hover:bg-indigo-500 shadow-sm"
          }`}
        >
          <Sparkles className={`h-4 w-4 ${isProcessing ? "animate-spin" : ""}`} />
          <span>
            {isProcessing
              ? "Processing Live Batch..."
              : existingPagesCount > 0
              ? `Extract & Append (Pages ${startPage} - ${endPage || totalPdfPages || startPage})`
              : `Start Vision OCR (Pages ${startPage} - ${endPage || totalPdfPages || startPage})`}
          </span>
        </button>
      </div>
    </div>
  );
};
