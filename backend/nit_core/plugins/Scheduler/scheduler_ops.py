from typing import Optional
from datetime import datetime, timedelta
import dateparser
from services.scheduler_service import scheduler_service

async def add_reminder(time: str, content: str, repeat_rule: str = None) -> str:
    """
    添加一个定时提醒。
    :param time: 触发时间，支持自然语言（如 "10分钟后"、"明天早上8点"）
    :param content: 提醒的内容
    :param repeat_rule: 重复规则（可选）。支持 "daily" (每天), "weekly" (每周), 或 "cron: * * * * *" (Cron表达式)
    :return: 任务 ID 或错误信息
    """
    try:
        # 使用 dateparser 解析自然语言时间
        # 设置 settings={'PREFER_DATES_FROM': 'future'} 倾向于未来时间
        trigger_time = dateparser.parse(time, settings={'PREFER_DATES_FROM': 'future', 'RELATIVE_BASE': datetime.now()})
        
        if not trigger_time:
            return "Error: 无法解析时间，请使用更清晰的格式（如 'YYYY-MM-DD HH:MM' 或 '10分钟后'）。"
            
        if trigger_time <= datetime.now():
            return "Error: 触发时间必须是未来时间。"

        job_id = scheduler_service.add_reminder(trigger_time, content, repeat=repeat_rule)
        return f"Success: 已添加提醒 '{content}'，将在 {trigger_time.strftime('%Y-%m-%d %H:%M:%S')} 触发 (ID: {job_id})。"
    except Exception as e:
        return f"Error: 添加提醒失败: {str(e)}"

async def list_reminders() -> str:
    """
    列出当前所有待执行的提醒。
    """
    jobs = scheduler_service.list_jobs()
    if not jobs:
        return "当前没有待执行的提醒任务。"
        
    result = "【待执行提醒列表】:\n"
    for job in jobs:
        next_run = job.next_run_time.strftime('%Y-%m-%d %H:%M:%S') if job.next_run_time else "N/A"
        result += f"- [{job.id}] {job.name} (触发时间: {next_run})\n"
    return result

async def delete_reminder(id: str) -> str:
    """
    删除指定的提醒任务。
    :param id: 任务 ID
    """
    try:
        scheduler_service.remove_job(id)
        return f"Success: 已删除任务 {id}。"
    except Exception:
        return f"Error: 未找到 ID 为 {id} 的任务。"
