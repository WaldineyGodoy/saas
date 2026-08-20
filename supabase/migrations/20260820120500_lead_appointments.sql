CREATE TABLE IF NOT EXISTS lead_appointments (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
    appointment_date date NOT NULL,
    appointment_time time NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pendente',
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    created_by uuid REFERENCES auth.users(id)
);
