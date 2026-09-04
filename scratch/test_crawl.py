import httpx
import re

url = "https://mosvy.gov.kh/%E1%9E%85%E1%9F%92%E1%9E%94%E1%9E%B6%E1%9E%94%E1%9F%8B-%E1%9E%93%E1%9E%B7%E1%9E%84%E1%9E%94%E1%9E%92%E1%9E%94%E1%9E%89%E1%9F%92%E1%9e%89%E1%9E%8f%E1%9F%92%E1%9e%8f%E1%9E%B7"
r = httpx.get(url, follow_redirects=True, timeout=25.0, headers={"User-Agent": "Mozilla/5.0"})
html = r.text

pos = html.find("ទាញយក")
print("Found pos:", pos)
print("Tag around it:\n", html[pos-150:pos+500])

# Also let's inspect the document detail page: https://mosvy.gov.kh/%e1%9e%80%e1%9e%b6%e1%9e%9a%e1%9e%9c%e1%9e%b7%e1%9e%97%e1%9e%b6%e1%9e%82%e1%9e%9f%e1%9f%92%e1%9e%90%e1%9e%b6%e1%9e%93%e1%9e%97%e1%9e%b6%e1%9e%96%e1%9e%8a%e1%9f%86%e1%9e%94%e1%9e%bc%e1%9e%84%e1%9e%9f-2
doc_url = "https://mosvy.gov.kh/%e1%9e%80%e1%9e%b6%e1%9e%9a%e1%9e%9c%e1%9e%b7%e1%9e%97%e1%9e%b6%e1%9e%82%e1%9e%9f%e1%9f%92%e1%9e%90%e1%9e%b6%e1%9e%93%e1%9e%97%e1%9e%b6%e1%9e%96%e1%9e%8a%e1%9f%86%e1%9e%94%e1%9e%bc%e1%9e%84%e1%9e%9f-2"
r2 = httpx.get(doc_url, follow_redirects=True, timeout=25.0, headers={"User-Agent": "Mozilla/5.0"})
html2 = r2.text
pdf_links = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html2, re.IGNORECASE)
print("\nPDFs on document detail page:", len(pdf_links))
for p in set(pdf_links):
    print("Detail PDF:", p)
