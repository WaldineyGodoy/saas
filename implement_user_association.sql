-- 1. Ensure tables have 'user_id' column to link with auth.users
ALTER TABLE public.originators ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Check and add for suppliers if table exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'suppliers') THEN
        ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 2. Create or Replace the Trigger Function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    matched_role TEXT := 'visitor'; -- Default role
    is_originator BOOLEAN := FALSE;
    is_subscriber BOOLEAN := FALSE;
    is_supplier BOOLEAN := FALSE;
    user_name TEXT;
BEGIN
    user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email);

    -- 1. Check Originators
    -- Note: handling email case sensitivity usually requires Lower(), but we assume exact match for now or update logic
    IF EXISTS (SELECT 1 FROM public.originators WHERE email = NEW.email) THEN
        UPDATE public.originators SET user_id = NEW.id WHERE email = NEW.email;
        matched_role := 'originator';
        is_originator := TRUE;
        -- Optional: Update name from originator record if profile name is generic?
    END IF;

    -- 2. Check Subscribers
    IF NOT is_originator AND EXISTS (SELECT 1 FROM public.subscribers WHERE email = NEW.email) THEN
        UPDATE public.subscribers SET user_id = NEW.id WHERE email = NEW.email;
        matched_role := 'subscriber';
        is_subscriber := TRUE;
    END IF;

    -- 3. Check Suppliers (Dynamic check to avoid error if table missing)
    IF NOT is_originator AND NOT is_subscriber AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'suppliers') THEN
         EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.suppliers WHERE email = $1)' INTO is_supplier USING NEW.email;
         IF is_supplier THEN
            EXECUTE 'UPDATE public.suppliers SET user_id = $1 WHERE email = $2' USING NEW.id, NEW.email;
            matched_role := 'supplier';
         END IF;
    END IF;

    -- 4. Create Profile Entry
    -- Using ON CONFLICT DO UPDATE in case profile already exists (e.g. if manually created)
    INSERT INTO public.profiles (id, email, name, role)
    VALUES (
        NEW.id,
        NEW.email,
        user_name,
        matched_role
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        role = CASE 
            WHEN profiles.role = 'visitor' OR profiles.role IS NULL THEN EXCLUDED.role 
            ELSE profiles.role -- Keep existing role if it was already set to something specific
        END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Ensure Trigger is Valid
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
