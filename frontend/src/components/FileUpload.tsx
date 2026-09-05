"use client";

import React, { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { DatasetFileItem, FileBreakdownItem } from "../types";
import { LocalDropzone } from "./file-upload/LocalDropzone";
import { ActiveFileTray } from "./file-upload/ActiveFileTray";

// Re-export for existing imports
export type { DatasetFileItem, FileBreakdownItem };

interface FileUploadProps {
  onFileSelected?: (file: File) => void;
  onFilesSelected?: (files: File[]) => void;
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
  selectedFile: File | null;
  selectedFiles?: File[];
  filesBreakdown?: FileBreakdownItem[];
  multiPdfMode?: "merged" | "batch";
  setMultiPdfMode?: (mode: "merged" | "batch") => void;
  onClearFile: () => void;
  isProcessing: boolean;
  onStartProcessing: () => void;
  concurrency: number;
  setConcurrency: (val: number) => void;
  processingMode?: "vision";
  setProcessingMode?: (mode: "vision") => void;
  startPage: number;
  setStartPage: (page: number) => void;
  endPage: number | null;
  setEndPage: (page: number | null) => void;
  totalPdfPages: number;
  existingPagesCount?: number;
  onClearExtractedPages?: () => void;
  existingPageNumbers?: number[];
  sessionRestored?: boolean;
  onLoadServerPages?: (pages: any[], filename: string, totalDocPages?: number) => void;
  onProcessUrlStream?: (url: string, startPage?: number, endPage?: number | null) => Promise<void>;
  onProcessBatchUrlsStream?: (urls: string[]) => Promise<void>;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelected,
  onFilesSelected,
  onAddFiles,
  onRemoveFile,
  selectedFile,
  selectedFiles = [],
  filesBreakdown = [],
  multiPdfMode = "merged",
  setMultiPdfMode,
  onClearFile,
  isProcessing,
  onStartProcessing,
  concurrency,
  setConcurrency,
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
  const [error, setError] = useState<string | null>(null);

  // Local string buffers for smooth typing
  const [startInput, setStartInput] = useState<string>(String(startPage || 1));
  const [endInput, setEndInput] = useState<string>(endPage ? String(endPage) : "");

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

  const isAllPdfs = Boolean(
    activeFileList.length > 0 &&
    activeFileList.every((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf")
  );

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

  const processIncomingFiles = (incomingList: FileList | File[], isAppending = false) => {
    setError(null);
    const filesArray = Array.from(incomingList);
    const valid = filesArray.filter(isValidFileType);

    if (valid.length === 0) {
      setError("Please select valid PDF documents or image files (.pdf, .png, .jpg, .webp).");
      return;
    }

    const sorted = valid.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );

    if (isAppending && onAddFiles) {
      onAddFiles(sorted);
    } else if (onFilesSelected) {
      onFilesSelected(sorted);
    } else if (onFileSelected && sorted.length > 0) {
      onFileSelected(sorted[0]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="space-y-4">
      {activeFileList.length === 0 ? (
        <div className="space-y-3">
          <LocalDropzone onFilesDropped={(files) => processIncomingFiles(files)} />

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <ActiveFileTray
          activeFileList={activeFileList}
          isMultiple={isMultiple}
          isAllPdfs={isAllPdfs}
          isImageFile={isImageFile}
          totalFileSize={totalFileSize}
          totalPdfPages={totalPdfPages}
          existingPagesCount={existingPagesCount}
          sessionRestored={sessionRestored}
          isProcessing={isProcessing}
          multiPdfMode={multiPdfMode}
          setMultiPdfMode={setMultiPdfMode}
          filesBreakdown={filesBreakdown}
          onRemoveFile={onRemoveFile}
          onAddFiles={(files) => processIncomingFiles(files, true)}
          onClearFile={onClearFile}
          onClearExtractedPages={onClearExtractedPages}
          startPage={startPage}
          setStartPage={setStartPage}
          endPage={endPage}
          setEndPage={setEndPage}
          startInput={startInput}
          endInput={endInput}
          onStartInputChange={handleStartInputChange}
          onStartInputBlur={handleStartInputBlur}
          onEndInputChange={handleEndInputChange}
          onEndInputBlur={handleEndInputBlur}
          concurrency={concurrency}
          setConcurrency={setConcurrency}
          onStartProcessing={onStartProcessing}
          formatFileSize={formatFileSize}
          existingPageNumbers={existingPageNumbers}
        />
      )}

      {error && activeFileList.length > 0 && (
        <div className="flex items-center space-x-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-xl">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
