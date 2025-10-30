-- Add new columns to trades table for team acceptance tracking
ALTER TABLE trades
ADD COLUMN IF NOT EXISTS accepted_date TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS accepted_by INT NULL,
ADD COLUMN IF NOT EXISTS rejected_date TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS rejected_by INT NULL,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;

-- Add foreign key constraints for the new user reference columns
ALTER TABLE trades
ADD CONSTRAINT fk_trades_accepted_by FOREIGN KEY (accepted_by) REFERENCES users(user_id) ON DELETE SET NULL,
ADD CONSTRAINT fk_trades_rejected_by FOREIGN KEY (rejected_by) REFERENCES users(user_id) ON DELETE SET NULL;