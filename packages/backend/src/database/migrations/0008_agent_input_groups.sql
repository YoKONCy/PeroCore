ALTER TABLE `agent_input_requests` ADD `questions_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_input_requests` ADD `answers_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE `agent_input_requests`
SET `questions_json` = json_array(json_object(
  'id', 'question', 'question', `question`,
  'options', json(`options_json`), 'multiple', json('true'),
  'allowFreeText', json(CASE WHEN `allow_free_text` = 1 THEN 'true' ELSE 'false' END)
));
--> statement-breakpoint
UPDATE `agent_input_requests`
SET `answers_json` = json_array(json_object(
  'questionId', 'question', 'selectedOptionIds', json(`selected_option_ids_json`),
  'message', coalesce(`response_message`, '')
)) WHERE `status` = 'answered';
