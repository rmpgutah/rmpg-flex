# kimi-connect Deploy Runbook

All application code (backend Tasks 1-9, frontend Tasks 10-12) is complete
and reviewed. This is the manual deployment checklist — every step here
requires your own Cloudflare account, `rmpgutah.us` zone access, and a
Brave Search API account. None of this can be scripted end-to-end by an
agent since it needs real credentials and interactive prompts.

Run all commands from the worktree: `cd /Users/rmpgutah/Kimi.ai-worktrees/kimi-connect`.

## 1. Create the D1 database

```bash
cd worker
npx wrangler d1 create kimi-connect-db
```

Copy the `database_id` from the output.

## 2. Update `worker/wrangler.toml`

Replace `REPLACE_AFTER_WRANGLER_D1_CREATE` with the real `database_id` from Step 1.

## 3. Apply the schema to the remote D1 database

```bash
npx wrangler d1 execute kimi-connect-db --remote --file=./schema.sql
```

Confirms `conversations` and `messages` (with `content_type`, `tool_name`,
`tool_call_id` columns, `role` including `'tool'`) were created remotely.

## 4. Get a Brave Search API key

Sign up for the free tier at https://api.search.brave.com (no payment
required for the free tier) and generate an API key.

## 5. Set Worker secrets

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put KIMI_CONNECT_PASSWORD
npx wrangler secret put AUTH_COOKIE_SECRET
```

Each prompts interactively. Use:
- `OPENROUTER_API_KEY`: your real OpenRouter key (free-tier usable as-is).
- `BRAVE_API_KEY`: the key from Step 4.
- `KIMI_CONNECT_PASSWORD`: the real password you'll use to log into the app.
- `AUTH_COOKIE_SECRET`: a random long string, e.g. output of `openssl rand -hex 32`.

## 6. Deploy the Worker

```bash
npm run deploy
```

Should route at `rmpgutah.us/kimi-connect/api/*` (requires `rmpgutah.us`
already active as a zone on this Cloudflare account).

## 7. Build and deploy the frontend

```bash
cd ../frontend
npm run build
npx wrangler pages deploy dist --project-name=kimi-connect-frontend
```

(Or connect `frontend/` to a Cloudflare Pages project via the dashboard's
Git integration instead of the CLI deploy.) Configure the Pages project's
route as `rmpgutah.us/kimi-connect/*` in the Cloudflare dashboard so it
serves alongside the Worker's `/kimi-connect/api/*` route on the same zone.

## 8. Verify

Visit `https://rmpgutah.us/kimi-connect/`, log in with the real password,
start a chat, confirm a streamed response from a free model, and try
prompting a search (e.g. "search the web for today's news") against a
tool-capable model to confirm the tool-calling loop and "🔍 Searching..."
status work end-to-end against the real Brave/OpenRouter APIs.

## After deploying

- To unlock Kimi K3 in the model dropdown once you've funded a balance:
  flip `ENABLE_KIMI_K3 = "true"` in `worker/wrangler.toml`'s `[vars]`
  block and the hardcoded `ENABLE_KIMI_K3` constant in
  `frontend/src/App.tsx`, then redeploy both.
