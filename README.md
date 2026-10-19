# Lyric Alignment — frontend take-home

A tool for timing lyrics against a song. The backend and the test harness are
done. The interface is not — that part is yours.

Budget whatever time you think the problem deserves. We would rather see a few
things done thoughtfully than everything done thinly.

> **Read [If you are working with an AI agent](#if-you-are-working-with-an-ai-agent)
> before you start.** If an agent writes most of this and there is no
> `decisions.md` in the repo, we reject the submission — not as a penalty, but
> because without it we cannot see who decided what, and that is the part we are
> reading for. Better you hear it now than after the work is done.

---

## Running it

You need **Node 22 or newer** and **pnpm**. Nothing else.

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:5173**. You should see a track title and a line
count. That is the entire frontend right now.

`pnpm dev` starts the API on port 4000 and the Vite dev server on 5173, with
`/api` proxied to the backend, so the browser only ever talks to one origin.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Both servers, watch mode |
| `pnpm reset` | Drop the database and reseed it |
| `pnpm test` | Playwright — one test, proving the harness works |
| `pnpm build` | Production build of the frontend |

If you would rather use containers, `docker compose up` brings up the same two
services on the same two ports.

Playwright's browser is downloaded during `pnpm install`. If that was skipped —
an offline install, for instance — run `pnpm exec playwright install chromium`
once before `pnpm test`.

## The token

Every API request needs a bearer token:

```
lyric-align-dev-token-7f3a91
```

It is already wired into the frontend's fetch wrapper, `apps/web/src/api.ts`.

## Talking to the API

For the implemented editor save workflow, API payload, and unsaved-change
protection, see [Saving timeline changes](decisions.md#manual-timeline-saving).

One example, which is also the only place you need to start:

```bash
curl -H "Authorization: Bearer lyric-align-dev-token-7f3a91" \
  http://localhost:4000/api/v1
```

---

## The task

You are building the interface for aligning a song's lyrics to its audio.

The track is **"You Verse You"** — 2:05, 28 lyric lines. It is AI generated,
words and recording both, downloaded from [aisong.org](https://aisong.org), and
you are welcome to use it for this exercise.

You get the audio and the 28 lines. Nothing is timed yet, and there is no
machine to guess it for you — the timings are the thing you are building a tool
to produce.

**Your job is to make producing them fast.** Someone should be able to put the
track on, listen once through, land each line where it belongs, fix the ones they
fumbled, and save the result — without fighting the interface. Twenty-eight lines
should feel like a couple of minutes' work, not a chore.

Think about where the time actually goes. Stamping a time while the track plays
beats typing one into a box. Nudging a run of lines together beats nudging eight
lines one at a time. Hearing what you just placed, immediately, beats guessing
and checking.

**The waveform, if you want one, is yours to draw.** The API does not ship
precomputed peaks. The browser decodes audio perfectly well — `AudioContext`
plus `decodeAudioData` gets you samples, and libraries like `wavesurfer.js` or
`peaks.js` will do the whole job. Or skip it: a waveform is a nice affordance,
not a requirement.

### One hard requirement: it has to take a track we bring

The seeded song is there to help you — real audio, a real lyric sheet, a real
number of lines. **It is not the subject.** Whatever you build must work when
someone points it at a *different* song: their own audio, their own lyric sheet,
a different length, a different number of lines. Nothing should be keyed to this
particular track — not its duration, not its 28 lines, not its ids.

Add a second track yourself and align it before you submit. That is the check we
will run, and it is the one thing here we treat as pass/fail rather than as a
matter of taste.

To be clear, because this is where people get stuck: **using the API is
optional**, and it has exactly one track with no route for creating another. So
this requirement lives on your side of the wire — a file picker or a URL field
for the audio, a paste box for the lyrics, held in whatever state you like.

That is the whole brief. How you build it — layout, interaction model, libraries,
state management, styling — is yours to decide. The scaffold deliberately
contains none of those choices: there is an `<audio>` element, a fetch wrapper,
and no layout at all. That is on purpose, not an oversight.

The one thing it does ship is `apps/web/src/styles.css` — a font stack, a few
colour variables, a dark mode that follows the OS, and sane defaults for buttons
and inputs, so the starting page is not raw browser default. **It is boilerplate,
not a design.** Change it, throw it away, or replace it with Tailwind or CSS
modules or whatever you normally reach for. It has no layout in it and it is not
part of what we read.

## The server is just somewhere to keep state

There is a small backend. **It is state, and nothing more** — it holds the track,
the lyric sheet, and whatever timings you have saved. Three routes: read the
track, read or write the alignment, that's it. It does not align anything, it
does not judge your timings, and it has no opinion about how your editor works.

**Using it is optional, and doing so is a plus, not a requirement.** Wiring up a
real save — with the failure cases that come with one — is worth showing us if
you have the time. Not wiring it up costs you nothing:

- keep everything in React state, in `localStorage`, in a module-level object
- or persist to the server and treat it as the source of truth
- or both, if you want an offline-first thing with a sync

**And it is your code.** If the payload shape is not what your UI wants, or a
rule annoys you, or you would rather it did something else entirely — change it.
`apps/api` is in the repo and you are free to reshape it however suits you, or to
ignore it completely. We are not going to grade you on our schema. If you do
change it, say what and why in your notes; that is interesting to read.

Two things it does still do, because they are the honest part of talking to a
server at all:

- **A save can be rejected.** Send a `version` you have already fallen behind on
  and you get a `409` carrying the server's current state, so you can reconcile
  without a second request. An interface that copes with that is worth more than
  one that assumes saves always land.
- **Malformed payloads get a `400` with a hint that says what to send instead.**
  Segment times are integer milliseconds while `duration_seconds` is a float, so
  there is one units boundary to keep straight.

Beyond that it lets you save what you like: overlapping segments, timings that
run against the line order, lines with no timing at all. Whether those are
mistakes is an editorial question, and your editor is a better place to answer it
than a fixture server is.

Whichever path you take, tell us which one and why — and the
bring-your-own-track requirement above still applies either way.

## Tests

There is one Playwright test. Its only job is to prove the harness works: dev
servers up, proxy wired, React rendering. It says nothing about how the UI should
behave.

**If you have time, a spec covering something you built is a big plus.** One test
that pins down a real interaction — a drag landing where it should, a bulk edit
doing what it claims, a rejected save surfacing to the user — tells us more than
a broad suite of shallow assertions. `pnpm test` runs whatever you add.

We would not trade working software for tests here. But a candidate who wrote one
good spec has shown us something a screenshot cannot.

## The shape we had in mind

Here is a rough sketch of what we were picturing. **It is a low-fi wireframe,
not a visual design and not a specification.**

![Low-fi wireframe of the lyric alignment editor](docs/wireframe.png)

Read it as one plausible answer to "where does everything go", not as a contract.
If you have a better idea about the interaction, build your idea and tell us why
— we would much rather see that than a faithful reproduction of a sketch.

**And it does not need to look anything like this.** The sketch is four grey
boxes because we did not want to smuggle a visual design into a problem
statement. Your creativity is genuinely welcome here: a different arrangement, a
different interaction model, a look and feel of your own, something we did not
think of. Build the thing you would want to use, tell us what you were going for,
and we will read it on its own terms.

Roughly, it shows four regions:

- **A lyrics pane** — paste a full lyric sheet in, add lines individually, and
  see which lines have been placed and which have not. Lines can be reordered,
  and dragging one onto another merges them.
- **A waveform with a segment lane underneath** — a time ruler, a playhead, and
  a block per timed line. Drag a line from the list onto the waveform to place
  it, drag a block to move it, drag its edges to trim it. Selecting several
  blocks lets you shift a whole verse at once.
- **An inspector** for the current selection — exact start and end, the
  resulting duration, and the operations that do not fit naturally into
  dragging: merge, split, delete.
- **A karaoke readout** along the bottom — the line playing now, with the ones
  either side of it for context.

A few things in the sketch are illustrative rather than literal:

- The song, artist, duration and line count shown are made up, though the real
  track is not far off the sketch's scale: 2:05 and 28 lines. Volume is not the
  challenge here — do not go hunting for a virtualised list.
- **The inspector's `Confidence` field is a leftover.** There is no machine
  guess in this exercise and nothing reports a confidence, so ignore it.
- There is only one track on the server, so nothing needs to load a second one
  from it — but see the bring-your-own-track requirement above.
- Zoom, LRC export and the exact contents of the inspector are ideas, not
  requirements. Take them or leave them.

## Ideas

A menu, not a checklist. Pick what interests you and ignore the rest.

**Easy**
- Show the lyric lines, and highlight the one that is playing.
- Show the playback position, and let someone seek by clicking.
- Tap a key while listening to stamp the current time onto a line.
- Make it obvious at a glance which lines are still untimed.

**Medium**
- Draw the waveform from the audio itself, and let someone place a line on it.
- Drag a block to move it, drag its edges to trim it.
- Time a whole verse in one pass rather than one line at a time.
- Shift a run of lines together when they are all late by the same amount.
- Split one line into two, or merge two into one, and keep the timings sane.
- Zoom the waveform, so fine adjustments are actually possible.
- Export the timings as an `.lrc` file.
- Write a Playwright spec for the interaction you are proudest of.

**Hard**
- Keep it smooth during playback — a decoded waveform is the expensive thing
  here, not the 28 lines.
- Undo and redo.
- Recover gracefully when a save is rejected.
- Load a track someone drops in, without a round trip.
- Make the whole thing usable from the keyboard alone.

## What we are looking for

Roughly in order:

1. **Is timing a sheet actually fast?** This is the point of the exercise. Sit
   down with the track and 28 untimed lines and see how long it takes you. If
   eight lines that are all late by the same amount take eight separate fixes,
   there is a tool missing.
2. **Does the interaction feel right?** Stamping, dragging, snapping, keyboard
   access, knowing what is selected and what an edit will change. Can you tell
   what you just did, and undo it?
3. **Does it work with a track we bring?** The pass/fail one. See above.
4. **Is the code something we could work in?** Sane state, clear boundaries,
   honest error handling, one units boundary rather than five.
5. **Do your claims about it hold up?** The track is short, so raw scale is not
   the test. But if you say something is smooth, or fast, or fine at ten times
   the size, we will ask how you know. Measuring and deciding "this is fine" is
   a perfectly good answer. Guessing is not.

Please leave us a few notes — a file in the repo is fine — covering what you
chose, what you deliberately skipped, and anything that surprised you. Naming
something you left out is a plus, not an admission.

## If you are working with an AI agent

Use whatever tools you normally use. We are not testing whether you can type.

But if you are leaning on an agent heavily, **instruct it to keep a
`decisions.md`** recording the decisions *it* made and why — the trade-offs it
weighed, the alternatives it rejected, the things it guessed at because the brief
did not say. Have it write that file as it goes, not reconstructed at the end.

**This one is not optional, and it is the one rule here with teeth.** An
agent-built submission that arrives without a decision log gets rejected, however
good the app is. We are sorry to be blunt about it — we would rather reject on a
missing file than waste your afternoon and ours reading code whose reasoning
nobody can account for. So please read this section before you start, not after.

The reason is simple. When an agent writes most of the code, the code stops
telling us who decided what. Your own notes cover your choices; `decisions.md`
covers the ones made on your behalf. Between them we can see the shape of the
thinking, which is the part we actually care about.

If you barely used an agent, say so and skip the file. That is a complete answer.

---

One last thing: if anything here is ambiguous, decide, build it, and tell us
what you decided. We would rather read a clear choice we disagree with than a
half-built hedge.
