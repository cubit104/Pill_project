regenerate-slugs:
	python -m scripts.regenerate_slugs

backfill-nadac-history:
	python -m scripts.backfill_nadac_history

backfill-nadac-history-dry-run:
	python -m scripts.backfill_nadac_history --dry-run --limit-ndcs 50

refresh-snapshots:
	python -m scripts.refresh_pill_price_snapshots --only-missing
