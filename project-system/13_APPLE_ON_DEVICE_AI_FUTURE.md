# 13 — Apple On-Device AI Future Track

Status: future / evidence-gated. Do not interrupt current desktop Spike 4e/4f work.

## Why this exists

Apple's recent developer direction increases the practical value of local visual AI on Apple devices. The opportunity for Scoop is not to become Apple-dependent. It is to use Apple hardware and system frameworks as an optional local execution layer while keeping Scoop's durable intelligence in provider-neutral product resolution, verification, commerce routing, and the visual-intent graph.

This track exists to preserve that opportunity without changing the current MVP build order.

## Strategic conclusion

Preferred long-term division of responsibility:

```text
Apple device
  user tap / selection
  local segmentation
  OCR / visible-mark extraction
  lightweight visual attributes
  local confidence / privacy-preserving preprocessing
        ↓
Scoop provider-neutral intent
        ↓
cloud escalation only when needed
  difficult visual reasoning
  multi-frame identity work
        ↓
Scoop backend
  product candidate retrieval
  candidate verification
  canonical identity
  merchant offers
  commercial ranking after relevance
```

Apple may provide cheap/private local perception. Scoop must continue to own the commerce intelligence and trust layer.

## Important opportunities

### 1. Local tap-to-object extraction

A future Apple client should evaluate system-provided image segmentation as an alternative to bounded crops or third-party segmentation.

Potential benefit:
- cleaner object isolation,
- less background noise,
- lower cloud payload size,
- potentially better downstream recognition,
- no custom segmentation model required if system quality is sufficient.

This does not replace the existing Spike 2 strategy until benchmark evidence proves it is better.

### 2. Local first-pass object understanding

A future Apple client should evaluate whether local models can reliably produce the existing provider-neutral `ObjectDescription` / `ProductIntent` fields:
- category,
- subcategory,
- color,
- material,
- visible text / marks,
- style attributes,
- brand/model hypotheses,
- search terms,
- confidence.

Local output is still hypothesis generation, not exact product identity.

Do not weaken the existing `EXACT` / `LIKELY` / `SIMILAR` evidence rules merely because the signal came from Apple hardware or an Apple model.

### 3. Privacy-preserving visual intent

Preferred future path where technically supported:

```text
frame stays local
  ↓
user-selected object isolated locally
  ↓
derived structured evidence leaves device
  ↓
raw pixels uploaded only for explicit hard-case escalation
```

This is stronger than the current crop-and-upload posture and should be preferred if quality remains acceptable.

### 4. Lower marginal inference cost

Local inference could reduce:
- vision API calls,
- image upload bandwidth,
- server inference spend,
- latency for easy cases.

Do not assume "local" means free in product terms. Measure battery, thermal impact, memory, device compatibility, engineering complexity, and quality before adopting it.

### 5. Future Apple distribution surface

After desktop validation, evaluate a native Apple/Safari path that reuses Scoop's existing provider-neutral backend and WebExtension-compatible concepts where practical.

Potential shape:

```text
Safari / Apple client surface
  ↓
user-initiated Scoop action
  ↓
local visual preprocessing
  ↓
existing Scoop resolution backend
  ↓
purchase options
```

Do not assume arbitrary system-wide screen access, Siri screen context, or protected-video access is available to third-party apps. Any such capability must be verified against current Apple APIs, permissions, App Review rules, platform terms, and DRM restrictions before design work begins.

## Future spike — Apple Local Visual Intent

Run only after:
1. desktop end-to-end interaction is validated,
2. Spike 4f exact-match benchmark exists,
3. product-resolution quality is good enough that cheaper/local perception would materially help,
4. mobile work no longer violates the current build-order gate.

### Question

Can an Apple device perform enough of Scoop's user-triggered visual-intent pipeline locally to improve privacy, latency, and cost without materially reducing identification quality?

### Test pipeline

```text
image/frame
  ↓
user tap
  ↓
local object segmentation
  ↓
local OCR / visible-mark extraction
  ↓
local structured attributes
  ↓
provider-neutral ProductIntent
  ↓
existing resolver + verifier
```

### Compare against current path

Measure the same selections through local and current cloud-assisted paths.

Record:
- object isolation quality,
- commercially searchable description rate,
- exact/likely/useful-result downstream impact,
- false-exact rate,
- local preprocessing latency,
- total end-to-end latency,
- bytes uploaded,
- cloud inference calls avoided,
- estimated cost per event,
- hard-case escalation rate,
- device compatibility,
- battery / memory / thermal impact where measurable.

### Pass criteria

Do not set numerical thresholds until the current benchmark establishes a baseline.

A local path is worth adopting only if it provides a meaningful improvement in privacy, cost, or latency while preserving downstream product-resolution quality and trust.

## Architecture guardrails

- Apple frameworks must sit behind Scoop-owned interfaces.
- Do not let Apple-specific response types leak into ranking or commerce logic.
- Maintain a non-Apple execution path.
- Do not require Apple hardware for the core service.
- Do not move canonical product identity or merchant ranking into device-specific code.
- Do not make App Intents, Siri, Apple Intelligence, or system screen context a prerequisite.
- Do not interpret local model confidence as product identity confidence.
- Do not bypass DRM or platform capture restrictions.
- Do not start a mobile rewrite before desktop validation.

## Product principle

The long-term opportunity is:

```text
cheap/private local perception
        +
Scoop-owned product resolution and trust
        +
replaceable merchant/provider network
```

The device can supply eyes. Scoop must own the commercial understanding.

## Re-validation triggers

Before implementing this track, re-check current primary Apple documentation for:
- Vision segmentation APIs,
- Foundation Models / local model capabilities,
- Core ML / local custom-model deployment options,
- Safari Web Extension support,
- native app ↔ extension communication,
- App Intents / Siri exposure,
- screenshot/frame access permissions,
- App Store Review requirements,
- privacy disclosures,
- protected-media behavior.

Do not build against launch-event claims, third-party summaries, or assumed future APIs.
