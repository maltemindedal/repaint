# 0003 — Default lightmap intensity is π

**Status:** Accepted · **Recorded:** 2026-08-13 (retrospectively, from the
existing implementation)

## Context

Once a Cycles bake reaches `material.lightMap`
([ADR 0002](0002-smuggle-the-lightmap-through-the-occlusion-slot.md)), the obvious
default intensity is `1` — pass the baked value through unchanged.

That renders the room noticeably too dark, and the usual response is to crank
exposure until it looks right, which wrecks the colours the app exists to judge.

The cause is a unit mismatch:

- three.js adds the lightmap into `irradiance`, and `RE_IndirectDiffuse_Physical`
  then multiplies that by `BRDF_Lambert() = albedo / π`.
- A Cycles **Diffuse** or **Combined** bake already stores _outgoing radiance_ for
  a white surface — that is, the answer **after** the division has notionally
  happened.

So passing the bake through at intensity 1 divides by π a second time, and the
room comes out π ≈ 3.14 times too dark.

## Decision

Default `lightMapIntensity` to `Math.PI`, putting the division back.

The constant is defined once as `LIGHTMAP_INTENSITY` in `core/processScene.ts`,
applied when the lightmap is wired up, and mirrored as the app-wide default in
`DEFAULT_SETTINGS`. The debug-panel slider ranges 0–6 so a bake exposed
differently can still be dialled in.

## Consequences

**Good.**

- A bake value of "fully lit" renders as the paint colour at full brightness,
  which is the whole premise of judging a colour in the viewer.
- Exposure stays at 1.0 and remains available as an actual exposure control
  rather than a fudge factor.

**Costs.**

- The default looks arbitrary to anyone who hasn't read this. It is the reason
  the constant carries a comment in three places rather than one.
- It is correct for a **Diffuse (Direct + Indirect, Color unchecked)** or
  **Combined** bake — the recommended workflow. A bake produced some other way,
  or an AO map, wants a different value; that is what the slider is for.
- Two settings now encode the same physical assumption (`lightMapIntensity` at π
  and `aoMapIntensity` at 0). Changing one without the other produces a plausible
  but wrong-looking room.

## Verification

`smoke.test.ts` covers the ORM-vs-lightmap classification and the wiring that
applies this constant. The value itself is a rendering judgement, not something a
headless test asserts.
