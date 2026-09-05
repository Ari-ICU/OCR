import { API_BASE_URL } from "../config/api";
import { DatasetFileItem, InspectStoreResult, UrlConvertToTxtPayload } from "../types";

export const datasetApi = {
  async inspectUrl(url: string): Promise<InspectStoreResult> {
    const res = await fetch(`${API_BASE_URL}/api/dataset/inspect-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Inspection failed (HTTP ${res.status})`);
    }

    return res.json();
  },

  async convertUrlToTxt(payload: UrlConvertToTxtPayload): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/api/dataset/url-to-txt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || `Conversion failed (HTTP ${res.status})`);
    }

    return res.json();
  },

  async listFiles(): Promise<DatasetFileItem[]> {
    const res = await fetch(`${API_BASE_URL}/api/dataset/list`);
    if (!res.ok) {
      throw new Error(`Failed to load dataset files (HTTP ${res.status})`);
    }
    return res.json();
  },
};
