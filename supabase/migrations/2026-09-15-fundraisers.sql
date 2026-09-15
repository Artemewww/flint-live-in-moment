-- Командные сборы: сначала заявка на перевод, затем подтверждение костяком.
CREATE TABLE IF NOT EXISTS fundraisers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  goal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deadline DATE NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  payment_card TEXT NOT NULL DEFAULT '',
  payment_note TEXT NOT NULL DEFAULT '',
  points_per_100 NUMERIC(10,2) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','closed')),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fundraiser_pledges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id UUID NOT NULL REFERENCES fundraisers(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS fundraiser_pledges_one_pending
  ON fundraiser_pledges(fundraiser_id, telegram_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS fundraiser_pledges_fundraiser_idx ON fundraiser_pledges(fundraiser_id, created_at DESC);
ALTER TABLE fundraisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundraiser_pledges ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_fundraisers_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS fundraisers_updated_at ON fundraisers;
CREATE TRIGGER fundraisers_updated_at BEFORE UPDATE ON fundraisers
FOR EACH ROW EXECUTE FUNCTION update_fundraisers_updated_at();