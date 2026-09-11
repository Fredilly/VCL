# Spike 4 runtime note

The eBay Browse adapter expects `EBAY_ACCESS_TOKEN` as a server-side Cloudflare Worker secret.

The extension never receives the token. Product identity remains conservative: this spike emits only `LIKELY` or `SIMILAR`, never `EXACT`.
