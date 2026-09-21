-- Codex image generation on the owner's ChatGPT subscription.
--
-- A new enum value cannot be used in the transaction that adds it, so the rules that accept it
-- follow in 20260921130100_codex_image_mode_rules.sql.

alter type public.provider_mode add value if not exists 'codex_image';
