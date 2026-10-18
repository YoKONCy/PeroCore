CREATE TABLE `task_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text,
	`task_revision` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`steps_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_plans_thread` ON `task_plans` (`thread_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `plan_id` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `plan_step_id` text;
--> statement-breakpoint
-- 旧任务的段末清单迁入统一计划，原任务 ID 与修订保留。
INSERT INTO task_plans (id, thread_id, agent_id, task_id, task_revision, title, steps_json, created_at, updated_at)
SELECT 'legacy-plan:' || task.id, task.thread_id, task.agent_id, task.id, task.revision,
       substr(task.title, 1, 120),
       (SELECT json_group_array(json_object(
          'id', 'step-' || (CAST(step.key AS INTEGER) + 1),
          'title', json_extract(step.value, '$.title'),
          'status', CASE WHEN json_extract(step.value, '$.done') = 1 THEN 'completed' ELSE 'pending' END
        )) FROM json_each(task.lifecycle_json, '$.plan') AS step),
       task.created_at, task.updated_at
FROM background_tasks AS task
WHERE json_array_length(CASE WHEN json_valid(task.lifecycle_json) THEN task.lifecycle_json ELSE '{}' END, '$.plan') > 0;
--> statement-breakpoint
UPDATE background_tasks
SET lifecycle_json = json_set(lifecycle_json, '$.plan', json('[]'))
WHERE json_array_length(CASE WHEN json_valid(lifecycle_json) THEN lifecycle_json ELSE '{}' END, '$.plan') > 0;
