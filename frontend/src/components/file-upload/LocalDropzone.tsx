"use client";

import React, { useRef, useState } from "react";
import { FileUp } from "lucide-react";

interface LocalDropzoneProps {
  onFilesDropped: (files: File[]) => void;
}

export const LocalDropzone: React.FC<LocalDropzoneProps> = ({ onFilesDropped }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesDropped(Array.from(e.target.files));
    }
  };

  return (
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
            Upload Multiple Khmer PDF Documents or Images
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto font-khmer">
            ទម្លាក់ឯកសារ PDF ច្រើនសន្លឹក ឬរូបភាព (PNG, JPG, WEBP) ដើម្បីបំប្លែង និងច្របាច់បញ្ចូលគ្នាដោយស្វ័យប្រវត្តិ
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400 pt-1">
          <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 font-medium text-indigo-300">
            📄 Multiple PDFs Supported
          </span>
          <span>•</span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 font-medium">
            🖼️ Multi-Images
          </span>
          <span>•</span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 font-medium">
            Hybrid Merged / Batch
          </span>
        </div>
      </div>
    </div>
  );
};
