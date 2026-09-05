"use client";

import React, { useState } from "react";
import {
  Link as LinkIcon,
  Search,
  Loader2,
  Database,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Zap,
  SlidersHorizontal,
  FileUp,
  X,
  Layers,
} from "lucide-react";
import { InspectStoreResult } from "../../types";

interface UrlImportBarProps {
  urlInput: string;
  setUrlInput: (val: string) => void;
  urlMode: "single" | "batch";
  setUrlMode: (mode: "single" | "batch") => void;
  batchUrlsInput: string;
  setBatchUrlsInput: (val: string) => void;
  isInspecting: boolean;
  storeInspection: InspectStoreResult | null;
  setStoreInspection: (res: InspectStoreResult | null) => void;
  isConvertingUrl: boolean;
  isFetchingUrl: boolean;
  isProcessingBatch: boolean;
  isProcessing: boolean;
  activeFilesCount: number;
  handleInspectStoreUrl: (urlOverride?: string) => Promise<void>;
  handleConvertUrlToTxt: (e?: React.FormEvent) => Promise<void>;
  handleFetchFromUrl: (specificUrl?: string) => Promise<void>;
  handleConvertBatchUrlsToTxt: () => Promise<void>;
  onProcessUrlStream?: (url: string, start?: number, end?: number | null) => Promise<void>;
  startInput: string;
  endInput: string;
  handleStartInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleStartInputBlur: () => void;
  handleEndInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleEndInputBlur: () => void;
}

export const UrlImportBar: React.FC<UrlImportBarProps> = ({
  urlInput,
  setUrlInput,
  urlMode,
  setUrlMode,
  batchUrlsInput,
  setBatchUrlsInput,
  isInspecting,
  storeInspection,
  setStoreInspection,
  isConvertingUrl,
  isFetchingUrl,
  isProcessingBatch,
  isProcessing,
  activeFilesCount,
  handleInspectStoreUrl,
  handleConvertUrlToTxt,
  handleFetchFromUrl,
  handleConvertBatchUrlsToTxt,
  onProcessUrlStream,
  startInput,
  endInput,
  handleStartInputChange,
  handleStartInputBlur,
  handleEndInputChange,
  handleEndInputBlur,
}) => {
  const [showPageRange, setShowPageRange] = useState(false);

  return (
    <div className="border border-slate-800 rounded-3xl p-6 sm:p-8 bg-[#0D1322] shadow-xl space-y-5">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
          <Zap className="h-6 w-6 text-indigo-400" />
        </div>
        <h3 className="text-sm sm:text-base font-semibold text-white flex items-center justify-center gap-2">
          <span>Server & Database PDF ➔ TXT</span>
          <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Zero Local Download
          </span>
        </h3>
        <p className="text-xs text-slate-400 max-w-xl mx-auto font-khmer leading-relaxed">
          បំប្លែងឯកសារ PDF ផ្ទាល់ពី URL ឬ Database API ដោយស្វ័យប្រវត្តទៅជា <code className="text-indigo-300 font-mono">./txt/</code> និង <code className="text-indigo-300 font-mono">./jsonl/</code> ដោយមិនបាច់ Download មកកុំព្យូទ័រឡើយ
        </p>
      </div>

      {/* Mode Toggle: Single / Database URL vs Batch Multi-Line URLs */}
      <div className="flex items-center justify-center">
        <div className="inline-flex p-1 rounded-xl bg-slate-900/90 border border-slate-800">
          <button
            type="button"
            onClick={() => setUrlMode("single")}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              urlMode === "single"
                ? "bg-indigo-600 text-white shadow-sm font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <LinkIcon className="h-3 w-3" />
            <span>Single / Database API</span>
          </button>
          <button
            type="button"
            onClick={() => setUrlMode("batch")}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              urlMode === "batch"
                ? "bg-indigo-600 text-white shadow-sm font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="h-3 w-3" />
            <span>Multi-Line URLs</span>
          </button>
        </div>
      </div>

      <div className="max-w-xl mx-auto space-y-4">
        {urlMode === "single" ? (
          <>
            {/* URL Input Bar & Scan Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <div className="absolute left-3.5 text-indigo-400 pointer-events-none">
                  <LinkIcon className="h-4 w-4" />
                </div>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setStoreInspection(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleConvertUrlToTxt();
                    }
                  }}
                  placeholder="Paste PDF link or database API endpoint..."
                  disabled={isFetchingUrl || isConvertingUrl || isProcessing || isInspecting}
                  className="w-full bg-[#070A12] border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl pl-10 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none shadow-inner font-mono transition-colors"
                />
                {urlInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setUrlInput("");
                      setStoreInspection(null);
                    }}
                    className="absolute right-2.5 text-slate-500 hover:text-slate-300 p-1 text-xs cursor-pointer"
                    title="Clear URL"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleInspectStoreUrl()}
                disabled={isInspecting || !urlInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700/80 text-slate-200 hover:text-white text-xs font-medium flex items-center justify-center space-x-1.5 transition-all shrink-0 cursor-pointer disabled:opacity-40"
                title="Scan if this URL has 1 or multiple PDFs in a database"
              >
                {isInspecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                ) : (
                  <Search className="h-3.5 w-3.5 text-indigo-400" />
                )}
                <span>Scan Store</span>
              </button>
            </div>

            {/* Backend Database Store Detected Panel */}
            {storeInspection?.is_store && storeInspection.pdfs && (
              <div className="rounded-2xl bg-[#0B0F19] border border-slate-800 p-4 space-y-3 shadow-lg animate-in fade-in duration-200">
                <div className="flex items-start justify-between gap-3 pb-1 border-b border-slate-800/80">
                  <div className="flex items-center space-x-2.5">
                    <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                      <Database className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <h4 className="text-xs sm:text-sm font-semibold text-white">
                          Database Store Detected
                        </h4>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {storeInspection.total_pdfs} PDFs Ready
                        </span>
                        {storeInspection.total_pages ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                            {storeInspection.total_pages} Total Pages
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-slate-400 font-khmer">
                        រកឃើញឯកសារ PDF ចំនួន {storeInspection.total_pdfs} {storeInspection.total_pages ? `(${storeInspection.total_pages} ទំព័រ)` : ""} ក្នុង Database — ការបំប្លែងនឹងធ្វើឡើងផ្ទាល់នៅលើ Server
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStoreInspection(null)}
                    className="text-slate-500 hover:text-slate-300 text-xs p-1 cursor-pointer transition-colors"
                    title="Close preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* List of Discovered PDFs */}
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                  {storeInspection.pdfs.map((pdf, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-xl bg-[#070A12] border border-slate-800/80 hover:border-slate-700 transition-all text-xs"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                        <span className="text-[10px] font-mono font-semibold text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/80 shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                            <FileText className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                            <span className="font-medium text-slate-200 truncate" title={pdf.title}>
                              {pdf.title}
                            </span>
                            {pdf.pages !== undefined && pdf.pages !== null ? (
                              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded shrink-0">
                                {pdf.pages} {pdf.pages === 1 ? "page" : "pages"}
                              </span>
                            ) : null}
                            {pdf.source_id && (
                              <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded shrink-0">
                                ID: {pdf.source_id}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate font-mono">
                            ➔ ./txt/{pdf.filename.replace(/\.pdf$/i, "")}.txt
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setUrlInput(pdf.url);
                            handleFetchFromUrl(pdf.url);
                          }}
                          disabled={isFetchingUrl || isConvertingUrl || isProcessing}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium border border-slate-700/60 transition-colors cursor-pointer flex items-center gap-1"
                          title="Load this PDF's pages into workspace to view thumbnails"
                        >
                          <FileUp className="h-3 w-3 text-slate-400" />
                          <span>Preview Pages</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUrlInput(pdf.url);
                            if (onProcessUrlStream) {
                              onProcessUrlStream(pdf.url, 1, null);
                            }
                          }}
                          disabled={isConvertingUrl || isProcessing}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                          title="Convert directly to TXT on server"
                        >
                          <Zap className="h-3 w-3 text-amber-300" />
                          <span>Convert</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Single Clear Action for Database Store */}
                <button
                  type="button"
                  onClick={handleConvertUrlToTxt}
                  disabled={isConvertingUrl || isProcessing}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm flex items-center justify-center space-x-2 transition-all cursor-pointer"
                >
                  {isConvertingUrl || isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>Streaming All {storeInspection.total_pdfs} PDFs ➔ TXT on Server...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 text-indigo-200" />
                      <span>Convert All ({storeInspection.total_pdfs}) PDFs ➔ TXT (Server Direct)</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Direct PDF Detection Alert */}
            {storeInspection?.is_direct_pdf && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-xs text-emerald-300 animate-in fade-in duration-200">
                <div className="flex items-center space-x-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">
                    Direct PDF Verified: <strong className="text-white font-mono">{storeInspection.filename}</strong>
                  </span>
                </div>
                {storeInspection.pages ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold text-[11px] shrink-0 border border-emerald-500/30">
                    {storeInspection.pages} {storeInspection.pages === 1 ? "page" : "pages"}
                  </span>
                ) : null}
              </div>
            )}

            {/* Inspection Message */}
            {storeInspection && !storeInspection.is_store && !storeInspection.is_direct_pdf && storeInspection.message && (
              <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/20 text-xs text-amber-300 animate-in fade-in duration-200">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>{storeInspection.message}</span>
              </div>
            )}

            {/* Primary Action Button - Hidden when Database Store Detected (which has its own single action above) */}
            {!storeInspection?.is_store && (
              <button
                type="button"
                onClick={handleConvertUrlToTxt}
                disabled={isConvertingUrl || isFetchingUrl || isProcessing || !urlInput.trim()}
                className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-sm flex items-center justify-center space-x-2 transition-all cursor-pointer"
                title="API Server fetches PDF directly, runs Vision OCR/correction, and saves .txt & .jsonl to disk without browser download"
              >
                {isConvertingUrl || (isProcessing && activeFilesCount === 0) ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                    <span>Converting & Saving on Server (Live Streaming)...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 text-amber-300 fill-amber-300" />
                    <span>Convert PDF ➔ TXT (Server Direct)</span>
                  </>
                )}
              </button>
            )}

            {/* Secondary Options Bar (Collapsible Page Range & Workspace Preview) */}
            <div className="flex items-center justify-between text-xs pt-0.5">
              <button
                type="button"
                onClick={() => setShowPageRange(!showPageRange)}
                className="text-slate-400 hover:text-slate-200 flex items-center space-x-1.5 transition-colors py-1 cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-400" />
                <span>{showPageRange ? "Hide Page Range" : "Page Range (Optional Slice)"}</span>
              </button>

              <button
                type="button"
                onClick={() => handleFetchFromUrl()}
                disabled={isFetchingUrl || isConvertingUrl || isProcessing || !urlInput.trim()}
                className="text-slate-400 hover:text-slate-200 disabled:opacity-40 flex items-center space-x-1.5 transition-colors py-1 cursor-pointer"
                title="Load into workspace if you want to inspect thumbnails first"
              >
                {isFetchingUrl ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <FileUp className="h-3.5 w-3.5" />
                    <span>Load in Workspace</span>
                  </>
                )}
              </button>
            </div>

            {/* Collapsible Page Range Slice Inputs */}
            {showPageRange && (
              <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl px-3.5 py-2 text-xs animate-in fade-in duration-150">
                <span className="text-slate-300 font-medium">Page Range Slice:</span>
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500">From</span>
                  <input
                    type="number"
                    min="1"
                    value={startInput}
                    onChange={handleStartInputChange}
                    onBlur={handleStartInputBlur}
                    className="w-14 bg-[#070A12] border border-slate-700 rounded-lg px-2 py-1 text-center text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-slate-500">To</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="All"
                    value={endInput}
                    onChange={handleEndInputChange}
                    onBlur={handleEndInputBlur}
                    className="w-14 bg-[#070A12] border border-slate-700 rounded-lg px-2 py-1 text-center text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  Paste Server Store PDF URLs (one URL per line):
                </span>
                {batchUrlsInput.trim() && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {
                      batchUrlsInput
                        .split("\n")
                        .map((l) => l.trim())
                        .filter((l) => l.startsWith("http://") || l.startsWith("https://"))
                        .length
                    }{" "}
                    URLs detected
                  </span>
                )}
              </div>
              <textarea
                rows={4}
                value={batchUrlsInput}
                onChange={(e) => setBatchUrlsInput(e.target.value)}
                placeholder={`http://my-server-store:8000/files/document_01.pdf\nhttps://storage.googleapis.com/bucket/khmer_manual.pdf\nhttp://internal-nas/reports/report_2026.pdf`}
                disabled={isProcessingBatch || isProcessing}
                className="w-full bg-[#070A12] border border-slate-700 rounded-2xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-inner font-mono leading-relaxed resize-y"
              />
            </div>

            <button
              type="button"
              onClick={handleConvertBatchUrlsToTxt}
              disabled={isProcessingBatch || isProcessing || !batchUrlsInput.trim()}
              className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-sm flex items-center justify-center space-x-2 transition-all cursor-pointer"
            >
              {isProcessingBatch ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span>Converting Batch URLs ➔ TXT on Server...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-indigo-200" />
                  <span>Convert All URLs ➔ TXT (Batch Direct)</span>
                </>
              )}
            </button>
          </>
        )}

        {/* Quick 1-Click Samples for Testing */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-center space-x-1.5 text-[11px] text-slate-500 font-medium">
            <Sparkles className="h-3 w-3 text-indigo-400" />
            <span>One-Click Test Samples:</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setUrlMode("single");
                const sampleUrl = "http://localhost:8000/api/dataset/sample-database-api";
                setUrlInput(sampleUrl);
                handleInspectStoreUrl(sampleUrl);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 text-xs transition-all font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Database className="h-3.5 w-3.5 text-indigo-400" />
              <span>Database API (2 PDFs)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlMode("single");
                setUrlInput("https://mosvy.gov.kh/wp-content/uploads/2021/11/02-Prakas-on-CTP-PF-Implementation.pdf");
                setStoreInspection(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 text-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span>Remote MoSVY PDF</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlMode("single");
                setUrlInput("http://localhost:8000/api/dataset/file/1787540635_Binder1.pdf");
                setStoreInspection(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 text-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span>Local Binder1 PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
