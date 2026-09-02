"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  FileUp,
  FileText,
  Image as ImageIcon,
  X,
  Sparkles,
  AlertCircle,
  Zap,
  Eye,
  Layers,
  RotateCcw,
  ArrowRight,
  Link as LinkIcon,
  Globe,
  Download,
  Loader2
} from "lucide-react";
import { API_BASE_URL } from "../config/api";

interface FileUploadProps {
  onFileSelected?: (file: File) => void;
  onFilesSelected?: (files: File[]) => void;
  selectedFile: File | null;
  selectedFiles?: File[];
  onClearFile: () => void;
  isProcessing: boolean;
  onStartProcessing: () => void;
  concurrency: number;
  setConcurrency: (val: number) => void;
  processingMode: "vision" | "text";
  setProcessingMode: (mode: "vision" | "text") => void;
  startPage: number;
  setStartPage: (page: number) => void;
  endPage: number | null;
  setEndPage: (page: number | null) => void;
  totalPdfPages: number;
  existingPagesCount?: number;
  onClearExtractedPages?: () => void;
  existingPageNumbers?: number[];
  sessionRestored?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelected,
  onFilesSelected,
  selectedFile,
  selectedFiles = [],
  onClearFile,
  isProcessing,
  onStartProcessing,
  concurrency,
  setConcurrency,
  processingMode,
  setProcessingMode,
  startPage,
  setStartPage,
  endPage,
  setEndPage,
  totalPdfPages,
  existingPagesCount = 0,
  onClearExtractedPages,
  existingPageNumbers = [],
  sessionRestored = false,
}) => {
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");
  const [urlInput, setUrlInput] = useState<string>("");
  const [isFetchingUrl, setIsFetchingUrl] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local string buffers for buttery smooth typing & deleting
  const [startInput, setStartInput] = useState<string>(String(startPage || 1));
  const [endInput, setEndInput] = useState<string>(endPage ? String(endPage) : "");

  // Synchronize when external props change
  useEffect(() => {
    setStartInput(String(startPage || 1));
  }, [startPage]);

  useEffect(() => {
    setEndInput(endPage ? String(endPage) : "");
  }, [endPage]);

  const isValidFileType = (file: File) => {
    const name = file.name.toLowerCase();
    const validExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"];
    return validExtensions.some((ext) => name.endsWith(ext)) || file.type.startsWith("image/") || file.type === "application/pdf";
  };

  const activeFileList = selectedFiles.length > 0 ? selectedFiles : selectedFile ? [selectedFile] : [];
  const isMultiple = activeFileList.length > 1;

  const isImageFile = Boolean(
    activeFileList.length > 0 &&
    activeFileList.every(
      (f) =>
        f.type.startsWith("image/") ||
        [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"].some((ext) => f.name.toLowerCase().endsWith(ext))
    )
  );

  const totalFileSize = activeFileList.reduce((acc, f) => acc + f.size, 0);

  const handleStartInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setStartInput(raw);
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      setStartPage(parsed);
    }
  };

  const handleStartInputBlur = () => {
    const parsed = parseInt(startInput, 10);
    if (isNaN(parsed) || parsed < 1) {
      setStartInput("1");
      setStartPage(1);
    } else {
      setStartInput(String(parsed));
      setStartPage(parsed);
    }
  };

  const handleEndInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setEndInput(raw);
    if (raw.trim() === "") {
      setEndPage(null);
    } else {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        setEndPage(parsed);
      }
    }
  };

  const handleEndInputBlur = () => {
    if (endInput.trim() === "") {
      setEndPage(null);
    } else {
      const parsed = parseInt(endInput, 10);
      if (isNaN(parsed) || parsed < 1) {
        setEndInput("");
        setEndPage(null);
      } else {
        setEndInput(String(parsed));
        setEndPage(parsed);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const processIncomingFiles = (incomingList: FileList | File[]) => {
    setError(null);
    const filesArray = Array.from(incomingList);
    const valid = filesArray.filter(isValidFileType);

    if (valid.length === 0) {
      setError("Please select valid PDF documents or image files (.pdf, .png, .jpg, .webp).");
      return;
    }

    // Natural sort by filename (e.g. Page_1, Page_2, Page_10)
    const sorted = valid.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );

    if (onFilesSelected) {
      onFilesSelected(sorted);
    } else if (onFileSelected && sorted.length > 0) {
      onFileSelected(sorted[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processIncomingFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processIncomingFiles(e.target.files);
    }
  };

  const handleFetchFromUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanUrl = urlInput.trim();
    if (!cleanUrl) {
      setError("Please enter a valid link URL.");
      return;
    }
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      setError("URL must start with http:// or https://");
      return;
    }

    setIsFetchingUrl(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/fetch-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cleanUrl }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(errorJson?.detail || `Failed to download file from link (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const filename =
        res.headers.get("X-Filename") ||
        res.headers.get("x-filename") ||
        "imported_document.pdf";

      const downloadedFile = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      processIncomingFiles([downloadedFile]);
      setUrlInput("");
    } catch (err: any) {
      setError(err?.message || "Failed to download file from link.");
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Quick helper to jump to the next batch (e.g. if 1-2 done, suggest 3-4)
  const maxExtractedPage = existingPageNumbers.length > 0 ? Math.max(...existingPageNumbers) : 0;
  const nextStart = maxExtractedPage > 0 ? maxExtractedPage + 1 : 1;
  const currentSpan = (endPage && startPage && endPage >= startPage) ? (endPage - startPage + 1) : 2;
  const nextEnd = totalPdfPages > 0 ? Math.min(totalPdfPages, nextStart + currentSpan - 1) : nextStart + 1;

  const handleSetNextBatch = () => {
    setStartPage(nextStart);
    setStartInput(String(nextStart));
    setEndPage(nextEnd);
    setEndInput(String(nextEnd));
  };

  const handleSetAllRemaining = () => {
    setStartPage(nextStart);
    setStartInput(String(nextStart));
    setEndPage(totalPdfPages);
    setEndInput(String(totalPdfPages));
  };

  return (
    <div className="w-full space-y-4">
      {activeFileList.length === 0 ? (
        <div className="space-y-3">
          {/* Toggle between Local Upload & Link Import */}
          <div className="flex items-center justify-center">
            <div className="inline-flex p-1 rounded-2xl bg-[#0D1322] border border-slate-800 shadow-lg">
              <button
                type="button"
                onClick={() => { setActiveTab("file"); setError(null); }}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                  activeTab === "file"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <FileUp className="h-4 w-4" />
                <span>Local Files (PDF / Images)</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("url"); setError(null); }}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                  activeTab === "url"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <LinkIcon className="h-4 w-4" />
                <span>Import via Link / URL</span>
              </button>
            </div>
          </div>

          {activeTab === "file" ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative group cursor-pointer border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center transition-all duration-300 ${
                isDragOver
                  ? "border-indigo-500 bg-indigo-500/10 scale-[1.01] shadow-2xl shadow-indigo-500/20"
                  : "border-slate-800 hover:border-indigo-500/50 bg-[#0D1322]/80 hover:bg-[#0D1322] shadow-xl"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInputChange}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tiff,application/pdf,image/*"
                multiple
                className="hidden"
              />
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="h-16 w-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 group-hover:bg-indigo-500/20 group-hover:shadow-lg group-hover:shadow-indigo-500/30 transition-all duration-300">
                  <FileUp className="h-8 w-8" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-white">
                    Upload Khmer PDF Documents or Multiple Images
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto font-khmer">
                    ទម្លាក់ឯកសារ PDF ឬរូបភាពច្រើនសន្លឹក (PNG, JPG, WEBP) ដើម្បីបំប្លែង និងច្របាច់បញ្ចូលគ្នាដោយស្វ័យប្រវត្តិ
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400 pt-1">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 font-medium">📄 PDF & 🖼️ Multi-Images</span>
                  <span>•</span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 font-medium">Vision OCR (Subscripts ជើង)</span>
                  <span>•</span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 font-medium">Auto-Numbered Pages</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-3xl p-6 sm:p-8 bg-[#0D1322] shadow-2xl space-y-5">
              <div className="text-center space-y-1.5">
                <div className="h-12 w-12 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Globe className="h-6 w-6" />
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Import PDF or Image from Link
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto font-khmer">
                  បញ្ចូលតំណភ្ជាប់ (Google Drive, Dropbox ឬ Direct Link) នៃឯកសារ PDF ឬរូបភាពដើម្បីទាញយកដោយស្វ័យប្រវត្តិ
                </p>
              </div>

              <form onSubmit={handleFetchFromUrl} className="max-w-xl mx-auto space-y-3">
                <div className="relative flex items-center">
                  <div className="absolute left-4 text-slate-500 pointer-events-none">
                    <LinkIcon className="h-4 w-4" />
                  </div>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://drive.google.com/... or https://example.com/document.pdf"
                    disabled={isFetchingUrl}
                    className="w-full bg-[#070A12] border border-slate-700 rounded-2xl pl-11 pr-32 py-3 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-inner"
                  />
                  <button
                    type="submit"
                    disabled={isFetchingUrl || !urlInput.trim()}
                    className="absolute right-2 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 flex items-center space-x-1.5 transition-all"
                  >
                    {isFetchingUrl ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Fetching...</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" />
                        <span>Fetch & Import</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500 pt-1">
                  <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800">🌐 Direct PDF / Image URL</span>
                  <span>•</span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800">📁 Google Drive Share Links</span>
                  <span>•</span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800">📦 Dropbox Links</span>
                </div>
              </form>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4">
          {/* File Information Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
            <div className="flex items-center space-x-3.5">
              <div className="h-11 w-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 shadow-md">
                {isImageFile ? <ImageIcon className="h-5 w-5 text-indigo-400" /> : <FileText className="h-5 w-5" />}
              </div>
              <div className="overflow-hidden">
                <h4 className="text-sm font-semibold text-white truncate max-w-xs sm:max-w-md">
                  {isMultiple
                    ? `${activeFileList.length} Images Merged (${activeFileList[0].name} ...)`
                    : activeFileList[0].name}
                </h4>
                <div className="flex items-center space-x-2 text-xs text-slate-400 font-medium pt-0.5 flex-wrap gap-y-1">
                  <span>{formatFileSize(totalFileSize)}</span>
                  <span>•</span>
                  <span>
                    {isMultiple
                      ? `${activeFileList.length} Pages (Multi-Image)`
                      : isImageFile
                      ? "Single Page Image"
                      : totalPdfPages > 0
                      ? `${totalPdfPages} Total Pages in PDF`
                      : "Document Ready"}
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
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 transition-all"
                  title="Clear extracted pages to start fresh"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset / Clear</span>
                </button>
              )}

              {!isProcessing && (
                <button
                  onClick={onClearFile}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 transition-colors"
                  title="Choose different file"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Change File</span>
                </button>
              )}
            </div>
          </div>

          {/* Configuration Controls Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
            {/* Mode Selection */}
            <div className="bg-[#070A12] border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                <span className="flex items-center space-x-1.5">
                  <Eye className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Processing Engine</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setProcessingMode("vision")}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-center ${
                    processingMode === "vision"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "text-slate-400 hover:text-white bg-slate-800/60"
                  }`}
                >
                  Vision OCR (VLM)
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setProcessingMode("text")}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-center ${
                    processingMode === "text"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "text-slate-400 hover:text-white bg-slate-800/60"
                  }`}
                >
                  Digital Text
                </button>
              </div>
            </div>

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
                      className="inline-flex items-center space-x-1 text-[10px] text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 rounded-md border border-indigo-500/30 font-medium transition-all"
                      title="Continue all remaining unfinished pages to the end"
                    >
                      <span>Continue: {nextStart}-{totalPdfPages}</span>
                      <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={handleSetNextBatch}
                      className="inline-flex items-center space-x-1 text-[10px] text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 px-1.5 py-0.5 rounded-md border border-emerald-500/30 font-medium transition-all"
                      title="Process next small chunk"
                    >
                      <span>+{currentSpan} pgs</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2">
                {/* From Input */}
                <div className="flex items-center space-x-1.5 flex-1">
                  <span className="text-[11px] text-slate-500 font-medium select-none">From:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={isProcessing}
                    value={startInput}
                    onChange={handleStartInputChange}
                    onBlur={handleStartInputBlur}
                    placeholder="1"
                    className="w-full bg-slate-800 border border-slate-700 hover:border-indigo-500 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-white text-center focus:outline-none font-mono font-semibold transition-all shadow-inner"
                  />
                </div>

                {/* To Input */}
                <div className="flex items-center space-x-1.5 flex-1">
                  <span className="text-[11px] text-slate-500 font-medium select-none">To:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={isProcessing}
                    placeholder={totalPdfPages > 0 ? String(totalPdfPages) : "End"}
                    value={endInput}
                    onChange={handleEndInputChange}
                    onBlur={handleEndInputBlur}
                    className="w-full bg-slate-800 border border-slate-700 hover:border-indigo-500 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-white text-center focus:outline-none font-mono font-semibold transition-all shadow-inner placeholder:text-slate-500"
                  />
                </div>
              </div>
            </div>

            {/* Speed & Concurrency Selector */}
            <div className="bg-[#070A12] border border-slate-800 rounded-xl p-3 space-y-1.5 sm:col-span-2 lg:col-span-1">
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
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all text-center ${
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
                <span>Extracting pages <strong>{startPage} to {endPage || totalPdfPages || startPage}</strong></span>
              )}
            </div>

            <button
              onClick={onStartProcessing}
              disabled={isProcessing}
              className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-semibold text-white transition-all ${
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
                  : `Start ${processingMode === "vision" ? "Vision OCR" : "Text Extraction"} (Pages ${startPage} - ${endPage || totalPdfPages || startPage})`}
              </span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-xl">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
