# Draft invitation for an independent workflow evaluation

**Nothing here has been sent.** This is a draft for the author to edit, address,
and send personally. Do not send it to anyone who wrote, reviewed, or advised on
the ConfoVHH code: their run is useful as a smoke test but cannot close the
independence gate.

## Who to ask

Someone who works with predicted protein complexes and is not part of this
project. A structural biology or computational biology graduate student,
postdoc, or staff scientist is the right level. They do not need to know
nanobodies, GPCRs, or this codebase. The exercise is deliberately synthetic, so
no unpublished data of theirs or ours is involved.

One completion closes the gate. Two or three is better, because the point is to
find out where the instructions are unclear.

## What to tell them it is

Twenty minutes. A command that generates two toy structures, then a browser
session where they load each one, assign chains, run an audit, and export a
report. They check the numbers against the receipt the command printed. There is
nothing to install beyond Node and the repository's own dependencies.

## Draft message

> Subject: 20 minutes to try a structure-review tool and tell me where it breaks
>
> Hi NAME,
>
> I have been building a tool called ConfoVHH that turns a predicted
> receptor-nanobody complex into an auditable interface report, and I am writing
> it up as a software paper. Before I submit it I need someone outside the
> project to confirm that the thing is actually usable from the instructions
> alone, and to tell me where the instructions fall over.
>
> It is a short exercise on two deliberately synthetic four-residue fragments, so
> there is no data of yours or mine involved and no biology to interpret. There
> is a written task sheet with five steps and a table at the end to fill in. It
> should take about twenty minutes, most of which is installing dependencies.
>
> What I need is the honest version: every step you could not follow, every
> message that did not make sense, and anything you had to ask me about. A run
> where you get stuck is more useful to me than a clean one.
>
> If you are willing, I would credit you in the acknowledgements, or leave you
> out if you prefer. Say no freely; I will not ask twice.
>
> Repository and task sheet: LINK
>
> Thanks,
> NAME

## After they run it

Transcribe their answers into a JSON record under
[`independent-evaluations/`](independent-evaluations/RECORD_SCHEMA.md), in their
words rather than a paraphrase, including the parts that reflect badly on the
software. Then rerun:

```bash
node scripts/paper/submission-status.mjs
```

Ask before naming them in the manuscript, and record which of acknowledgement or
anonymity they chose.
