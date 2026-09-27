CREATE TABLE payment_printful_drafts (
  order_id TEXT PRIMARY KEY REFERENCES payment_orders(id),
  external_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Processing','Retry','Draft','Review')),
  payload_json TEXT,
  printful_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX payment_printful_drafts_pending ON payment_printful_drafts(status,next_attempt_at,lease_until);
