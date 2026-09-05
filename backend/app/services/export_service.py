import json
from typing import List, Dict, Any
from fastapi import Response

class ExportService:
    @staticmethod
    def export(filename: str, format_type: str, pages: List[Dict[str, Any]]) -> Response:
        base_name = filename.replace(".pdf", "").replace(".PDF", "")
        
        if format_type == "jsonl":
            jsonl_lines = []
            for p in pages:
                is_blank = p.get("is_blank") or p.get("model_used") == "blank-skipped"
                is_english = p.get("is_english_skipped") or p.get("model_used") == "english-skipped"
                raw = p.get("corrected_text") or p.get("raw_text") or ""

                if is_blank or "[ទំព័រទទេ" in raw or "Blank Page" in raw:
                    continue
                if is_english or "English Page - Skipped" in raw:
                    continue

                clean_text = raw.strip()
                if not clean_text:
                    continue

                record = {
                    "document": p.get("file_name") or filename,
                    "page": p.get("page_number", 1),
                    "doc_page": p.get("doc_page_number") or p.get("page_number", 1),
                    "text": clean_text,
                    "char_count": len(clean_text),
                    "word_count": len(clean_text.split()),
                    "has_formulas": bool(p.get("has_formulas", False)),
                }
                jsonl_lines.append(json.dumps(record, ensure_ascii=False))

            content_str = "\n".join(jsonl_lines) + ("\n" if jsonl_lines else "")
            return Response(
                content=content_str,
                media_type="application/x-ndjson; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{base_name}_clean.jsonl"'}
            )
        elif format_type == "json":
            data = {
                "document": filename,
                "total_pages": len(pages),
                "pages": pages
            }
            return Response(
                content=json.dumps(data, ensure_ascii=False, indent=2),
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="{base_name}_khmer.json"'}
            )
        elif format_type == "md":
            lines = [f"# {base_name} - Khmer OCR & LaTeX Formulas", ""]
            for p in pages:
                num = p.get("page_number", 1)
                is_blank = p.get("is_blank") or p.get("model_used") == "blank-skipped" or (not p.get("corrected_text") and not p.get("raw_text"))
                content = "*[ទំព័រទទេ / Blank Page]*" if is_blank else (p.get("corrected_text") or p.get("raw_text", ""))
                lines.append(f"## ទំព័រទី {num} (Page {num})\n\n{content}\n")
            return Response(
                content="\n".join(lines),
                media_type="text/markdown; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{base_name}_khmer.md"'}
            )
        else:  # txt
            blocks = []
            for p in pages:
                num = p.get("page_number", 1)
                is_blank = p.get("is_blank") or p.get("model_used") == "blank-skipped" or (not p.get("corrected_text") and not p.get("raw_text"))
                content = "[ទំព័រទទេ / Blank Page]" if is_blank else (p.get("corrected_text") or p.get("raw_text", ""))
                blocks.append(f"=== Page {num} ===\n\n{content}\n")
            return Response(
                content="\n".join(blocks),
                media_type="text/plain; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{base_name}_khmer.txt"'}
            )
