"use client";

import React, { useState, useEffect } from "react";
import {
  Download,
  Copy,
  Check,
  FileDown,
  Layers,
  Sparkles,
  Search,
  Filter,
  FileCode,
  Edit3,
  FileText,
  Archive,
  Loader2,
  Folder,
  FolderOpen,
  FolderCheck,
  X
} from "lucide-react";
import JSZip from "jszip";
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
  multiPdfMode?: "merged" | "batch";
  activeDocumentFilter?: string;
  documentsList?: string[];
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
  multiPdfMode = "merged",
  activeDocumentFilter = "all",
  documentsList = [],
}) => {
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [saveDirectoryHandle, setSaveDirectoryHandle] = useState<any>(null);
  const [saveDirectoryName, setSaveDirectoryName] = useState<string>("");
  const [saveNotification, setSaveNotification] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState<boolean>(false);

  // Compute effective document name when a specific document is filtered in batch mode
  const effectiveBaseName =
    activeDocumentFilter && activeDocumentFilter !== "all"
      ? activeDocumentFilter.replace(/\.pdf$/i, "")
      : filename
        ? filename.replace(/\.pdf$/i, "")
        : "khmer_restored_document";

  const [customFileName, setCustomFileName] = useState<string>(effectiveBaseName);

  // Sync custom filename when a new PDF file is uploaded or filter changes
  useEffect(() => {
    setCustomFileName(effectiveBaseName);
  }, [effectiveBaseName]);

  const getCleanFileName = () => {
    const raw = customFileName.trim();
    if (!raw) return effectiveBaseName;
    return raw.replace(/\.(txt|md|json|jsonl|pdf|zip)$/i, "").trim() || effectiveBaseName;
  };

  // Get active pages based on whether a document filter is currently applied
  const getRelevantPages = () => {
    if (multiPdfMode === "batch" && activeDocumentFilter && activeDocumentFilter !== "all") {
      return pages.filter((p) => p.file_name === activeDocumentFilter);
    }
    return pages;
  };

  const formatPageText = (p: PageResult) => {
    const isBlank = p.model_used === "blank-skipped" || (!p.corrected_text && !p.raw_text);
    const isEnglish =
      p.model_used === "english-skipped" ||
      (p.corrected_text && p.corrected_text.includes("English Page - Skipped"));
    return isBlank
      ? "[ទំព័រទទេ / Blank Page]"
      : isEnglish
        ? "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]"
        : p.corrected_text || p.raw_text;
  };

  const getFullCorrectedText = (targetPages: PageResult[] = getRelevantPages()) => {
    return targetPages
      .map((p) => {
        const docPrefix = p.file_name ? ` (${p.file_name})` : "";
        return `=== Page ${p.page_number}${docPrefix} ===\n\n${formatPageText(p)}\n`;
      })
      .join("\n");
  };

  // Helper to extract clean text from a page record (filtering out blank/skipped pages)
  const getPageCleanText = (p: PageResult): string | null => {
    if (p.is_blank || p.model_used === "blank-skipped") return null;
    if (p.is_english_skipped || p.model_used === "english-skipped") return null;

    const raw = p.corrected_text || p.raw_text || "";
    if (
      raw.includes("[ទំព័រទទេ") ||
      raw.includes("[Blank Page]") ||
      raw.includes("English Page - Skipped")
    ) {
      return null;
    }

    const cleaned = raw.trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  // Choose a destination folder once for batch saving
  const handleChooseDestinationFolder = async () => {
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({
          mode: "readwrite",
        });
        setSaveDirectoryHandle(dirHandle);
        setSaveDirectoryName(dirHandle.name);
        setSaveNotification(`Destination folder set to: ${dirHandle.name}`);
        setTimeout(() => setSaveNotification(""), 3500);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.warn("Could not choose directory", err);
      }
    } else {
      setSaveNotification(
        "Direct folder selection is supported in Chrome, Edge, and Brave. The native Save As location dialog will open on download."
      );
      setTimeout(() => setSaveNotification(""), 5000);
    }
  };

  const handleClearDestinationFolder = () => {
    setSaveDirectoryHandle(null);
    setSaveDirectoryName("");
    setSaveNotification("Save location reset to per-file prompt.");
    setTimeout(() => setSaveNotification(""), 3000);
  };

  // Save blob with pre-selected folder or native OS "Save As" location dialog
  const saveBlobWithPicker = async (
    blob: Blob,
    suggestedName: string,
    extension: string,
    description: string
  ) => {
    // 1. If user already chose a destination folder, save directly into it!
    if (saveDirectoryHandle) {
      try {
        const fileHandle = await saveDirectoryHandle.getFileHandle(
          `${suggestedName}.${extension}`,
          { create: true }
        );
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSaveNotification(`✓ Saved to ${saveDirectoryName}/${suggestedName}.${extension}`);
        setTimeout(() => setSaveNotification(""), 4000);
        return;
      } catch (err: any) {
        console.warn("Could not save to pre-selected directory, prompting location dialog", err);
      }
    }

    // 2. Otherwise, prompt native OS "Save As" dialog so user can choose location on computer
    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        let acceptTypes: Record<string, string[]> = {};
        if (extension === "jsonl" || extension === "json") {
          acceptTypes = { "application/json": [`.${extension}`], "text/plain": [`.${extension}`] };
        } else if (extension === "md") {
          acceptTypes = { "text/markdown": [".md"], "text/plain": [".md"] };
        } else if (extension === "txt") {
          acceptTypes = { "text/plain": [".txt"] };
        } else if (extension === "zip") {
          acceptTypes = { "application/zip": [".zip"] };
        } else {
          acceptTypes = { "application/octet-stream": [`.${extension}`] };
        }

        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${suggestedName}.${extension}`,
          types: [
            {
              description,
              accept: acceptTypes,
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSaveNotification(`✓ Saved: ${suggestedName}.${extension}`);
        setTimeout(() => setSaveNotification(""), 4000);
        return;
      } catch (err: any) {
        // If user cancelled the location dialog, exit cleanly without downloading automatically to Downloads
        if (err?.name === "AbortError") return;
        console.warn("showSaveFilePicker failed, trying fallback:", err);
      }
    }

    // 3. Fallback for browsers without File System Access API
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${suggestedName}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveNotification(`Downloaded ${suggestedName}.${extension}`);
    setTimeout(() => setSaveNotification(""), 3500);
  };

  const saveFileWithPicker = async (
    content: string,
    suggestedName: string,
    mimeType: string,
    extension: string,
    description: string
  ) => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    await saveBlobWithPicker(blob, suggestedName, extension, description);
  };

  const handleCopyAll = () => {
    const text = getFullCorrectedText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = async () => {
    const targetPages = getRelevantPages();
    const text = getFullCorrectedText(targetPages);
    const cleanName = getCleanFileName();
    await saveFileWithPicker(text, cleanName, "text/plain", "txt", "Plain Text Document (.txt)");
  };

  const handleDownloadMarkdown = async () => {
    const targetPages = getRelevantPages();
    const cleanName = getCleanFileName();
    const lines = [`# ${cleanName} - Khmer OCR & AI Restoration`, ""];
    for (const p of targetPages) {
      const docBadge = p.file_name ? ` • Document: ${p.file_name}` : "";
      lines.push(`## Page ${p.page_number}${docBadge}\n\n${formatPageText(p)}\n`);
    }
    await saveFileWithPicker(lines.join("\n"), cleanName, "text/markdown", "md", "Markdown Document (.md)");
  };

  const handleDownloadJsonl = async () => {
    const targetPages = getRelevantPages();
    const cleanName = getCleanFileName();

    const jsonlLines: string[] = [];
    for (const p of targetPages) {
      const cleanText = getPageCleanText(p);
      // Clean Data: exclude empty or skipped pages
      if (!cleanText) continue;

      const record = {
        document: p.file_name || `${cleanName}.pdf`,
        page: p.page_number,
        doc_page: p.doc_page_number || p.page_number,
        text: cleanText,
        char_count: cleanText.length,
        word_count: cleanText.split(/\s+/).filter(Boolean).length,
        has_formulas: Boolean(p.has_formulas),
      };

      jsonlLines.push(JSON.stringify(record));
    }

    const content = jsonlLines.join("\n") + (jsonlLines.length > 0 ? "\n" : "");
    await saveFileWithPicker(
      content,
      `${cleanName}_clean`,
      "application/x-ndjson",
      "jsonl",
      "Clean JSON Lines Dataset (.jsonl)"
    );
  };

  // Download all documents packaged into a single ZIP archive
  const handleDownloadBatchZip = async () => {
    if (pages.length === 0 || isZipping) return;
    setIsZipping(true);

    try {
      const zip = new JSZip();
      const distinctDocs =
        documentsList.length > 0
          ? documentsList
          : Array.from(new Set(pages.map((p) => p.file_name).filter(Boolean) as string[]));

      if (distinctDocs.length <= 1) {
        const docName = distinctDocs[0] || getCleanFileName();
        const baseDoc = docName.replace(/\.pdf$/i, "");
        zip.file(`${baseDoc}_khmer.txt`, getFullCorrectedText(pages));
        const mdLines = [`# ${baseDoc} - Khmer OCR`, ""];
        pages.forEach((p) => mdLines.push(`## Page ${p.page_number}\n\n${formatPageText(p)}\n`));
        zip.file(`${baseDoc}_khmer.md`, mdLines.join("\n"));

        // Add clean JSONL
        const cleanLines = pages
          .map((p) => {
            const cleanText = getPageCleanText(p);
            if (!cleanText) return null;
            return JSON.stringify({
              document: docName,
              page: p.page_number,
              doc_page: p.doc_page_number || p.page_number,
              text: cleanText,
              char_count: cleanText.length,
              word_count: cleanText.split(/\s+/).filter(Boolean).length,
              has_formulas: Boolean(p.has_formulas),
            });
          })
          .filter(Boolean);
        if (cleanLines.length > 0) {
          zip.file(`${baseDoc}_clean.jsonl`, cleanLines.join("\n") + "\n");
        }
      } else {
        const allCleanRecords: string[] = [];

        distinctDocs.forEach((docName) => {
          const docPages = pages.filter((p) => p.file_name === docName);
          const baseDoc = docName.replace(/\.pdf$/i, "");
          const txtContent = getFullCorrectedText(docPages);
          zip.file(`${baseDoc}_khmer.txt`, txtContent);

          const mdLines = [`# ${baseDoc} - Khmer OCR`, ""];
          const docJsonl: string[] = [];

          docPages.forEach((p) => {
            const pageTitle = p.doc_page_number ? `Page ${p.doc_page_number} (Overall ${p.page_number})` : `Page ${p.page_number}`;
            mdLines.push(`## ${pageTitle}\n\n${formatPageText(p)}\n`);

            const cleanText = getPageCleanText(p);
            if (cleanText) {
              const rec = JSON.stringify({
                document: docName,
                page: p.page_number,
                doc_page: p.doc_page_number || p.page_number,
                text: cleanText,
                char_count: cleanText.length,
                word_count: cleanText.split(/\s+/).filter(Boolean).length,
                has_formulas: Boolean(p.has_formulas),
              });
              docJsonl.push(rec);
              allCleanRecords.push(rec);
            }
          });

          zip.file(`${baseDoc}_khmer.md`, mdLines.join("\n"));
          if (docJsonl.length > 0) {
            zip.file(`${baseDoc}_clean.jsonl`, docJsonl.join("\n") + "\n");
          }
        });

        // Add master clean JSONL containing all documents
        if (allCleanRecords.length > 0) {
          zip.file("all_documents_clean.jsonl", allCleanRecords.join("\n") + "\n");
        }

        // Add summary JSON
        const summaryData = {
          batch_title: "Khmer OCR Multi-Document Export",
          extracted_at: new Date().toISOString(),
          total_documents: distinctDocs.length,
          total_pages: pages.length,
          clean_records_count: allCleanRecords.length,
          documents: distinctDocs.map((docName) => {
            const docPages = pages.filter((p) => p.file_name === docName);
            return {
              document_name: docName,
              page_count: docPages.length,
              clean_pages_count: docPages.filter((p) => Boolean(getPageCleanText(p))).length,
              completed_count: docPages.filter((p) => Boolean(p.corrected_text)).length,
            };
          }),
        };
        zip.file("batch_summary.json", JSON.stringify(summaryData, null, 2));
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      await saveBlobWithPicker(zipBlob, "khmer_ocr_batch_export", "zip", "ZIP Archive (.zip)");
    } catch (err) {
      console.error("Failed to generate ZIP", err);
    } finally {
      setIsZipping(false);
    }
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
  const hasMultipleDocuments = documentsList.length > 1;

  return (
    <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4">
      {/* Top row: Progress info & Download Buttons */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-sm shrink-0 shadow-inner">
            {progressPercent}%
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap">
              <h3 className="text-base font-bold text-white font-khmer">
                វឌ្ឍនភាពដំណើរការ (Processing Progress)
              </h3>
              <span className="text-xs font-mono font-bold text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-500/30">
                {completedPages} / {totalPages} Pages Completed
              </span>
              {hasMultipleDocuments && (
                <span className="text-[11px] font-mono text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-500/30">
                  📁 {documentsList.length} PDFs in Queue
                </span>
              )}
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
        <div className="flex items-center space-x-2 w-full xl:w-auto flex-wrap gap-y-2.5">
          {/* Editable File Name Input */}
          <div className="flex items-center space-x-1.5 bg-[#070A12] border border-slate-700/80 hover:border-indigo-500/60 focus-within:border-indigo-500 rounded-xl px-2.5 py-1.5 transition-all shadow-inner group">
            <FileText className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <input
              type="text"
              value={customFileName}
              onChange={(e) => setCustomFileName(e.target.value)}
              placeholder="Filename..."
              className="bg-transparent text-xs text-slate-100 font-medium focus:outline-none w-28 sm:w-40 placeholder:text-slate-600"
              title="Edit export filename for TXT, MD, and JSONL downloads"
            />
            <span className="text-[10px] text-slate-500 font-mono select-none pr-1">
              .ext
            </span>
          </div>

          {/* Location / Folder Picker Button (Opens Popup Modal) */}
          <div className="flex items-center">
            {saveDirectoryName ? (
              <button
                type="button"
                onClick={() => setShowLocationModal(true)}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs bg-emerald-950/70 hover:bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-medium transition-all group shadow-sm"
                title="Folder active. Click to view or change save location"
              >
                <FolderCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="truncate max-w-[120px]">
                  📁 {saveDirectoryName}
                </span>
                <span className="text-[10px] text-emerald-400/80 group-hover:text-emerald-200 ml-0.5 underline decoration-emerald-500/50">
                  ប្តូរ
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLocationModal(true)}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-all shadow-sm"
                title="Choose a specific folder on your computer to save all exported files directly"
              >
                <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                <span>Save Location</span>
              </button>
            )}
          </div>

          <button
            onClick={handleCopyAll}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all disabled:opacity-50"
            title="Copy all extracted text to clipboard"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>

          <button
            onClick={handleDownloadTxt}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50"
            title={`Save TXT file with folder / location picker`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>TXT</span>
          </button>

          <button
            onClick={handleDownloadMarkdown}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition-all disabled:opacity-50"
            title={`Save Markdown file with folder / location picker`}
          >
            <FileDown className="h-3.5 w-3.5 text-indigo-400" />
            <span>MD</span>
          </button>

          <button
            onClick={handleDownloadJsonl}
            disabled={pages.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm transition-all disabled:opacity-50"
            title={`Save clean data JSONL dataset with folder / location picker`}
          >
            <FileCode className="h-3.5 w-3.5 text-amber-400" />
            <span>JSONL (Clean Data)</span>
          </button>

          {/* Batch ZIP All Documents Button */}
          {hasMultipleDocuments && (
            <button
              onClick={handleDownloadBatchZip}
              disabled={pages.length === 0 || isZipping}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50"
              title="Save all processed PDF documents packaged as a ZIP file"
            >
              {isZipping ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Zipping...</span>
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5" />
                  <span>ZIP All</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Save Notification Toast / Feedback */}
      {saveNotification && (
        <div className="flex items-center space-x-2 text-xs text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-2 rounded-xl shadow-md animate-in fade-in slide-in-from-top-1">
          <FolderCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{saveNotification}</span>
        </div>
      )}

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
              <span>Progress</span>
            )}
          </span>
          <span className="font-bold text-white">{progressPercent}%</span>
        </div>
        <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
          <div
            className={`h-full rounded-full transition-all duration-300 ${isProcessing
                ? "bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 bg-[length:200%_100%] animate-pulse"
                : completedPages === totalPages
                  ? "bg-emerald-500 shadow-md shadow-emerald-500/30"
                  : "bg-indigo-600"
              }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <div className="absolute left-3 top-2.5 text-slate-500 pointer-events-none">
            <Search className="h-3.5 w-3.5" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Khmer or LaTeX text..."
            className="w-full bg-[#070A12] border border-slate-700/80 rounded-xl pl-9 pr-4 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors shadow-inner"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center space-x-1.5 bg-[#070A12] p-1 rounded-xl border border-slate-800 w-full sm:w-auto justify-center sm:justify-start">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filterStatus === "all"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
              }`}
          >
            All ({totalPages})
          </button>
          <button
            onClick={() => setFilterStatus("completed")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filterStatus === "completed"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
              }`}
          >
            Restored ({completedPages})
          </button>
          <button
            onClick={() => setFilterStatus("formulas")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filterStatus === "formulas"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
              }`}
          >
            LaTeX ({formulaPagesCount})
          </button>
        </div>
      </div>
      {/* Save Location Popup Modal */}
      {showLocationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-[#0E131F] border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden text-slate-200 p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <span>ជ្រើសរើសទីតាំងរក្សាទុក</span>
                    <span className="text-xs font-normal text-slate-400 font-mono">(Save Location)</span>
                  </h3>
                  <p className="text-xs text-slate-400 pt-0.5">
                    កំណត់ Folder នៅលើកុំព្យូទ័ររបស់អ្នកសម្រាប់ទុកឯកសារ Export
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Close popup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current Folder Status Card */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Folder បច្ចុប្បន្ន (Current Destination)
                </span>
                {saveDirectoryName ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                    <Check className="h-3 w-3 mr-1" /> Folder ត្រូវបានកំណត់
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                    រើសរាល់ពេល Download
                  </span>
                )}
              </div>

              {saveDirectoryName ? (
                <div className="flex items-center justify-between bg-slate-950/80 p-3 rounded-xl border border-emerald-500/30">
                  <div className="flex items-center space-x-2.5 truncate">
                    <FolderCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                    <div className="truncate">
                      <p className="text-sm font-bold text-white truncate font-mono">
                        📁 {saveDirectoryName}
                      </p>
                      <p className="text-[11px] text-emerald-400/90">
                        ឯកសារទាញយកទាំងអស់នឹង Save ចូល Folder នេះដោយផ្ទាល់
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearDestinationFolder}
                    className="text-xs text-rose-300 hover:text-white bg-rose-950/40 hover:bg-rose-900/60 px-2.5 py-1 rounded-lg border border-rose-500/30 transition-all shrink-0 ml-2 font-medium"
                    title="Reset back to asking where to save every time"
                  >
                    លុបចេញ (Reset)
                  </button>
                </div>
              ) : (
                <div className="text-xs text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-slate-800/80 leading-relaxed">
                  មិនទាន់បានជ្រើស Folder ជាក់លាក់ណាមួយនៅឡើយទេ។ នៅពេលអ្នកចុច Download Browser នឹងបើកផ្ទាំង <strong className="text-slate-200">Save As</strong> លើកុំព្យូទ័រដើម្បីឱ្យអ្នករើសទីតាំង។
                </div>
              )}

              {/* Action Button to Select / Change Folder */}
              <button
                type="button"
                onClick={async () => {
                  await handleChooseDestinationFolder();
                }}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all active:scale-[0.99]"
              >
                <Folder className="h-4 w-4" />
                <span>{saveDirectoryName ? "ប្តូរ Folder ផ្សេង (Change Destination Folder...)" : "ជ្រើសរើស Folder លើកុំព្យូទ័រ (Choose Destination Folder...)"}</span>
              </button>
            </div>

            {/* Browser Permission Explanatory Card */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 flex items-start space-x-3">
              <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-300">
                  ចំណាំអំពី Browser Security Permission:
                </p>
                <p className="text-[11px] leading-relaxed text-slate-300">
                  ពេលអ្នកជ្រើសរើស Folder Browser នឹងបង្ហាញផ្ទាំង <strong className="text-white">«Allow this site to edit files?»</strong>។ សូមចុច <strong className="text-emerald-400">«Allow»</strong> ដើម្បីអនុញ្ញាតឱ្យកម្មវិធីអាច Save ឯកសារ (.jsonl, .txt, .md, .zip) ចូលទៅកាន់ Folder នោះដោយស្វ័យប្រវត្តិតែម្តង។
                </p>
              </div>
            </div>

            {/* Quick Export Actions */}
            <div className="space-y-2 pt-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                ទាញយកភ្លាមៗ (Quick Download)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleDownloadTxt();
                    setShowLocationModal(false);
                  }}
                  disabled={pages.length === 0}
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>TXT</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleDownloadMarkdown();
                    setShowLocationModal(false);
                  }}
                  disabled={pages.length === 0}
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition-all disabled:opacity-50"
                >
                  <FileDown className="h-3.5 w-3.5 text-indigo-400" />
                  <span>MD</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleDownloadJsonl();
                    setShowLocationModal(false);
                  }}
                  disabled={pages.length === 0}
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all disabled:opacity-50"
                >
                  <FileCode className="h-3.5 w-3.5 text-amber-400" />
                  <span>JSONL</span>
                </button>
                {hasMultipleDocuments ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleDownloadBatchZip();
                      setShowLocationModal(false);
                    }}
                    disabled={pages.length === 0 || isZipping}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    <span>ZIP All</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleCopyAll();
                    }}
                    disabled={pages.length === 0}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-all"
              >
                រួចរាល់ (Done)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
