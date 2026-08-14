-- M05 任务输入、常驻任务与 ReAct checkpoint 扩展
ALTER TABLE `background_tasks` ADD COLUMN `category` text DEFAULT 'agent_task' NOT NULL;
--> statement-breakpoint
ALTER TABLE `background_tasks` ADD COLUMN `input_question` text;
--> statement-breakpoint
ALTER TABLE `background_tasks` ADD COLUMN `input_context_json` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_tasks_category` ON `background_tasks` (`category`);
