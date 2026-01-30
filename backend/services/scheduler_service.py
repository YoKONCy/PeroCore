import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
from database import engine
import os

logger = logging.getLogger(__name__)

class SchedulerService:
    """
    Unified Scheduler Service based on APScheduler.
    Manages timed tasks (reminders, alarms, system maintenance).
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SchedulerService, cls).__new__(cls)
            cls._instance.scheduler = None
        return cls._instance

    def initialize(self):
        """Initialize the scheduler with database job store"""
        if self.scheduler:
            return

        # Configure job stores
        # We use the existing SQLAlchemy engine but APScheduler needs a URL or engine
        # SQLAlchemyJobStore works best with a direct URL string usually, but let's try engine if supported or separate
        # To avoid conflict with async engine, we might need a sync URL or a separate connection.
        # For simplicity in MVP, let's use MemoryJobStore or SQLite file for now if async engine is tricky.
        # But Phase 2 requires persistence.
        
        # NOTE: APScheduler 3.x SQLAlchemyJobStore is synchronous. 
        # We need to provide a sync database URL.
        # Assuming sqlite:///./backend/data/pero.db
        
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "pero.db")
        db_url = f"sqlite:///{db_path}"

        jobstores = {
            'default': SQLAlchemyJobStore(url=db_url)
        }
        
        self.scheduler = AsyncIOScheduler(jobstores=jobstores)
        self.scheduler.start()
        logger.info("SchedulerService initialized and started.")

    def add_reminder(self, trigger_time: datetime, content: str, repeat: str = None):
        """
        Add a reminder task.
        :param trigger_time: When to trigger
        :param content: Reminder content
        :param repeat: Repeat rule ('daily', 'weekly', or 'cron: * * * * *')
        """
        trigger = None
        
        if repeat:
            repeat = repeat.lower().strip()
            if repeat == 'daily':
                trigger = CronTrigger(hour=trigger_time.hour, minute=trigger_time.minute, second=trigger_time.second)
            elif repeat == 'weekly':
                trigger = CronTrigger(day_of_week=trigger_time.weekday(), hour=trigger_time.hour, minute=trigger_time.minute, second=trigger_time.second)
            elif repeat.startswith('cron:'):
                # Simple cron parsing "cron: * * * * *"
                cron_str = repeat[5:].strip()
                trigger = CronTrigger.from_crontab(cron_str)
            else:
                # Fallback to date trigger if unknown repeat format or if it's just a one-time request
                trigger = DateTrigger(run_date=trigger_time)
        else:
            trigger = DateTrigger(run_date=trigger_time)

        job = self.scheduler.add_job(
            SchedulerService._trigger_reminder,
            trigger=trigger,
            args=[content],
            name=f"Reminder: {content[:20]}",
            replace_existing=False
        )
        logger.info(f"Added reminder job {job.id} at {trigger_time} (Repeat: {repeat})")
        
        # Broadcast update
        self._broadcast_update("add", {"id": job.id, "content": content, "next_run_time": str(job.next_run_time)})
        
        return job.id

    def list_jobs(self):
        """List all active jobs"""
        if not self.scheduler: return []
        return self.scheduler.get_jobs()

    def remove_job(self, job_id: str):
        """Remove a job by ID"""
        if self.scheduler:
            try:
                self.scheduler.remove_job(job_id)
                self._broadcast_update("remove", {"id": job_id})
            except Exception as e:
                logger.warning(f"Failed to remove job {job_id}: {e}")

    def _broadcast_update(self, operation: str, data: dict):
        """Broadcast schedule update event"""
        try:
            from services.gateway_client import gateway_client
            from proto import perolink_pb2
            import uuid
            import time
            import asyncio

            # Ensure we are in an event loop (this might be called from sync code)
            # APScheduler callbacks are usually in thread pool if sync, but here we are in service methods.
            # Assuming add_reminder is called from async context (FastAPI).
            
            async def _send():
                envelope = perolink_pb2.Envelope()
                envelope.id = str(uuid.uuid4())
                envelope.source_id = "scheduler"
                envelope.target_id = "broadcast"
                envelope.timestamp = int(time.time() * 1000)
                
                envelope.request.action_name = "schedule_update"
                envelope.request.params["operation"] = operation
                envelope.request.params["data"] = str(data) # Simple JSON string or just fields
                
                await gateway_client.send(envelope)

            # Check if there is a running loop
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_send())
            except RuntimeError:
                # No running loop, create one (rare case for service methods called from scripts)
                asyncio.run(_send())
        except Exception as e:
            logger.error(f"Failed to broadcast schedule update: {e}")

    @staticmethod
    async def _trigger_reminder(content: str):
        """
        Callback when reminder is triggered.
        Broadcasts 'action:reminder_trigger' to Gateway.
        """
        logger.info(f"TRIGGER REMINDER: {content}")
        
        from services.gateway_client import gateway_client
        from proto import perolink_pb2
        import uuid
        import time

        envelope = perolink_pb2.Envelope()
        envelope.id = str(uuid.uuid4())
        envelope.source_id = "scheduler"
        envelope.target_id = "broadcast"
        envelope.timestamp = int(time.time() * 1000)
        
        # Construct ActionRequest for reminder
        envelope.request.action_name = "reminder_trigger"
        envelope.request.params["content"] = content
        envelope.request.params["timestamp"] = datetime.now().isoformat()
        
        await gateway_client.send(envelope)

scheduler_service = SchedulerService()
import os
