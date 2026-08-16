# Tim six-state runtime frames

These are 192×208 RGBA half-body runtime frames. Each state contains multiple clips and frames; the component chooses a semantic clip on state entry, advances it with a state-specific timing loop (including blink/eye changes), and resets to frame 0 on state changes.

| Runtime state | Frames | Source decision |
|---|---:|---|
| idle | 6 | migrated handoff candidate; half-body frame QA passed |
| running | 6 | current half-body candidate; tablet allowed only in this state, no lower body |
| needs-input | 6 | migrated `waiting` candidate; half-body frame QA passed |
| ready | 6 | migrated `review` candidate; half-body frame QA passed |
| blocked | 8 | half-body failure/confusion variants; UI warning symbols stay in Effects Layer |
| extras | 6 | current generated random-action candidate; half-body frame QA passed |

The six-state development gate is recorded in `assets/manifests/tim-six-state-runtime.json`. The original 38 state frames remain the semantic baseline, and a shared pool of 74 normalized half-body frames is now loaded through state-specific clips: tablet/side work, waiting, waving, jumping, failed, review, and look actions. Look clips are Extras-only and retain direction QA warning. Production promotion still requires final visual signoff.
