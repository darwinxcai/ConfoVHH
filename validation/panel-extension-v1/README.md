# Local-SE(3) panel extension, v1

## What this is

The shipped pose-ranking policy was measured on five targets. Five correlated
targets, chosen from receptors the project had already worked with, is not
enough to say the ordering holds generally — and the policy was *selected* on
those five, so the number it produced there is optimistic by an unknown amount.

This study asks the narrowest honest version of the follow-up question: **does
the ordering still work on receptors it was not selected against?** It runs the
development pilot's own perturbation generator over all seventeen structures of
the public regression panel, labels every pose with DockQ, and scores the shipped
policy against the same baselines the pilot used.

Five of those seventeen structures were in the pilot. The primary endpoint is
therefore computed on the **twelve that were not**. Any figure covering all
seventeen is secondary and is labelled contaminated wherever it appears.

## What this is not

Three things, and the distinction matters more than the result.

**It is not the hard-decoy holdout.** `validation/hard-decoy-holdout-v3` remains
unexecuted, with `executionAuthorized: false`. Its gates — ten formally cleared
independent groups, an exhaustively archived candidate universe, a pinned
independent oracle, a signing and transparency key ceremony — are unmet, and
nothing under that directory is read or written here.

**It is not the leakage-component-out study.** That design
(`LEAKAGE_COMPONENT_DEVELOPMENT_PROTOCOL.md`) mandates a new template-free
population from ColabFold 1.6.2 and Boltz 2.2.1, roughly 34 to 136 GPU-hours,
under a separately frozen environment manifest. This study runs no learned model
and needs no GPU.

**It does not test the question the product actually exists to answer.** Every
pose here is a rigid-body perturbation of a solved structure. That distribution
is easier than, and differently shaped from, what a prediction pipeline
produces. A good result here means the ordering is not a five-target artifact.
It does not mean the ranking picks correct poses out of predictor output. Only
the holdout answers that, and it remains unexecuted.

## Why the outcome is written down in advance

`study-spec.json` contains a `prespecifiedOutcomes` block naming what counts as
generalization, what counts as partial, and what counts as failure — written
before a single pose existed. The failure branch is explicit: if the shipped
policy does not beat the all-tied control on the twelve unseen structures, that
is published as a failure to generalize, and the policy's shipped boundary text
is amended to say so.

This is the whole point of freezing first. A study that can only confirm what
you hoped is not evidence.

## Integrity

The spec is frozen by SHA-256 in `checksums.sha256`. The runner recomputes that
digest and refuses to execute if it does not match, so the protocol cannot drift
between freeze and run.

Source coordinates are verified twice over: every downloaded file must match the
byte count *and* the SHA-256 already recorded in
`validation/v0.5-public-regression-attestation-v1/native-interfaces.json` before
any pose is generated. A mismatch fails the study closed rather than being
repaired or excluded.

Before the seventeen-target study is scored at all, the runner must reproduce
every macro metric of the frozen five-target pilot from
`validation/dockq-development-pilot-v1/`, to within 1e-9. A re-implementation
that cannot reproduce the pilot's recorded numbers is not the same estimator,
and its output would not be comparable. That gate runs first and aborts the
study on failure.

## Status

Frozen and not yet executed. Results, when they exist, land beside this file and
never overwrite it.
