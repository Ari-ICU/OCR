export interface DatasetFileItem {
  filename: string;
  stem: string;
  size_bytes: number;
  size_human: string;
  total_pages: number;
  has_txt: boolean;
  txt_filename: string | null;
  txt_size_bytes: number;
  txt_size_human: string;
  has_jsonl: boolean;
  jsonl_filename: string | null;
  jsonl_size_bytes: number;
  modified_time?: number;
}

export interface DiscoveredPdfItem {
  url: string;
  title: string;
  filename: string;
  source_id?: string;
  extra?: Record<string, string>;
}

export interface InspectStoreResult {
  is_store: boolean;
  is_direct_pdf?: boolean;
  url?: string;
  filename?: string;
  size_bytes?: number;
  store_url?: string;
  total_pdfs?: number;
  database_response_type?: "json" | "html_index";
  pdfs?: DiscoveredPdfItem[];
  message?: string;
  json_keys?: string[] | string;
}

export interface UrlConvertToTxtPayload {
  url: string;
  start_page?: number;
  end_page?: number | null;
  mode?: "vision" | "text";
  provider?: string;
  model?: string;
  dpi?: number;
  use_ai?: boolean;
  save_to_txt?: boolean;
  save_to_jsonl?: boolean;
  save_to_pdf_dataset?: boolean;
  api_key?: string;
}
