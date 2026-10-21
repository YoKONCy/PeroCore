UPDATE provider_connections
SET name = CASE brand
  WHEN 'openai' THEN 'OpenAI'
  WHEN 'anthropic' THEN 'Anthropic'
  WHEN 'gemini' THEN 'Google Gemini'
  WHEN 'deepseek' THEN 'DeepSeek'
  WHEN 'dashscope' THEN '阿里百炼'
  WHEN 'siliconflow' THEN '硅基流动'
  WHEN 'volcengine' THEN '火山引擎'
  WHEN 'zhipu' THEN '智谱'
  WHEN 'moonshot' THEN 'Moonshot'
  WHEN 'minimax' THEN 'MiniMax'
  WHEN 'hunyuan' THEN '腾讯混元'
  WHEN 'stepfun' THEN '阶跃星辰'
  WHEN 'yi' THEN '零一万物'
  WHEN 'groq' THEN 'Groq'
  WHEN 'mistral' THEN 'Mistral'
  WHEN 'ollama' THEN 'Ollama'
  WHEN 'openrouter' THEN 'OpenRouter'
  WHEN 'xai' THEN 'xAI'
  ELSE brand END
WHERE id = 'legacy-global-' || brand AND name = brand || '（原全局连接）';
--> statement-breakpoint
UPDATE provider_connections
SET name = substr(name, 1, length(name) - length('（原独立连接）'))
WHERE id GLOB 'legacy-model-*' AND name LIKE '%（原独立连接）';
