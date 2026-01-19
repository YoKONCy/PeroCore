import sqlite3
import os

db_path = r"c:\Users\Administrator\Desktop\Perofamily\PeroCore\backend\data\perocore.db"

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Check if column exists
    cursor.execute("PRAGMA table_info(conversationlog)")
    columns = [info[1] for info in cursor.fetchall()]
    
    if "agent_id" in columns:
        print("'agent_id' 列已存在于 conversationlog 表中。")
    else:
        cursor.execute("ALTER TABLE conversationlog ADD COLUMN agent_id TEXT DEFAULT 'pero'")
        conn.commit()
        print("'agent_id' 列已成功添加到 conversationlog 表。")

    if "raw_content" in columns:
        print("'raw_content' 列已存在于 conversationlog 表中。")
    else:
        cursor.execute("ALTER TABLE conversationlog ADD COLUMN raw_content TEXT")
        conn.commit()
        print("'raw_content' 列已成功添加到 conversationlog 表。")

    # Check petstate table
    cursor.execute("PRAGMA table_info(petstate)")
    columns_pet = [info[1] for info in cursor.fetchall()]
    
    if "agent_id" in columns_pet:
        print("'agent_id' 列已存在于 petstate 表中。")
    else:
        cursor.execute("ALTER TABLE petstate ADD COLUMN agent_id TEXT DEFAULT 'pero'")
        conn.commit()
        print("'agent_id' 列已成功添加到 petstate 表。")

except Exception as e:
    print(f"错误: {e}")
finally:
    if 'conn' in locals() and conn:
        conn.close()
