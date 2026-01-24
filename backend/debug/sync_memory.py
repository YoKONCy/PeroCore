import asyncio
import os
import sys
import time
from datetime import datetime
from sqlmodel import select, func
from sqlalchemy.orm import selectinload

# Setup path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from database import init_db, get_session
from models import Memory
from services.vector_store_service import VectorStoreService, vector_store
from services.embedding_service import embedding_service

async def main():
    print("="*50)
    print("🚀 Memory Synchronization Tool")
    print("="*50)

    # 1. Init
    await init_db()
    embedding_service.warm_up()
    
    # 2. Get DB Count
    async for session in get_session():
        try:
            print("[1/3] Checking SQL Database...")
            # Get distinct agent_ids
            agent_ids_result = await session.exec(select(Memory.agent_id).distinct())
            agent_ids = agent_ids_result.all()
            # Handle None agent_id if any (should default to 'pero')
            agent_ids = [aid if aid else 'pero' for aid in agent_ids]
            agent_ids = list(set(agent_ids)) # Unique
            
            if not agent_ids:
                agent_ids = ['pero']
                
            print(f"Found agents: {agent_ids}")

            for agent_id in agent_ids:
                print(f"\n--- Syncing Agent: {agent_id} ---")
                statement = select(func.count(Memory.id)).where(Memory.agent_id == agent_id)
                result = await session.exec(statement)
                db_count = result.one()
                print(f"📊 SQL Database Memories ({agent_id}): {db_count}")
                
                # 3. Get Vector Store Count
                print(f"[2/3] Checking Vector Store ({agent_id})...")
                try:
                    # Force ensure loaded
                    vector_store._ensure_loaded()
                    vec_count = vector_store.count_memories(agent_id=agent_id)
                    print(f"📊 Vector Store Memories ({agent_id}): {vec_count}")
                except Exception as e:
                    print(f"❌ Vector Store Error: {e}")
                    continue

                if db_count == vec_count:
                    print(f"✅ Counts match for {agent_id}! No synchronization needed.")
                    continue

                print(f"⚠️ Mismatch detected for {agent_id}! (DB: {db_count} vs Vector: {vec_count})")
                print("🔄 Starting Synchronization...")
                
                # 4. Synchronization (One-way: DB -> Vector)
                # Fetch all memories for this agent
                stmt = select(Memory).where(Memory.agent_id == agent_id)
                memories = (await session.exec(stmt)).all()
                
                synced_count = 0
                t_start = time.time()
                
                # Batch process
                BATCH_SIZE = 50
                total_batches = (len(memories) + BATCH_SIZE - 1) // BATCH_SIZE
                
                for i in range(0, len(memories), BATCH_SIZE):
                    batch = memories[i:i+BATCH_SIZE]
                    
                    # Prepare vectors
                    texts = [m.content for m in batch]
                    embeddings = embedding_service.encode(texts)
                    
                    for m, vec in zip(batch, embeddings):
                        if not m.id: continue
                        try:
                            vector_store.add_memory(
                                memory_id=m.id,
                                embedding=vec,
                                metadata={"agent_id": agent_id}
                            )
                            synced_count += 1
                        except Exception as ve:
                            print(f"Failed to add memory {m.id}: {ve}")
                    
                    print(f"   Processed batch {i//BATCH_SIZE + 1}/{total_batches} ({synced_count}/{len(memories)})")
                
                # Save index
                vector_store.save()
                t_end = time.time()
                print(f"✅ Synced {synced_count} memories for {agent_id} in {t_end - t_start:.2f}s")

            print("\n" + "="*50)
            print(f"✅ All Agents Synchronization Complete!")
            print("="*50)

        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            break

if __name__ == "__main__":
    asyncio.run(main())
