"use client";

import React, { useState, useEffect } from "react";
import { Navbar, ModelInfo } from "../../components/Navbar";
import { KeyManagementView } from "../../components/KeyManagementView";

export default function KeysPage() {
  const [apiKey, setApiKey] = useState<string>("");
  const [hfKey, setHfKey] = useState<string>("");
  const [ollamaUrl, setOllamaUrl] = useState<string>("http://localhost:11434");
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.6-flash");
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("khmerpdf_api_key");
      if (savedKey) setApiKey(savedKey);

      const savedHfKey = localStorage.getItem("khmerpdf_hf_key");
      if (savedHfKey) setHfKey(savedHfKey);

      const savedOllama = localStorage.getItem("khmerpdf_ollama_url");
      if (savedOllama) setOllamaUrl(savedOllama);

      const savedModel = localStorage.getItem("khmerpdf_selected_model");
      if (savedModel) setSelectedModel(savedModel);
    } catch (e) {
      console.warn("Could not read localStorage", e);
    }
  }, []);

  const handleSetApiKey = (key: string) => {
    setApiKey(key);
    try {
      localStorage.setItem("khmerpdf_api_key", key);
    } catch {}
  };

  const handleSetHfKey = (key: string) => {
    setHfKey(key);
    try {
      localStorage.setItem("khmerpdf_hf_key", key);
    } catch {}
  };

  const handleSetOllamaUrl = (url: string) => {
    setOllamaUrl(url);
    try {
      localStorage.setItem("khmerpdf_ollama_url", url);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-[#070A12] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <Navbar
        apiKey={apiKey}
        setApiKey={handleSetApiKey}
        hfKey={hfKey}
        setHfKey={handleSetHfKey}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        backendHealthy={backendHealthy}
        onRefreshHealth={() => {}}
        ollamaUrl={ollamaUrl}
        setOllamaUrl={handleSetOllamaUrl}
        activeTab="keys"
        setActiveTab={(tab) => {
          if (tab !== "keys") {
            window.location.href = "/";
          }
        }}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-8">
        <KeyManagementView
          apiKey={apiKey}
          setApiKey={handleSetApiKey}
          hfKey={hfKey}
          setHfKey={handleSetHfKey}
          ollamaUrl={ollamaUrl}
          setOllamaUrl={handleSetOllamaUrl}
        />
      </main>

      <footer className="border-t border-slate-800/80 py-6 mt-12 bg-[#070A12]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
          <p>© 2026 KhmerPDF AI • Powered by FastAPI & Next.js with Gemini AI & PyMuPDF</p>
          <div className="flex items-center space-x-4 font-khmer">
            <span>Khmer Unicode Normalization</span>
            <span>•</span>
            <span>LaTeX Math & KaTeX</span>
            <span>•</span>
            <span>Multi-Project Key Pool</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
