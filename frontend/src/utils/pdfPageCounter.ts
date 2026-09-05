import { PDFDocument } from "pdf-lib";
import { FileBreakdownItem } from "../types";

/**
 * Accurately determines the page count of a single File (PDF or Image) directly in the browser.
 */
export async function readPdfPageCount(file: File): Promise<number> {
  const isPdf =
    file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

  if (!isPdf) {
    return 1;
  }

  // Strategy 1: For files <= 120MB, pdf-lib provides instant, specification-compliant page counting
  if (file.size <= 120 * 1024 * 1024) {
    try {
      const buffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const count = pdfDoc.getPageCount();
      if (count > 0) return count;
    } catch (err) {
      console.warn(`[pdfPageCounter] pdf-lib failed for ${file.name}, trying chunk scanner`, err);
    }
  }

  // Strategy 2: Fast chunked binary scanner (ideal for multi-GB files or corrupted streams)
  try {
    const count = await scanPdfPageCountChunks(file);
    if (count > 0) return count;
  } catch (err) {
    console.warn(`[pdfPageCounter] Chunk scan failed for ${file.name}`, err);
  }

  // Strategy 3: Try pdf-lib as last-resort fallback even if large
  try {
    const buffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const count = pdfDoc.getPageCount();
    if (count > 0) return count;
  } catch {}

  return 1;
}

/**
 * Scans a file in chunks to count /Type /Page objects without loading the full file into memory.
 */
async function scanPdfPageCountChunks(file: File): Promise<number> {
  const chunkSize = 8 * 1024 * 1024; // 8MB per chunk
  const overlap = 64;
  let offset = 0;
  let pageCount = 0;

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const slice = file.slice(offset, end);
    const text = await slice.text();

    const matches = text.match(/\/Type\s*\/Page\b/g);
    if (matches) {
      pageCount += matches.length;
    }

    if (end >= file.size) break;
    offset += chunkSize - overlap;
  }

  return pageCount;
}

/**
 * Calculates page breakdown for all selected files in sequential order.
 */
export async function calculateFilesBreakdown(files: File[]): Promise<{
  breakdown: FileBreakdownItem[];
  totalPages: number;
}> {
  let currentGlobalPage = 1;
  const breakdown: FileBreakdownItem[] = [];

  for (const file of files) {
    let pages = 1;
    try {
      pages = await readPdfPageCount(file);
    } catch {
      pages = 1;
    }

    const startPage = currentGlobalPage;
    const endPage = currentGlobalPage + pages - 1;

    breakdown.push({
      filename: file.name,
      pages,
      start_page: startPage,
      end_page: endPage,
      size_bytes: file.size,
    });

    currentGlobalPage = endPage + 1;
  }

  const totalPages = currentGlobalPage - 1;
  return { breakdown, totalPages };
}
