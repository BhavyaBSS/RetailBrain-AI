import urllib.request
import re
import xml.etree.ElementTree as ET

def crawl_blinkit_categories():
    print("Initiating Web Crawl of Blinkit Categories sitemap...")
    url = "https://blinkit.com/sitemaps/categories.xml"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    }
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
            
        print("  Categories sitemap loaded. Parsing XML...")
        
        xml_str = xml_data.decode('utf-8')
        urls = re.findall(r'<loc>(.*?)</loc>', xml_str)
        
        # Clean URLs to show human-readable categories
        categories = []
        for u in urls:
            match = re.search(r'/cn/(.*?)/cid/', u)
            if match:
                categories.append(match.group(1).replace('-', ' ').title())
            else:
                # Fallback to display path
                categories.append(u.split('/')[-1])
        
        # Remove duplicates
        categories = sorted(list(set(categories)))
        
        print(f"\n--- SUCCESS: DISCOVERED {len(categories)} ACTIVE CATEGORIES ---")
        for idx, cat in enumerate(categories[:25]):
            print(f"[{idx+1:02d}] {cat}")
            
        if len(categories) > 25:
            print(f"... and {len(categories) - 25} more categories.")
            
    except Exception as e:
        print(f"Error fetching categories sitemap: {e}")

if __name__ == "__main__":
    crawl_blinkit_categories()
