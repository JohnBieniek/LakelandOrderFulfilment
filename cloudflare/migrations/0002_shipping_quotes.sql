-- Additive sandbox shipping snapshots. Existing payment orders remain unchanged.
CREATE TABLE payment_shipping_quotes (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  cart_hash TEXT NOT NULL,
  address_json TEXT NOT NULL,
  shipping_cents INTEGER NOT NULL CHECK(shipping_cents >= 0),
  service TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX payment_shipping_quotes_expiry ON payment_shipping_quotes(expires_at);
ALTER TABLE payment_orders ADD COLUMN shipping_quote_id TEXT;
ALTER TABLE payment_orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN shipping_address_json TEXT;
