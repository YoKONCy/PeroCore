-- 文档原文与语义切片；检索索引和 ripgrep 文本镜像可重建。
CREATE TABLE `knowledge_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `source_kind` text NOT NULL,
  `source` text DEFAULT '' NOT NULL,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `token_count` integer NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `vector_status` text DEFAULT 'skipped' NOT NULL,
  `model_name` text,
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_document_status` ON `knowledge_documents` (`status`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `knowledge_parts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `document_id` text NOT NULL REFERENCES `knowledge_documents`(`id`) ON DELETE cascade,
  `ordinal` integer NOT NULL,
  `title` text NOT NULL,
  `summary` text NOT NULL,
  `keywords_json` text NOT NULL,
  `start_offset` integer NOT NULL,
  `end_offset` integer NOT NULL,
  `token_count` integer NOT NULL,
  `embedding_json` text,
  `embedding_key` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_part_ordinal` ON `knowledge_parts` (`document_id`, `ordinal`);
