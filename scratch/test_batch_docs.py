import httpx
import re

docs = [
    "https://mosvy.gov.kh/%e1%9e%80%e1%9e%b6%e1%9e%9a%e1%9e%9c%e1%9e%b7%e1%9e%97%e1%9e%b6%e1%9e%82%e1%9e%9f%e1%9f%92%e1%9e%90%e1%9e%b6%e1%9e%93%e1%9e%97%e1%9e%b6%e1%9e%96%e1%9e%8a%e1%9f%86%e1%9e%94%e1%9e%bc%e1%9e%84%e1%9e%9f-2",
    "https://mosvy.gov.kh/331280-2",
    "https://mosvy.gov.kh/18-05-2026",
    "https://mosvy.gov.kh/the-achievement-of-social-assistance-programmes-in-cambodia"
]

for d in docs:
    try:
        r = httpx.get(d, follow_redirects=True, timeout=15.0, headers={"User-Agent": "Mozilla/5.0"})
        pdfs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, re.IGNORECASE)
        # title
        title_match = re.search(r'<h1[^>]*>(.*?)</h1>', r.text, re.DOTALL | re.IGNORECASE)
        title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else d
        print(f"\nDoc Title: {title}")
        print(f"PDFs found: {list(set(pdfs))}")
    except Exception as e:
        print(f"Failed {d}: {e}")
