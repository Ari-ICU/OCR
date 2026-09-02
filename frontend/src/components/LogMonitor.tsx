"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Activity,
  Trash2,
  Copy,
  Check,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Maximize2,
  Minimize2,
  Radio,
  Clock,
  Key,
  Flame,
  ChevronDown
} from "lucide-react";
import { API_BASE_URL } from "../config/api";

export interface LogEntry {
  id: string;
  timestamp: string;
  iso_time: string;
  level: "INFO" | "SUCCESS" | "WARN" | "ERROR" | "RATE_LIMIT";
  event: string;
  message: string;
  model?: string;
  page_number?: number;
  details?: Record<string, any>;
}

export interface LogStats {
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  rate_limit_hits: number;
  last_rate_limit_time?: string;
  active_retries: number;
  stored_logs_count?: number;
  connected_monitors?: number;
}

interface LogMonitorProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const LogMonitor: React.FC<LogMonitorProps> = ({ isOpen, onToggle }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats>({
    total_calls: 0,
    successful_calls: 0,
    failed_calls: 0,
    rate_limit_hits: 0,
    active_retries: 0,
  });
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to SSE Log Stream which automatically pushes initial backlog & real-time events
  useEffect(() => {
    let es: EventSource | null = null;
    let isMounted = true;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      if (!isMounted) return;
      try {
        if (es) {
          es.close();
        }
        es = new EventSource(`${API_BASE_URL}/api/logs/stream`);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (isMounted) setIsConnected(true);
        };

        es.addEventListener("init", (e) => {
          try {
            if (!isMounted) return;
            const data = JSON.parse(e.data);
            if (data.stats) setStats(data.stats);
            if (data.backlog && Array.isArray(data.backlog)) {
              setLogs(data.backlog);
            }
            setIsConnected(true);
          } catch {}
        });

        es.addEventListener("log", (e) => {
          try {
            if (!isMounted) return;
            const entry: LogEntry = JSON.parse(e.data);
            setLogs((prev) => {
              const updated = [...prev, entry];
              return updated.length > 500 ? updated.slice(-500) : updated;
            });
            setIsConnected(true);
          } catch {}
        });

        es.addEventListener("ping", (e) => {
          try {
            if (!isMounted) return;
            const data = JSON.parse(e.data);
            if (data.stats) setStats(data.stats);
            setIsConnected(true);
          } catch {}
        });

        es.onerror = () => {
          if (isMounted) {
            setIsConnected(false);
            es?.close();
            reconnectTimeout = setTimeout(connectSSE, 4000);
          }
        };
      } catch {
        if (isMounted) {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connectSSE, 4000);
        }
      }
    };

    connectSSE();

    return () => {
      isMounted = false;
      if (es) es.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);


  useEffect(() => {
    if (autoScroll && logsEndRef.current && isOpen) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, isOpen]);

  const handleClearLogs = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/logs`, { method: "DELETE" });
      setLogs([]);
      setStats({
        total_calls: 0,
        successful_calls: 0,
        failed_calls: 0,
        rate_limit_hits: 0,
        active_retries: 0,
      });
    } catch {}
  };

  const handleCopyLogs = () => {
    const text = logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level}] ${l.model ? `[${l.model}]` : ""} ${
            l.page_number ? `(Page ${l.page_number})` : ""
          } ${l.message}`
      )
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = logs.filter((l) => {
    if (filterLevel !== "ALL" && l.level !== filterLevel) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        l.message.toLowerCase().includes(q) ||
        (l.model && l.model.toLowerCase().includes(q)) ||
        (l.event && l.event.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="w-full transition-all duration-300">
      {/* Header Metric Cards */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3.5">
        <div className="flex items-center space-x-3 cursor-pointer select-none" onClick={onToggle}>
          <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white text-sm">Live API & Rate Limit Monitor</span>
              <span
                className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  isConnected
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                <span>{isConnected ? "Live SSE" : "Reconnecting"}</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 pt-0.5">
              Real-time telemetry for Gemini API quotas, 429 backoffs, and worker latencies
            </p>
          </div>
        </div>

        {/* Quick Summary Badges Grid */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-1.5 w-full lg:w-auto justify-start sm:justify-end">
          {/* Total Calls */}
          <div className="flex items-center space-x-1.5 bg-[#070A12] border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
            <Activity className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-slate-400 text-xs">Calls:</span>
            <span className="font-bold text-white font-mono text-xs">{stats.total_calls}</span>
          </div>

          {/* Rate Limits Hit */}
          <div
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs border ${
              stats.rate_limit_hits > 0
                ? "bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-sm shadow-amber-500/20 animate-pulse"
                : "bg-[#070A12] border-slate-800 text-slate-400"
            }`}
          >
            <AlertTriangle className={`h-3.5 w-3.5 ${stats.rate_limit_hits > 0 ? "text-amber-400" : "text-slate-500"}`} />
            <span className="text-xs">Rate Limits (429):</span>
            <span className={`font-bold font-mono text-xs ${stats.rate_limit_hits > 0 ? "text-amber-200" : "text-slate-300"}`}>
              {stats.rate_limit_hits}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded Terminal Panel */}
      {isOpen && (
        <div className="mt-3.5 bg-[#080C16] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-0 animate-in fade-in zoom-in-95 duration-150">
          {/* Terminal Toolbar */}
          <div className="bg-[#0A0F1E] border-b border-slate-800 px-3 sm:px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
            {/* Filter Tabs */}
            <div className="flex items-center space-x-1 bg-[#050811] p-1 rounded-xl border border-slate-800 max-w-full overflow-x-auto no-scrollbar">
              {[
                { id: "ALL", label: "All" },
                { id: "RATE_LIMIT", label: "Rate Limits", count: stats.rate_limit_hits },
                { id: "SUCCESS", label: "Success" },
                { id: "ERROR", label: "Errors" },
                { id: "INFO", label: "Info" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterLevel(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 ${
                    filterLevel === f.id
                      ? f.id === "RATE_LIMIT"
                        ? "bg-amber-600 text-white shadow"
                        : "bg-indigo-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span>{f.label}</span>
                  {typeof f.count === "number" && f.count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-black/40 text-[9px]">
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search log messages..."
                className="bg-[#050811] border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 w-full sm:w-44"
              />

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    autoScroll
                      ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                  title="Toggle automatic scrolling on new incoming logs"
                >
                  Auto-scroll: {autoScroll ? "ON" : "OFF"}
                </button>

                <button
                  onClick={handleCopyLogs}
                  disabled={logs.length === 0}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-40"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>

                <button
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] bg-slate-800 hover:bg-rose-900/30 text-rose-300 hover:text-rose-200 border border-slate-700 transition-colors disabled:opacity-40"
                  title="Clear logs"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
          </div>

          {/* Terminal Output Console */}
          <div
            className={`p-3 sm:p-4 font-mono text-xs overflow-y-auto space-y-1.5 transition-all duration-200 bg-[#050811] ${
              isExpanded ? "h-[500px]" : "h-80 sm:h-96"
            }`}
          >
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-600 italic space-y-2 py-10">
                <Terminal className="h-6 w-6 text-slate-700" />
                <p className="text-center text-xs">No log entries to display. Logs will stream here live when API requests run.</p>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isRateLimit = log.level === "RATE_LIMIT";
                const isError = log.level === "ERROR";
                const isSuccess = log.level === "SUCCESS";
                const isWarn = log.level === "WARN";

                return (
                  <div
                    key={log.id}
                    className={`p-2.5 rounded-xl leading-relaxed flex flex-col sm:flex-row sm:items-start space-y-1 sm:space-y-0 sm:space-x-2 border transition-all ${
                      isRateLimit
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                        : isError
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                        : isSuccess
                        ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                        : isWarn
                        ? "bg-amber-500/5 border-amber-500/15 text-amber-300"
                        : "bg-slate-900/40 border-slate-800/60 text-slate-300"
                    }`}
                  >
                    {/* Header line on mobile */}
                    <div className="flex items-center space-x-1.5 flex-wrap shrink-0">
                      {/* Timestamp */}
                      <span className="text-[10px] text-slate-500 shrink-0 select-none">
                        {log.timestamp}
                      </span>

                      {/* Level Pill */}
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase shrink-0 ${
                          isRateLimit
                            ? "bg-amber-500 text-black font-black"
                            : isError
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            : isSuccess
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : isWarn
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                        }`}
                      >
                        {log.level}
                      </span>

                      {/* Page Badge */}
                      {log.page_number && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 shrink-0">
                          Page {log.page_number}
                        </span>
                      )}

                      {/* Model Badge */}
                      {log.model && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                          {log.model}
                        </span>
                      )}

                      {/* Details pill */}
                      {log.details?.wait_seconds && (
                        <span className="text-[10px] text-amber-300 font-bold bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30 shrink-0">
                          Backoff {log.details.wait_seconds}s
                        </span>
                      )}
                    </div>

                    {/* Message */}
                    <span className="flex-1 break-words text-xs font-normal pt-0.5 sm:pt-0">
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>

          {/* Footer stats line */}
          <div className="bg-[#0A0F1E] border-t border-slate-800 px-3 sm:px-4 py-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              Live SSE Telemetry • {filteredLogs.length} logs
            </span>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center space-x-1 text-slate-400 hover:text-white"
            >
              {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              <span className="hidden sm:inline">{isExpanded ? "Collapse" : "Expand"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
