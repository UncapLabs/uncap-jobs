# Points

## Local Development

To run the scheduled export locally:

1. Start the Wrangler dev server with scheduled event support:

```bash
npx wrangler dev --test-scheduled --remote
```

2. Trigger the scheduled event via curl:

```bash
curl "http://localhost:8787/__scheduled?cron=0%2018%20*%20*%20FRI&scheduled=1732147200000"
```

This will execute the scheduled worker and export points snapshots to the configured R2 bucket.

**Note:** The `--remote` flag means this uses the production DB and R2 bucket. Be cautious when testing locally.

## Deployment

To deploy to production:

```bash
npm run deploy
```

This will deploy the worker to Cloudflare with the configured scheduled triggers (every Friday at 10:00 and 18:00 UTC).
