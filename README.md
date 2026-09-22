# VCL

Visual Commerce Layer.

A low-cost proof that a user can pause supported online video, select a visible object, identify it with calibrated confidence, and receive commercially useful purchase options.

## Current phase

Closed-alpha preparation for the first 5–10 testers.

## Stack

- WXT
- React
- TypeScript
- pnpm workspaces
- Hono + Cloudflare Workers when backend work is required

## Alpha tester onboarding

The canonical closed-alpha instructions are in:

- `apps/extension/ALPHA_TESTER_GUIDE.md`
- `apps/extension/ALPHA_PRIVACY.md`
- `apps/extension/ALPHA_DISABLE_UNINSTALL.md`
- `docs/ALPHA_LAUNCH_RUNBOOK.md`

See `project-system/AGENTS.md` before making architectural or product decisions.


## API keys and secrets

Add or rotate a known Worker secret with one command:

```bash
pnpm secret:add OPENROUTER_API_KEY
```

Wrangler securely prompts for the value, so the secret is not stored in git or typed into the command itself. After the update, Scoop checks the production `/health` endpoint automatically.

See which known secrets are configured:

```bash
pnpm secrets:check
```

The canonical secret-name registry is `apps/api/secrets.registry.json`. Add new provider secret names there when a provider is introduced.
