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
from sqlmodel import select, delete
from models import Memory

async def cleanup_test_memories(session, tag):
    """Clean up memories created during test"""
    statement = select(Memory).where(Memory.tags.contains(tag))
    results = (await session.exec(statement)).all()
    for m in results:
        await session.delete(m)
    await session.commit()
    print(f"🧹 Cleaned up {len(results)} test memories.")

async def main():
    print("="*50)
    print("🚀 Memory Isolation Test (Multi-Agent) Starting...")
    print("="*50)

    # 1. Initialize DB
    await init_db()
    embedding_service.warm_up()
    
    test_tag = "ISOLATION_TEST_TAG_XYZ"
    
    async for session in get_session():
        try:
            # 0. Cleanup previous runs
            await cleanup_test_memories(session, test_tag)

            # 1. Create Data
            print("\n[1/3] Creating Test Memories...")
            
            # Pero's Memory
            await MemoryService.save_memory(
                session=session,
                content="My name is Pero and I love Python.",
                tags=test_tag,
                agent_id="pero"
            )
            print("✅ Saved Pero's memory.")

            # Nana's Memory
            await MemoryService.save_memory(
                session=session,
                content="My name is Nana and I love Rust.",
                tags=test_tag,
                agent_id="nana"
            )
            print("✅ Saved Nana's memory.")
            
            # Wait for async indexing (if any, though here it's sync)
            await asyncio.sleep(1)

            # 2. Test Pero Retrieval
            print("\n[2/3] Testing Pero's Retrieval (Query: 'name')...")
            pero_results = await MemoryService.get_relevant_memories(
                session=session,
                text="What is my name?",
                limit=10,
                agent_id="pero",
                update_access_stats=False
            )
            
            print(f"🔍 Pero retrieved {len(pero_results)} memories:")
            pero_passed = True
            for m in pero_results:
                print(f"   - [{m.agent_id}] {m.content}")
                if m.agent_id != "pero":
                    print("❌ FAILURE: Pero retrieved non-Pero memory!")
                    pero_passed = False
            
            # Check if Pero found her own memory
            found_pero = any("Pero" in m.content for m in pero_results)
            if not found_pero:
                print("⚠️ WARNING: Pero didn't find her own memory (might be ranking issue).")

            # 3. Test Nana Retrieval
            print("\n[3/3] Testing Nana's Retrieval (Query: 'name')...")
            nana_results = await MemoryService.get_relevant_memories(
                session=session,
                text="What is my name?",
                limit=10,
                agent_id="nana",
                update_access_stats=False
            )
            
            print(f"🔍 Nana retrieved {len(nana_results)} memories:")
            nana_passed = True
            for m in nana_results:
                print(f"   - [{m.agent_id}] {m.content}")
                if m.agent_id != "nana":
                    print("❌ FAILURE: Nana retrieved non-Nana memory!")
                    nana_passed = False
            
            found_nana = any("Nana" in m.content for m in nana_results)
            if not found_nana:
                print("⚠️ WARNING: Nana didn't find her own memory.")

            print("\n" + "="*50)
            if pero_passed and nana_passed:
                print("✅ TEST PASSED: Memory isolation verified.")
            else:
                print("❌ TEST FAILED: Memory isolation failed.")
            print("="*50)

            # Cleanup
            await cleanup_test_memories(session, test_tag)

        except Exception as e:
            print(f"❌ Error during test: {e}")
            import traceback
            traceback.print_exc()
        finally:
            break

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
