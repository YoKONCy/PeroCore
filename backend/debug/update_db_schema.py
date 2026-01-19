import sqlite3
import os

db_path = r"c:\Users\Administrator\Desktop\Perofamily\PeroCore\backend\data\perocore.db"

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Check if column exists
    cursor.execute("PRAGMA table_info(conversationlog)")
    columns = [info[1] for info in cursor.fetchall()]
    if "raw_content" in columns:
        print("Column 'raw_content' already exists.")
    else:
        cursor.execute("ALTER TABLE conversationlog ADD COLUMN raw_content TEXT")
        conn.commit()
        print("Column 'raw_content' added successfully.")
except Exception as e:
    print(f"Error: {e}")
finally:
    if 'conn' in locals() and conn:
        conn.close()
