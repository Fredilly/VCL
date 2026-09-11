# Visual Commerce Layer — Agent Instructions

## Mission

Build a low-cost proof that a user can pause supported online video, select a visible object, identify it with calibrated confidence, and receive commercially useful purchase options without corrupting the identification result.

The long-term product is a neutral visual-commerce layer:

`SEE -> POINT -> UNDERSTAND -> BUY`

The browser extension is a distribution surface, not the moat.

## Current phase

This is a side-quest MVP. Optimize for:
1. technical proof,
2. user trust,
3. minimal provider dependency,
4. minimal recurring cost,
5. reversible decisions.

Do not optimize for scale, fundraising, creator dashboards, ad auctions, or broad platform coverage until the core interaction works.

## Read first

Read these project-system files before making architectural or product decisions:

1. `00_PROJECT_CHARTER.md`
2. `01_PRODUCT_PRINCIPLES.md`
3. `02_MVP_SCOPE_AND_SPIKES.md`
4. `03_ARCHITECTURE_AND_STACK.md`
5. `04_PROVIDER_DEPENDENCY_GUARDRAILS.md`
6. `05_PLATFORM_DRM_AND_CAPTURE.md`
7. `06_MATCHING_TRUST_AND_RANKING.md`
8. `07_MOAT_AND_SYMBIOSIS.md`
9. `08_DATA_MODEL_AND_METRICS.md`
10. `09_DELIVERY_PLAN_AND_ACCEPTANCE.md`
11. `10_SECURITY_PRIVACY_COMPLIANCE.md`
12. `11_DECISIONS_AND_DO_NOTS.md`

## Global engineering rules

- TypeScript-first.
- Chrome/Chromium first.
- No paid infrastructure until a free-tier or local option has failed a measured requirement.
- No custom model training in the MVP.
- No Roboflow subscription in the MVP unless a spike proves it is necessary.
- No Amazon dependency. Amazon Associates Special Links are not a valid browser-extension monetization foundation without separate written approval.
- No single merchant, model provider, video platform, or affiliate network may be a hard dependency.
- Do not bypass DRM, protected media, browser security controls, access controls, or platform restrictions.
- Do not claim support for protected video unless an explicitly permitted capture path works.
- Never let sponsorship alter identification truth.
- Label exact, likely, similar, and sponsored results separately.
- Store as little video/frame data as possible. Prefer transient processing.
- Build provider adapters behind stable internal interfaces.
- Every external integration must have a fallback or a documented degraded mode.
- Every spike must end with evidence, a pass/fail result, and a decision.
- Do not expand scope until the previous acceptance gate passes.

## MVP success definition

A user on a supported non-protected video can:

1. pause video,
2. invoke the extension,
3. click a visible product,
4. receive a plausible object identification,
5. see useful purchasable matches,
6. understand whether each result is exact, likely, similar, or sponsored,
7. complete the flow without the extension misleading them.

The MVP is not complete merely because a vision model can describe an object.
