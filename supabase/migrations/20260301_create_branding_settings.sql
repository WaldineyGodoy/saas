-- Create branding_settings table
create table if not exists public.branding_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default 'B2W Energia',
  logo_url text,
  primary_color text not null default '#003366',
  secondary_color text not null default '#FF6600',
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.branding_settings enable row level security;

-- Create policy to allow all authenticated users to read
create policy "Allow authenticated users to read branding"
  on public.branding_settings
  for select
  to authenticated
  using (true);

-- Create policy to allow admins to update
create policy "Allow admins to update branding"
  on public.branding_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

-- Create policy to allow admins to insert
create policy "Allow admins to insert branding"
  on public.branding_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

-- Insert initial row if not exists
insert into public.branding_settings (company_name, primary_color, secondary_color)
values ('B2W Energia', '#003366', '#FF6600')
on conflict do nothing;

-- Create branding bucket if it doesn't exist (if you have permissions to run this in migration)
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- Set up storage policies for branding bucket
create policy "Public Access to Branding"
  on storage.objects for select
  using ( bucket_id = 'branding' );

create policy "Admins can upload to Branding"
  on storage.objects for insert
  with check (
    bucket_id = 'branding' 
    and (select auth.jwt()->>'role' = 'authenticated')
  );

create policy "Admins can delete from Branding"
  on storage.objects for delete
  using ( bucket_id = 'branding' );
