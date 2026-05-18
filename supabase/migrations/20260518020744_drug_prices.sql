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
