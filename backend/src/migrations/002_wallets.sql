-- Migration 002: User Wallet System for BITBRICK
-- Adds wallet balance tracking, transaction history, and exchange rates

-- User wallet balance (holds sats)
CREATE TABLE IF NOT EXISTS user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
  balance_sats BIGINT DEFAULT 0 CHECK (balance_sats >= 0),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Transaction history for auditing
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'buy_in', 'payout', 'withdrawal')),
  amount_sats BIGINT NOT NULL,
  amount_usd DECIMAL(10,2),
  exchange_rate DECIMAL(12,4), -- sats per USD at time of tx
  payment_hash VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Exchange rate cache
CREATE TABLE IF NOT EXISTS exchange_rates (
  id SERIAL PRIMARY KEY,
  btc_usd DECIMAL(12,2) NOT NULL,
  sats_per_usd DECIMAL(12,4) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_fetched ON exchange_rates(fetched_at DESC);

-- Function to update wallet balance
CREATE OR REPLACE FUNCTION update_wallet_balance(
  p_user_id UUID,
  p_amount BIGINT,
  p_type VARCHAR(20),
  p_description TEXT DEFAULT NULL,
  p_payment_hash VARCHAR(255) DEFAULT NULL
) RETURNS TABLE(new_balance BIGINT, transaction_id UUID) AS $$
DECLARE
  v_wallet_id UUID;
  v_new_balance BIGINT;
  v_tx_id UUID;
BEGIN
  -- Get or create wallet
  INSERT INTO user_wallets (user_id, balance_sats)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Update balance
  UPDATE user_wallets
  SET balance_sats = balance_sats + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance_sats INTO v_new_balance;

  -- Check for negative balance (shouldn't happen with CHECK constraint)
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Record transaction
  INSERT INTO transactions (user_id, type, amount_sats, status, description, payment_hash, completed_at)
  VALUES (p_user_id, p_type, p_amount, 'completed', p_description, p_payment_hash, NOW())
  RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_new_balance, v_tx_id;
END;
$$ LANGUAGE plpgsql;
