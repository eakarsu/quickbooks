CREATE TABLE runtime_ai_results (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  feature TEXT NOT NULL,
  prompt TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider='openrouter'),
  model TEXT NOT NULL,
  provider_response_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_runtime_ai_results_user_created ON runtime_ai_results(user_id, created_at DESC);
