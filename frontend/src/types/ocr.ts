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
  file_name?: string;
  doc_page_number?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export type NavTab = "vision" | "monitor" | "keys";

export interface FileBreakdownItem {
  filename: string;
  pages: number;
  start_page?: number;
  end_page?: number;
  size_bytes?: number;
}

export interface KhmerErrorGroup {
  subscriptMatches: number;
  coengMatches: number;
  standaloneSignMatches: number;
  isolatedVowelMatches: number;
  duplicateCharMatches: number;
  hasErrors: boolean;
  totalErrors: number;
}
