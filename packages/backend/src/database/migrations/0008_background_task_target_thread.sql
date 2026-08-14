-- 后台任务发送到对话：记录原聊天 Thread
ALTER TABLE `background_tasks` ADD COLUMN `target_thread_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_tasks_target_thread_id` ON `background_tasks` (`target_thread_id`);
