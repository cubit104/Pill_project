create table if not exists drug_prices (
  ndc text primary key,
  price_per_unit numeric not null,
  unit text not null,
  effective_date date not null,
  source text not null default 'NADAC',
  raw_payload jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists drug_prices_effective_date_idx on drug_prices (effective_date);

create table if not exists drug_price_history (
  ndc text not null,
  effective_date date not null,
  price_per_unit numeric not null,
  unit text not null,
  primary key (ndc, effective_date)
);

create index if not exists drug_price_history_ndc_idx on drug_price_history (ndc);

alter table drug_prices enable row level security;
alter table drug_price_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drug_prices' and policyname = 'service_role_all_drug_prices'
  ) then
    create policy service_role_all_drug_prices on drug_prices
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drug_price_history' and policyname = 'service_role_all_drug_price_history'
  ) then
    create policy service_role_all_drug_price_history on drug_price_history
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end$$;
