CREATE TABLE `provider_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `brand` text NOT NULL,
  `protocol` text DEFAULT 'openai' NOT NULL,
  `api_base` text DEFAULT '' NOT NULL,
  `auth_mode` text DEFAULT 'api_key' NOT NULL,
  `api_key` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_model_configs` ADD `provider_connection_id` text REFERENCES `provider_connections` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `ai_model_configs` ADD `connection_override` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_model_configs` ADD `connection_protocol` text;
--> statement-breakpoint
ALTER TABLE `ai_model_configs` ADD `connection_auth_mode` text DEFAULT 'api_key' NOT NULL;
--> statement-breakpoint
INSERT INTO `provider_connections` (`id`, `name`, `brand`, `protocol`, `api_base`, `auth_mode`, `api_key`)
SELECT 'legacy-global-' || p.brand, p.brand || '（原全局连接）', p.brand,
  CASE WHEN p.brand IN ('anthropic', 'claude') THEN 'anthropic' WHEN p.brand = 'gemini' THEN 'gemini' ELSE 'openai' END,
  COALESCE((SELECT value FROM configs WHERE key = 'global.' || p.brand || '.apiBase'), ''),
  CASE WHEN p.brand = 'ollama' AND COALESCE((SELECT value FROM configs WHERE key = 'global.' || p.brand || '.apiKey'), '') = '' THEN 'none' ELSE 'api_key' END,
  COALESCE((SELECT value FROM configs WHERE key = 'global.' || p.brand || '.apiKey'), '')
FROM (
  SELECT DISTINCT substr(key, 8, length(key) - 14) AS brand FROM configs
  WHERE key LIKE 'global.%.apiKey' AND value <> ''
  UNION
  SELECT DISTINCT substr(key, 8, length(key) - 15) AS brand FROM configs
  WHERE key LIKE 'global.%.apiBase' AND value <> ''
) p;
--> statement-breakpoint
INSERT INTO `provider_connections` (`id`, `name`, `brand`, `protocol`, `api_base`, `auth_mode`, `api_key`)
SELECT 'legacy-model-' || m.id, m.name || '（原独立连接）', COALESCE(m.provider, 'openai'),
  CASE WHEN m.provider IN ('anthropic', 'claude') THEN 'anthropic' WHEN m.provider = 'gemini' THEN 'gemini'
    WHEN m.provider = 'custom' AND m.provider_type IN ('anthropic', 'gemini') THEN m.provider_type ELSE 'openai' END,
  COALESCE(NULLIF(m.api_base, ''), (SELECT value FROM configs WHERE key = 'global.' || COALESCE(m.provider, 'openai') || '.apiBase'), ''),
  CASE WHEN m.provider = 'ollama' AND COALESCE(NULLIF(m.api_key, ''), (SELECT value FROM configs WHERE key = 'global.' || COALESCE(m.provider, 'openai') || '.apiKey'), '') = '' THEN 'none' ELSE 'api_key' END,
  COALESCE(NULLIF(m.api_key, ''), (SELECT value FROM configs WHERE key = 'global.' || COALESCE(m.provider, 'openai') || '.apiKey'), '')
FROM ai_model_configs m
WHERE COALESCE(m.api_base, '') <> '' OR COALESCE(m.api_key, '') <> ''
  OR (m.provider = 'custom' AND m.provider_type IN ('anthropic', 'gemini'))
  OR NOT EXISTS (SELECT 1 FROM provider_connections p WHERE p.id = 'legacy-global-' || COALESCE(m.provider, 'openai'));
--> statement-breakpoint
UPDATE ai_model_configs SET provider_connection_id =
  CASE WHEN EXISTS (SELECT 1 FROM provider_connections p WHERE p.id = 'legacy-model-' || ai_model_configs.id)
    THEN 'legacy-model-' || id ELSE 'legacy-global-' || COALESCE(provider, 'openai') END;
