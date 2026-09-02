"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Cpu,
  Clock,
  Zap,
  CheckCircle2,
  RefreshCw,
  FileText,
  Layers,
  Check,
  ChevronDown,
} from "lucide-react";
import { API_BASE_URL } from "../config/api";

interface ProcessingBackboneProps {
  totalPages: number;
  completedPages: number;
  isProcessing: boolean;
  concurrency: number;
  activePages: number[];
  selectedModel: string;
  onCancel?: () => void;
  apiKey?: string;
  hfKey?: string;
}

export const ProcessingBackbone: React.FC<ProcessingBackboneProps> = ({
  totalPages,
  completedPages,
  isProcessing,
  concurrency,
  activePages,
  selectedModel,
  onCancel,
  apiKey = "",
  hfKey = "",
}) => {
  if (!isProcessing && totalPages === 0) return null;

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Live timer tracker
  useEffect(() => {
    if (isProcessing) {
      const startTime = Date.now() - elapsedSeconds * 1000;
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isProcessing]);

  // Reset timer on new run
  useEffect(() => {
    if (isProcessing && completedPages === 0) {
      setElapsedSeconds(0);
    }
  }, [isProcessing, completedPages]);

  const percent = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

  // Real-time speed & ETA calculation
  const avgSecondsPerPage = completedPages > 0 ? (elapsedSeconds / completedPages) : 0;
  const remainingPages = Math.max(0, totalPages - completedPages);
  const etaSeconds = avgSecondsPerPage > 0 ? Math.round(remainingPages * avgSecondsPerPage) : 0;

  // Parse keys in pool
  const parsedKeys = React.useMemo(() => {
    if (!apiKey) return [];
    return apiKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5);
  }, [apiKey]);

  // Real-time Key Pool Health Status from Backend
  const [keyStatuses, setKeyStatuses] = useState<
    Array<{
      id: number;
      alias: string;
      suffix: string;
      status: "ready" | "in_flight" | "cooldown" | "daily_exhausted";
      cooldown_remaining_seconds: number;
      usage_count: number;
    }>
  >([]);
  const [keySummary, setKeySummary] = useState<{
    total_used: number;
    daily_remaining: number;
    total_tokens_used: number;
    total_daily_quota: number;
  } | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let isFetching = false;

    const fetchKeyPoolStatus = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        const res = await fetch(`${API_BASE_URL}/api/key-pool-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey || "" }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.pool && Array.isArray(data.pool)) {
            setKeyStatuses(data.pool);
          }
          if (data.summary) {
            setKeySummary(data.summary);
          }
        }
      } catch {
      } finally {
        isFetching = false;
      }
    };

    fetchKeyPoolStatus();
    timer = setInterval(fetchKeyPoolStatus, 4000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [apiKey]);

  // Real-time stage resolution
  const step1Done = totalPages > 0;
  const step2Active = isProcessing && activePages.length > 0;
  const step3Active = isProcessing && completedPages < totalPages;
  const step3Done = completedPages === totalPages && totalPages > 0;
  const step4Done = completedPages === totalPages && totalPages > 0;
  const step4Active = completedPages > 0 && !step4Done;

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? "0" : ""}${s}`;
  };

  const [showKeyDetails, setShowKeyDetails] = useState(false);
  const [keyFilter, setKeyFilter] = useState<"all" | "active" | "inactive">("all");

  const isKeyActive = (status: string) => status === "ready" || status === "in_flight";
  const isKeyInactive = (status: string) => status === "daily_exhausted" || status === "cooldown";

  const totalKeysCount = keyStatuses.length > 0 ? keyStatuses.length : parsedKeys.length;
  const activeKeysCount = keyStatuses.length > 0
    ? keyStatuses.filter((k) => isKeyActive(k.status)).length
    : parsedKeys.length;
  const inactiveKeysCount = keyStatuses.length > 0
    ? keyStatuses.filter((k) => isKeyInactive(k.status)).length
    : 0;
  const dailyCappedCount = keyStatuses.filter((k) => k.status === "daily_exhausted").length;
  const cooldownCount = keyStatuses.filter((k) => k.status === "cooldown").length;
  const inFlightCount = keyStatuses.filter((k) => k.status === "in_flight").length;

  const filteredKeyStatuses = React.useMemo(() => {
    if (keyFilter === "active") return keyStatuses.filter((k) => isKeyActive(k.status));
    if (keyFilter === "inactive") return keyStatuses.filter((k) => isKeyInactive(k.status));
    return keyStatuses;
  }, [keyStatuses, keyFilter]);

  return (
    <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      {/* Header Info Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
            {isProcessing ? (
              <RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-white text-sm sm:text-base">
                {isProcessing ? "AI Processing Pipeline Active" : "Extraction & Restoration Completed"}
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-bold font-mono">
                {percent}%
              </span>
            </div>
            <p className="text-xs text-slate-400 pt-0.5">
              {isProcessing
                ? `Extracting Khmer Unicode & LaTeX formulas via ${selectedModel}`
                : `All ${totalPages} pages ready for side-by-side KaTeX inspection and export.`}
            </p>
          </div>
        </div>

        {/* Real-time Workers & Telemetry & Stop Button Badge */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
          {/* Live Speedometer & ETA */}
          <div className="flex items-center space-x-1.5 bg-[#070A12] border border-slate-800 px-2.5 py-1 rounded-lg text-xs font-mono text-slate-300">
            <Clock className="h-3.5 w-3.5 text-indigo-400" />
            <span>{isProcessing ? formatTime(elapsedSeconds) : `Elapsed: ${formatTime(elapsedSeconds)}`}</span>
            {isProcessing && etaSeconds > 0 && remainingPages > 0 ? (
              <span className="text-indigo-300 pl-1.5 border-l border-slate-700 font-semibold">
                ⏳ ETA: ~{etaSeconds}s ({avgSecondsPerPage.toFixed(1)}s/pg)
              </span>
            ) : avgSecondsPerPage > 0 ? (
              <span className="text-slate-400 pl-1.5 border-l border-slate-700">
                ⚡ ~{avgSecondsPerPage.toFixed(1)}s/pg
              </span>
            ) : null}
          </div>

          {/* Active Workers List */}
          <div className="flex items-center space-x-1.5 bg-[#070A12] border border-slate-800 px-2.5 py-1 rounded-lg text-xs max-w-full">
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-400 text-[11px] shrink-0">Workers:</span>
            <div className="flex items-center space-x-1 flex-wrap gap-1">
              {activePages.length > 0 ? (
                <>
                  {activePages.slice(0, 8).map((p) => (
                    <span
                      key={p}
                      className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[11px] font-bold animate-pulse border border-indigo-500/30 shrink-0"
                    >
                      P{p}
                    </span>
                  ))}
                  {activePages.length > 8 && (
                    <span className="text-slate-400 font-mono text-[10px] font-semibold">
                      +{activePages.length - 8} more
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 text-[11px]">
                  {isProcessing ? "Queueing..." : "Idle"}
                </span>
              )}
            </div>
          </div>

          {/* STOP / CANCEL EXTRACTION BUTTON */}
          {isProcessing && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center space-x-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white border border-rose-500/40 hover:border-rose-500/60 px-3 py-1 rounded-lg text-xs font-bold shadow-md shadow-rose-500/20 transition-all active:scale-95 cursor-pointer ml-1 animate-pulse"
              title="Stop current extraction batch immediately"
            >
              <span className="h-2 w-2 rounded-sm bg-rose-400" />
              <span>Stop Extraction</span>
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Animated Progress Bar */}
      {totalPages > 0 && (
        <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800/80">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isProcessing
                ? "bg-indigo-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* REAL-TIME KEY POOL HEALTH & COOLDOWN RADAR */}
      <div className="space-y-2 pt-1 border-t border-slate-800/60">
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
          {/* Left: Key Pool Counts & Active/Inactive Badges */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            <span className="text-xs text-slate-300 font-bold flex items-center space-x-1.5">
              <span>🔑 Key Pool:</span>
              <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/60">
                {totalKeysCount} Total
              </span>
            </span>

            {/* ACTIVE COUNT BADGE */}
            <button
              type="button"
              onClick={() => {
                setKeyFilter(keyFilter === "active" && showKeyDetails ? "all" : "active");
                setShowKeyDetails(true);
              }}
              className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold font-mono border transition-all cursor-pointer ${
                activeKeysCount > 0
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25 shadow-sm shadow-emerald-500/10"
                  : "bg-slate-800/40 text-slate-400 border-slate-700/40"
              }`}
              title="Click to filter & view Active / Ready keys"
            >
              <span className={`h-2 w-2 rounded-full ${activeKeysCount > 0 ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
              <span><strong>{activeKeysCount}</strong> Active / Ready</span>
            </button>

            {/* INACTIVE / DAILY CAP / COOLDOWN BADGE */}
            <button
              type="button"
              onClick={() => {
                setKeyFilter(keyFilter === "inactive" && showKeyDetails ? "all" : "inactive");
                setShowKeyDetails(true);
              }}
              className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold font-mono border transition-all cursor-pointer ${
                inactiveKeysCount > 0
                  ? "bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25 shadow-sm shadow-rose-500/10"
                  : "bg-slate-800/40 text-slate-500 border-slate-700/40"
              }`}
              title="Click to filter & view Inactive / Daily Capped keys"
            >
              <span className={`h-2 w-2 rounded-full ${inactiveKeysCount > 0 ? "bg-rose-400" : "bg-slate-600"}`} />
              <span>
                <strong>{inactiveKeysCount}</strong> Inactive
                {dailyCappedCount > 0 ? ` (${dailyCappedCount} Daily Cap)` : cooldownCount > 0 ? ` (${cooldownCount} Cooldown)` : ""}
              </span>
            </button>

            {/* TOGGLE EXPAND PILLS */}
            {totalKeysCount > 0 && (
              <button
                type="button"
                onClick={() => setShowKeyDetails(!showKeyDetails)}
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-750 border border-slate-700/70 transition cursor-pointer"
              >
                <span>{showKeyDetails ? "Hide Keys" : "Show All Keys"}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showKeyDetails ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>

          {/* Right: Live Pool Usage Summary */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            {keySummary && keySummary.total_used > 0 && (
              <div className="flex items-center space-x-1.5 text-[11px] font-mono">
                <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 shadow-sm" title="Total requests used out of daily quota">
                  ⚡ <strong>{keySummary.total_used}</strong> / {keySummary.total_daily_quota.toLocaleString()} pages ({keySummary.daily_remaining.toLocaleString()} left)
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 shadow-sm" title="Estimated live tokens processed today">
                  🪙 ~<strong>{(keySummary.total_tokens_used).toLocaleString()}</strong> tokens
                </span>
              </div>
            )}

            {hfKey && (
              <div className="flex items-center space-x-1.5 text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span>Hugging Face: Ready</span>
              </div>
            )}
          </div>
        </div>

        {/* EXPANDED INDIVIDUAL KEY PILLS WITH FILTER */}
        {showKeyDetails && totalKeysCount > 0 && (
          <div className="p-3.5 rounded-xl bg-[#070A12] border border-slate-800 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150 shadow-inner">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono border-b border-slate-800/80 pb-2">
              <span className="font-semibold text-slate-300">
                Key Pool Detail ({filteredKeyStatuses.length} of {totalKeysCount} displayed):
              </span>
              <div className="flex items-center space-x-2">
                {inactiveKeysCount > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await fetch(`${API_BASE_URL}/api/keys/reset-cooldowns`, { method: "POST" });
                        // Trigger immediate refresh
                        const res = await fetch(`${API_BASE_URL}/api/key-pool-status`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ api_key: apiKey || "" }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          if (data.pool) setKeyStatuses(data.pool);
                        }
                      } catch {}
                    }}
                    className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold font-mono transition flex items-center space-x-1"
                    title="Force unfreeze all keys immediately"
                  >
                    <span>⚡ Unfreeze All Keys</span>
                  </button>
                )}
                <div className="flex items-center space-x-1 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800">
                  {(["all", "active", "inactive"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setKeyFilter(mode)}
                      className={`px-2.5 py-0.5 rounded-md capitalize text-[10px] font-bold font-mono transition ${
                        keyFilter === mode
                          ? mode === "active"
                            ? "bg-emerald-600 text-white shadow-sm"
                            : mode === "inactive"
                            ? "bg-rose-600 text-white shadow-sm"
                            : "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {mode} ({mode === "all" ? totalKeysCount : mode === "active" ? activeKeysCount : inactiveKeysCount})
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 flex-wrap gap-y-1.5 max-h-52 overflow-y-auto pr-1">
              {filteredKeyStatuses.length > 0 ? (
                filteredKeyStatuses.map((k) => (
                  <span
                    key={k.id}
                    className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-sm transition-all ${
                      k.status === "daily_exhausted"
                        ? "bg-rose-500/15 text-rose-300 border border-rose-500/35"
                        : k.status === "cooldown"
                        ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        : k.status === "in_flight"
                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 animate-pulse shadow-sm shadow-indigo-500/10"
                        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/25"
                    }`}
                    title={
                      k.status === "daily_exhausted"
                        ? `Daily Free-tier project quota cap reached (20 RPD on this key). Ready in ${(k.cooldown_remaining_seconds / 3600).toFixed(1)}h`
                        : k.status === "cooldown"
                        ? `Rate limit active. Ready in ${k.cooldown_remaining_seconds}s`
                        : k.status === "in_flight"
                        ? `Actively executing an OCR API request right now (Total used: ${k.usage_count} times)`
                        : `Healthy & ready (Used ${k.usage_count} times)`
                    }
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        k.status === "daily_exhausted"
                          ? "bg-rose-400"
                          : k.status === "cooldown"
                          ? "bg-amber-400 animate-ping"
                          : k.status === "in_flight"
                          ? "bg-indigo-400 animate-pulse"
                          : "bg-emerald-400"
                      }`}
                    />
                    <span>
                      {k.alias} (...{k.suffix}):{" "}
                      {k.status === "daily_exhausted"
                        ? "Daily Cap"
                        : k.status === "cooldown"
                        ? `Cooldown (${k.cooldown_remaining_seconds}s)`
                        : k.status === "in_flight"
                        ? `In-Flight (${k.usage_count} reqs)`
                        : k.usage_count > 0
                        ? `Ready (${k.usage_count} reqs)`
                        : "Ready"}
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500 italic py-1">No keys match the &apos;{keyFilter}&apos; filter.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4-Step Real-Time Pipeline Stages Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Step 1: PDF Parsing */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            step1Done
              ? "bg-[#080C16] border-emerald-500/30"
              : "bg-[#080C16] border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Step 1</span>
            {step1Done ? (
              <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-semibold">
                <Check className="h-3 w-3 stroke-[3]" />
                <span>Rendered</span>
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">Pending</span>
            )}
          </div>
          <div className="flex items-center space-x-2.5 pt-1.5">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
              step1Done ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-500"
            }`}>
              <FileText className="h-4 w-4" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-white truncate">PDF Render & Slice</p>
              <p className="text-[10.5px] text-slate-400 truncate">
                {totalPages > 0 ? `${totalPages} Pages Sliced` : "Ready to process"}
              </p>
            </div>
          </div>
        </div>

        {/* Step 2: Concurrency Queue */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            step2Active
              ? "bg-[#080C16] border-indigo-500/40"
              : completedPages === totalPages && totalPages > 0
              ? "bg-[#080C16] border-emerald-500/30"
              : "bg-[#080C16] border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Step 2</span>
            {step2Active ? (
              <span className="inline-flex items-center space-x-1 text-[10px] text-indigo-400 font-semibold animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
                <span>{activePages.length} Running</span>
              </span>
            ) : completedPages === totalPages && totalPages > 0 ? (
              <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-semibold">
                <Check className="h-3 w-3 stroke-[3]" />
                <span>Done</span>
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">Standby</span>
            )}
          </div>
          <div className="flex items-center space-x-2.5 pt-1.5">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
              step2Active ? "bg-indigo-500/15 text-indigo-400" : "bg-slate-800 text-slate-500"
            }`}>
              <Layers className="h-4 w-4" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-white truncate">Parallel Worker Queue</p>
              <p className="text-[10.5px] text-slate-400 truncate">
                {concurrency}x Parallel Slots
              </p>
            </div>
          </div>
        </div>

        {/* Step 3: Khmer AI & Formulas */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            step3Active
              ? "bg-[#080C16] border-indigo-500/40"
              : step3Done
              ? "bg-[#080C16] border-emerald-500/30"
              : "bg-[#080C16] border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Step 3</span>
            {step3Active ? (
              <span className="inline-flex items-center space-x-1 text-[10px] text-indigo-400 font-semibold animate-pulse">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>Restoring...</span>
              </span>
            ) : step3Done ? (
              <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-semibold">
                <Check className="h-3 w-3 stroke-[3]" />
                <span>Restored</span>
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">Awaiting</span>
            )}
          </div>
          <div className="flex items-center space-x-2.5 pt-1.5">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
              step3Active || step3Done ? "bg-indigo-500/15 text-indigo-400" : "bg-slate-800 text-slate-500"
            }`}>
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-white truncate">Khmer Unicode & Math AI</p>
              <p className="text-[10.5px] text-slate-400 truncate">
                {completedPages} / {totalPages} Pages Restored
              </p>
            </div>
          </div>
        </div>

        {/* Step 4: KaTeX Typography & Export */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            step4Done
              ? "bg-[#080C16] border-emerald-500/30"
              : step4Active
              ? "bg-[#080C16] border-indigo-500/40"
              : "bg-[#080C16] border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Step 4</span>
            {step4Done ? (
              <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-semibold">
                <Check className="h-3 w-3 stroke-[3]" />
                <span>Ready</span>
              </span>
            ) : step4Active ? (
              <span className="text-[10px] text-indigo-300 font-medium">Streaming</span>
            ) : (
              <span className="text-[10px] text-slate-500">Standby</span>
            )}
          </div>
          <div className="flex items-center space-x-2.5 pt-1.5">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
              step4Done || step4Active ? "bg-amber-500/15 text-amber-400" : "bg-slate-800 text-slate-500"
            }`}>
              <Cpu className="h-4 w-4" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-white truncate">KaTeX & Stream Export</p>
              <p className="text-[10.5px] text-slate-400 truncate">
                {completedPages > 0 ? `${completedPages} Pages Ready` : "Awaiting Output"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
