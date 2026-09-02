// IndexedDB storage utility for persistent Khmer PDF conversion sessions
import { PageResult } from "../components/PageCard";

const DB_NAME = "khmer_pdf_ai_db";
const DB_VERSION = 1;
const STORE_NAME = "session_store";
const SESSION_KEY = "current_session";
const FILE_KEY = "current_file";

export interface StoredSession {
  fileName: string;
  fileSize: number;
  fileType: string;
  totalPdfDocPages: number;
  totalPages: number;
  startPage: number;
  endPage: number | null;
  processingMode: "vision" | "text";
  concurrency: number;
  pages: PageResult[];
  savedAt: number;
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
 * Save the entire active session including file binary blob and page results
 */
export async function persistActiveSession(
  file: File | null,
  pages: PageResult[],
  metadata: {
    totalPdfDocPages: number;
    totalPages: number;
    startPage: number;
    endPage: number | null;
    processingMode: "vision" | "text";
    concurrency: number;
  }
): Promise<void> {
  try {
    // 1. Prepare file record and all data BEFORE opening the transaction
    // Only store binary arrayBuffer in IndexedDB if file is under 25MB to prevent Chrome tab OOM crashes
    const MAX_STORAGE_BLOB_SIZE = 25 * 1024 * 1024; // 25 MB
    let fileRecord: {
      name: string;
      type: string;
      lastModified: number;
      buffer: ArrayBuffer;
    } | null = null;

    if (file && file.size > 0 && file.size <= MAX_STORAGE_BLOB_SIZE) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        fileRecord = {
          name: file.name,
          type: file.type || "application/pdf",
          lastModified: file.lastModified,
          buffer: arrayBuffer,
        };
      } catch (readErr) {
        console.warn("Could not read file arrayBuffer for persistence", readErr);
      }
    }

    const sessionData: StoredSession = {
      fileName: file?.name || "",
      fileSize: file?.size || 0,
      fileType: file?.type || "application/pdf",
      totalPdfDocPages: metadata.totalPdfDocPages,
      totalPages: metadata.totalPages,
      startPage: metadata.startPage,
      endPage: metadata.endPage,
      processingMode: metadata.processingMode,
      concurrency: metadata.concurrency,
      pages,
      savedAt: Date.now(),
    };

    // 2. Open DB and start immediate synchronous transaction
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.put(sessionData, SESSION_KEY);

    if (fileRecord) {
      store.put(fileRecord, FILE_KEY);
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
        concurrency: 3,
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

        if (fileReq.result && fileReq.result.buffer) {
          try {
            const blob = new Blob([fileReq.result.buffer], {
              type: fileReq.result.type || "application/pdf",
            });
            file = new File([blob], fileReq.result.name || "document.pdf", {
              type: fileReq.result.type || "application/pdf",
              lastModified: fileReq.result.lastModified || Date.now(),
            });
          } catch (e) {
            console.warn("Failed to recreate File object from stored buffer:", e);
          }
        }

        resolve({ session, file });
      };

      tx.onerror = () => {
        resolve({ session: null, file: null });
      };
    });
  } catch (err) {
    console.warn("Failed to load session from IndexedDB:", err);
    return { session: null, file: null };
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
