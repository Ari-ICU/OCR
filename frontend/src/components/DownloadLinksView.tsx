"use client";

import React, { useState, useMemo } from "react";
import {
  Link as LinkIcon,
  Download,
  Clipboard,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  ExternalLink,
  Eye,
  FileText,
  FileDown,
  RefreshCw,
  Plus,
  Globe,
  Search,
  CheckSquare,
  Square,
  ShieldCheck,
} from "lucide-react";
import { API_BASE_URL } from "../config/api";

export interface QueuedLink {
  id: string;
  url: string;
  status: "idle" | "downloading" | "success" | "error";
  file?: File;
  fileName?: string;
  fileSize?: number;
  error?: string;
  language?: "khmer" | "english" | "unknown";
  hasKhmer?: boolean;
}

interface CrawledPdfItem {
  title: string;
  url: string;
  filename: string;
  language: "khmer" | "english";
  has_khmer: boolean;
}

interface CrawledResult {
  webpage_url: string;
  webpage_title: string;
  total_found: number;
  khmer_count: number;
  english_count: number;
  pdfs: CrawledPdfItem[];
}

interface DownloadLinksViewProps {
  onProcessFiles: (files: File[], mode: "vision" | "text") => void;
  onNavigateToEngine: (mode: "vision" | "text") => void;
}

export const DownloadLinksView: React.FC<DownloadLinksViewProps> = ({
  onProcessFiles,
  onNavigateToEngine,
}) => {
  // Mode toggle: "webpage" (crawler) vs "direct" (paste multiple URLs)
  const [activeMode, setActiveMode] = useState<"webpage" | "direct">("webpage");

  // Webpage Crawler State
  const [webpageUrl, setWebpageUrl] = useState("");
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawledResult, setCrawledResult] = useState<CrawledResult | null>(null);
  const [selectedCrawledIndices, setSelectedCrawledIndices] = useState<Set<number>>(new Set());
  const [crawledSearchTerm, setCrawledSearchTerm] = useState("");
  // Language filter inside crawled results: "khmer" | "all" | "english"
  const [crawledLangFilter, setCrawledLangFilter] = useState<"khmer" | "all" | "english">("khmer");

  // Direct URLs State
  const [inputText, setInputText] = useState("");

  // Download Queue State
  const [queue, setQueue] = useState<QueuedLink[]>([]);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [processFeedback, setProcessFeedback] = useState<string | null>(null);

  // Parse direct URLs
  const parseUrls = (text: string): string[] => {
    const rawLines = text
      .split(/[\n,]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const validUrls: string[] = [];
    for (const line of rawLines) {
      if (line.startsWith("http://") || line.startsWith("https://")) {
        validUrls.push(line);
      } else if (line.includes(".") && !line.includes(" ")) {
        validUrls.push(`https://${line}`);
      }
    }
    return Array.from(new Set(validUrls));
  };

  const handleAddUrls = (urlsToAdd: string[]) => {
    if (urlsToAdd.length === 0) return;
    setGeneralError(null);

    const newItems: QueuedLink[] = urlsToAdd.map((u) => {
      let inferredName = "document.pdf";
      try {
        const parsed = new URL(u);
        const segments = parsed.pathname.split("/").filter(Boolean);
        if (segments.length > 0) {
          const last = decodeURIComponent(segments[segments.length - 1]);
          if (last.includes(".")) {
            inferredName = last;
          }
        }
      } catch {}

      const isExplicitEng = /(_eng|-eng|_english|-english|eng-final)/i.test(inferredName);
      const isKhmerTerm = /(prakas|anukret|kram|chbab|sarachor|samrech|khmer|_kh|-kh|_khm|-khm|_khmer|-khmer)/i.test(inferredName);
      const hasKhmerInName = /[\u1780-\u17FF\u19E0-\u19FF]/.test(inferredName) || isKhmerTerm;
      const detectedLang = isExplicitEng ? "english" : (hasKhmerInName ? "khmer" : "khmer");

      return {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        url: u,
        status: "idle",
        fileName: inferredName,
        language: detectedLang,
        hasKhmer: !isExplicitEng,
      };
    });

    setQueue((prev) => [...prev, ...newItems]);
    setInputText("");
  };

  const handlePasteClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        if (activeMode === "webpage") {
          setWebpageUrl(clipText.trim());
        } else {
          const found = parseUrls(clipText);
          if (found.length > 0) {
            handleAddUrls(found);
          } else {
            setInputText(clipText.trim());
          }
        }
      }
    } catch {
      setGeneralError("Browser prevented clipboard paste. Please paste directly into the box.");
    }
  };

  // Crawl single webpage for all PDF documents
  const handleCrawlWebpage = async () => {
    const target = webpageUrl.trim();
    if (!target) return;

    setIsCrawling(true);
    setCrawlError(null);
    setCrawledResult(null);
    setSelectedCrawledIndices(new Set());
    setCrawledSearchTerm("");
    setCrawledLangFilter("khmer"); // Default to Khmer only

    try {
      const res = await fetch(`${API_BASE_URL}/api/crawl-webpage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });

      if (!res.ok) {
        let errDetail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.detail) errDetail = errJson.detail;
        } catch {}
        throw new Error(errDetail);
      }

      const data: CrawledResult = await res.json();
      if (!data.pdfs || data.pdfs.length === 0) {
        setCrawlError("រកមិនឃើញឯកសារ PDF លើគេហទំព័រនេះទេ។ សូមពិនិត្យមើលតំណភ្ជាប់ម្តងទៀត។ (No PDF documents discovered on this page)");
      } else {
        setCrawledResult(data);
        // CRITICAL REQUIREMENT: Focus on Khmer only by default!
        // Automatically pre-select only Khmer PDFs. English PDFs are unchecked!
        const khmerIndices = new Set<number>();
        data.pdfs.forEach((p, idx) => {
          if (p.has_khmer || p.language === "khmer") {
            khmerIndices.add(idx);
          }
        });
        setSelectedCrawledIndices(khmerIndices.size > 0 ? khmerIndices : new Set(data.pdfs.map((_, i) => i)));
      }
    } catch (err: any) {
      setCrawlError(err?.message || "Failed to scan webpage for PDF documents");
    } finally {
      setIsCrawling(false);
    }
  };

  // Filter crawled items by search term AND language filter
  const filteredCrawledPdfs = useMemo(() => {
    if (!crawledResult) return [];
    let list = crawledResult.pdfs.map((pdf, originalIndex) => ({ pdf, originalIndex }));

    // Language filter
    if (crawledLangFilter === "khmer") {
      list = list.filter(({ pdf }) => pdf.has_khmer || pdf.language === "khmer");
    } else if (crawledLangFilter === "english") {
      list = list.filter(({ pdf }) => !pdf.has_khmer && pdf.language === "english");
    }

    // Text search filter
    if (crawledSearchTerm.trim()) {
      const term = crawledSearchTerm.toLowerCase();
      list = list.filter(({ pdf }) =>
        pdf.title.toLowerCase().includes(term) ||
        pdf.filename.toLowerCase().includes(term) ||
        pdf.url.toLowerCase().includes(term)
      );
    }

    return list;
  }, [crawledResult, crawledLangFilter, crawledSearchTerm]);

  // Toggle single crawled item selection
  const toggleCrawledSelection = (originalIndex: number) => {
    setSelectedCrawledIndices((prev) => {
      const next = new Set(prev);
      if (next.has(originalIndex)) {
        next.delete(originalIndex);
      } else {
        next.add(originalIndex);
      }
      return next;
    });
  };

  // Select all or none in current view
  const toggleSelectAllFiltered = () => {
    if (!crawledResult) return;
    const currentIndices = filteredCrawledPdfs.map((f) => f.originalIndex);
    const allSelected = currentIndices.every((i) => selectedCrawledIndices.has(i));

    setSelectedCrawledIndices((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        currentIndices.forEach((i) => next.delete(i));
      } else {
        currentIndices.forEach((i) => next.add(i));
      }
      return next;
    });
  };

  // Add selected crawled items to queue
  const handleAddCrawledToQueue = () => {
    if (!crawledResult || selectedCrawledIndices.size === 0) return;

    const itemsToAdd: QueuedLink[] = [];
    crawledResult.pdfs.forEach((item, idx) => {
      if (selectedCrawledIndices.has(idx)) {
        itemsToAdd.push({
          id: `${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
          url: item.url,
          status: "idle",
          fileName: item.filename || `${item.title.substring(0, 40)}.pdf`,
          language: item.language,
          hasKhmer: item.has_khmer,
        });
      }
    });

    setQueue((prev) => [...prev, ...itemsToAdd]);
    setCrawledResult(null);
    setSelectedCrawledIndices(new Set());
    setWebpageUrl("");
  };

  // Download individual link item
  const downloadSingleItem = async (item: QueuedLink): Promise<QueuedLink> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/fetch-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url.trim() }),
      });

      if (!response.ok) {
        let errDetail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson?.detail) errDetail = errJson.detail;
        } catch {}
        return {
          ...item,
          status: "error",
          error: errDetail,
        };
      }

      const cd = response.headers.get("content-disposition");
      const xFilename = response.headers.get("x-filename");
      const xLang = response.headers.get("x-detected-language");
      const xHasKhmer = response.headers.get("x-has-khmer");

      let filename = xFilename || item.fileName || "imported_document.pdf";
      if (!xFilename && cd && cd.includes("filename=")) {
        const match = cd.match(/filename=["']?([^"';]+)["']?/);
        if (match && match[1]) {
          filename = match[1].trim();
        }
      }

      const blob = await response.blob();
      const fileType = blob.type || (filename.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const file = new File([blob], filename, { type: fileType });

      // Determine language from response headers or previous state
      const detectedLang =
        xLang === "khmer"
          ? "khmer"
          : xLang === "english"
          ? "english"
          : item.language || "khmer";

      const hasKhmerDoc = xHasKhmer === "true" || (xHasKhmer !== "false" && item.hasKhmer !== false);

      return {
        ...item,
        status: "success",
        file,
        fileName: filename,
        fileSize: blob.size,
        language: detectedLang,
        hasKhmer: hasKhmerDoc,
        error: undefined,
      };
    } catch (err: any) {
      return {
        ...item,
        status: "error",
        error: err?.message || "Failed to download remote file",
      };
    }
  };

  // Batch download all pending
  const handleDownloadAll = async () => {
    const pendingItems = queue.filter((item) => item.status === "idle" || item.status === "error");
    if (pendingItems.length === 0) return;

    setIsBatchDownloading(true);
    setGeneralError(null);

    const CONCURRENCY = 3;
    const itemsToProcess = [...pendingItems];

    for (let i = 0; i < itemsToProcess.length; i += CONCURRENCY) {
      const chunk = itemsToProcess.slice(i, i + CONCURRENCY);

      setQueue((prev) =>
        prev.map((q) => (chunk.some((c) => c.id === q.id) ? { ...q, status: "downloading" } : q))
      );

      const results = await Promise.all(chunk.map((item) => downloadSingleItem(item)));

      setQueue((prev) =>
        prev.map((q) => {
          const res = results.find((r) => r.id === q.id);
          return res || q;
        })
      );
    }

    setIsBatchDownloading(false);
  };

  const handleDownloadSingle = async (id: string) => {
    const target = queue.find((q) => q.id === id);
    if (!target) return;

    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "downloading", error: undefined } : q)));
    const updated = await downloadSingleItem(target);
    setQueue((prev) => prev.map((q) => (q.id === id ? updated : q)));
  };

  const handleRemove = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const handleClearAll = () => {
    setQueue([]);
  };

  const handleClearCompleted = () => {
    setQueue((prev) => prev.filter((q) => q.status !== "success"));
  };

  // Remove English files from queue
  const handleRemoveEnglishFiles = () => {
    setQueue((prev) => prev.filter((q) => q.language !== "english" && q.hasKhmer !== false));
  };

  const handleSaveToDevice = (item: QueuedLink) => {
    if (!item.file) return;
    const url = URL.createObjectURL(item.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.fileName || "downloaded.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Processing triggers: Automatically focus Khmer and ignore English
  const handleProcessAll = (mode: "vision" | "text") => {
    const completedItems = queue.filter((q) => q.status === "success" && q.file);
    if (completedItems.length === 0) return;

    // Filter ONLY Khmer documents (ignoring pure English text files)
    const khmerItems = completedItems.filter((q) => q.language !== "english" && q.hasKhmer !== false);
    const englishSkippedCount = completedItems.length - khmerItems.length;

    if (khmerItems.length === 0) {
      setProcessFeedback(
        "⚠️ ឯកសារទាំងអស់ដែលបានទាញយកជាភាសាអង់គ្លេសសុទ្ធ (មិនមានឯកសារខ្មែរសម្រាប់ដំណើរការទេ)។"
      );
      return;
    }

    if (englishSkippedCount > 0) {
      setProcessFeedback(
        `🇰🇭 បានបញ្ជូនឯកសារខ្មែរចំនួន ${khmerItems.length} ទៅដំណើរការ (រំលងឯកសារអង់គ្លេសសុទ្ធចំនួន ${englishSkippedCount} ដោយស្វ័យប្រវត្តិ)។`
      );
    } else {
      setProcessFeedback(null);
    }

    const filesToSend = khmerItems.map((q) => q.file as File);
    onProcessFiles(filesToSend, mode);
  };

  const handleProcessSingle = (item: QueuedLink, mode: "vision" | "text") => {
    if (!item.file) return;
    onProcessFiles([item.file], mode);
  };

  const completedCount = queue.filter((q) => q.status === "success").length;
  const failedCount = queue.filter((q) => q.status === "error").length;
  const downloadingCount = queue.filter((q) => q.status === "downloading").length;
  const englishInQueueCount = queue.filter((q) => q.language === "english" || q.hasKhmer === false).length;
  const khmerInQueueCount = queue.filter((q) => q.language === "khmer" || q.hasKhmer === true).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Route Header */}
      <div className="text-center space-y-2 max-w-3xl mx-auto">
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-indigo-300 text-xs font-semibold">
          <LinkIcon className="h-3.5 w-3.5 text-indigo-400" />
          <span>Batch PDF Downloader & Khmer Webpage Link Crawler</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Download PDFs by Link & Webpage
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 font-khmer max-w-2xl mx-auto leading-relaxed">
          ស្កេនទំព័រគេហទំព័រមួយ (ដូចជាទំព័រច្បាប់ ឬកាតាឡុកឯកសាររបស់ក្រសួង) ដើម្បីស្រង់យក PDF ទាំងអស់ដោយស្វ័យប្រវត្តិ។ <span className="text-emerald-400 font-semibold">ផ្តោតតែឯកសារភាសាខ្មែរ និងរំលងឯកសារអង់គ្លេសសុទ្ធ</span> ដើម្បីកុំឲ្យខាតបង់ Token និងពេលវេលា។
        </p>
      </div>

      {/* Input Mode Tabs & Card */}
      <div className="p-5 sm:p-6 rounded-2xl bg-[#0D1322] border border-slate-800 shadow-xl space-y-5">
        {/* Mode Selector */}
        <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveMode("webpage")}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeMode === "webpage"
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>ស្កេនទំព័រវេបសាយ (Webpage Crawler)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode("direct")}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeMode === "direct"
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300"
            }`}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span>បញ្ចូលតំណភ្ជាប់ផ្ទាល់ (Direct Links)</span>
          </button>
        </div>

        {/* TAB 1: WEBPAGE CRAWLER */}
        {activeMode === "webpage" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                <Globe className="h-4 w-4 text-indigo-400" />
                <span className="font-khmer">បញ្ចូលតំណភ្ជាប់ទំព័រវេបសាយដែលមាន PDF ច្រើន (Single Webpage URL)</span>
              </label>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
              >
                <Clipboard className="h-3.5 w-3.5 text-indigo-400" />
                <span>Paste Webpage URL</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={webpageUrl}
                  onChange={(e) => setWebpageUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && webpageUrl.trim() && !isCrawling) {
                      handleCrawlWebpage();
                    }
                  }}
                  placeholder="https://mosvy.gov.kh/ច្បាប់-និងបទប្បញ្ញត្តិ or https://domain.gov.kh/documents"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#070A12] border border-slate-800 text-white placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <button
                type="button"
                disabled={!webpageUrl.trim() || isCrawling}
                onClick={handleCrawlWebpage}
                className="flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {isCrawling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                    <span>កំពុងស្កេន (Scanning Webpage...)...</span>
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    <span className="font-khmer">ស្កេនរក PDF ទាំងអស់ (Scan PDFs)</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick Link Sample */}
            <div className="flex items-center flex-wrap gap-2 text-xs text-slate-400 pt-1">
              <span className="text-slate-500 font-medium">សាកល្បង៖</span>
              <button
                type="button"
                onClick={() => setWebpageUrl("https://mosvy.gov.kh/%e1%9e%85%e1%9f%92%e1%9e%94%e1%9e%b6%e1%9e%94%e1%9f%8b-%e1%9e%93%e1%9e%b7%e1%9e%84%e1%9e%94%e1%9e%92%e1%9e%94%e1%9e%89%e1%9f%92%e1%9e%89%e1%9e%8f%e1%9f%92%e1%9e%8f%e1%9e%b7.")}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono text-[11px] border border-slate-700/60 transition-colors"
              >
                MOSVY: ច្បាប់ និងបទប្បញ្ញត្តិ
              </button>
            </div>

            {crawlError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span className="font-khmer">{crawlError}</span>
              </div>
            )}

            {/* Crawled Results Drawer / Table */}
            {crawledResult && (
              <div className="mt-4 p-4 rounded-xl bg-[#070A12] border border-indigo-900/60 space-y-4">
                {/* Result Summary Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <h4 className="text-xs font-bold text-white truncate max-w-lg">
                        {crawledResult.webpage_title || crawledResult.webpage_url}
                      </h4>
                    </div>
                    <div className="flex items-center flex-wrap gap-2 text-[11px] font-khmer">
                      <span className="text-slate-400">
                        រកឃើញសរុប <strong className="text-white">{crawledResult.total_found}</strong> ឯកសារ៖
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-semibold">
                        🇰🇭 ខ្មែរ {crawledResult.khmer_count}
                      </span>
                      {crawledResult.english_count > 0 && (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                          🇬🇧 អង់គ្លេស {crawledResult.english_count} (រំលង)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                    >
                      {filteredCrawledPdfs.every((f) => selectedCrawledIndices.has(f.originalIndex)) ? (
                        <>
                          <Square className="h-3.5 w-3.5 text-slate-400" />
                          <span>Deselect All</span>
                        </>
                      ) : (
                        <>
                          <CheckSquare className="h-3.5 w-3.5 text-indigo-400" />
                          <span>Select Filtered</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={selectedCrawledIndices.size === 0}
                      onClick={handleAddCrawledToQueue}
                      className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="font-khmer">បញ្ចូល ({selectedCrawledIndices.size}) ទៅក្នុង Queue</span>
                    </button>
                  </div>
                </div>

                {/* Khmer Priority Notice Banner */}
                <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 flex items-center justify-between text-xs text-indigo-200">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="font-khmer text-[11px]">
                      <strong>ផ្តោតតែឯកសារភាសាខ្មែរ៖</strong> ប្រព័ន្ធបានជ្រើសរើសស្វ័យប្រវត្តិតែឯកសារខ្មែរ ({crawledResult.khmer_count})។ ឯកសារអង់គ្លេស ({crawledResult.english_count}) ត្រូវបានរំលងដោះចេញរួចជាស្រេច។
                    </span>
                  </div>
                </div>

                {/* Filter Toolbar: Language Tabs + Search */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setCrawledLangFilter("khmer")}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                        crawledLangFilter === "khmer"
                          ? "bg-indigo-600 text-white shadow"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      🇰🇭 ឯកសារខ្មែរ ({crawledResult.khmer_count})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrawledLangFilter("all")}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                        crawledLangFilter === "all"
                          ? "bg-indigo-600 text-white shadow"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      🌐 ទាំងអស់ ({crawledResult.total_found})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrawledLangFilter("english")}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                        crawledLangFilter === "english"
                          ? "bg-indigo-600 text-white shadow"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      🇬🇧 អង់គ្លេស ({crawledResult.english_count})
                    </button>
                  </div>

                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={crawledSearchTerm}
                      onChange={(e) => setCrawledSearchTerm(e.target.value)}
                      placeholder="ស្វែងរកតាមចំណងជើង..."
                      className="w-full pl-9 pr-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Discovered PDFs List */}
                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                  {filteredCrawledPdfs.map(({ pdf, originalIndex }) => {
                    const isSelected = selectedCrawledIndices.has(originalIndex);
                    const isKhmer = pdf.has_khmer || pdf.language === "khmer";

                    return (
                      <div
                        key={originalIndex}
                        onClick={() => toggleCrawledSelection(originalIndex)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-indigo-950/40 border-indigo-800/80 text-white"
                            : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-850"
                        }`}
                      >
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          <div className="shrink-0 text-indigo-400">
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-indigo-400" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-600" />
                            )}
                          </div>

                          <FileText className="h-4 w-4 text-rose-400 shrink-0" />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <p className="text-xs font-semibold text-slate-200 truncate font-khmer">
                                {pdf.title}
                              </p>
                              {isKhmer ? (
                                <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 text-[9px] font-bold shrink-0">
                                  🇰🇭 ខ្មែរ
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/60 text-[9px] shrink-0">
                                  🇬🇧 English (Skipped)
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 font-mono truncate">
                              {pdf.filename}
                            </p>
                          </div>
                        </div>

                        <a
                          href={pdf.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded text-slate-500 hover:text-indigo-300 hover:bg-slate-800 transition shrink-0 ml-2"
                          title="Open PDF URL in new tab"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DIRECT LINKS TEXTAREA */}
        {activeMode === "direct" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                <span>បញ្ចូលតំណភ្ជាប់ URL (អាចបញ្ចូលច្រើនតំណភ្ជាប់ក្នុងពេលតែមួយ)</span>
              </label>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
              >
                <Clipboard className="h-3.5 w-3.5 text-indigo-400" />
                <span>Paste Multiple Links</span>
              </button>
            </div>

            <div className="relative">
              <textarea
                rows={4}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Paste one or more PDF / Image links (one per line):\nhttps://example.com/khmer_document.pdf\nhttps://drive.google.com/file/d/1A2B3C.../view\nhttps://www.dropbox.com/s/.../physics.pdf`}
                className="w-full px-4 py-3 rounded-xl bg-[#070A12] border border-slate-800 text-white placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-indigo-500 transition-colors resize-y"
              />
            </div>

            {/* Supported link badges & Add Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Supported:</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-mono text-[10px]">
                  Direct .pdf
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-mono text-[10px]">
                  Google Drive
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-mono text-[10px]">
                  Dropbox
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-mono text-[10px]">
                  Images (.png, .jpg)
                </span>
              </div>

              <button
                type="button"
                disabled={!inputText.trim()}
                onClick={() => handleAddUrls(parseUrls(inputText))}
                className="flex items-center justify-center space-x-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>Add to Download Queue</span>
              </button>
            </div>
          </div>
        )}

        {generalError && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{generalError}</span>
          </div>
        )}
      </div>

      {/* Queue & Actions Header */}
      {queue.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#0D1322] border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center flex-wrap gap-2 text-xs">
              <span className="font-bold text-white">
                Queue: {queue.length} URLs
              </span>
              <span className="text-slate-600">•</span>
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-medium">
                {completedCount} Downloaded
              </span>
              {downloadingCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-medium flex items-center space-x-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{downloadingCount} Downloading</span>
                </span>
              )}
              {englishInQueueCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 font-medium">
                  🇬🇧 {englishInQueueCount} English (Ignored in Batch)
                </span>
              )}
              {failedCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60 font-medium">
                  {failedCount} Failed
                </span>
              )}
            </div>

            <div className="flex items-center flex-wrap gap-2">
              <button
                type="button"
                disabled={isBatchDownloading || queue.every((q) => q.status === "success")}
                onClick={handleDownloadAll}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition disabled:opacity-50"
              >
                {isBatchDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>{isBatchDownloading ? "Downloading All..." : "Download All URLs"}</span>
              </button>

              {completedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleProcessAll("vision")}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition"
                    title="Process all Khmer PDFs with Vision OCR (VLM)"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Process Khmer (Vision OCR)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProcessAll("text")}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow transition"
                    title="Process all Khmer PDFs with Digital Text (Fast)"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Process Khmer (Digital Text)</span>
                  </button>
                </>
              )}

              {englishInQueueCount > 0 && (
                <button
                  type="button"
                  onClick={handleRemoveEnglishFiles}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-medium border border-slate-700 transition-colors"
                  title="Remove all English documents from queue"
                >
                  Clear English ({englishInQueueCount})
                </button>
              )}

              {completedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
                >
                  Clear Done
                </button>
              )}

              <button
                type="button"
                onClick={handleClearAll}
                className="px-2.5 py-1.5 rounded-xl bg-slate-850 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 text-xs font-medium border border-slate-800 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>

          {processFeedback && (
            <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-800 text-indigo-300 text-xs flex items-center justify-between font-khmer">
              <span>{processFeedback}</span>
              <button
                type="button"
                onClick={() => setProcessFeedback(null)}
                className="text-xs text-indigo-400 hover:text-white ml-2 underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Queue List */}
          <div className="space-y-2">
            {queue.map((item, idx) => {
              const isPdf = item.fileName?.toLowerCase().endsWith(".pdf");
              const isImg = item.fileName?.match(/\.(png|jpe?g|webp|bmp|tiff?)$/i);
              const isEnglish = item.language === "english" || item.hasKhmer === false;

              return (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#0D1322] border transition-all gap-3 ${
                    item.status === "error"
                      ? "border-rose-900/60 bg-rose-950/20"
                      : isEnglish
                      ? "border-slate-800/60 opacity-80"
                      : item.status === "success"
                      ? "border-slate-800 hover:border-slate-700"
                      : "border-slate-800/80"
                  }`}
                >
                  <div className="flex items-start sm:items-center space-x-3 min-w-0 flex-1">
                    <span className="text-slate-500 font-mono text-xs w-5 shrink-0 text-right">
                      {idx + 1}.
                    </span>

                    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700/70 shrink-0">
                      {isPdf ? (
                        <FileText className="h-4 w-4 text-rose-400" />
                      ) : isImg ? (
                        <Eye className="h-4 w-4 text-sky-400" />
                      ) : (
                        <LinkIcon className="h-4 w-4 text-indigo-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-white truncate max-w-md">
                          {item.fileName || "document.pdf"}
                        </span>
                        {item.fileSize && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({(item.fileSize / (1024 * 1024)).toFixed(2)} MB)
                          </span>
                        )}
                        {/* Language Badge */}
                        {isEnglish ? (
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[9px] shrink-0 font-medium">
                            🇬🇧 English Only (Ignored)
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 text-[9px] shrink-0 font-bold">
                            🇰🇭 Khmer
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono truncate max-w-xl" title={item.url}>
                        {item.url}
                      </p>
                      {item.error && (
                        <p className="text-[11px] text-rose-400 font-medium">
                          Error: {item.error}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                    {item.status === "idle" && (
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(item.id)}
                        className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                      >
                        <Download className="h-3 w-3" />
                        <span>Download</span>
                      </button>
                    )}

                    {item.status === "downloading" && (
                      <div className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-indigo-950 text-indigo-300 text-xs font-semibold border border-indigo-800/60">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                        <span>Fetching...</span>
                      </div>
                    )}

                    {item.status === "error" && (
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(item.id)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 text-xs font-semibold border border-rose-800 transition"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Retry</span>
                      </button>
                    )}

                    {item.status === "success" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleProcessSingle(item, "vision")}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition"
                          title="Process this file with Vision OCR (VLM)"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Vision OCR</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleProcessSingle(item, "text")}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold transition"
                          title="Extract directly with Digital Text (Fast)"
                        >
                          <FileText className="h-3 w-3" />
                          <span>Digital Text</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSaveToDevice(item)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                          title="Save to computer"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemove(item.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                      title="Remove from queue"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State Help Card */}
      {queue.length === 0 && !crawledResult && (
        <div className="p-8 rounded-2xl bg-[#0D1322] border border-slate-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-indigo-400 shadow-inner">
            <Globe className="h-6 w-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-sm font-bold text-white">No documents queued yet</h3>
            <p className="text-xs text-slate-400 font-khmer">
              បញ្ចូលតំណភ្ជាប់គេហទំព័រមួយដែលមានឯកសារជាច្រើន (ដូចជាគេហទំព័រក្រសួង ឬស្ថាប័នរដ្ឋ)។ ប្រព័ន្ធនឹងស្កេនស្រង់យក និងជ្រើសរើសស្វ័យប្រវត្តិតែឯកសារខ្មែរ ដោយរំលងឯកសារអង់គ្លេស។
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center space-x-3">
            <button
              type="button"
              onClick={() => {
                setActiveMode("webpage");
                setWebpageUrl("https://mosvy.gov.kh/%e1%9e%85%e1%9f%92%e1%9e%94%e1%9e%b6%e1%9e%94%e1%9f%8b-%e1%9e%93%e1%9e%b7%e1%9e%84%e1%9e%94%e1%9e%92%e1%9e%94%e1%9e%89%e1%9f%92%e1%9e%89%e1%9e%8f%e1%9f%92%e1%9e%8f%e1%9e%b7.");
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-4 font-khmer"
            >
              សាកល្បងជាមួយតំណភ្ជាប់ MOSVY Regulations (ស្កេនឯកសារខ្មែរ)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
