-- A terminal status for work the editor decides not to publish.
--
-- A new enum value cannot be used in the transaction that adds it, so its transitions and the
-- function that reaches it follow in 20260921140100_discard_job.sql.

alter type public.job_status add value if not exists 'DISCARDED';
