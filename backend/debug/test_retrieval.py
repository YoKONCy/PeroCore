import asyncio
import time
import os
import sys
from datetime import datetime

# Setup path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from database import init_db, get_session
from services.memory_service import MemoryService
from services.embedding_service import embedding_service
from services.vector_store_service import VectorStoreService

async def main():
    print("="*50)
    print("🚀 Memory Retrieval Test Starting...")
    print(f"📅 Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*50)

    # 1. Initialize DB
    print("[1/4] Initializing Database...")
    await init_db()
    
    # 2. Warm up Embedding Model
    print("[2/4] Warming up Embedding Model...")
    t0 = time.time()
    embedding_service.warm_up()
    t1 = time.time()
    print(f"✅ Embedding Model Ready (Took {t1 - t0:.4f}s)")

    # 3. Check Vector Store
    print("[3/4] Checking Vector Store...")
    try:
        vs = VectorStoreService()
        count = vs.count_memories()
        print(f"✅ Vector Store Connected. Total Memories: {count}")
    except Exception as e:
        print(f"❌ Vector Store Error: {e}")
        return

    # 4. Run Retrieval Test
    print("[4/4] Running Retrieval Test...")
    
    # User Input
    user_text = "rust编程"
    print(f"\n📝 User Input: \"{user_text}\"")
    
    async for session in get_session():
        try:
            # Step A: Vectorization
            print("\n--- Step A: Vectorization ---")
            t_start_vec = time.time()
            query_vec = embedding_service.encode_one(user_text)
            t_end_vec = time.time()
            print(f"✅ Vectorization Complete.")
            print(f"⏱️ Time: {t_end_vec - t_start_vec:.4f}s")
            print(f"📊 Vector Dimension: {len(query_vec)}")

            # Step B: Full Retrieval (Vector Search + Spreading Activation + Filtering)
            print("\n--- Step B: Memory Retrieval (get_relevant_memories) ---")
            t_start_retrieval = time.time()
            
            # Note: passing query_vec to save time since we already computed it, 
            # but providing text is also required for keyword fallback or intent detection.
            # We will use limit=5 (default) or maybe 10 to see more results.
            memories = await MemoryService.get_relevant_memories(
                session=session,
                text=user_text,
                limit=10,
                query_vec=query_vec,
                exclude_after_time=None, # No context filtering for this test to see raw recall
                update_access_stats=False # Don't mess up stats
            )
            
            t_end_retrieval = time.time()
            print(f"✅ Retrieval Complete.")
            print(f"⏱️ Time: {t_end_retrieval - t_start_retrieval:.4f}s")
            print(f"🔍 Found {len(memories)} relevant memories.")
            
            print("\n--- Results ---")
            for i, mem in enumerate(memories):
                # Print simplified memory content
                content_preview = mem.content[:50].replace('\n', ' ') + "..." if len(mem.content) > 50 else mem.content.replace('\n', ' ')
                print(f"[{i+1}] ID: {mem.id} | {content_preview}")

            # Total Time
            print("\n" + "="*50)
            print(f"🏁 Total Process Time: {t_end_retrieval - t_start_vec:.4f}s")
            print("="*50)

        except Exception as e:
            print(f"❌ Error during test: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # We only need one session pass
            break

if __name__ == "__main__":
    asyncio.run(main())
