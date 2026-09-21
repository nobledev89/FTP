# Image stage

Generate one editorial illustration for FinTechPulse, a UK financial and fintech publication. You
are given the brief for a single image. Produce the image and nothing else.

## The picture to make

{{prompt}}

It should read as: {{altText}}

- Article: {{title}}
- What this image has to do: {{purpose}}
- Placement: slot {{slot}}, the {{role}} image, {{aspectRatio}}.

## House style

Every FinTechPulse illustration is the same kind of object: a **screenprinted editorial
illustration**, as though pulled on a press in three inks on uncoated paper. This is the look, and
it does not vary between articles.

**Inks.** Exactly three, plus the paper. Warm near-black `#1C1917`, warm grey `#A8A29E`, and
vermilion `#C2410C` on bone white `#F5F5F4`. Vermilion is the accent and is used sparingly — one
shape, one gesture, the thing the eye should land on first. Never introduce a fourth colour, and
never use vermilion for more than about a fifth of the image.

**Surface.** Flat areas of solid ink with a coarse halftone grain where tone is needed. Visible
paper tooth. Slight misregistration between the inks, as real screenprinting has. No gradients, no
airbrushing, no 3D rendering, no gloss, no soft drop shadows. A shadow, where one exists, is a hard
flat shape in a single ink.

**Drawing.** Confident, slightly graphic, closer to a woodcut or a mid-century poster than to a
technical diagram. Objects are simplified to their silhouette and one or two interior marks. Edges
are decisive.

**Contrast.** High. Large areas of solid dark against large areas of bare paper. This is a printed
poster, not a watercolour — if the image would read as pale or washed out at thumbnail size, it is
wrong.

## Finding the picture

The brief gives you a subject. Turn it into **one concrete image with one idea in it**, built from
real objects a reader could name.

- Pick physical things from the story's own world — a bank card, a paper form, a turnstile, a
  shuttered door, a queue, a ledger, a set of keys, a postbox, a lift button, a stack of envelopes.
- Give it a twist of scale or relation that carries the argument: the object far too large, far too
  small, repeated into a wall, cut in half, balanced, locked, queued behind.
- One subject dominates. Everything else is space.
- Place the subject off-centre and keep it clear of the extreme edges; the image gets cropped to
  several shapes.

What this must never become: a network of glowing nodes, a skyline with lines drawn over it, icons
arranged in a row, a flowchart, a phone with arrows pointing at it, or any other picture of a
concept rather than a thing. If your idea could illustrate any fintech article, it is the wrong
idea — go back and find the object that belongs to _this_ story.

## Hard rules

- **No text of any kind** in the image: no words, numbers, labels, signage, or lettering. Models
  render them badly and they cannot be corrected afterwards.
- **No real logos, wordmarks, trade dress, or recognisable real people.**
- **No charts, graphs, or data of any kind.** An invented figure in an image is a fabrication.

## Output

Return the generated image only. No text, no commentary, no JSON — the publishing system records
the image's metadata itself from the approved brief.
