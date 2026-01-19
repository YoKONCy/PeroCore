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
            statement = select(func.count(Memory.id))
            result = await session.exec(statement)
            db_count = result.one()
            print(f"📊 SQL Database Memories: {db_count}")
            
            # 3. Get Vector Store Count
            print("[2/3] Checking Vector Store...")
            try:
                # Force ensure loaded
                vector_store._ensure_loaded()
                vec_count = vector_store.count_memories()
                print(f"📊 Vector Store Memories: {vec_count}")
            except Exception as e:
                print(f"❌ Vector Store Error: {e}")
                return

            if db_count == vec_count:
                print("\n✅ Counts match! No synchronization needed.")
                return

            print(f"\n⚠️ Mismatch detected! (DB: {db_count} vs Vector: {vec_count})")
            print("🔄 Starting Synchronization...")
            
            # 4. Synchronization (One-way: DB -> Vector)
            # Fetch all memories
            stmt = select(Memory)
            memories = (await session.exec(stmt)).all()
            
            synced_count = 0
            t_start = time.time()
            
            # Batch process
            BATCH_SIZE = 50
            total_batches = (len(memories) + BATCH_SIZE - 1) // BATCH_SIZE
            
            for i in range(0, len(memories), BATCH_SIZE):
                batch = memories[i:i+BATCH_SIZE]
                
                # Check which ones are missing (simple check: try to add all, 
                # vector store should handle updates/duplicates or we just overwrite)
                # Actually, vector_service.add_memory usually overwrites.
                
                # Prepare vectors
                texts = [m.content for m in batch]
                embeddings = embedding_service.encode(texts)
                
                for m, vec in zip(batch, embeddings):
                    if not m.id: continue
                    try:
                        vector_store.add_memory(
                            memory_id=m.id,
                            embedding=vec
                        )
                        synced_count += 1
                    except Exception as ve:
                        print(f"Failed to add memory {m.id}: {ve}")
                
                print(f"   Processed batch {i//BATCH_SIZE + 1}/{total_batches} ({synced_count}/{len(memories)})")
                
            # Save index
            vector_store.save()
            t_end = time.time()
            
            print("\n" + "="*50)
            print(f"✅ Synchronization Complete!")
            print(f"📥 Synced {synced_count} memories.")
            print(f"⏱️ Time: {t_end - t_start:.2f}s")
            print("="*50)

        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            break

if __name__ == "__main__":
    asyncio.run(main())
