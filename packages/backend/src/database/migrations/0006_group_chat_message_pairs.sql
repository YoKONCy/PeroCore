ALTER TABLE `group_chat_messages` ADD COLUMN `pair_id` text;
--> statement-breakpoint
CREATE INDEX `idx_group_chat_messages_pair_id` ON `group_chat_messages` (`pair_id`);
