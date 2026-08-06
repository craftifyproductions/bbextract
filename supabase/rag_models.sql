-- RAG vector index (files stay in R2 vector-db).
-- Run in Supabase SQL Editor. Safe to re-run.

create extension if not exists vector;

create table if not exists public.rag_models (
  id uuid primary key default gen_random_uuid(),
  r2_folder_key text not null unique,

  description text not null,
  embedding_text text not null,
  embedding vector(1536),
  embedding_model text,
  embedding_dims integer default 1536,

  category text not null,
  subcategory text,
  style_tags text[] default '{}',
  material_tags text[] default '{}',
  color_palette text[] default '{}',
  complexity text,
  cube_count integer,

  has_animation boolean not null default false,
  has_metadata boolean not null default false,

  confidence text,
  needs_review boolean not null default false,
  label_schema_version integer,

  raw_label jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rag_models add column if not exists embedding_model text;
alter table public.rag_models add column if not exists embedding_dims integer default 1536;

-- Keep updated_at in sync with Postgres time (avoids app/DB clock skew vs created_at).
create or replace function public.rag_models_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rag_models_set_updated_at on public.rag_models;
create trigger rag_models_set_updated_at
  before insert or update on public.rag_models
  for each row
  execute function public.rag_models_set_updated_at();

create index if not exists rag_models_category_idx on public.rag_models (category);
create index if not exists rag_models_subcategory_idx on public.rag_models (subcategory);
create index if not exists rag_models_embedding_model_idx on public.rag_models (embedding_model);

create index if not exists rag_models_embedding_hnsw_idx
  on public.rag_models
  using hnsw (embedding vector_cosine_ops);

-- Drop older signatures before recreate (return type / args may change).
drop function if exists public.match_rag_models(vector, integer, text, text, text, double precision);
drop function if exists public.match_rag_models(vector, integer, text, text, text, double precision, boolean, boolean);
drop function if exists public.match_rag_models(vector, int, text, text, text, float);
drop function if exists public.match_rag_models(vector, int, text, text, text, float, boolean, boolean);

create or replace function public.match_rag_models (
  query_embedding vector(1536),
  match_count int default 5,
  filter_category text default null,
  filter_subcategory text default null,
  filter_embedding_model text default null,
  min_similarity float default 0.22,
  exclude_needs_review boolean default true,
  exclude_low_confidence boolean default true
)
returns table (
  id uuid,
  r2_folder_key text,
  description text,
  category text,
  subcategory text,
  has_animation boolean,
  has_metadata boolean,
  embedding_model text,
  confidence text,
  similarity float
)
language sql
stable
as $$
  select
    m.id,
    m.r2_folder_key,
    m.description,
    m.category,
    m.subcategory,
    m.has_animation,
    m.has_metadata,
    m.embedding_model,
    m.confidence,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.rag_models m
  where m.embedding is not null
    and (filter_category is null or m.category = filter_category)
    and (filter_subcategory is null or m.subcategory = filter_subcategory)
    and (filter_embedding_model is null or m.embedding_model = filter_embedding_model)
    and (not exclude_needs_review or coalesce(m.needs_review, false) = false)
    and (not exclude_low_confidence or coalesce(m.confidence, 'medium') <> 'low')
    and (1 - (m.embedding <=> query_embedding)) >= min_similarity
  order by m.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

alter table public.rag_models enable row level security;

-- Optional: repair any historically double-encoded jsonb strings (safe no-op if none).
-- update public.rag_models
-- set raw_label = (raw_label #>> '{}')::jsonb
-- where jsonb_typeof(raw_label) = 'string';

-- Optional: audit category spread
-- select category, count(*) from public.rag_models group by 1 order by 2 desc;
-- select r2_folder_key, category, subcategory
-- from public.rag_models
-- where category = 'character' and subcategory in ('passive-mob', 'hostile-mob', 'villager')
--    or category = 'creature' and subcategory in ('player', 'npc', 'warrior', 'mage');

drop policy if exists "rag_models_select_authenticated" on public.rag_models;
create policy "rag_models_select_authenticated"
  on public.rag_models
  for select
  to authenticated
  using (true);
