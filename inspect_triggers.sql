-- List all triggers
SELECT event_object_table, trigger_name, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public';

-- List the content of handle_new_user if exists
select pg_get_functiondef('public.handle_new_user'::regproc);
