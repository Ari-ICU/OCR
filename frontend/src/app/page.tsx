"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Navbar, ModelInfo, NavTab } from "../components/Navbar";
import { DownloadLinksView } from "../components/DownloadLinksView";
import { FileUpload } from "../components/FileUpload";
import { PageCard, PageResult } from "../components/PageCard";
import { StatsBar } from "../components/StatsBar";
import { PageGridNavigator } from "../components/PageGridNavigator";
import { ProcessingBackbone } from "../components/ProcessingBackbone";
import { LogMonitor } from "../components/LogMonitor";
import { KeyManagementView } from "../components/KeyManagementView";
import { API_BASE_URL } from "../config/api";
import {
  Sparkles,
  BookOpen,
  Terminal,
} from "lucide-react";
import { detectKhmerErrors } from "../utils/khmerValidator";

import {
  persistActiveSession,
  persistPagesOnly,
  loadPersistedSession,
  clearPersistedSession,
} from "../utils/sessionStorageDB";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [apiKey, setApiKey] = useState<string>("");
  const [hfKey, setHfKey] = useState<string>("");
  const [ollamaUrl, setOllamaUrl] = useState<string>("http://localhost:11434");
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.6-flash");
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);
  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);

  // Navigation: Vision OCR (#vision) vs Digital Text (#text) vs Download Links (#download) vs Monitor (#monitor) vs Keys (#keys)
  const [activeTab, setActiveTab] = useState<NavTab>("vision");

  // PDF & Multi-Image processing state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [totalPdfDocPages, setTotalPdfDocPages] = useState<number>(0);
  const [pages, setPages] = useState<PageResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [processingMode, setProcessingMode] = useState<"vision" | "text">("vision");
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number | null>(2);
  const [sessionRestored, setSessionRestored] = useState<boolean>(false);

  // Rate limit counter for navbar notification
  const [rateLimitHitsCount, setRateLimitHitsCount] = useState<number>(0);

  // Filter & Search states
  const [filterStatus, setFilterStatus] = useState<"all" | "completed" | "formulas">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeWorkerPages, setActiveWorkerPages] = useState<number[]>([]);
  const [collapsedPages, setCollapsedPages] = useState<Set<number>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Warn user before refreshing or closing tab while processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing) {
        e.preventDefault();
        e.returnValue = "Khmer PDF conversion is currently running. Are you sure you want to leave or refresh?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isProcessing]);

  const handleToggleCollapse = (pageNum: number) => {
    setCollapsedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) {
        next.delete(pageNum);
      } else {
        next.add(pageNum);
      }
      try {
        localStorage.setItem("khmerpdf_collapsed_pages", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const handleCollapseAll = () => {
    const all = new Set(pages.map((p) => p.page_number));
    setCollapsedPages(all);
    try {
      localStorage.setItem("khmerpdf_collapsed_pages", JSON.stringify(Array.from(all)));
    } catch {}
  };

  const handleExpandAll = () => {
    const empty = new Set<number>();
    setCollapsedPages(empty);
    try {
      localStorage.setItem("khmerpdf_collapsed_pages", JSON.stringify([]));
    } catch {}
  };

  // Helper to determine AI provider
  const getProviderForModel = (model: string): "huggingface" | "ollama" | "gemini" => {
    if (model.startsWith("Qwen/") || model.startsWith("meta-llama/") || model.includes("Hugging Face")) {
      return "huggingface";
    }
    if (
      model.startsWith("qwen2.5vl") ||
      model.startsWith("qwen2.5-vl") ||
      model.startsWith("qwen2.5:") ||
      model.includes("llama3.2-vision") ||
      model.includes(":7b") ||
      model.includes(":14b") ||
      model.includes(":32b") ||
      model.includes("Ollama")
    ) {
      return "ollama";
    }
    return "gemini";
  };

  // Load saved settings from localStorage & saved session from IndexedDB on initial mount
  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("khmerpdf_api_key");
      if (savedKey) setApiKey(savedKey);

      const savedHfKey = localStorage.getItem("khmerpdf_hf_key");
      if (savedHfKey) setHfKey(savedHfKey);

      const savedOllama = localStorage.getItem("khmerpdf_ollama_url");
      if (savedOllama) setOllamaUrl(savedOllama);

      const savedModel = localStorage.getItem("khmerpdf_selected_model");
      if (savedModel) {
        if (savedModel.includes("2.0") || savedModel.includes("1.5")) {
          setSelectedModel("gemini-3.6-flash");
          try { localStorage.setItem("khmerpdf_selected_model", "gemini-3.6-flash"); } catch {}
        } else {
          setSelectedModel(savedModel);
        }
      }

      const savedCollapsed = localStorage.getItem("khmerpdf_collapsed_pages");
      if (savedCollapsed) {
        try {
          const parsed = JSON.parse(savedCollapsed);
          if (Array.isArray(parsed)) {
            setCollapsedPages(new Set(parsed));
          }
        } catch {}
      }

      // Restore processing mode (Vision OCR vs Digital Text) from localStorage
      const savedMode = localStorage.getItem("khmerpdf_processing_mode");
      if (savedMode === "vision" || savedMode === "text") {
        setProcessingMode(savedMode);
      }

      // Restore active main navigation tab from URL hash (#vision, #text, #download, #monitor, #keys) or localStorage
      const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "").toLowerCase() : "";
      const savedTab = localStorage.getItem("khmerpdf_active_tab") as NavTab | null;

      if (hash === "vision" || hash === "vision-ocr") {
        setActiveTab("vision");
        setProcessingMode("vision");
      } else if (hash === "text" || hash === "digital-text") {
        setActiveTab("text");
        setProcessingMode("text");
      } else if (hash === "download" || hash === "download-links" || hash === "links") {
        setActiveTab("download");
      } else if (hash === "monitor") {
        setActiveTab("monitor");
      } else if (hash === "keys") {
        setActiveTab("keys");
      } else if (hash === "pdf") {
        const mode = savedMode === "text" ? "text" : "vision";
        setActiveTab(mode);
        setProcessingMode(mode);
      } else if (savedTab && ["vision", "text", "download", "monitor", "keys"].includes(savedTab)) {
        setActiveTab(savedTab);
        if (savedTab === "vision" || savedTab === "text") {
          setProcessingMode(savedTab);
        }
      } else {
        const mode = savedMode === "text" ? "text" : "vision";
        setActiveTab(mode);
        setProcessingMode(mode);
      }
    } catch (e) {
      console.warn("Could not read localStorage", e);
    }

    // Restore PDF session from IndexedDB so refreshing keeps all work intact!
    async function restoreSession() {
      try {
        const { session, file } = await loadPersistedSession();
        if (session) {
          if (file && file.size > 0) {
            setSelectedFile(file);
            setSelectedFiles([file]);
          } else {
            setSelectedFile(null);
            setSelectedFiles([]);
          }
          if (session.pages && session.pages.length > 0) {
            const sanitizedPages = session.pages.map((p) => ({
              ...p,
              isProcessing: false,
            }));
            setPages(sanitizedPages);
            setTotalPages(sanitizedPages.length);
          }

          if (session.totalPdfDocPages) setTotalPdfDocPages(session.totalPdfDocPages);
          if (session.startPage) setStartPage(session.startPage);
          if (session.endPage !== undefined && session.endPage !== null) setEndPage(session.endPage);
          // Check localStorage FIRST because it stores the user's latest explicitly chosen engine mode
          const savedMode = localStorage.getItem("khmerpdf_processing_mode");
          if (savedMode === "vision" || savedMode === "text") {
            setProcessingMode(savedMode);
          } else if (session.processingMode) {
            setProcessingMode(session.processingMode);
            try { localStorage.setItem("khmerpdf_processing_mode", session.processingMode); } catch {}
          }
          if (session.concurrency) setConcurrency(Math.min(2, Math.max(1, session.concurrency)));
          if (file || (session.pages && session.pages.length > 0)) {
            setSessionRestored(true);
          }
        }
      } catch (err) {
        console.warn("Failed to restore previous session from IndexedDB", err);
      }
    }
    restoreSession();
    setMounted(true);
  }, []);

  const handleSetProcessingMode = (mode: "vision" | "text") => {
    setProcessingMode(mode);
    try {
      localStorage.setItem("khmerpdf_processing_mode", mode);
    } catch {}
    if (activeTab === "vision" || activeTab === "text") {
      setActiveTab(mode);
      try {
        localStorage.setItem("khmerpdf_active_tab", mode);
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `#${mode}`);
        }
      } catch {}
    }
    if (selectedFile) {
      persistActiveSession(selectedFile, pages, {
        totalPdfDocPages,
        totalPages,
        startPage,
        endPage,
        processingMode: mode,
        concurrency,
      });
    }
  };

  const handleSetApiKey = (key: string) => {
    setApiKey(key);
    try {
      localStorage.setItem("khmerpdf_api_key", key);
    } catch { }
  };

  const handleSetHfKey = (key: string) => {
    setHfKey(key);
    try {
      localStorage.setItem("khmerpdf_hf_key", key);
    } catch { }
  };


  const handleSetOllamaUrl = (url: string) => {
    setOllamaUrl(url);
    try {
      localStorage.setItem("khmerpdf_ollama_url", url);
    } catch { }
  };

  const handleSetSelectedModel = (model: string) => {
    setSelectedModel(model);
    if (model === "qwen2.5:7b") {
      handleSetProcessingMode("text");
      setConcurrency(1);
    } else if (model.includes("qwen2.5vl") || model.includes("llama3.2-vision") || model.includes(":32b") || model.includes(":7b")) {
      setConcurrency(1);
    }
    try {
      localStorage.setItem("khmerpdf_selected_model", model);
    } catch { }
  };

  const handleSetActiveTab = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab === "vision") {
      setProcessingMode("vision");
      try { localStorage.setItem("khmerpdf_processing_mode", "vision"); } catch {}
    } else if (tab === "text") {
      setProcessingMode("text");
      try { localStorage.setItem("khmerpdf_processing_mode", "text"); } catch {}
    }
    try {
      localStorage.setItem("khmerpdf_active_tab", tab);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `#${tab}`);
      }
    } catch {}
  };

  // Keep active tab in sync when user clicks back/forward or navigates via hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "").toLowerCase();
      if (hash === "vision" || hash === "vision-ocr") {
        setActiveTab("vision");
        setProcessingMode("vision");
        try { localStorage.setItem("khmerpdf_processing_mode", "vision"); } catch {}
      } else if (hash === "text" || hash === "digital-text") {
        setActiveTab("text");
        setProcessingMode("text");
        try { localStorage.setItem("khmerpdf_processing_mode", "text"); } catch {}
      } else if (hash === "download" || hash === "download-links" || hash === "links") {
        setActiveTab("download");
      } else if (hash === "monitor") {
        setActiveTab("monitor");
      } else if (hash === "keys") {
        setActiveTab("keys");
      } else if (hash === "pdf") {
        const savedMode = localStorage.getItem("khmerpdf_processing_mode");
        const mode = savedMode === "text" ? "text" : "vision";
        setActiveTab(mode);
        setProcessingMode(mode);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Check backend health & fetch models list
  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`);
      if (res.ok) {
        setBackendHealthy(true);
        const data = await res.json();
        if (data.active_models) {
          setModelsList(data.active_models);
        }
      } else {
        setBackendHealthy(false);
      }
    } catch {
      setBackendHealthy(false);
    }
  }, []);

  useEffect(() => {
    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 12000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  // When a file is selected, fetch lightweight preview immediately and persist session
  // When files are selected (single PDF or multiple images), fetch preview and persist session
  const handleFilesSelected = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setSelectedFiles(files);
    setSelectedFile(files[0]);
    setPages([]);
    setTotalPages(0);
    setTotalPdfDocPages(0);
    setErrorMessage(null);
    setStartPage(1);
    setSessionRestored(false);

    const formData = new FormData();
    for (const f of files) {
      formData.append("files", f);
    }

    let docTotal = files.length;
    try {
      const res = await fetch(`${API_BASE_URL}/api/extract-preview`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        docTotal = data.total_pages || files.length;
        setTotalPdfDocPages(docTotal);
        setEndPage(docTotal);
      } else {
        setEndPage(files.length);
      }
    } catch (err) {
      console.warn("Preview load error", err);
      setEndPage(files.length);
    } finally {
      persistActiveSession(files[0], [], {
        totalPdfDocPages: docTotal,
        totalPages: 0,
        startPage: 1,
        endPage: docTotal,
        processingMode,
        concurrency,
      });
    }
  };

  const handleClearExtractedPages = () => {
    setPages([]);
    setTotalPages(0);
    setStartPage(1);
    setEndPage(2);
    if (selectedFile) {
      persistActiveSession(selectedFile, [], {
        totalPdfDocPages,
        totalPages: 0,
        startPage: 1,
        endPage: 2,
        processingMode,
        concurrency,
      });
    }
  };

  const handleClearAllSession = async () => {
    setSelectedFile(null);
    setSelectedFiles([]);
    setPages([]);
    setTotalPages(0);
    setTotalPdfDocPages(0);
    setErrorMessage(null);
    setSessionRestored(false);
    setStartPage(1);
    setEndPage(2);
    await clearPersistedSession();
  };

  // Handle PDF / Multi-Image SSE Streaming with continuous merging/appending and auto-persistence
  const handleStartProcessing = async () => {
    const activeList = selectedFiles.length > 0 ? selectedFiles : selectedFile ? [selectedFile] : [];
    if (activeList.length === 0) return;

    setIsProcessing(true);
    setErrorMessage(null);
    setActiveWorkerPages([]);

    const effectiveProvider = getProviderForModel(selectedModel);

    const formData = new FormData();
    for (const f of activeList) {
      formData.append("files", f);
    }
    formData.append("mode", processingMode);
    formData.append("provider", effectiveProvider);
    formData.append("model", selectedModel);
    formData.append("concurrency", String(concurrency));
    formData.append("start_page", String(startPage));
    if (endPage) {
      formData.append("end_page", String(endPage));
    }
    if (effectiveProvider === "huggingface" && hfKey) {
      formData.append("api_key", hfKey);
    } else if (apiKey) {
      formData.append("api_key", apiKey);
    }
    if (ollamaUrl) formData.append("ollama_url", ollamaUrl);

    // Auto-Skip: tell backend to immediately skip already restored pages
    const alreadyCompletedPages = pages
      .filter((p) => p.success && p.corrected_text && p.corrected_text.trim().length > 0)
      .map((p) => p.page_number);
    if (alreadyCompletedPages.length > 0) {
      formData.append("skip_pages", JSON.stringify(alreadyCompletedPages));
    }



    try {
      const response = await fetch(`${API_BASE_URL}/api/extract-correct-stream`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        const detailMsg = errorJson?.detail || `Server returned HTTP ${response.status}`;
        throw new Error(detailMsg);
      }

      if (!response.body) {
        throw new Error("ReadableStream not supported in response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Normalize CRLF to LF for reliable splitting
        const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const blocks = normalized.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          if (!block.trim()) continue;

          let eventType = "message";
          const dataLines: string[] = [];

          for (const rawLine of block.split("\n")) {
            const line = rawLine.trim();
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (rawLine.startsWith("data:")) {
              dataLines.push(rawLine.replace(/^data:\s?/, ""));
            }
          }

          const dataStr = dataLines.join("\n").trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === "init") {
              const docTotal = data.doc_total_pages || data.total_pages || 0;
              setTotalPdfDocPages(docTotal);

              const incomingOverview: PageResult[] = (data.pages_overview || []).map(
                (p: any) => ({
                  page_number: p.page_number,
                  raw_text: p.raw_text || "",
                  corrected_text: "",
                  model_used: "",
                  elapsed_seconds: 0,
                  success: false,
                  isProcessing: false,
                  word_count: p.word_count || 0,
                  char_count: p.char_count || 0,
                  has_formulas: p.has_formulas || false,
                  thumbnail: p.thumbnail || ""
                })
              );

              // Merge into existing pages without overwriting previous finished pages
              setPages((prevPages) => {
                const pageMap = new Map<number, PageResult>();
                prevPages.forEach((p) => pageMap.set(p.page_number, p));

                incomingOverview.forEach((p) => {
                  if (!pageMap.has(p.page_number)) {
                    pageMap.set(p.page_number, p);
                  } else {
                    const existing = pageMap.get(p.page_number)!;
                    pageMap.set(p.page_number, {
                      ...existing,
                      thumbnail: p.thumbnail || existing.thumbnail,
                      raw_text: p.raw_text || existing.raw_text,
                      isProcessing: false
                    });
                  }
                });

                const merged = Array.from(pageMap.values()).sort((a, b) => a.page_number - b.page_number);
                setTotalPages(merged.length);
                persistPagesOnly(merged);
                return merged;
              });

            } else if (eventType === "page_start") {
              setActiveWorkerPages((prev) => Array.from(new Set([...prev, data.page_number])));
              setPages((prev) => {
                const exists = prev.some(p => p.page_number === data.page_number);
                if (exists) {
                  return prev.map((p) =>
                    p.page_number === data.page_number
                      ? { ...p, raw_text: data.raw_text || p.raw_text, isProcessing: true }
                      : p
                  );
                } else {
                  const newP: PageResult = {
                    page_number: data.page_number,
                    raw_text: data.raw_text || "",
                    corrected_text: "",
                    model_used: "",
                    elapsed_seconds: 0,
                    success: false,
                    isProcessing: true,
                    word_count: (data.raw_text || "").split(/\s+/).length,
                    char_count: (data.raw_text || "").length,
                    has_formulas: false,
                  };
                  return [...prev, newP].sort((a, b) => a.page_number - b.page_number);
                }
              });

            } else if (eventType === "page_done") {
              setActiveWorkerPages((prev) => prev.filter((num) => num !== data.page_number));
              setPages((prev) => {
                const exists = prev.some(p => p.page_number === data.page_number);
                let updated: PageResult[];
                if (exists) {
                  updated = prev.map((p) =>
                    p.page_number === data.page_number
                      ? {
                        ...p,
                        page_number: data.page_number,
                        raw_text: data.raw_text || p.raw_text,
                        corrected_text: data.already_completed ? p.corrected_text : (data.corrected_text ?? p.corrected_text),
                        model_used: data.already_completed ? p.model_used : (data.model_used ?? p.model_used),
                        elapsed_seconds: data.already_completed ? p.elapsed_seconds : (data.elapsed_seconds ?? p.elapsed_seconds),
                        tokens_used: data.already_completed ? p.tokens_used : ((data.tokens_used ?? 0) + (p.tokens_used || 0)),
                        success: data.already_completed ? p.success : (data.success ?? p.success),
                        error: data.already_completed ? p.error : data.error,
                        is_blank: data.already_completed ? p.is_blank : (data.is_blank ?? (data.model_used === "blank-skipped")),
                        is_english_skipped: data.already_completed ? p.is_english_skipped : (data.is_english_skipped ?? (data.model_used === "english-skipped")),
                        isProcessing: false,
                      }
                      : p
                  );
                } else {
                  const newP: PageResult = {
                    page_number: data.page_number,
                    raw_text: data.raw_text || "",
                    corrected_text: data.corrected_text,
                    model_used: data.model_used,
                    elapsed_seconds: data.elapsed_seconds,
                    tokens_used: data.tokens_used || 0,
                    success: data.success,
                    error: data.error,
                    is_blank: Boolean(data.is_blank || data.model_used === "blank-skipped"),
                    is_english_skipped: Boolean(data.is_english_skipped || data.model_used === "english-skipped"),
                    isProcessing: false,
                  };
                  updated = [...prev, newP].sort((a, b) => a.page_number - b.page_number);
                }
                // Save incrementally as each page finishes
                persistPagesOnly(updated);
                return updated;
              });

            } else if (eventType === "done") {
              setIsProcessing(false);
              setActiveWorkerPages([]);
              // Auto increment the range inputs to the next batch for user convenience
              const lastDonePage = endPage || startPage;
              let nextS = startPage;
              let nextE = endPage;
              if (totalPdfDocPages > 0 && lastDonePage < totalPdfDocPages) {
                const batchSize = (endPage && startPage) ? Math.max(1, endPage - startPage + 1) : 2;
                nextS = lastDonePage + 1;
                nextE = Math.min(totalPdfDocPages, nextS + batchSize - 1);
                setStartPage(nextS);
                setEndPage(nextE);
              }
              // Save final session state
              setPages((currentPages) => {
                persistActiveSession(selectedFile, currentPages, {
                  totalPdfDocPages,
                  totalPages: currentPages.length,
                  startPage: nextS,
                  endPage: nextE,
                  processingMode,
                  concurrency,
                });
                return currentPages;
              });
            } else if (eventType === "error") {
              setErrorMessage(data.message || "An error occurred during extraction.");
              setIsProcessing(false);
              setActiveWorkerPages([]);
            }
          } catch (e) {
            console.error("SSE parse error", e, dataStr);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("PDF extraction aborted by user.");
      } else {
        console.error(err);
        setErrorMessage(
          err instanceof Error
            ? err.message
            : `Failed to connect to FastAPI backend. Make sure the backend is running on ${API_BASE_URL}.`
        );
      }
    } finally {
      setIsProcessing(false);
      setActiveWorkerPages([]);
      abortControllerRef.current = null;
    }
  };

  const handleCancelProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsProcessing(false);
    setActiveWorkerPages([]);
  };


  // Re-process a single page with AI and persist
  const handleReprocessSinglePage = async (pageNum: number, modelToUse?: string) => {
    const pageItem = pages.find((p) => p.page_number === pageNum);
    if (!pageItem) return;

    setPages((prev) =>
      prev.map((p) => (p.page_number === pageNum ? { ...p, isProcessing: true } : p))
    );

    try {
      const activeModel = modelToUse || selectedModel;
      const effectiveProvider = getProviderForModel(activeModel);
      const effectiveKey = effectiveProvider === "huggingface" ? (hfKey || undefined) : (apiKey || undefined);

      const res = await fetch(`${API_BASE_URL}/api/reprocess-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_text: pageItem.raw_text,
          page_number: pageNum,
          api_key: effectiveKey,
          model: activeModel || undefined,
          provider: effectiveProvider,
          mode: processingMode,
          image_base64: pageItem.thumbnail || undefined,
        }),
      });

      const data = await res.json();
      setPages((prev) => {
        const updated = prev.map((p) =>
          p.page_number === pageNum
            ? {
              ...p,
              corrected_text: data.corrected_text,
              model_used: data.model_used || activeModel,
              elapsed_seconds: data.elapsed_seconds,
              tokens_used: data.tokens_used || 0,
              success: data.success,
              error: data.error,
              isProcessing: false,
            }
            : p
        );
        persistPagesOnly(updated);
        return updated;
      });
    } catch {
      setPages((prev) => {
        const updated = prev.map((p) =>
          p.page_number === pageNum
            ? { ...p, isProcessing: false, error: "Failed to re-run page" }
            : p
        );
        persistPagesOnly(updated);
        return updated;
      });
    }
  };

  const [isRetryingFailed, setIsRetryingFailed] = useState(false);
  const [retryingPagesCount, setRetryingPagesCount] = useState(0);

  // Batch re-process arbitrary list of pages with custom model option
  const handleReprocessBatchPages = async (targetPages: PageResult[], modelToUse?: string) => {
    if (targetPages.length === 0 || isRetryingFailed) return;

    setIsRetryingFailed(true);
    setRetryingPagesCount(targetPages.length);

    const batchSize = Math.max(1, concurrency || 4);
    for (let i = 0; i < targetPages.length; i += batchSize) {
      const batch = targetPages.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map((p) => handleReprocessSinglePage(p.page_number, modelToUse))
      );
      setRetryingPagesCount(Math.max(0, targetPages.length - (i + batch.length)));
    }
    setIsRetryingFailed(false);
    setRetryingPagesCount(0);
  };

  // Re-process all failed / raw mode pages
  const handleReprocessAllFailedPages = async (modelToUse?: string) => {
    const failed = pages.filter(
      (p) => !p.isProcessing && (!p.success || p.model_used === "fallback-raw" || !!p.error)
    );
    await handleReprocessBatchPages(failed, modelToUse || "gemini-3.6-flash");
  };

  // Re-process all pages with Red Line Errors (Khmer Unicode / OCR anomalies or failure)
  const handleReprocessRedLineErrors = async (modelToUse?: string) => {
    const redLinePages = pages.filter((p) => {
      if (p.isProcessing) return false;
      if (!p.success || p.model_used === "fallback-raw" || !!p.error) return true;
      const text = p.corrected_text || p.raw_text;
      const isDone = !!p.corrected_text;
      return isDone && detectKhmerErrors(text).length > 0;
    });
    await handleReprocessBatchPages(redLinePages, modelToUse || "gemini-3.6-flash");
  };

  // Quick Flash re-run handler (Gemini 3.6 Flash #1 model)
  const handleReprocessWithFlash = async (target: "all_35" | "all" | "red_lines" | "failed") => {
    if (target === "all_35") {
      // Re-run all pages that were scanned with 3.5 models / fallback / errors
      const pagesToUpgrade = pages.filter(
        (p) =>
          !p.isProcessing &&
          (!p.model_used ||
            p.model_used.includes("3.5") ||
            p.model_used === "fallback-raw" ||
            !p.success ||
            p.model_used !== "gemini-3.6-flash")
      );
      const targetList = pagesToUpgrade.length > 0 ? pagesToUpgrade : pages.filter((p) => !p.isProcessing);
      await handleReprocessBatchPages(targetList, "gemini-3.6-flash");
    } else if (target === "red_lines") {
      await handleReprocessRedLineErrors("gemini-3.6-flash");
    } else if (target === "failed") {
      await handleReprocessAllFailedPages("gemini-3.6-flash");
    } else {
      const allPages = pages.filter((p) => !p.isProcessing);
      await handleReprocessBatchPages(allPages, "gemini-3.6-flash");
    }
  };

  // Update page text after manual inline edit and persist
  const handleUpdatePageText = (pageNum: number, newText: string) => {
    setPages((prev) => {
      const updated = prev.map((p) =>
        p.page_number === pageNum ? { ...p, corrected_text: newText } : p
      );
      persistPagesOnly(updated);
      return updated;
    });
  };

  // Scroll to page card
  const handleScrollToPage = (pageNum: number) => {
    const el = document.getElementById(`page-card-${pageNum}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // Filter and search pages
  const filteredPages = useMemo(() => {
    return pages.filter((p) => {
      if (filterStatus === "completed" && !p.corrected_text) return false;
      if (filterStatus === "formulas" && !p.has_formulas) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const rawMatch = (p.raw_text || "").toLowerCase().includes(query);
        const correctedMatch = (p.corrected_text || "").toLowerCase().includes(query);
        return rawMatch || correctedMatch;
      }

      return true;
    });
  }, [pages, filterStatus, searchQuery]);

  const completedPagesCount = pages.filter((p) => !!p.corrected_text).length;
  const existingPageNumbers = useMemo(() => pages.map(p => p.page_number), [pages]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070A12] text-slate-400" suppressHydrationWarning>
        <div className="flex items-center space-x-3">
          <div className="h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <span className="text-xs font-semibold text-slate-400 font-mono">Loading KhmerPDF AI...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#070A12] text-[#F8FAFC]" suppressHydrationWarning>
      <Navbar
        apiKey={apiKey}
        setApiKey={handleSetApiKey}
        hfKey={hfKey}
        setHfKey={handleSetHfKey}
        selectedModel={selectedModel}
        setSelectedModel={handleSetSelectedModel}
        backendHealthy={backendHealthy}
        onRefreshHealth={checkBackendHealth}
        modelsList={modelsList}
        ollamaUrl={ollamaUrl}
        setOllamaUrl={handleSetOllamaUrl}
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        rateLimitHits={rateLimitHitsCount}
        processingMode={processingMode}
        setProcessingMode={handleSetProcessingMode}
        isProcessing={isProcessing}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ROUTE 1 & 2: PDF DOCUMENT PROCESSOR (VISION OCR / DIGITAL TEXT) */}
        <div className={(activeTab === "vision" || activeTab === "text") ? "space-y-6 block" : "hidden"}>
          {/* Hero Section */}
          <div className="text-center space-y-3 max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span>
                {processingMode === "vision"
                  ? "Vision OCR (VLM) • 100% Khmer Subscripts (ជើង) • LaTeX Formulas ($...$)"
                  : "Digital Text (Fast) • Direct Unicode Text Layer Extraction"}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              {processingMode === "vision"
                ? "Convert Khmer PDFs to Clean Text & LaTeX"
                : "Fast Digital Khmer PDF & Webpage Text Extractor"}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-khmer max-w-2xl mx-auto leading-relaxed">
              {processingMode === "vision"
                ? "បំប្លែងឯកសារ PDF ភាសាខ្មែរ ទៅជាអត្ថបទស្អាត ត្រឹមត្រូវតាមស្ដង់ដារយូនីកូដ (Consonant + Subscript ជើង + Vowel + Signs) ព្រមទាំងរក្សារូបមន្តគណិតវិទ្យា/រូបវិទ្យាជាទម្រង់ LaTeX 100%"
                : "ស្រង់អត្ថបទយូនីកូដខ្មែរដោយផ្ទាល់ពី Digital PDF ឬតំណភ្ជាប់ Webpage HTML ក្នុងល្បឿនលឿនបំផុត (Fast Native Extraction) ដោយមិនបាច់រង់ចាំ AI VLM"}
            </p>
          </div>

          {/* File Upload Area */}
          <FileUpload
            onFilesSelected={handleFilesSelected}
            onFileSelected={(file) => handleFilesSelected([file])}
            selectedFile={selectedFile}
            selectedFiles={selectedFiles}
            onClearFile={handleClearAllSession}
            isProcessing={isProcessing}
            onStartProcessing={handleStartProcessing}
            concurrency={concurrency}
            setConcurrency={setConcurrency}
            processingMode={processingMode}
            setProcessingMode={handleSetProcessingMode}
            startPage={startPage}
            setStartPage={setStartPage}
            endPage={endPage}
            setEndPage={setEndPage}
            totalPdfPages={totalPdfDocPages}
            existingPagesCount={pages.length}
            onClearExtractedPages={handleClearExtractedPages}
            existingPageNumbers={existingPageNumbers}
            sessionRestored={sessionRestored}
          />

          {/* Error Display */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between shadow-lg">
              <span>{errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-rose-400 hover:text-rose-200 font-bold ml-2 text-sm"
              >
                ✕
              </button>
            </div>
          )}

          {/* Live Processing Pipeline Backbone Tracker */}
          {(isProcessing || pages.length > 0) && (
            <ProcessingBackbone
              totalPages={pages.length}
              completedPages={completedPagesCount}
              isProcessing={isProcessing}
              concurrency={concurrency}
              activePages={activeWorkerPages}
              selectedModel={selectedModel}
              onCancel={handleCancelProcessing}
              apiKey={apiKey}
              hfKey={hfKey}
            />
          )}

          {/* Stats & Progress Bar */}
          {pages.length > 0 && (
            <StatsBar
              totalPages={pages.length}
              completedPages={completedPagesCount}
              pages={pages}
              filename={selectedFile?.name || "document.pdf"}
              isProcessing={isProcessing}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
          )}

          {/* Page Grid Jump Navigator */}
          {pages.length > 1 && (
            <PageGridNavigator
              pages={pages}
              onSelectPage={handleScrollToPage}
              onRetryFailedPages={handleReprocessAllFailedPages}
              onRetryRedLineErrors={handleReprocessRedLineErrors}
              isRetryingFailed={isRetryingFailed}
              retryingPagesCount={retryingPagesCount}
            />
          )}

          {/* Page Results List */}
          {pages.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2 font-khmer">
                  <BookOpen className="h-4 w-4 text-indigo-400" />
                  <span>
                    ទំព័រដែលបានទាញយក និងកែសម្រួល ({filteredPages.length} ក្នុងចំណោម {pages.length} ទំព័រដែលបានស្រង់)
                  </span>
                </h3>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                    title="Collapse all page previews to compact list"
                  >
                    Collapse All
                  </button>
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                    title="Expand all page previews"
                  >
                    Expand All
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                {filteredPages.map((page) => (
                  <PageCard
                    key={page.page_number}
                    page={page}
                    onUpdatePageText={handleUpdatePageText}
                    onReprocessPage={handleReprocessSinglePage}
                    isCollapsed={collapsedPages.has(page.page_number)}
                    onToggleCollapse={() => handleToggleCollapse(page.page_number)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ROUTE 3: DEDICATED BATCH LINK DOWNLOADER ROUTE */}
        <div className={activeTab === "download" ? "block" : "hidden"}>
          <DownloadLinksView
            onProcessFiles={(files, mode) => {
              handleFilesSelected(files);
              handleSetProcessingMode(mode);
              handleSetActiveTab(mode);
            }}
            onNavigateToEngine={(mode) => {
              handleSetProcessingMode(mode);
              handleSetActiveTab(mode);
            }}
          />
        </div>

        {/* TAB 2: DEDICATED LIVE MONITOR & RATE LIMIT TAB */}
        <div className={activeTab === "monitor" ? "space-y-4 block" : "hidden"}>
          <div className="text-center space-y-2 max-w-2xl mx-auto pb-2">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-semibold shadow-inner">
              <Terminal className="h-3.5 w-3.5 text-emerald-400" />
              <span>Live Server-Sent Events (SSE) Telemetry Stream</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
              Live API & Rate Limit Monitor
            </h2>
            <p className="text-xs text-slate-400">
              Track real-time Google Gemini API calls, token throughput, rate limit backoffs (429), and worker latencies.
            </p>
          </div>

          <LogMonitor
            isOpen={true}
            onToggle={() => { }}
          />
        </div>

        {/* TAB 4: GOOGLE GEMINI KEY POOL & SCALING ENGINE VIEW */}
        <div className={activeTab === "keys" ? "block" : "hidden"}>
          <KeyManagementView
            apiKey={apiKey}
            setApiKey={handleSetApiKey}
            hfKey={hfKey}
            setHfKey={handleSetHfKey}
            ollamaUrl={ollamaUrl}
            setOllamaUrl={handleSetOllamaUrl}
          />
        </div>
      </main>


      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 mt-12 bg-[#070A12]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
          <p>© 2026 KhmerPDF AI • Powered by FastAPI & Next.js with Gemini AI & PyMuPDF</p>
          <div className="flex items-center space-x-4 font-khmer">
            <span>Khmer Unicode Normalization</span>
            <span>•</span>
            <span>LaTeX Math & KaTeX</span>
            <span>•</span>
            <span>Live Telemetry Stream</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
