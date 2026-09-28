# Milestone — Cross-video Exact reuse

Date: 2026-09-28

## What we proved

Scoop can recognize the same physical product across two different web videos and return **EXACT** after strict verification, instead of only returning SIMILAR.

Observed live behavior from `network-log(20260928-015939).har`:

```text
video A -> product resolved / remembered
video B -> canonical candidates retrieved
        -> strict visual verification
        -> cross-video reuse: visual_confirmed
        -> EXACT merchant offers
```

This is a product milestone because Scoop is no longer only doing fresh visual search. It is reusing product identity memory across content.

## ELI5 version

Scoop now has a little product memory.

It sees a shirt in one video and learns:
> "This is that shirt."

Later it sees the shirt in a different video.

Instead of starting from zero, Scoop says:
> "I think I've seen this before."

It checks the old product very carefully against the new picture.

If the evidence agrees, Scoop says:
> "Yes. Same product."

That is when it can return **EXACT**.

## The architecture that made it work

1. **Canonical product memory** — the product has a Scoop-owned identity independent of a seller listing.
2. **Offer ownership** — merchant offers attach to a canonical product instead of becoming product identity.
3. **Indexed cross-video retrieval** — Jev routes the lookup to a small relevant canonical candidate set.
4. **Strict visual verification** — retrieval never creates Exact by itself.
5. **Canonical consolidation** — multiple verified seller/canonical records that are really the same product can collapse into one product identity.
6. **Legacy evidence recovery** — partial OCR and older noisy titles can help reconcile old canonical records, but only after strict visual confirmation.

## Relevant PRs

- #292 — Enforce one canonical product per merchant offer
- #294 — Use Jev to route indexed canonical retrieval
- #295 — Consolidate equivalent cross-video canonicals after strict verification
- #296 — Handle legacy cross-video canonicals with partial OCR

Known-good merge point for this milestone:
`9086ab102bf35f0884da6596ebf443e7a72158d6`

## Trust invariant

Do not weaken this:

```text
retrieval != identity
visual similarity alone != Exact
merchant rank != Exact
Jev != product truth
Exact requires strong product evidence + verification
```

False Exact remains a critical regression.

## Freeze rule

Treat this behavior as a known-good baseline.

Before changing canonical matching, cross-video reuse, retrieval routing, verification thresholds, OCR identity logic, or offer/canonical ownership:

1. preserve this two-video cross-video Exact case as a regression fixture,
2. require false-Exact gates to remain green,
3. compare the new behavior to this milestone,
4. do not trade cross-video Exact precision for broader recall.

## Remaining cleanup

The live run showed that the same physical product can still temporarily appear under more than one canonical key before convergence.

That is **graph hygiene**, not proof that cross-video Exact is missing.

Do not change the live matching logic merely to make IDs prettier.

Future cleanup should:
- reconcile duplicate canonical IDs safely,
- redirect old IDs to one survivor,
- preserve every merchant offer,
- preserve old video mappings,
- never merge products with conflicting evidence.

This cleanup is lower priority than freezing and launching the working behavior.

## Next validation

Do not optimize for this one shirt.

Validate the same mechanism on several unrelated products:
- another slogan/graphic shirt,
- a branded model/SKU,
- a product with no readable text,
- an intentionally similar-but-not-identical negative control.

The target is general cross-video Exact reuse with no false-Exact regression.
