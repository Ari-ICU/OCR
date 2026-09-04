import httpx
import re

url = "https://mosvy.gov.kh/%E1%9E%85%E1%9F%92%E1%9E%94%E1%9E%B6%E1%9E%94%E1%9F%8B-%E1%9E%93%E1%9E%B7%E1%9E%84%E1%9E%94%E1%9E%92%E1%9E%94%E1%9E%89%E1%9F%92%E1%9e%89%E1%9E%8f%E1%9f%92%E1%9e%8f%E1%9E%B7"
r = httpx.get(url, follow_redirects=True, timeout=25.0, headers={"User-Agent": "Mozilla/5.0"})
html = r.text

pos = html.find("មើលឯកសារ")
print("Found មើលឯកសារ at:", pos)
if pos != -1:
    print("Tag around it:\n", html[pos-100:pos+300])

pos2 = html.find("Khmer Version")
print("Found Khmer Version at:", pos2)
if pos2 != -1:
    print("Tag around it:\n", html[pos2-150:pos2+200])
