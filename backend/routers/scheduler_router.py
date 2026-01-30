from fastapi import APIRouter, Body, HTTPException, Depends
from typing import List, Dict, Any
from services.scheduler_service import scheduler_service
from datetime import datetime
import dateparser

router = APIRouter()

@router.post("/sync")
async def sync_reminders(
    payload: Dict[str, Any] = Body(...)
):
    """
    接收移动端/其他端同步过来的 XML 解析结果，将其注册到后端调度器。
    Payload example:
    {
        "source": "mobile",
        "reminders": [
            {
                "content": "提醒我喝水",
                "time": "2024-01-01 12:00:00"
            }
        ]
    }
    """
    reminders = payload.get("reminders", [])
    source = payload.get("source", "unknown")
    
    results = []
    
    for item in reminders:
        content = item.get("content")
        time_str = item.get("time")
        repeat = item.get("repeat") # Optional repeat rule
        
        if not content or not time_str:
            continue
            
        try:
            # 解析时间
            trigger_time = dateparser.parse(time_str)
            if not trigger_time:
                results.append({"status": "error", "message": f"Invalid time format: {time_str}"})
                continue
                
            if trigger_time <= datetime.now() and not repeat:
                # Only skip past times if it's not a repeating task (repeating tasks might be set for 'every morning' starting from past)
                # But for simplicity, let's just warn or allow. APScheduler might fire immediately if misconfigured.
                # Actually, if I set a repeat task for 8am and it's 9am, it should fire next day.
                # But trigger_time is usually the start date.
                # Let's keep the check for one-time tasks.
                results.append({"status": "skipped", "message": "Time is in the past"})
                continue
                
            # 添加到调度器
            job_id = scheduler_service.add_reminder(trigger_time, content, repeat=repeat)
            results.append({"status": "success", "job_id": job_id, "content": content})
            
        except Exception as e:
            results.append({"status": "error", "message": str(e)})
            
    return {"status": "completed", "results": results}
