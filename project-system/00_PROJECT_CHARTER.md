# 00 — Project Charter

## Working name

Visual Commerce Layer

The name is provisional. Do not block engineering on branding.

## Problem

Visual media contains commercial intent that is mostly inaccessible unless the creator or platform manually tags a product.

A viewer can see an object they want but often cannot answer:
- What is it?
- Is this the exact item?
- Where can I buy it?
- If unavailable, what is the closest current equivalent?
- What is a lower-cost alternative?

## Product thesis

Convert a deliberate visual gesture into a structured commercial-intent event.

Primary interaction:

`pause -> point/click -> identify -> resolve -> compare -> buy`

## Strategic thesis

The company should not depend on owning content, inventory, checkout, or a single commerce platform.

The durable layer is the neutral graph connecting:

`media -> timestamp -> object -> identity -> product -> merchant -> outcome`

## Primary user

Initial:
- desktop web user watching supported video,
- willing to install a Chromium extension,
- interested in a visible fashion/accessory/product item.

Later:
- creators and publishers,
- merchants and marketplaces,
- video platforms,
- commerce and discovery platforms.

## Initial wedge

YouTube and ordinary non-protected HTML5 video.

Initial categories:
- shoes,
- watches,
- bags,
- apparel,
- consumer electronics,
- furniture/home objects.

Do not promise universal coverage.

## North-star proof

A user clicks an object in a paused frame and receives at least one commercially useful result they would plausibly click to buy.

## Non-goals for MVP

- universal DRM support,
- Netflix/Disney+/Prime support,
- mobile apps,
- smart TV,
- AR glasses,
- custom model training,
- creator revenue sharing,
- merchant bidding,
- ad network,
- checkout,
- global product catalog,
- exact SKU identification for every object,
- automatic analysis of every frame.

## Business principle

Identification must remain independent from monetization.

Commercial partners may compete only after a relevance gate. They may not purchase a false identity.
