import requests
import json
import os
import time

TRACE_MOE_API = 'https://api.trace.moe/search?cutBorders&anilistInfo'

async def find_anime_by_image(image_url: str, **kwargs) -> str:
    """
    Identify anime from a screenshot using trace.moe API.
    """
    try:
        # 1. Download image
        headers = {
            'User-Agent': 'PeroCore/1.0'
        }
        img_resp = requests.get(image_url, headers=headers, timeout=20)
        img_resp.raise_for_status()
        image_data = img_resp.content

        # 2. Upload to trace.moe
        files = {'image': ('screenshot.jpg', image_data, 'image/jpeg')}
        response = requests.post(TRACE_MOE_API, files=files, timeout=30)
        response.raise_for_status()
        data = response.json()

        # 3. Format result
        if not data.get('result'):
            return "No matches found."

        results = data['result'][:3] # Top 3
        formatted_output = "### Anime Identification Results\n\n"
        
        for i, res in enumerate(results, 1):
            anilist = res.get('anilist', {})
            title = anilist.get('title', {})
            native = title.get('native', 'Unknown')
            romaji = title.get('romaji', '')
            english = title.get('english', '')
            
            similarity = res.get('similarity', 0) * 100
            episode = res.get('episode', 'Unknown')
            
            formatted_output += f"**Match {i}** ({similarity:.1f}%)\n"
            formatted_output += f"- **Title**: {native}" + (f" ({romaji})" if romaji else "") + "\n"
            if english:
                formatted_output += f"- **English**: {english}\n"
            formatted_output += f"- **Episode**: {episode}\n"
            formatted_output += f"- **Time**: {res.get('from', 0):.1f}s - {res.get('to', 0):.1f}s\n"
            formatted_output += "\n"

        return formatted_output

    except Exception as e:
        return f"Error identifying anime: {str(e)}"
