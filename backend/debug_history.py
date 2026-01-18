import asyncio
import httpx

async def fetch_history(port):
    url = f"http://localhost:{port}/api/history/desktop/default?limit=50&offset=0&sort=desc"
    print(f"Testing port {port}...")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url)
            print(f"Status: {resp.status_code}")
            if resp.status_code != 200:
                print(f"Error: {resp.text}")
            else:
                data = resp.json()
                print(f"Fetched {len(data)} logs.")
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(fetch_history(8000))
    asyncio.run(fetch_history(9120))
