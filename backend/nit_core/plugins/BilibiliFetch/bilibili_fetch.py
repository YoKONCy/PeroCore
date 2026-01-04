import json
import re
import requests
import logging

# --- Constants ---
BILIBILI_VIDEO_BASE_URL = "https://www.bilibili.com/video/"
PAGELIST_API_URL = "https://api.bilibili.com/x/player/pagelist"
PLAYER_WBI_API_URL = "https://api.bilibili.com/x/player/wbi/v2"

# --- Helper Functions ---

def extract_bvid(video_input: str) -> str | None:
    """Extracts BV ID from URL or direct input."""
    match = re.search(r'bilibili\.com/video/(BV[a-zA-Z0-9]+)', video_input, re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.match(r'^(BV[a-zA-Z0-9]+)$', video_input, re.IGNORECASE)
    if match:
        return match.group(1)
    return None

def get_subtitle_json_string(bvid: str, user_cookie: str | None = None) -> str:
    """
    Fetches subtitle JSON for a given BVID.
    """
    logging.info(f"Attempting to fetch subtitles for BVID: {bvid}")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': f'{BILIBILI_VIDEO_BASE_URL}{bvid}/',
    }
    if user_cookie:
        headers['Cookie'] = user_cookie

    try:
        # Step 1: Get AID
        resp = requests.get(f'{BILIBILI_VIDEO_BASE_URL}{bvid}/', headers=headers, timeout=10)
        resp.raise_for_status()
        text = resp.text
        
        aid_match = re.search(r'"aid"\s*:\s*(\d+)', text)
        aid = aid_match.group(1) if aid_match else None
        
        if not aid:
            # Fallback to initial state
            state_match = re.search(r'window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?', text)
            if state_match:
                try:
                    data = json.loads(state_match.group(1))
                    aid = data.get('videoData', {}).get('aid')
                except:
                    pass

        if not aid:
            return json.dumps({"error": "Could not find AID"}, ensure_ascii=False)

        # Step 2: Get CID
        cid_resp = requests.get(PAGELIST_API_URL, params={'bvid': bvid}, headers=headers, timeout=10)
        cid_data = cid_resp.json()
        if cid_data['code'] != 0 or not cid_data['data']:
            return json.dumps({"error": "Could not find CID"}, ensure_ascii=False)
        cid = cid_data['data'][0]['cid']

        # Step 3: Get Subtitle List
        params = {'aid': aid, 'cid': cid}
        player_resp = requests.get(PLAYER_WBI_API_URL, params=params, headers=headers, timeout=10)
        player_data = player_resp.json()
        
        subtitles = player_data.get('data', {}).get('subtitle', {}).get('subtitles', [])
        if not subtitles:
            return json.dumps({"body": []})

        # Step 4: Fetch Subtitle Content (Prefer zh-CN)
        target_sub = next((s for s in subtitles if s.get('lan') == 'zh-CN'), subtitles[0])
        sub_url = target_sub.get('subtitle_url')
        if sub_url:
            if sub_url.startswith('//'):
                sub_url = 'https:' + sub_url
            content_resp = requests.get(sub_url, headers=headers, timeout=10)
            return json.dumps(content_resp.json(), ensure_ascii=False)
            
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)
        
    return json.dumps({"body": []})

# --- Exported Tools ---

async def bilibili_get_subtitles(url: str, **kwargs) -> str:
    """
    Get subtitles for a Bilibili video.
    """
    bvid = extract_bvid(url)
    if not bvid:
        return "Error: Invalid Bilibili URL or BVID."
    
    # Run synchronous request in executor if needed, but for now simple call
    # Note: In production, consider run_in_executor
    try:
        result = get_subtitle_json_string(bvid)
        return result
    except Exception as e:
        return f"Error fetching subtitles: {str(e)}"

async def bilibili_get_info(url: str, **kwargs) -> str:
    """
    Get basic info for a Bilibili video (Title, Desc, etc).
    """
    bvid = extract_bvid(url)
    if not bvid:
        return "Error: Invalid Bilibili URL or BVID."
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        resp = requests.get(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}", headers=headers, timeout=10)
        data = resp.json()
        if data['code'] == 0:
            d = data['data']
            info = {
                "title": d['title'],
                "desc": d['desc'],
                "owner": d['owner']['name'],
                "view": d['stat']['view'],
                "like": d['stat']['like'],
                "coin": d['stat']['coin'],
                "favorite": d['stat']['favorite']
            }
            return json.dumps(info, ensure_ascii=False, indent=2)
        else:
            return f"Error: API returned code {data['code']} - {data.get('message')}"
    except Exception as e:
        return f"Error fetching video info: {str(e)}"
