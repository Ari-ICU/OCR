import httpx
import json

r = httpx.get("https://mosvy.gov.kh/wp-json/wp/v2/pages/352497", follow_redirects=True, timeout=20.0, headers={"User-Agent": "Mozilla/5.0"})
data = r.json()
rendered = data.get("content", {}).get("rendered", "")
print("Rendered length:", len(rendered))
import re
links = re.findall(r'href=["\']([^"\']+)["\']', rendered)
print("Links in page content:", len(links))
for l in links:
    print("Content link:", l)
