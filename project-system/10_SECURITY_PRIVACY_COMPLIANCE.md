# 10 — Security, Privacy, and Compliance

## Privacy posture

User invocation is consent for a single visual-intent action, not permission to monitor browsing.

## Data minimization

Prefer:
- transient frame processing,
- crop-only uploads,
- derived attributes,
- hashed/non-identifying content references.

Avoid:
- continuous capture,
- background frame collection,
- raw browsing history,
- persistent screenshots.

## Frame lifecycle

Default:
1. capture locally,
2. crop/prepare,
3. transmit only required image region,
4. process,
5. discard frame bytes after request.

If debugging storage becomes necessary:
- opt-in internally,
- short TTL,
- access control,
- never enable silently in production.

## Secrets

- API keys remain server-side.
- No merchant secrets in extension bundle.
- No affiliate signing secrets in client.
- Use environment variables / secret store.

## Extension permissions

Request the minimum permissions necessary.

Avoid broad host permissions where a narrower model works.

Explain any capture permission at the moment it is needed.

## DRM and access controls

Do not:
- bypass DRM,
- bypass CORS via exploit/proxy tricks designed to defeat access control,
- decrypt protected streams,
- intercept credentials,
- manipulate platform checkout.

## Copyright-sensitive handling

The system should analyze user-selected visual information for recognition, not build a permanent video archive.

Do not republish frame imagery unless needed for the immediate UI and permitted.

## Merchant data

Comply with:
- display requirements,
- freshness requirements,
- attribution requirements,
- caching restrictions,
- trademark/image usage restrictions.

Provider adapters must document these obligations.

## Sponsorship

Sponsored results must be clearly labeled.

Do not create dark patterns that disguise advertising as identification.

## Children / sensitive contexts

Do not infer sensitive personal attributes from people in video for commerce targeting.

The product identifies objects/products, not people.

## Incident posture

If a platform/provider sends a legitimate policy complaint:
- disable affected adapter/flow,
- preserve logs,
- review terms,
- do not attempt technical evasion while the issue is unresolved.
