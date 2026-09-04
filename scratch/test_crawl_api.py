import asyncio
import httpx
import re
import urllib.parse

async def crawl_webpage(url: str, max_subpages: int = 15):
    clean_url = url.strip().rstrip(".")
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        clean_url = "https://" + clean_url
        
    parsed = urllib.parse.urlparse(clean_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "km,en-US;q=0.9,en;q=0.8",
    }
    
    pdfs = []
    seen_pdf_urls = set()
    page_title = clean_url
    
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=25.0, verify=False) as client:
        try:
            resp = await client.get(clean_url)
            html = resp.text
            
            title_m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
            if title_m:
                page_title = re.sub(r'<[^>]+>', '', title_m.group(1)).strip()
        except Exception as e:
            print("Failed to fetch initial URL:", e)
            html = ""

        if html:
            # 1. Direct PDF links on the page
            direct_links = re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
            for href, content in direct_links:
                full_url = urllib.parse.urljoin(clean_url, href.strip())
                if ".pdf" in full_url.lower() and full_url not in seen_pdf_urls:
                    clean_text = re.sub(r'<[^>]+>', '', content).strip()
                    filename = urllib.parse.unquote(full_url.split("/")[-1].split("?")[0])
                    title = clean_text if len(clean_text) > 3 else filename
                    pdfs.append({"title": title, "url": full_url, "filename": filename})
                    seen_pdf_urls.add(full_url)
                    
            # 2. Check for detail/post links to crawl
            detail_links = []
            seen_detail_urls = set()
            for href, content in direct_links:
                full_url = urllib.parse.urljoin(clean_url, href.strip())
                parsed_detail = urllib.parse.urlparse(full_url)
                if parsed_detail.netloc != parsed.netloc or full_url == clean_url or full_url.endswith("#"):
                    continue
                if full_url in seen_detail_urls:
                    continue
                if any(x in full_url.lower() for x in ["/category/", "/feed", "/wp-admin", "/tag/", "/author/", "comment"]):
                    continue
                    
                clean_text = re.sub(r'<[^>]+>', '', content).strip()
                # Check if this link likely points to a document page
                if clean_text in ["មើលឯកសារ", "ទាញយក", "Download", "View"] or len(clean_text) > 8:
                    seen_detail_urls.add(full_url)
                    detail_links.append({"url": full_url, "title": clean_text if clean_text not in ["មើលឯកសារ", "ទាញយក"] else ""})

            # Crawl subpages
            if detail_links:
                async def fetch_subpage(item):
                    try:
                        r = await client.get(item["url"], timeout=12.0)
                        sub_pdfs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, re.IGNORECASE)
                        res = []
                        for p in sub_pdfs:
                            full_pdf = urllib.parse.urljoin(item["url"], p.strip())
                            if full_pdf not in seen_pdf_urls:
                                filename = urllib.parse.unquote(full_pdf.split("/")[-1].split("?")[0])
                                title = item["title"]
                                if not title:
                                    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', r.text, re.DOTALL | re.IGNORECASE)
                                    if h1:
                                        title = re.sub(r'<[^>]+>', '', h1.group(1)).strip()
                                if not title:
                                    title = filename
                                res.append({"title": title, "url": full_pdf, "filename": filename})
                                seen_pdf_urls.add(full_pdf)
                        return res
                    except Exception:
                        return []

                chunks = detail_links[:max_subpages]
                sub_results = await asyncio.gather(*[fetch_subpage(item) for item in chunks])
                for sub in sub_results:
                    pdfs.extend(sub)

        # 3. WordPress Media API query
        try:
            wp_media_url = f"{origin}/wp-json/wp/v2/media?mime_type=application/pdf&per_page=30"
            wp_resp = await client.get(wp_media_url, timeout=8.0)
            if wp_resp.status_code == 200:
                media_items = wp_resp.json()
                if isinstance(media_items, list):
                    for m in media_items:
                        src = m.get("source_url")
                        if src and src not in seen_pdf_urls:
                            title = m.get("title", {}).get("rendered", "")
                            filename = urllib.parse.unquote(src.split("/")[-1].split("?")[0])
                            pdfs.append({
                                "title": title or filename,
                                "url": src,
                                "filename": filename
                            })
                            seen_pdf_urls.add(src)
        except Exception:
            pass

    return {
        "webpage_url": clean_url,
        "webpage_title": page_title,
        "total_found": len(pdfs),
        "pdfs": pdfs
    }

async def main():
    url = "https://mosvy.gov.kh/%e1%9e%85%e1%9f%92%e1%9e%94%e1%9e%b6%e1%9e%94%e1%9f%8b-%e1%9e%93%e1%9e%b7%e1%9e%84%e1%9e%94%e1%9e%92%e1%9e%94%e1%9e%89%e1%9f%92%e1%9e%89%e1%9e%8f%e1%9f%92%e1%9e%8f%e1%9e%b7."
    res = await crawl_webpage(url)
    print(f"\nPage: {res['webpage_title']}")
    print(f"Total PDFs Discovered: {res['total_found']}")
    for i, p in enumerate(res['pdfs'][:10], 1):
        print(f"{i}. {p['title']}")
        print(f"   {p['url']}")

if __name__ == "__main__":
    asyncio.run(main())
