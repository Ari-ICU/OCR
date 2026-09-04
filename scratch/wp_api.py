import httpx
import json

r = httpx.get("https://mosvy.gov.kh/wp-json/wp/v2/pages?search=ច្បាប់", follow_redirects=True, timeout=20.0, headers={"User-Agent": "Mozilla/5.0"})
print("Status:", r.status_code)
pages = r.json()
print("Found pages:", len(pages))
for p in pages:
    print("Page ID:", p.get("id"), "Slug:", p.get("slug"), "Link:", p.get("link"))
