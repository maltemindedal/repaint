# Judging colour accurately

**Read this before trusting a colour on screen.**

Repaint is good at comparing colours against each other from a fixed viewpoint.
It is not a colorimeter. This guide covers how to get the most literal reading
the app can give, and where its honesty ends.

## Why the screen isn't showing you your hex

The app defaults to **ACES filmic tone mapping**, because that is what makes a
three.js view resemble a Cycles render — it rolls off highlights and adds the
contrast you expect from a rendered image.

But tone mapping is a non-linear transform applied _after_ lighting. A wall
painted `#E8E4DA` will **not** produce `#E8E4DA` on screen: it has been
multiplied by the lightmap and then pushed through a film curve.

## Getting a literal reading

**1. Turn tone mapping off.** Press <kbd>T</kbd>, or use the toolbar's
`ACES`/`Raw` button. The button turns red as a reminder.

With tone mapping off, `Color.setStyle()`'s sRGB→linear conversion on the way in
and `outputColorSpace = SRGBColorSpace` on the way out are an exact round trip, so
a _fully lit_ surface shows the hex you typed.

**2. Remove the lighting multiplier.** Even with tone mapping off, the lightmap
still multiplies the colour. In the debug panel (<kbd>`</kbd>), set **Lightmap
intensity** to `0`and **Environment** to`1`.

At that point you may as well read the sidebar swatch instead — it is the literal
hex on a neutral grey background, with no lighting applied at all.

**3. Trust the grey.** The UI chrome is a deliberately hue-neutral grey ramp
(`#1a1a1a` background) for exactly this reason. A blue-tinted dark theme next to
a warm white sample makes the sample look warmer than it is. The viewport
background is adjustable in the debug panel if you want to test a colour against
a different surround.

## What the app is genuinely good at

Stand still. Press <kbd>1</kbd>, <kbd>2</kbd>, <kbd>3</kbd>.

Scheme slots apply a whole set of wall colours instantly from a fixed viewpoint,
with the lighting, the framing and your eye position all held constant. That
side-by-side comparison — _is this white warmer than that one, in this room, at
this time of day_ — is where the tool beats a paint chart, because a paint chart
can't show you the colour on four square metres of wall under your own baked
lighting.

## What it cannot tell you

**None of this replaces a physical sample.** Screen gamut, panel calibration,
the ambient light in _your_ room, and the sheen of the actual paint all move the
result more than anything in this app does.

Use Repaint to shortlist and to compare. Then buy tester pots, put them on the
actual wall, and look at them in daylight and at night.

## Related

- [Configuration reference](../reference/configuration.md) — every debug-panel
  setting, its default and its range.
- [Baking lighting](baking-lighting.md) — why the lightmap multiplies the way it
  does.
- [ADR 0003: default lightmap intensity is π](../architecture/decisions/0003-default-lightmap-intensity-is-pi.md).
