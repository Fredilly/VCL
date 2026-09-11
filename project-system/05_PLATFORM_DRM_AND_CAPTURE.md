# 05 — Platform, DRM, and Capture

## Principle

Do not defeat DRM or protected media systems.

The product must work through browser/platform-permitted access only.

## Capture modes

### Mode A — direct media/frame access

Use when the browser permits access to usable video pixels.

Advantages:
- low friction,
- precise timestamp,
- fast,
- cheap.

Risks:
- cross-origin rules,
- canvas tainting,
- player implementation changes,
- protected playback.

### Mode B — explicit user-authorized tab/screen capture

Use only where browser APIs and platform rules permit it.

Advantages:
- can work when direct DOM access is unsuitable.

Risks:
- additional permission UX,
- protected video may still be unavailable/blank,
- greater privacy responsibility,
- cannot be treated as a DRM workaround.

### Mode C — unsupported

If no permitted capture path returns usable pixels:
- do not analyze,
- explain that this video is unsupported/protected,
- do not attempt circumvention.

## DRM guardrail

Netflix, Disney+, Prime Video, Max and similar services commonly use encrypted/protected playback.

Treat them as unsupported until a lawful, technically permitted integration exists.

Never:
- bypass Widevine or other EME/CDM protections,
- patch protected rendering paths,
- capture through exploit-like methods,
- instruct users to disable protections,
- claim universal streaming support.

## Platform adapters

Use:

```ts
interface VisualSurfaceAdapter {
  detect(): boolean
  getState(): SurfaceState
  requestFrame(): Promise<FrameResult>
  getContext(): SurfaceContext
}
```

Implement:
- generic HTML5 adapter,
- YouTube adapter.

Later adapters only after core proof.

## YouTube risk

Assume YouTube can:
- change DOM/player internals,
- restrict extension behavior,
- expand native Shopping,
- alter policy.

Mitigation:
- keep YouTube-specific code isolated,
- do not rely on undocumented internals when avoidable,
- do not alter native controls,
- do not replace or obscure native shopping,
- maintain a generic HTML5 path,
- build backend intelligence reusable outside YouTube.

## Platform hostility test

Before scaling, answer:

"If YouTube blocks the extension tomorrow, what remains valuable?"

Acceptable answer:
- visual intent graph,
- product resolution engine,
- merchant integrations,
- benchmark/evaluation corpus,
- creator/publisher integrations,
- website/embedded video SDK,
- other supported surfaces.

If the answer is "nothing," the architecture is wrong.
