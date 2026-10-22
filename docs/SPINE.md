# SPINE — Alveron Catalogue Studio (reference-driven catalogue workflow)

## Judged axis
Not a hackathon — this is the user's live product line (alveronfashion.com).
The axis is **source-product fidelity**: a generated editorial image is only
worth shipping if the actual uploaded garment is still recognisably *that garment*.
Everything else (layout, branding, export) is packaging around that axis.

- The one line the app is FOR:
  `A generated catalogue asset must be traceable to, and faithfully derived from, the
  exact uploaded product bytes — and a human must approve it before it counts.`
- Anti-thesis (what it is NOT): a pretty AI-fashion mockup generator that invents
  garments, invents accessories, and labels the output "Alveron inventory". That is the
  failure mode this build explicitly refuses.
- Proof bar: a real end-to-end run against a clean database where an FLUX Kontext
  generation reads real uploaded product bytes, the output is persisted with its
  source SHA-256, and the fidelity claim is recorded as *measured*, not asserted.

## Load-bearing sponsor/provider integration (grep-able)
`fal-ai/flux-pro/kontext` in `src/lib/generation/providers/fal-kontext.ts`.
Removing it => `getImageGenerationProvider()` returns null => every generation job is
recorded as `blocked` with `provider_not_configured` and no asset is ever produced.
Generation STOPS. (Already the existing behaviour — the adapter is the only way to flip it.)

Supporting read-only rail (measured, not load-bearing for generation):
Qwen `qwen3.8-max` at `hackathon.bitgetops.com/v1` for **vision understanding only**
(product attribute extraction + fidelity review). Removing it degrades the review to
manual, it does not stop generation. Explicitly NOT used as an image generator.

## Provider capability evidence (measured 2026-10-22, this machine)
| Model | Accepts source image | Fidelity vs 8-detail garment spec | Verdict |
|---|---|---|---|
| `fal-ai/flux-pro/kontext` | yes (image_url/data URI) | **7 / 8 preserved** | SELECTED |
| `fal-ai/nano-banana/edit` | yes (image_urls[]) | 3 / 8 preserved | rejected |
| `fal-ai/qwen-image-edit` | yes | 400 on poll, unnamed | unused |
| Qwen `qwen3.8-max` | vision input only | n/a | **no image-gen route: all /v1/images/* = 404** |

## The ONE mechanism this build ships
`Generate → persist → measure fidelity → human approve/reject → export`, with the
fidelity measurement stored on the asset so a reviewer sees *what the model preserved*
instead of having to trust the word "faithful".

## ONE primary user + who it's NOT for
Primary: the Alveron studio owner (single operator) producing social catalogue posts
from her own uploaded inventory.
NOT for: multi-tenant agency use, or generating garments the studio does not own.

## Non-negotiables carried from the brief
- Originals immutable; generated outputs live in their own table/key space.
- No fabricated materials, labels, inventory or accessories presented as real stock.
- Human approval required before an asset becomes exportable catalogue output.
- Every fidelity statement is either measured or explicitly marked unverified.
