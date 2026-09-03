"use client";

import React, { useState, useMemo } from "react";
import {
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Cpu,
  Clock,
  FileCheck,
  Eye,
  Code,
  Columns,
  Edit3,
  RefreshCw,
  Sparkles,
  Save,
  Sigma,
  FileImage,
  Maximize2,
  AlertCircle,
  CheckCircle2,
  Zap
} from "lucide-react";
import { MathRenderer } from "./MathRenderer";
import { detectKhmerErrors } from "../utils/khmerValidator";

export interface PageResult {
  page_number: number;
  raw_text: string;
  corrected_text: string;
  model_used: string;
  elapsed_seconds: number;
  tokens_used?: number;
  success: boolean;
  error?: string;
  isProcessing?: boolean;
  word_count?: number;
  char_count?: number;
  has_formulas?: boolean;
  thumbnail?: string;
  is_blank?: boolean;
  is_english_skipped?: boolean;
}

interface PageCardProps {
  page: PageResult;
  onUpdatePageText?: (pageNum: number, newText: string) => void;
  onReprocessPage?: (pageNum: number, model?: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const PageCard: React.FC<PageCardProps> = ({
  page,
  onUpdatePageText,
  onReprocessPage,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(true);
  const isOpen = isCollapsed !== undefined ? !isCollapsed : internalIsOpen;

  const handleToggle = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalIsOpen(!internalIsOpen);
    }
  };

  const [viewMode, setViewMode] = useState<"split" | "rendered" | "clean_text" | "raw">("split");
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(page.corrected_text || page.raw_text);
  const [showFullImageModal, setShowFullImageModal] = useState(false);
  const [highlightErrors, setHighlightErrors] = useState(true);

  const textToInspect = page.corrected_text || page.raw_text;
  const issues = useMemo(() => detectKhmerErrors(textToInspect), [textToInspect]);

  const imageSrc = useMemo(() => {
    if (!page.thumbnail) return "";
    if (page.thumbnail.startsWith("data:")) return page.thumbnail;
    return `data:image/jpeg;base64,${page.thumbnail}`;
  }, [page.thumbnail]);

  const handleCopy = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (onUpdatePageText) {
      onUpdatePageText(page.page_number, editedText);
    }
    setIsEditing(false);
  };

  return (
    <>
      <div
        id={`page-card-${page.page_number}`}
        className="bg-[#0D1322] border border-slate-800 rounded-2xl overflow-hidden shadow-xl transition-all duration-200 hover:border-slate-700/80"
      >
        {/* Card Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-[#0A0E1A] border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center space-x-2.5 sm:space-x-3 flex-wrap gap-y-1">
            <span className="flex items-center justify-center h-7 w-7 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs font-bold font-mono">
              {page.page_number}
            </span>
            <h4 className="text-sm font-semibold text-white font-khmer">
              ទំព័រទី {page.page_number} <span className="font-sans text-xs text-slate-400 font-normal">(Page {page.page_number})</span>
            </h4>

            {page.isProcessing ? (
              <span className="flex items-center space-x-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full animate-pulse font-medium">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>AI Vision Restoring...</span>
              </span>
            ) : page.model_used === "blank-skipped" || page.is_blank ? (
              <span className="flex items-center space-x-1 text-[11px] text-slate-300 bg-slate-800/90 border border-slate-700 px-2.5 py-0.5 rounded-full font-medium" title="Blank / empty page detected. Skipped AI OCR to save API quota.">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>Blank Page (Skipped)</span>
              </span>
            ) : page.model_used === "english-skipped" || page.is_english_skipped || (page.corrected_text && page.corrected_text.includes("English Page - Skipped")) ? (
              <span className="flex items-center space-x-1 text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2.5 py-0.5 rounded-full font-medium" title="Pure English page without Khmer detected. Skipped to focus strictly on Khmer content.">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                <span>English Page (Skipped)</span>
              </span>
            ) : page.success || (page.corrected_text && page.corrected_text.trim().length > 0) ? (
              <span className="flex items-center space-x-1 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-medium">
                <Check className="h-3 w-3 text-emerald-400" />
                <span>Restored</span>
              </span>
            ) : page.error ? (
              <span className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2.5 py-0.5 rounded-full font-medium">
                Failed (Raw Mode)
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-[11px] text-slate-400 bg-slate-800/80 border border-slate-700 px-2.5 py-0.5 rounded-full font-medium">
                <Clock className="h-3 w-3 text-slate-500" />
                <span>Waiting in Queue</span>
              </span>
            )}

            {/* Unicode Quality & Anomaly Detector Badge */}
            {page.corrected_text && !page.isProcessing && (
              issues.length > 0 ? (
                <span
                  title={`${issues.length} potential Khmer Unicode ordering or OCR anomalies detected`}
                  className="inline-flex items-center space-x-1 text-[10px] text-rose-300 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-full font-medium"
                >
                  <AlertCircle className="h-3 w-3 text-rose-400" />
                  <span>{issues.length} Issue{issues.length > 1 ? "s" : ""} (Red Underline)</span>
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center space-x-1 text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  <span>Khmer Unicode Clean</span>
                </span>
              )
            )}

            {page.has_formulas && (
              <span className="hidden md:inline-flex items-center space-x-1 text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                <Sigma className="h-3 w-3" />
                <span>LaTeX Formulas</span>
              </span>
            )}
          </div>

          {/* Metrics & Actions */}
          <div className="flex items-center space-x-2">
            {!page.isProcessing && (
              <>
                {page.model_used && (
                  <div className="hidden lg:flex items-center space-x-1 text-[11px] text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                    <Cpu className="h-3 w-3 text-indigo-400" />
                    <span>{page.model_used}</span>
                  </div>
                )}
                {page.elapsed_seconds > 0 && (
                  <div className="hidden sm:flex items-center space-x-1 text-[11px] text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                    <Clock className="h-3 w-3 text-amber-400" />
                    <span>{page.elapsed_seconds}s</span>
                  </div>
                )}
                {page.tokens_used !== undefined && page.tokens_used > 0 && (
                  <div className="hidden sm:flex items-center space-x-1 text-[11px] text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/25 font-mono shadow-sm" title="Actual tokens consumed for this page">
                    <span>🪙</span>
                    <span>{page.tokens_used.toLocaleString()} tokens</span>
                  </div>
                )}

                {onReprocessPage && (
                  <button
                    onClick={() => onReprocessPage(page.page_number, "gemini-3.6-flash")}
                    title="1-Click AI Vision & LaTeX restoration with Gemini 3.6 Flash (#1 Model)"
                    className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-200 border border-indigo-500/40 hover:border-indigo-400 transition-all font-semibold active:scale-95 shadow-sm"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                    <span>⚡ 3.6 Flash</span>
                  </button>
                )}

                <button
                  onClick={() => handleCopy(page.corrected_text || page.raw_text)}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  title="Copy page text"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
                </button>
              </>
            )}

            <button
              onClick={handleToggle}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title={isOpen ? "Collapse page" : "Expand page"}
            >
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Body Content */}
        {isOpen && (
          <div className="p-4 sm:p-5 space-y-4">
            {/* View Mode Switcher & Anomaly Inspector Toggle */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 flex-wrap gap-2">
              <div className="flex space-x-1 bg-[#070A12] p-1 rounded-xl border border-slate-800 text-xs max-w-full overflow-x-auto no-scrollbar">
                <button
                  onClick={() => {
                    setViewMode("split");
                    setIsEditing(false);
                  }}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0 ${
                    viewMode === "split"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Columns className="h-3.5 w-3.5" />
                  <span>PDF vs Restored</span>
                </button>
                <button
                  onClick={() => {
                    setViewMode("rendered");
                    setIsEditing(false);
                  }}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0 ${
                    viewMode === "rendered"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>KaTeX & Markdown</span>
                </button>
                <button
                  onClick={() => {
                    setViewMode("clean_text");
                    setIsEditing(false);
                  }}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0 ${
                    viewMode === "clean_text"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Code className="h-3.5 w-3.5" />
                  <span>Clean Text (.txt)</span>
                </button>
                <button
                  onClick={() => {
                    setViewMode("raw");
                    setIsEditing(false);
                  }}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0 ${
                    viewMode === "raw"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <FileImage className="h-3.5 w-3.5" />
                  <span>Raw Text</span>
                </button>
              </div>

              <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                {/* Red Wavy Line Highlight Toggle */}
                <button
                  type="button"
                  onClick={() => setHighlightErrors(!highlightErrors)}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    highlightErrors
                      ? "bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25"
                      : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                  title="Toggle red wavy underline on Khmer spelling and OCR errors"
                >
                  <AlertCircle className={`h-3 w-3 ${highlightErrors ? "text-rose-400" : "text-slate-400"}`} />
                  <span>Red Line Check: {highlightErrors ? "ON" : "OFF"}</span>
                </button>

                {onUpdatePageText && !page.isProcessing && (
                  <button
                    onClick={() => {
                      if (isEditing) {
                        handleSaveEdit();
                      } else {
                        setEditedText(page.corrected_text || page.raw_text);
                        setIsEditing(true);
                      }
                    }}
                    className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      isEditing
                        ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
                        : "bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white"
                    }`}
                  >
                    {isEditing ? <Save className="h-3 w-3 text-emerald-400" /> : <Edit3 className="h-3 w-3" />}
                    <span>{isEditing ? "Save Edits" : "Edit Text"}</span>
                  </button>
                )}

                <span className="text-xs text-slate-500 font-mono">
                  {(page.corrected_text || page.raw_text).length} chars
                </span>
              </div>
            </div>

            {/* Content Views */}
            {page.isProcessing ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-3 text-slate-400 bg-[#070A12] rounded-xl border border-slate-800/60">
                <RefreshCw className="h-7 w-7 animate-spin text-indigo-400" />
                <p className="text-xs font-medium">Extracting Khmer characters, subscripts (ជើង), and LaTeX equations...</p>
              </div>
            ) : isEditing ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Direct Markdown / Text Editor:</span>
                  <span className="text-emerald-400">Editing Mode Active</span>
                </div>
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={14}
                  className="w-full bg-[#070A12] border border-indigo-500/40 rounded-xl p-4 text-sm text-slate-100 font-khmer leading-relaxed focus:outline-none focus:border-indigo-400 shadow-inner"
                  placeholder="Edit page text..."
                />
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>Save Changes</span>
                  </button>
                </div>
              </div>
            ) : viewMode === "split" ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left Column: Original PDF Page Rendering */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span className="flex items-center space-x-1.5">
                      <FileImage className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Original PDF Page</span>
                    </span>
                    {page.thumbnail && (
                      <button
                        onClick={() => setShowFullImageModal(true)}
                        className="flex items-center space-x-1 text-slate-400 hover:text-white text-[11px]"
                      >
                        <Maximize2 className="h-3 w-3" />
                        <span>Enlarge</span>
                      </button>
                    )}
                  </div>
                  <div className="bg-[#070A12] border border-slate-800/80 rounded-xl p-2 min-h-[300px] flex items-center justify-center overflow-hidden">
                    {page.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={imageSrc}
                        alt={`Page ${page.page_number} original rendering`}
                        className="max-h-[460px] w-auto object-contain rounded-lg border border-slate-800/60 shadow-lg cursor-zoom-in"
                        onClick={() => setShowFullImageModal(true)}
                      />
                    ) : (
                      <div className="text-center text-slate-500 py-16 space-y-2 text-xs">
                        <FileImage className="h-8 w-8 mx-auto text-slate-600" />
                        <p>No preview thumbnail available for this page</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Restored KaTeX & Khmer Text with Red Wavy Error Lines */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span className="flex items-center space-x-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Restored Markdown & KaTeX Math</span>
                    </span>
                    {highlightErrors && issues.length > 0 && (
                      <span className="text-[10px] text-rose-300 font-mono">
                        {issues.length} red line error{issues.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="bg-[#070A12] border border-slate-800/80 rounded-xl p-4 min-h-[300px] max-h-[500px] overflow-y-auto font-khmer text-sm text-slate-200 leading-relaxed shadow-inner">
                    <MathRenderer
                      content={page.corrected_text || page.raw_text}
                      highlightErrors={highlightErrors}
                    />
                  </div>
                </div>
              </div>
            ) : viewMode === "rendered" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                  <span>KaTeX Mathematical Formulas & Rendered Khmer Text:</span>
                  {highlightErrors && issues.length > 0 && (
                    <span className="text-[10px] text-rose-300 font-mono">
                      {issues.length} error{issues.length > 1 ? "s" : ""} highlighted in red wavy lines
                    </span>
                  )}
                </div>
                <div className="bg-[#070A12] border border-slate-800/80 rounded-xl p-5 font-khmer text-sm text-slate-200 leading-relaxed shadow-inner">
                  <MathRenderer
                    content={page.corrected_text || page.raw_text}
                    highlightErrors={highlightErrors}
                  />
                </div>
              </div>
            ) : viewMode === "clean_text" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                  <span>Clean Khmer Plain Text:</span>
                </div>
                <div className="bg-[#070A12] border border-slate-800/80 rounded-xl p-4 font-khmer text-sm text-slate-200 leading-relaxed shadow-inner whitespace-pre-wrap">
                  <MathRenderer
                    content={page.corrected_text || page.raw_text}
                    highlightErrors={highlightErrors}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                  <span>Raw Extracted Digital PDF Stream:</span>
                </div>
                <pre className="bg-[#070A12] border border-slate-800/80 rounded-xl p-4 font-mono text-xs text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                  {page.raw_text || "(No selectable digital text on this page)"}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full Size Image Modal */}
      {showFullImageModal && page.thumbnail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-150"
          onClick={() => setShowFullImageModal(false)}
        >
          <div
            className="relative max-w-4xl max-h-[92vh] overflow-auto bg-[#070A12] border border-slate-800 rounded-2xl p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowFullImageModal(false)}
              className="absolute top-4 right-4 z-10 p-2 rounded-xl bg-slate-800/90 text-white hover:bg-slate-700 transition-colors shadow-lg"
            >
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc}
              alt={`Page ${page.page_number} full resolution preview`}
              className="max-h-[85vh] w-auto mx-auto rounded-lg"
            />
          </div>
        </div>
      )}
    </>
  );
};
