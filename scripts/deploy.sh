## One-command deploy + trigger setup

This repo includes a helper script that deploys the app and ensures required triggers exist:

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

What it does:
- Runs `slack deploy`
- Ensures the `/consensus` trigger exists (creates it if missing)
- Ensures the scheduled reminder trigger exists (creates it if missing)

### Why the reminder trigger is generated at deploy time

Slack requires `schedule.start_time` to be **in the future** when creating a scheduled trigger.
A static date in `triggers/reminder_schedule.ts` can drift into the past and fail with:

`invalid_start_before_now`

So `scripts/deploy.sh` computes a future start time (next weekday at 09:00 UTC) and generates a temporary trigger definition file for creation.
