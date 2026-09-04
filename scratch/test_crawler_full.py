import asyncio
import httpx
import re
import urllib.parse

async def crawl_webpage_for_pdfs(page_url: str, max_subpages: int = 15):
    # Normalize URL
    page_url = page_url.strip().rstrip(".")
    parsed_base = urllib.parse.urlparse(page_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    results = []
    seen_urls = set()
    
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=25.0) as client:
        try:
            resp = await client.get(page_url)
        except Exception as e:
            print("Failed to fetch initial page:", e)
            return []
            
        html = resp.text
        
        # 1. Direct PDF links on the page
        direct_matches = re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
        for href, anchor in direct_matches:
            full_href = urllib.parse.urljoin(page_url, href.strip())
            if ".pdf" in full_href.lower() and full_href not in seen_urls:
                clean_title = re.sub(r"<[^>]+>", "", anchor).strip()
                if not clean_title or len(clean_title) < 3:
                    clean_title = urllib.parse.unquote(full_href.split("/")[-1])
                results.append({"title": clean_title, "url": full_href})
                seen_urls.add(full_href)

        # 2. Check for document cards / detail links (like WordPress posts, document views)
        detail_links = []
        for href, anchor in direct_matches:
            full_href = urllib.parse.urljoin(page_url, href.strip())
            clean_anchor = re.sub(r"<[^>]+>", "", anchor).strip()
            
            # Skip if same page, external non-related domain, anchor jump, or already seen
            if full_href in seen_urls or full_href == page_url or full_href.endswith("#"):
                continue
            if urllib.parse.urlparse(full_href).netloc != parsed_base.netloc:
                continue
            # Skip common non-document paths
            if any(skip in full_href.lower() for skip in ["/category/", "/feed", "/wp-admin", "/tag/", "/author/", "facebook.com"]):
                continue

            # Check if anchor or context indicates document / law / article
            if ("មើលឯកសារ" in clean_anchor or len(clean_anchor) > 10) and full_href not in [d["url"] for d in detail_links]:
                detail_links.append({"title": clean_anchor if clean_anchor != "មើលឯកសារ" else "", "url": full_href})

        print(f"Found {len(results)} direct PDFs, and {len(detail_links)} detail links to check...")

        # Concurrently fetch detail links to find their PDFs (limit to max_subpages)
        async def check_detail(item):
            try:
                sub_resp = await client.get(item["url"])
                sub_html = sub_resp.text
                sub_pdfs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', sub_html, re.IGNORECASE)
                sub_results = []
                for p in sub_pdfs:
                    full_p = urllib.parse.urljoin(item["url"], p.strip())
                    if full_p not in seen_urls:
                        # Extract title from sub_html or fallback to item title
                        title = item["title"]
                        if not title:
                            title_match = re.search(r'<h1[^>]*>(.*?)</h1>', sub_html, re.DOTALL | re.IGNORECASE)
                            if title_match:
                                title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip()
                        if not title:
                            title = urllib.parse.unquote(full_p.split("/")[-1])
                        sub_results.append({"title": title, "url": full_p})
                        seen_urls.add(full_p)
                return sub_results
            except Exception:
                return []

        if detail_links:
            chunks = detail_links[:max_subpages]
            sub_res_lists = await asyncio.gather(*[check_detail(item) for item in chunks])
            for s_list in sub_res_lists:
                results.extend(s_list)

    return results

async def main():
    target = "https://mosvy.gov.kh/%E1%9E%85%E1%9F%92%E1%9E%94%E1%9E%B6%E1%9E%94%E1%9F%8B-%E1%9E%93%E1%9E%B7%E1%9E%84%E1%9E%94%E1%9E%92%E1%9E%94%E1%9E%89%E1%9F%92%E1%9e%89%E1%9E%8f%E1%9F%92%E1%9e%8f%E1%9E%B7"
    pdfs = await crawl_webpage_for_pdfs(target)
    print(f"\nSUCCESS: Crawled {len(pdfs)} total PDF files from page:")
    for idx, p in enumerate(pdfs, 1):
        print(f"{idx}. {p['title']}")
        print(f"   URL: {p['url']}")

if __name__ == "__main__":
    asyncio.run(main())
