-- 0003: SLA. Each ticket gets a due date (from its priority) and the moment it was resolved.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- existing tickets: same rule the API uses (see src/domain/sla.ts)
UPDATE tickets
SET due_at = created_at + CASE priority
  WHEN 'urgent' THEN interval '4 hours'
  WHEN 'high' THEN interval '8 hours'
  WHEN 'medium' THEN interval '24 hours'
  ELSE interval '72 hours'
END
WHERE due_at IS NULL;

UPDATE tickets SET resolved_at = updated_at WHERE resolved_at IS NULL AND status IN ('resolved', 'closed');

ALTER TABLE tickets ALTER COLUMN due_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_org_due_idx ON tickets (organization_id, due_at) WHERE resolved_at IS NULL;
