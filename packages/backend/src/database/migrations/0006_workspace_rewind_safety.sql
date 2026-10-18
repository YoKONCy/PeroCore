ALTER TABLE `file_change_snapshots` ADD `history_continuous` integer DEFAULT true;
--> statement-breakpoint
UPDATE `file_change_snapshots` SET `history_continuous` = NULL;
