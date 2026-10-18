ALTER TABLE `threads` ADD `interaction_mode` text DEFAULT 'chat' NOT NULL;
--> statement-breakpoint
UPDATE `threads` SET `interaction_mode` = 'work';
