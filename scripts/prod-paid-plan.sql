-- Production only: Odds API paid plan, 20,000 credits/month (local/tests stay on the free-tier 500/400).
-- Cap 18,000 leaves a 2,000-credit buffer; 2,000 credits are protected for scores/finals.
-- Paid calls stay OFF: this does not touch odds_paid_calls_enabled.
update private.app_settings set value = '20000' where key = 'odds_monthly_quota';
update private.app_settings set value = '18000' where key = 'odds_monthly_cap';
update private.app_settings set value = '2000' where key = 'odds_settlement_credits';
