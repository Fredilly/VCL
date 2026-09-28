# Production alpha configuration

Issue: #200

This file records production-safe configuration by name only. Never commit secret values.

## Committed production variables

- `VISION_PROVIDER=openrouter`
- `OPENROUTER_MODEL=google/gemini-2.5-flash-lite`
- `GEMINI_MODEL=gemini-3.5-flash-lite`
- `COMMERCE_ELIGIBILITY_GATE=1`
- `EBAY_ENVIRONMENT=production`
- `JEV_DECISION_ROUTER=true`
- `BENCHMARK_MODE=false`
- `VERIFIED_PRODUCT_TEST_MODE=false`

Production must not contain `VERIFIED_PRODUCT_MAPPINGS_JSON` test fixtures.

## Dashboard-managed production controls

- `ALPHA_ENABLED`
- `ALPHA_INVITE_REQUIRED`
- `ALPHA_CREATOR_CONTENT_MAP`

These remain dashboard-managed so emergency/runtime overrides survive deploys through `keep_vars: true`.

## Required secret names

Provider/commerce secrets:
- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `AI_GATEWAY_API_KEY`
- `EBAY_PRODUCTION_CLIENT_ID`
- `EBAY_PRODUCTION_CLIENT_SECRET`
- `ETSY_KEYSTRING`
- `ETSY_SHARED_SECRET`
- `BRAVE_SEARCH_API_KEY`
- `SERPAPI_API_KEY`

Alpha secrets:
- `ALPHA_ATTRIBUTION_SECRET`
- `ALPHA_FEEDBACK_ADMIN_TOKEN`
- `ALPHA_INVITE_SECRET`

Deployment secrets in GitHub Actions:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Guardrail

`apps/api/scripts/check-production-config.mjs` runs in CI and immediately before production deploy. It rejects benchmark mode, verified-product test mode, or committed verified-product test fixtures.
