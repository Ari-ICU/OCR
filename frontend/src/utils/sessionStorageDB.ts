// IndexedDB storage utility for persistent Khmer PDF conversion sessions
import { PageResult } from "../components/PageCard";

const DB_NAME = "khmer_pdf_ai_db";
const DB_VERSION = 1;
const STORE_NAME = "session_store";
const SESSION_KEY = "current_session";
const FILE_KEY = "current_file";

export interface StoredFileInfo {
  name: string;
  size: number;
  type: string;
}

export interface StoredSession {
  fileName: string;
  fileSize: number;
  fileType: string;
  files?: StoredFileInfo[];
  multiPdfMode?: "merged" | "batch";
  totalPdfDocPages: number;
  totalPages: number;
  startPage: number;
  endPage: number | null;
  processingMode: "vision" | "text";
  concurrency: number;
  pages: PageResult[];
  savedAt: number;
}

interface StoredFileRecord {
  name: string;
  type: string;
  lastModified: number;
  buffer: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !window.indexedDB) {
        reject(new Error("IndexedDB is not supported in this environment"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

/**
 * Save the entire active session including file binary blobs and page results
 */
export async function persistActiveSession(
  inputFiles: File[] | File | null,
  pages: PageResult[],
  metadata: {
    totalPdfDocPages: number;
    totalPages: number;
    startPage: number;
    endPage: number | null;
    processingMode: "vision" | "text";
    concurrency: number;
    multiPdfMode?: "merged" | "batch";
  }
): Promise<void> {
  try {
    const filesList: File[] = Array.isArray(inputFiles)
      ? inputFiles
      : inputFiles
      ? [inputFiles]
      : [];

    const primaryFile = filesList.length > 0 ? filesList[0] : null;

    // Only store binary arrayBuffer in IndexedDB if cumulative size is under 40MB
    const MAX_STORAGE_TOTAL_BLOB_SIZE = 40 * 1024 * 1024; // 40 MB
    let currentTotalBytes = 0;
    const records: StoredFileRecord[] = [];

    for (const f of filesList) {
      if (f && f.size > 0 && currentTotalBytes + f.size <= MAX_STORAGE_TOTAL_BLOB_SIZE) {
        try {
          const arrayBuffer = await f.arrayBuffer();
          records.push({
            name: f.name,
            type: f.type || "application/pdf",
            lastModified: f.lastModified,
            buffer: arrayBuffer,
          });
          currentTotalBytes += f.size;
        } catch (readErr) {
          console.warn(`Could not read file buffer for ${f.name}`, readErr);
        }
      }
    }

    const sessionData: StoredSession = {
      fileName: primaryFile?.name || "",
      fileSize: primaryFile?.size || 0,
      fileType: primaryFile?.type || "application/pdf",
      files: filesList.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type || "application/pdf",
      })),
      multiPdfMode: metadata.multiPdfMode || "merged",
      totalPdfDocPages: metadata.totalPdfDocPages,
      totalPages: metadata.totalPages,
      startPage: metadata.startPage,
      endPage: metadata.endPage,
      processingMode: metadata.processingMode,
      concurrency: metadata.concurrency,
      pages,
      savedAt: Date.now(),
    };

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.put(sessionData, SESSION_KEY);

    if (records.length > 0) {
      store.put(records, FILE_KEY);
    } else {
      store.delete(FILE_KEY);
    }

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // Non-blocking
    });
  } catch (err) {
    console.warn("Failed to persist session to IndexedDB:", err);
  }
}

/**
 * Incrementally save updated pages (fast during live streaming)
 */
export async function persistPagesOnly(pages: PageResult[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const getReq = store.get(SESSION_KEY);
    getReq.onsuccess = () => {
      const existing: StoredSession = getReq.result || {
        fileName: "",
        fileSize: 0,
        fileType: "application/pdf",
        totalPdfDocPages: 0,
        totalPages: pages.length,
        startPage: 1,
        endPage: 2,
        processingMode: "vision",
        concurrency: 2,
        pages: [],
        savedAt: Date.now(),
      };

      existing.pages = pages;
      existing.totalPages = pages.length;
      existing.savedAt = Date.now();
      store.put(existing, SESSION_KEY);
    };
  } catch (err) {
    console.warn("Failed to persist pages to IndexedDB:", err);
  }
}

/**
 * Load saved session from IndexedDB on page mount / refresh
 */
export async function loadPersistedSession(): Promise<{
  session: StoredSession | null;
  file: File | null;
  files: File[];
}> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const sessionReq = store.get(SESSION_KEY);
    const fileReq = store.get(FILE_KEY);

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        const session: StoredSession | null = sessionReq.result || null;
        let file: File | null = null;
        const files: File[] = [];

        if (fileReq.result) {
          const raw = fileReq.result;
          const records: StoredFileRecord[] = Array.isArray(raw) ? raw : [raw];

          for (const rec of records) {
            if (rec && rec.buffer) {
              try {
                const blob = new Blob([rec.buffer], {
                  type: rec.type || "application/pdf",
                });
                const recreated = new File([blob], rec.name || "document.pdf", {
                  type: rec.type || "application/pdf",
                  lastModified: rec.lastModified || Date.now(),
                });
                files.push(recreated);
              } catch (e) {
                console.warn("Failed to recreate File object from stored buffer:", e);
              }
            }
          }
          if (files.length > 0) {
            file = files[0];
          }
        }

        resolve({ session, file, files });
      };

      tx.onerror = () => {
        resolve({ session: null, file: null, files: [] });
      };
    });
  } catch (err) {
    console.warn("Failed to load session from IndexedDB:", err);
    return { session: null, file: null, files: [] };
  }
}

/**
 * Clear saved session when user resets or uploads a new file
 */
export async function clearPersistedSession(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.delete(SESSION_KEY);
    store.delete(FILE_KEY);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Failed to clear session in IndexedDB:", err);
  }
}
