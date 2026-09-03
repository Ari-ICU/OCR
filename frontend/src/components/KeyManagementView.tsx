"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Zap,
  ExternalLink,
  Copy,
  Check,
  Trash2,
  Sparkles,
  ShieldAlert,
  Activity,
  BarChart3,
  Clock,
  Search,
  RotateCcw,
} from "lucide-react";
import { API_BASE_URL } from "../config/api";

interface KeyManagementViewProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  hfKey?: string;
  setHfKey?: (key: string) => void;
  ollamaUrl?: string;
  setOllamaUrl?: (url: string) => void;
}

interface VerificationResult {
  key: string;
  suffix: string;
  valid: boolean;
  status: string;
  message: string;
}

interface KeyPoolItem {
  id: number;
  alias: string;
  suffix: string;
  status: "ready" | "in_flight" | "cooldown" | "daily_exhausted" | "invalid" | "forbidden";
  cooldown_remaining_seconds: number;
  usage_count: number;
  daily_limit?: number;
  daily_remaining?: number;
  tokens_used: number;
}

interface KeyPoolSummary {
  total_used: number;
  daily_remaining: number;
  total_tokens_used: number;
  total_daily_quota: number;
}

export const KeyManagementView: React.FC<KeyManagementViewProps> = ({
  apiKey,
  setApiKey,
  hfKey = "",
  setHfKey,
  ollamaUrl = "http://localhost:11434",
  setOllamaUrl,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"pool" | "verify">("pool");
  const [localKey, setLocalKey] = useState(apiKey);
  const [localHfKey, setLocalHfKey] = useState(hfKey);
  const [localOllamaUrl, setLocalOllamaUrl] = useState(ollamaUrl);
  const [isSavedNotice, setIsSavedNotice] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live real-time key usage tracking
  const [keyPoolItems, setKeyPoolItems] = useState<KeyPoolItem[]>([]);
  const [keyPoolSummary, setKeyPoolSummary] = useState<KeyPoolSummary | null>(null);
  const [keyFilter, setKeyFilter] = useState<"all" | "active" | "inactive">("all");
  const [searchKey, setSearchKey] = useState("");

  useEffect(() => {
    setLocalKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    setLocalHfKey(hfKey);
  }, [hfKey]);

  useEffect(() => {
    setLocalOllamaUrl(ollamaUrl);
  }, [ollamaUrl]);

  // Load saved subtab
  useEffect(() => {
    try {
      const savedSubTab = localStorage.getItem("khmerpdf_keys_subtab");
      if (savedSubTab === "verify" || savedSubTab === "pool") {
        setActiveSubTab(savedSubTab);
      }
    } catch {}
  }, []);

  // Poll real-time key request & quota statistics from backend
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let isFetching = false;

    const fetchStatus = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        const res = await fetch(`${API_BASE_URL}/api/key-pool-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey || localKey || "" }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.pool && Array.isArray(data.pool)) {
            setKeyPoolItems(data.pool);
          }
          if (data.summary) {
            setKeyPoolSummary(data.summary);
          }
        }
      } catch {
      } finally {
        isFetching = false;
      }
    };

    fetchStatus();
    timer = setInterval(fetchStatus, 3000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [apiKey, localKey]);

  const handleSetActiveSubTab = (tab: "pool" | "verify") => {
    setActiveSubTab(tab);
    try {
      localStorage.setItem("khmerpdf_keys_subtab", tab);
    } catch {}
  };

  const handleCopyKey = (keyText: string, suffix: string) => {
    navigator.clipboard.writeText(keyText);
    setCopiedKey(suffix);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSave = async () => {
    setApiKey(localKey);
    if (setHfKey) setHfKey(localHfKey);
    if (setOllamaUrl) setOllamaUrl(localOllamaUrl);
    
    // Automatically unblock and refresh all keys on backend
    try {
      await Promise.all([
        fetch(`${API_BASE_URL}/api/keys/reset-invalid`, { method: "POST" }),
        fetch(`${API_BASE_URL}/api/keys/reset-cooldowns`, { method: "POST" })
      ]);
    } catch {}

    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 2500);
  };

  const handleResetCooldowns = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/keys/reset-cooldowns`, { method: "POST" });
      const res = await fetch(`${API_BASE_URL}/api/key-pool-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey || localKey || "" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pool) setKeyPoolItems(data.pool);
        if (data.summary) setKeyPoolSummary(data.summary);
      }
    } catch {}
  };

  const handleVerifyAllKeys = async () => {
    const keysToVerify = localKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5);

    if (keysToVerify.length === 0) return;

    setIsVerifying(true);
    setVerificationResults([]);

    try {
      const res = await fetch(`${API_BASE_URL}/api/keys/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: keysToVerify }),
      });

      if (res.ok) {
        const data = await res.json();
        setVerificationResults(data.results || []);
        
        // Also refresh pool status to immediately reflect live Google statuses on all cards
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/key-pool-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: localKey }),
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.pool) setKeyPoolItems(statusData.pool);
            if (statusData.summary) setKeyPoolSummary(statusData.summary);
          }
        } catch {}
      }
    } catch {
      // Backend error
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRemoveInvalidKeys = async () => {
    const currentKeys = localKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5);

    if (currentKeys.length === 0) return;

    setIsVerifying(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/keys/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: currentKeys }),
      });

      if (res.ok) {
        const data = await res.json();
        const validResults = (data.results || []).filter((r: VerificationResult) => r.valid);
        const validKeys = validResults.map((r: VerificationResult) => r.key);
        const updated = validKeys.join("\n");
        setLocalKey(updated);
        setApiKey(updated);
        setVerificationResults(data.results || []);
        setIsSavedNotice(true);
        setTimeout(() => setIsSavedNotice(false), 2500);
      }
    } catch {
      // Error
    } finally {
      setIsVerifying(false);
    }
  };

  const parsedKeysList = useMemo(() => {
    return localKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5);
  }, [localKey]);

  const activeKeyCount = parsedKeysList.length;

  const totalUsage = useMemo(() => {
    if (keyPoolSummary) return keyPoolSummary.total_used;
    return keyPoolItems.reduce((acc, k) => acc + (k.usage_count || 0), 0);
  }, [keyPoolSummary, keyPoolItems]);

  const totalTokens = useMemo(() => {
    if (keyPoolSummary) return keyPoolSummary.total_tokens_used;
    return keyPoolItems.reduce((acc, k) => acc + (k.tokens_used || 0), 0);
  }, [keyPoolSummary, keyPoolItems]);

  const filteredPoolItems = useMemo(() => {
    return keyPoolItems.filter((item) => {
      if (keyFilter === "active" && item.status !== "ready" && item.status !== "in_flight") return false;
      if (keyFilter === "inactive" && item.status === "ready") return false;
      if (searchKey.trim()) {
        const q = searchKey.toLowerCase();
        return item.suffix.toLowerCase().includes(q) || item.alias.toLowerCase().includes(q);
      }
      return true;
    });
  }, [keyPoolItems, keyFilter, searchKey]);

  const readyCount = keyPoolItems.filter((k) => k.status === "ready" || k.status === "in_flight").length;
  const dailyCapCount = keyPoolItems.filter((k) => k.status === "daily_exhausted").length;
  const cooldownCount = keyPoolItems.filter((k) => k.status === "cooldown").length;
  const invalidCount = keyPoolItems.filter((k) => k.status === "invalid" || k.status === "forbidden").length;
  
  const totalPoolCount = keyPoolItems.length > 0 ? keyPoolItems.length : activeKeyCount;

  const totalLiveRemaining = useMemo(() => {
    if (keyPoolItems.length === 0) return totalPoolCount * 20;
    return keyPoolItems.reduce((acc, k) => acc + (k.daily_remaining !== undefined ? k.daily_remaining : 20), 0);
  }, [keyPoolItems, totalPoolCount]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-[#0D1322] border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-semibold">
              <Zap className="h-3.5 w-3.5" />
              <span>Multi-Key Pool & Scaling Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Google Gemini API Key Management
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm max-w-2xl leading-relaxed">
              Scale your PDF extraction throughput by rotating multiple Gemini API keys.
              The engine automatically load-balances requests across your keys with instant 429 failover.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-2xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition shadow-lg shadow-indigo-500/10 active:scale-95"
            >
              <span>Get Free Gemini Key</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Global Real-time Request & Quota Telemetry Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-2xl bg-[#0D1322] border border-slate-800/80 shadow-md space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Requests Processed</span>
            <Activity className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {totalUsage}
            <span className="text-xs font-normal text-slate-500 ml-1">/ {totalPoolCount * 20}</span>
          </div>
          <p className="text-[11px] text-slate-500">Across all pool keys today</p>
        </div>

        <div className="p-4 rounded-2xl bg-[#0D1322] border border-slate-800/80 shadow-md space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>AI Tokens Used</span>
            <BarChart3 className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 font-mono">
            ~{totalTokens.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500">OCR & math formatting tokens</p>
        </div>

        <div className="p-4 rounded-2xl bg-[#0D1322] border border-slate-800/80 shadow-md space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Ready on Google</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {readyCount}
            <span className="text-xs font-normal text-slate-500 ml-1">/ {totalPoolCount} keys</span>
          </div>
          <p className="text-[11px] text-emerald-400/80">
            {dailyCapCount > 0 ? `${dailyCapCount} keys at daily cap` : "Healthy keys ready to work"}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-[#0D1322] border border-slate-800/80 shadow-md space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Live Quota Remaining</span>
            <Clock className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {totalLiveRemaining.toLocaleString()}
            <span className="text-xs font-normal text-slate-500 ml-1">page/day</span>
          </div>
          <p className="text-[11px] text-slate-500">⏰ Google resets at 2:00 PM ICT</p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center space-x-2 p-1.5 rounded-2xl bg-[#080C14] border border-slate-800/80 max-w-md">
        <button
          onClick={() => handleSetActiveSubTab("pool")}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs font-bold transition ${
            activeSubTab === "pool"
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <Key className="h-4 w-4" />
          <span>Active Key Pool ({activeKeyCount})</span>
        </button>

        <button
          onClick={() => handleSetActiveSubTab("verify")}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs font-bold transition ${
            activeSubTab === "verify"
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          <span>
            Verification Report
            {verificationResults.length > 0 && ` (${verificationResults.filter((r) => r.valid).length}/${verificationResults.length})`}
          </span>
        </button>
      </div>

      {/* SUBTAB 1: Active Key Pool & Import */}
      {activeSubTab === "pool" && (
        <div className="space-y-6">
          {/* Key Pool Textarea Box */}
          <div className="p-6 sm:p-7 rounded-3xl bg-[#0D1322] border border-slate-800 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Key className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Gemini API Key Pool</h3>
                  <p className="text-xs text-slate-400">
                    Paste one or multiple Gemini API keys (one per line)
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleRemoveInvalidKeys}
                  disabled={isVerifying || activeKeyCount === 0}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                  title="Test all keys and auto-remove suspended/invalid ones"
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                  <span>Purge Invalid Keys</span>
                </button>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:underline flex items-center space-x-1 font-semibold"
                >
                  <span>Google AI Studio</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            <div className="space-y-3">
              <textarea
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                rows={6}
                placeholder={`Paste your Gemini API keys here (one key per line):\nAIzaSyA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q\nAIzaSyB1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6r`}
                className="w-full bg-[#070A11] border border-slate-700/80 rounded-2xl p-4 text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-indigo-500 font-mono resize-none leading-relaxed transition-all shadow-inner placeholder:text-slate-600"
              />

              {/* Status & Actions Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <span className="flex items-center space-x-1.5 text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{totalPoolCount} Keys in Pool</span>
                  </span>

                  <span className="text-xs font-mono text-slate-400 bg-slate-800/80 border border-slate-700/60 px-3 py-1.5 rounded-xl">
                    ⚡ Capacity: ~{totalPoolCount * 20} Pages/Day ({totalPoolCount * 15} RPM)
                  </span>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={handleVerifyAllKeys}
                    disabled={isVerifying || activeKeyCount === 0}
                    className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition disabled:opacity-50 active:scale-95 shadow-md cursor-pointer"
                  >
                    {isVerifying ? (
                      <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    )}
                    <span>{isVerifying ? "Verifying Keys..." : "Verify All Live"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex items-center space-x-1.5 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-600/30 active:scale-95 cursor-pointer"
                  >
                    {isSavedNotice ? <Check className="h-4 w-4 text-emerald-300" /> : <Key className="h-4 w-4" />}
                    <span>{isSavedNotice ? "Saved to Pool!" : "Save & Activate Pool"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Individual Key Request & Token Tracker */}
          {keyPoolItems.length > 0 && (
            <div className="p-6 sm:p-7 rounded-3xl bg-[#0D1322] border border-slate-800 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="h-9 w-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm sm:text-base">
                      Live Per-Key Activity Monitor
                    </h3>
                    <p className="text-xs text-slate-400">
                      Live requests processed and tokens used by each individual API key
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={handleVerifyAllKeys}
                    disabled={isVerifying || activeKeyCount === 0}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/40 text-xs font-bold font-mono transition shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                    title="Probe Google servers live to test validity and check 20/day quota"
                  >
                    {isVerifying ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                    ) : (
                      <Zap className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                    )}
                    <span>{isVerifying ? "Checking Google..." : "Live Google Quota Check"}</span>
                  </button>

                  {invalidCount > 0 && (
                    <button
                      type="button"
                      onClick={handleRemoveInvalidKeys}
                      disabled={isVerifying}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold font-mono transition cursor-pointer"
                      title="Purge all suspended/invalid keys from your pool"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove Invalid ({invalidCount})</span>
                    </button>
                  )}

                  {cooldownCount > 0 && (
                    <button
                      type="button"
                      onClick={handleResetCooldowns}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold font-mono transition cursor-pointer"
                      title="Clear cooldown timers across all keys"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Cooldowns ({cooldownCount})</span>
                    </button>
                  )}

                  {/* Filter Buttons */}
                  <div className="flex items-center p-1 rounded-xl bg-[#070A11] border border-slate-800 text-xs font-mono">
                    <button
                      onClick={() => setKeyFilter("all")}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                        keyFilter === "all" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      All ({keyPoolItems.length})
                    </button>
                    <button
                      onClick={() => setKeyFilter("active")}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                        keyFilter === "active" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Active ({readyCount})
                    </button>
                    {cooldownCount > 0 && (
                      <button
                        onClick={() => setKeyFilter("inactive")}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                          keyFilter === "inactive" ? "bg-rose-600 text-white" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        Paused ({cooldownCount})
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Search Key Input */}
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchKey}
                  onChange={(e) => setSearchKey(e.target.value)}
                  placeholder="Search key by index or suffix (e.g. Bcpw, Key 11)..."
                  className="w-full bg-[#070A11] border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono transition"
                />
              </div>

              {/* Grid of Keys */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto pr-1">
                {filteredPoolItems.map((item) => {
                  const isReady = item.status === "ready";
                  const isInFlight = item.status === "in_flight";
                  const isCooldown = item.status === "cooldown";
                  const isDaily = item.status === "daily_exhausted";
                  const isInvalid = item.status === "invalid" || item.status === "forbidden";

                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                        isInFlight
                          ? "bg-indigo-500/10 border-indigo-500/40 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/30"
                          : isDaily
                          ? "bg-rose-950/20 border-rose-500/40"
                          : isInvalid
                          ? "bg-red-950/30 border-red-500/30 opacity-70"
                          : isReady
                          ? "bg-[#070A12] border-slate-800/90 hover:border-slate-700"
                          : isCooldown
                          ? "bg-amber-500/5 border-amber-500/25"
                          : "bg-slate-900 border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-mono font-bold text-xs text-white">
                            Key #{item.id}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded border border-slate-700/60">
                            ...{item.suffix}
                          </span>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {isInFlight ? (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-mono font-bold text-indigo-300 bg-indigo-500/20 border border-indigo-500/40 px-2 py-0.5 rounded-full animate-pulse">
                              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                              <span>In-Flight</span>
                            </span>
                          ) : isInvalid ? (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-mono font-bold text-red-300 bg-red-500/15 border border-red-500/30 px-2 py-0.5 rounded-full">
                              <span>⛔ Suspended</span>
                            </span>
                          ) : isDaily ? (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-mono font-bold text-rose-300 bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 rounded-full">
                              <span>⚡ 20/20 on Google</span>
                            </span>
                          ) : isReady ? (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span>Ready</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-mono font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                              <Clock className="h-2.5 w-2.5" />
                              <span>{item.cooldown_remaining_seconds}s</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Request and Token Counters with Remaining */}
                      <div className="space-y-1.5 pt-1 border-t border-slate-800/60 text-xs font-mono">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[10px] text-slate-400">Requests:</span>
                          <span className="font-bold text-slate-200">
                            {item.usage_count || 0} / {item.daily_limit || 20}
                            <span className={`text-[10px] ml-1 font-semibold ${isDaily || isInvalid ? "text-rose-400" : "text-emerald-400"}`}>
                              ({isDaily ? "0 left (Resets 2 PM)" : isInvalid ? "invalid" : `${item.daily_remaining !== undefined ? item.daily_remaining : 20} left`})
                            </span>
                          </span>
                        </div>

                        {/* Visual Progress Bar */}
                        <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isDaily || (item.usage_count || 0) >= (item.daily_limit || 20)
                                ? "bg-rose-500 w-full"
                                : isInvalid
                                ? "bg-red-500/50 w-full"
                                : (item.usage_count || 0) > 15
                                ? "bg-amber-400"
                                : "bg-indigo-500"
                            }`}
                            style={isDaily || isInvalid ? { width: "100%" } : {
                              width: `${Math.min(100, Math.max(3, ((item.usage_count || 0) / (item.daily_limit || 20)) * 100))}%`,
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-0.5">
                          <span className="text-[10px] text-slate-400">Tokens:</span>
                          <span className="font-bold text-amber-300 flex items-center space-x-1">
                            <Zap className="h-3 w-3 text-amber-400" />
                            <span>{(item.tokens_used || 0).toLocaleString()}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: Verification Report */}
      {activeSubTab === "verify" && (
        <div className="space-y-4">
          <div className="p-6 rounded-3xl bg-[#0D1322] border border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Live Google API Key Verification Report</h3>
                  <p className="text-xs text-slate-400">Live validation test results against Google Generative Language API</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {verificationResults.some((r) => !r.valid) && (
                  <button
                    onClick={handleRemoveInvalidKeys}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Purge {verificationResults.filter((r) => !r.valid).length} Suspended Keys</span>
                  </button>
                )}
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                  {verificationResults.filter((r) => r.valid).length} of {verificationResults.length} Keys Active
                </span>
              </div>
            </div>

            {verificationResults.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <ShieldCheck className="h-10 w-10 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">No verification results yet.</p>
                <button
                  onClick={handleVerifyAllKeys}
                  disabled={isVerifying || activeKeyCount === 0}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md"
                >
                  Verify Keys Now
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {verificationResults.map((res, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-2xl border flex items-center justify-between text-xs transition ${
                      res.valid
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-sm text-white">
                          Key #{idx + 1} (...{res.suffix})
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                            res.valid ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {res.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{res.message}</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleCopyKey(res.key, res.suffix)}
                        className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                        title="Copy Key"
                      >
                        {copiedKey === res.suffix ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                      {res.valid ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-rose-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
