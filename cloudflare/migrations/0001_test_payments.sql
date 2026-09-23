-- Separate sandbox ledger. No production fulfillment consumer uses these tables.
CREATE TABLE payment_orders (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal')),
  cart_hash TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency = 'USD'),
  status TEXT NOT NULL DEFAULT 'PendingPayment' CHECK(status IN ('PendingPayment', 'Paid', 'Canceled', 'Review')),
  provider_id TEXT,
  approval_url TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_id)
);
CREATE TABLE payment_original_reservations (
  product_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES payment_orders(id)
);
CREATE INDEX payment_reservations_order ON payment_original_reservations(order_id);
CREATE INDEX payment_orders_owner ON payment_orders(owner_hash);
CREATE TABLE payment_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders(id),
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(provider, event_id)
);
CREATE TABLE payment_test_outbox (
  order_id TEXT PRIMARY KEY REFERENCES payment_orders(id),
  event_type TEXT NOT NULL CHECK(event_type = 'BetaPaymentRecorded'),
  created_at INTEGER NOT NULL
);
