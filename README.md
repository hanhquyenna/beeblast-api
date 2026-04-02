# Beeblast API

Sales pipeline API for Dify AI agents + Tracy orchestration.

## Endpoints

All endpoints require `Authorization: Bearer <API_KEY>` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| POST | `/scrape-company` | Scrape LinkedIn company data via Apify |
| POST | `/score-lead` | Score lead against ICP criteria (returns tier 1/2/3) |
| POST | `/save-company` | Save/upsert company to Supabase |
| POST | `/save-contact` | Save/upsert contact to Supabase |
| GET | `/pipeline` | Get leads list (filter by tier/stage) |
| PATCH | `/contacts/:id/status` | Update outreach status |
| POST | `/outreach-log` | Log an outreach action |
| GET | `/followup-due` | Get contacts needing follow-up (>3 days no reply) |

## Deploy

Railway: connect GitHub repo → set env vars → deploy.

## Env vars

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
APIFY_TOKEN=
API_KEY=
PORT=3000
```
