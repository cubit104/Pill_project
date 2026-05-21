create table if not exists ingredient_ndcs (
  ingredient_rxcui text primary key,
  ingredient_name text not null,
  products jsonb not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists idx_ingredient_ndcs_refreshed_at
  on ingredient_ndcs (refreshed_at);

create index if not exists idx_ingredient_ndcs_products_gin
  on ingredient_ndcs using gin (products jsonb_path_ops);

alter table ingredient_ndcs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ingredient_ndcs' and policyname = 'service_role_all_ingredient_ndcs'
  ) then
    create policy service_role_all_ingredient_ndcs on ingredient_ndcs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end$$;
