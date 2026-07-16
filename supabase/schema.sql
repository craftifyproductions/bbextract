-- BBExtract Supabase schema
-- Paste this into the Supabase SQL Editor (Dashboard → SQL → New query)

-- ---------------------------------------------------------------------------
-- Extraction runs (session logs)
-- ---------------------------------------------------------------------------
create table if not exists public.extraction_runs (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  user_email text,
  filename text not null,
  created_at timestamptz not null default now(),
  file_count integer not null default 0,
  success_count integer not null default 0,
  error_count integer not null default 0,
  content text not null default '',
  source text not null default 'browser'
);

alter table public.extraction_runs
  add column if not exists user_id uuid default auth.uid();

alter table public.extraction_runs
  add column if not exists user_email text;

alter table public.extraction_runs
  alter column user_id set default auth.uid();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'extraction_runs_content_size_check'
  ) then
    alter table public.extraction_runs
      add constraint extraction_runs_content_size_check
      check (octet_length(content) <= 5242880) not valid;
  end if;
end $$;

create index if not exists extraction_runs_created_at_idx
  on public.extraction_runs (created_at desc);

create index if not exists extraction_runs_user_id_created_at_idx
  on public.extraction_runs (user_id, created_at desc);

-- Per-model rows for a run (optional detail; populated when saving from the app)
create table if not exists public.run_models (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.extraction_runs (id) on delete cascade,
  model_name text not null,
  original_filename text not null,
  status text not null check (status in ('done', 'error', 'processing')),
  element_count integer,
  bone_count integer,
  texture_count integer,
  animation_count integer,
  extracted_bytes bigint,
  error_message text,
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists run_models_run_id_idx on public.run_models (run_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'run_models_counts_check'
  ) then
    alter table public.run_models
      add constraint run_models_counts_check
      check (
        coalesce(element_count, 0) >= 0
        and coalesce(bone_count, 0) >= 0
        and coalesce(texture_count, 0) >= 0
        and coalesce(animation_count, 0) >= 0
        and coalesce(extracted_bytes, 0) >= 0
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: signed-in users share the library, writes stay user-owned.
-- ---------------------------------------------------------------------------
alter table public.extraction_runs enable row level security;
alter table public.run_models enable row level security;

revoke all on public.extraction_runs from anon;
revoke all on public.run_models from anon;
grant select, insert, update on public.extraction_runs to authenticated;
grant select, insert on public.run_models to authenticated;

drop policy if exists "bbextract_runs_select" on public.extraction_runs;
drop policy if exists "bbextract_runs_insert" on public.extraction_runs;
drop policy if exists "bbextract_runs_update" on public.extraction_runs;
drop policy if exists "bbextract_run_models_select" on public.run_models;
drop policy if exists "bbextract_run_models_insert" on public.run_models;

create policy "bbextract_runs_select"
  on public.extraction_runs for select
  using (auth.uid() = user_id);

create policy "bbextract_runs_insert"
  on public.extraction_runs for insert
  with check (auth.uid() = user_id);

create policy "bbextract_runs_update"
  on public.extraction_runs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bbextract_run_models_select"
  on public.run_models for select
  using (
    exists (
      select 1
      from public.extraction_runs
      where extraction_runs.id = run_models.run_id
        and extraction_runs.user_id = auth.uid()
    )
  );

create policy "bbextract_run_models_insert"
  on public.run_models for insert
  with check (
    exists (
      select 1
      from public.extraction_runs
      where extraction_runs.id = run_models.run_id
        and extraction_runs.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage bucket + extracted file metadata
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bbextract',
  'bbextract',
  false,
  104857600,
  array[
    'application/json',
    'application/zip',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.extracted_models (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.extraction_runs (id) on delete set null,
  user_id uuid not null default auth.uid(),
  user_email text,
  model_name text not null,
  original_filename text not null,
  file_hash text not null,
  folder_name text,
  original_size_bytes bigint,
  extracted_size_bytes bigint,
  element_count integer,
  bone_count integer,
  texture_count integer,
  animation_count integer,
  model_zip_path text,
  created_at timestamptz not null default now()
);

alter table public.extracted_models
  add column if not exists user_email text;

create unique index if not exists extracted_models_file_hash_idx
  on public.extracted_models (file_hash);

create index if not exists extracted_models_user_id_created_at_idx
  on public.extracted_models (user_id, created_at desc);

alter table public.extracted_models enable row level security;

revoke all on public.extracted_models from anon;
grant select, insert, update, delete on public.extracted_models to authenticated;

drop policy if exists "bbextract_extracted_models_select" on public.extracted_models;
drop policy if exists "bbextract_extracted_models_insert" on public.extracted_models;
drop policy if exists "bbextract_extracted_models_update" on public.extracted_models;
drop policy if exists "bbextract_extracted_models_delete" on public.extracted_models;

create policy "bbextract_extracted_models_select"
  on public.extracted_models for select
  using (auth.role() = 'authenticated');

create policy "bbextract_extracted_models_insert"
  on public.extracted_models for insert
  with check (auth.uid() = user_id);

create policy "bbextract_extracted_models_update"
  on public.extracted_models for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bbextract_extracted_models_delete"
  on public.extracted_models for delete
  using (auth.uid() = user_id);

create table if not exists public.extracted_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.extraction_runs (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  user_email text,
  model_name text not null,
  file_kind text not null check (
    file_kind in ('model_zip', 'texture', 'json', 'animation', 'element', 'geometry', 'metadata', 'summary', 'raw_model')
  ),
  filename text not null,
  storage_bucket text not null default 'bbextract',
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.extracted_files
    drop constraint if exists extracted_files_file_kind_check;

  alter table public.extracted_files
    add constraint extracted_files_file_kind_check
    check (
      file_kind in ('model_zip', 'texture', 'json', 'animation', 'element', 'geometry', 'metadata', 'summary', 'raw_model')
    ) not valid;
end $$;

alter table public.extracted_files
  add column if not exists user_email text;

create unique index if not exists extracted_files_storage_path_idx
  on public.extracted_files (storage_bucket, storage_path);

create index if not exists extracted_files_run_id_idx
  on public.extracted_files (run_id);

create index if not exists extracted_files_user_id_created_at_idx
  on public.extracted_files (user_id, created_at desc);

alter table public.extracted_files enable row level security;

revoke all on public.extracted_files from anon;
grant select, insert, update, delete on public.extracted_files to authenticated;

drop policy if exists "bbextract_extracted_files_select" on public.extracted_files;
drop policy if exists "bbextract_extracted_files_insert" on public.extracted_files;
drop policy if exists "bbextract_extracted_files_update" on public.extracted_files;
drop policy if exists "bbextract_extracted_files_delete" on public.extracted_files;

create policy "bbextract_extracted_files_select"
  on public.extracted_files for select
  using (auth.role() = 'authenticated');

create policy "bbextract_extracted_files_insert"
  on public.extracted_files for insert
  with check (auth.uid() = user_id);

create policy "bbextract_extracted_files_update"
  on public.extracted_files for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bbextract_extracted_files_delete"
  on public.extracted_files for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- User activity audit log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  user_email text,
  action text not null,
  subject text,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_events
  add column if not exists user_email text;

create index if not exists audit_events_user_id_created_at_idx
  on public.audit_events (user_id, created_at desc);

alter table public.audit_events enable row level security;

revoke all on public.audit_events from anon;
grant select, insert on public.audit_events to authenticated;

drop policy if exists "bbextract_audit_events_select" on public.audit_events;
drop policy if exists "bbextract_audit_events_insert" on public.audit_events;

create policy "bbextract_audit_events_select"
  on public.audit_events for select
  using (auth.uid() = user_id);

create policy "bbextract_audit_events_insert"
  on public.audit_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "bbextract_storage_select" on storage.objects;
drop policy if exists "bbextract_storage_insert" on storage.objects;
drop policy if exists "bbextract_storage_update" on storage.objects;
drop policy if exists "bbextract_storage_delete" on storage.objects;

create policy "bbextract_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'bbextract'
    and auth.role() = 'authenticated'
  );

create policy "bbextract_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'bbextract'
    and auth.role() = 'authenticated'
    and owner = auth.uid()
  );

create policy "bbextract_storage_update"
  on storage.objects for update
  using (
    bucket_id = 'bbextract'
    and auth.role() = 'authenticated'
    and owner = auth.uid()
  )
  with check (
    bucket_id = 'bbextract'
    and auth.role() = 'authenticated'
    and owner = auth.uid()
  );

create policy "bbextract_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'bbextract'
    and auth.role() = 'authenticated'
    and owner = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.extraction_runs;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.extracted_models;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.extracted_files;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.audit_events;
exception
  when duplicate_object then null;
end $$;

-- Storage object realtime may already be managed by Supabase. If this block errors
-- because storage.objects cannot be added in your project, remove this block; the app
-- also refreshes on focus and every 10 seconds.
do $$
begin
  alter publication supabase_realtime add table storage.objects;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Runtime permissions repair
-- ---------------------------------------------------------------------------
-- Keep this at the end so re-running the schema fixes older projects where the
-- tables already existed but role grants were missing.
grant usage on schema public to authenticated;
grant select, insert, update on public.extraction_runs to authenticated;
grant select, insert on public.run_models to authenticated;
grant select, insert, update, delete on public.extracted_models to authenticated;
grant select, insert, update, delete on public.extracted_files to authenticated;
grant select, insert on public.audit_events to authenticated;
