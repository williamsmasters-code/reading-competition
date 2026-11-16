; Set the live competition date and start time to match the official event flyer.
-- event_settings is a single-row table (id = 1).
-- Do not run until Daniel approves. This file does not change venue (shown only on the flyer).
begin;
update public.event_settings
   set event_date = date '2026-11-19',
       start_time = time '09:00',
       updated_at = now()
 where id = 1;
commit;
