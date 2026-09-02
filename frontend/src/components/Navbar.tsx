"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Sparkles,
  Key,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Cpu,
  ShieldCheck,
  Zap,
  Settings,
  Globe,
  ChevronDown,
  Check,
  Server,
  FileText,
  Terminal,
  Activity,
  Layers,
  Copy
} from "lucide-react";
import { API_BASE_URL } from "../config/api";

export interface ModelInfo {
  id: string;
  name: string;
  tag: string;
  description: string;
}

interface NavbarProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  hfKey?: string;
  setHfKey?: (key: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  backendHealthy: boolean | null;
  onRefreshHealth: () => void;
  modelsList?: ModelInfo[];
  ollamaUrl?: string;
  setOllamaUrl?: (url: string) => void;
  activeTab: "pdf" | "monitor" | "keys";
  setActiveTab: (tab: "pdf" | "monitor" | "keys") => void;
  rateLimitHits?: number;
}


export const Navbar: React.FC<NavbarProps> = ({
  apiKey,
  setApiKey,
  hfKey = "",
  setHfKey,
  selectedModel,
  setSelectedModel,
  backendHealthy,
  onRefreshHealth,
  modelsList = [],
  ollamaUrl = "http://localhost:11434",
  setOllamaUrl,
  activeTab,
  setActiveTab,
  rateLimitHits = 0
}) => {
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);
  const [tempHfKey, setTempHfKey] = useState(hfKey);
  const [tempOllamaUrl, setTempOllamaUrl] = useState(ollamaUrl);
  const [backendModels, setBackendModels] = useState<ModelInfo[]>([]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch models directly from backend on mount and whenever health changes
  useEffect(() => {
    async function fetchModelsFromBackend() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        if (res.ok) {
          const data = await res.json();
          if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            setBackendModels(data.models);
          }
        }
      } catch (e) {
        // Backend offline or loading
      }
    }
    fetchModelsFromBackend();
  }, [backendHealthy]);

  const availableModels = useMemo(() => {
    if (modelsList && modelsList.length > 0) return modelsList;
    if (backendModels && backendModels.length > 0) return backendModels;
    return [];
  }, [modelsList, backendModels]);

  const currentModel = useMemo(() => {
    if (availableModels.length === 0) {
      return {
        id: selectedModel,
        name: selectedModel || "Loading...",
        tag: "Backend Model",
        description: "Loading models directly from backend..."
      };
    }
    return availableModels.find((m) => m.id === selectedModel) || availableModels[0];
  }, [availableModels, selectedModel]);

  // Calculate active key count
  const activeKeyCount = useMemo(() => {
    if (!apiKey.trim()) return 0;
    return apiKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5).length;
  }, [apiKey]);

  const modalKeyCount = useMemo(() => {
    if (!tempKey.trim()) return 0;
    return tempKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5).length;
  }, [tempKey]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowModelDropdown(false);
      }
    };

    if (showModelDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showModelDropdown]);

  const handleSaveSettings = () => {
    setApiKey(tempKey);
    if (setHfKey) setHfKey(tempHfKey);
    if (setOllamaUrl) setOllamaUrl(tempOllamaUrl);
    setShowKeyModal(false);
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-[#070A12]/85 border-b border-slate-800/80 shadow-2xl transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">

          {/* Logo & Brand Identity */}
          <div className="flex items-center space-x-3 shrink-0">
            <div className="relative group cursor-pointer" onClick={() => setActiveTab("pdf")}>
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-sky-400 rounded-xl blur opacity-40 group-hover:opacity-80 transition duration-300"></div>
              <div className="relative p-2 bg-slate-900 border border-slate-700/80 rounded-xl flex items-center justify-center shadow-inner">
                <Sparkles className="h-5 w-5 text-indigo-400 group-hover:rotate-12 transition-transform duration-300" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-extrabold text-base sm:text-lg bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent tracking-tight">
                  KhmerPDF
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  STEM AI
                </span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block font-khmer">
                ប្រព័ន្ធស្រង់ និងកែសម្រួលអត្ថបទខ្មែរ រូបមន្តគណិត/រូបវិទ្យា
              </p>
            </div>
          </div>

          {/* Responsive Navigation Tabs */}
          <nav className="flex items-center p-1 rounded-2xl bg-[#0D1322] border border-slate-800 text-xs shadow-lg max-w-full overflow-x-auto no-scrollbar">
            {/* Tab 1: PDF Processor */}
            <button
              type="button"
              onClick={() => setActiveTab("pdf")}
              className={`flex items-center space-x-1.5 px-2.5 sm:px-4 py-1.5 rounded-xl font-semibold transition-all duration-200 shrink-0 ${activeTab === "pdf"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">PDF Processor</span>
              <span className="sm:hidden">PDF</span>
            </button>

            {/* Tab 2: Live API & Rate Limit Monitor */}
            <button
              type="button"
              onClick={() => setActiveTab("monitor")}
              className={`flex items-center space-x-1.5 px-2.5 sm:px-4 py-1.5 rounded-xl font-semibold transition-all duration-200 shrink-0 relative ${activeTab === "monitor"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <Terminal className="h-3.5 w-3.5 text-indigo-300" />
              <span className="hidden sm:inline">Live Monitor</span>
              <span className="sm:hidden">Monitor</span>

              {/* Live Pulsing Dot */}
              <span className="flex h-2 w-2 relative ml-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>

              {/* Rate limit badge counter if hit */}
              {rateLimitHits > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[9px] font-black animate-pulse">
                  {rateLimitHits}
                </span>
              )}
            </button>

            {/* Tab 4: API Key Pool & Quota Manager */}
            <button
              type="button"
              onClick={() => setActiveTab("keys")}
              className={`flex items-center space-x-1.5 px-2.5 sm:px-4 py-1.5 rounded-xl font-semibold transition-all duration-200 shrink-0 ${
                activeTab === "keys"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Key className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">Keys Pool ⚡</span>
              <span className="sm:hidden">Keys</span>
            </button>

          </nav>

          {/* Right Controls: Model Dropdown, Status, Keys Button */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {/* Backend Health Badge */}
            <button
              onClick={onRefreshHealth}
              title="Click to check backend status"
              className={`hidden lg:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all duration-200 ${backendHealthy === true
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20"
                  : backendHealthy === false
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20"
                    : "bg-slate-800/80 border-slate-700 text-slate-400"
                }`}
            >
              {backendHealthy === true ? (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              ) : backendHealthy === false ? (
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              )}
              <span>{backendHealthy === true ? "Online" : "Offline"}</span>
            </button>

            {/* Responsive Model Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowModelDropdown((prev) => !prev)}
                className={`flex items-center space-x-1.5 bg-[#0D1322] border px-2 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-200 shadow-inner transition-all duration-200 hover:bg-[#121A2E] ${showModelDropdown
                    ? "border-indigo-500 ring-2 ring-indigo-500/20 text-white"
                    : "border-slate-800 hover:border-slate-700"
                  }`}
              >
                <Zap className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <span className="truncate max-w-[70px] sm:max-w-[130px] text-[11px] sm:text-xs">
                  {currentModel.name}
                </span>
                <ChevronDown
                  className={`h-3 w-3 sm:h-3.5 sm:w-3.5 text-slate-400 transition-transform duration-200 ${showModelDropdown ? "rotate-180 text-indigo-300" : ""
                    }`}
                />
              </button>

              {/* Dropdown Menu */}
              {showModelDropdown && (
                <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm rounded-2xl bg-[#0D1322]/95 backdrop-blur-2xl border border-slate-700/80 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 border-b border-slate-800/80 mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Select AI Model
                    </span>
                    <span className="text-[10px] text-indigo-400 font-medium">
                      {availableModels.length} Models
                    </span>
                  </div>

                  <div className="space-y-1 max-h-[300px] sm:max-h-[340px] overflow-y-auto pr-1">
                    {availableModels.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        {backendHealthy === false
                          ? "Backend is offline. Start backend server to load models."
                          : "Loading models from backend..."}
                      </div>
                    ) : (
                      availableModels.map((m) => {
                      const isSelected = m.id === selectedModel;
                      const isHF = m.id.includes("Qwen/") || m.id.includes("meta-llama/") || m.tag.includes("Hugging Face");
                      const isOllama = m.id.startsWith("qwen2.5-vl") || m.id.startsWith("qwen2.5vl") || m.id.includes(":7b") || m.id.includes(":14b") || m.tag.includes("Ollama");

                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m.id);
                            setShowModelDropdown(false);
                          }}
                          className={`w-full text-left p-2.5 sm:p-3 rounded-xl transition-all duration-150 flex items-start justify-between group ${isSelected
                              ? "bg-indigo-600/20 border border-indigo-500/40 text-white shadow-inner"
                              : "hover:bg-slate-800/70 border border-transparent text-slate-300 hover:text-white"
                            }`}
                        >
                          <div className="space-y-1 pr-2">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              <span className="font-bold text-xs">
                                {m.name}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isHF
                                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                    : isOllama
                                      ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                      : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                                  }`}
                              >
                                {m.tag}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                              {m.description}
                            </p>
                          </div>

                          <div className="pt-0.5 shrink-0 pl-1">
                            {isSelected ? (
                              <div className="h-5 w-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md">
                                <Check className="h-3 w-3 stroke-[3]" />
                              </div>
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-slate-700 group-hover:border-slate-500" />
                            )}
                          </div>
                        </button>
                      );
                    }))}
                  </div>
                </div>
              )}
            </div>

            {/* Direct Route / Tab Switch to Keys Pool */}
            <button
              onClick={() => setActiveTab("keys")}
              className={`flex items-center space-x-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-medium border transition-all ${
                activeTab === "keys"
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300 ring-2 ring-amber-500/20"
                  : "bg-[#0D1322] hover:bg-slate-800 text-slate-200 border-slate-800 hover:border-slate-700"
              }`}
              title="Open Key Pool & Quota Manager"
            >
              <Key className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">
                {activeKeyCount > 1
                  ? `${activeKeyCount} Keys Pool ⚡`
                  : activeKeyCount === 1
                    ? "Key Active ⚡"
                    : "Key Pool"}
              </span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
};


