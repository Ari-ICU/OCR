import { API_BASE_URL } from "../config/api";
import { ModelInfo } from "../types";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  active_models: ModelInfo[];
  default_model: string;
}

export const pdfApi = {
  async fetchHealth(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE_URL}/api/health`);
    if (!res.ok) throw new Error(`Health check failed (${res.status})`);
    return res.json();
  },

  async cancelAllProcessing(): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/api/cancel-all-processing`, { method: "POST" });
    } catch {
      // Best-effort cancellation
    }
  },

  async fetchUrlFile(cleanUrl: string): Promise<File> {
    const res = await fetch(`${API_BASE_URL}/api/fetch-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cleanUrl }),
    });

    if (!res.ok) {
      const errorJson = await res.json().catch(() => null);
      throw new Error(errorJson?.detail || `Failed to download file from link (HTTP ${res.status})`);
    }

    let filename = "downloaded_document.pdf";
    const disposition = res.headers.get("content-disposition");
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, "").trim();
      }
    } else {
      try {
        const urlObj = new URL(cleanUrl);
        const pathSegments = urlObj.pathname.split("/").filter(Boolean);
        if (pathSegments.length > 0) {
          const last = pathSegments[pathSegments.length - 1];
          if (last.includes(".")) filename = decodeURIComponent(last);
        }
      } catch {}
    }

    const blob = await res.blob();
    return new File([blob], filename, {
      type: blob.type || "application/pdf",
      lastModified: Date.now(),
    });
  },

  async extractPreview(
    files: File[],
    startPage: number = 1,
    endPage: number | null = null,
    signal?: AbortSignal
  ): Promise<any> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));

    const query = new URLSearchParams({ start_page: String(startPage) });
    if (endPage) query.set("end_page", String(endPage));

    const res = await fetch(`${API_BASE_URL}/api/extract-preview?${query.toString()}`, {
      method: "POST",
      body: formData,
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Failed to load document preview (HTTP ${res.status})`);
    }

    return res.json();
  },

  async reprocessPage(payload: {
    raw_text: string;
    page_number: number;
    model?: string;
    provider?: string;
    api_key?: string;
    mode?: string;
    image_base64?: string;
  }): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/api/reprocess-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || "Reprocessing failed.");
    }

    return res.json();
  },
};
