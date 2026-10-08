-- 0004: ticket category (set by an agent, optionally from an AI suggestion).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category text
  CHECK (category IN ('billing', 'technical', 'account', 'feature_request', 'other'));
