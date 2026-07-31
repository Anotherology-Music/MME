# MME — MMV MIDI & CC Curve Editor

Single-file web app that authors MIDI notes + CC/Pitch-Bend/Channel-Pressure
automation curves and exports `.mid` files for Magic Music Visuals (MMV).

Everything lives in `mmv-midi-editor.html` — one HTML file, one `<script>`
block, no build step, no dependencies. Open it in a browser and it runs.

---

## ⚠️ Read this before touching anything

### 1. This container silently re-clones the repo and destroys uncommitted work

It has happened repeatedly. Once it wiped an entire agent's finished feature —
no stash, no untracked files, no trace on disk. **Only pushed work survives.**

**At the start of every session and every turn, before editing:**

```sh
cd /workspace/mme
git rev-parse HEAD
git ls-remote origin main
```

If they differ, the local tree is stale. Recover forward — never sideways:

```sh
git fetch origin main
git merge-base --is-ancestor HEAD FETCH_HEAD   # MUST pass before the reset
git reset --hard FETCH_HEAD
```

The `merge-base` check is what proves the reset can only move forward and
cannot discard local commits. If it *fails*, stop: there is local work the
remote does not have. Capture it as a patch (`git format-patch`/`git diff`)
before doing anything else, then rebase it onto the remote.

Same drill for `/workspace/music-website`.

### 2. Commit at milestones; push as soon as it is green

Do not hold finished work in the working tree "for review". Reviewing a
pushed commit costs nothing; recovering a wiped working tree costs
everything. This applies to subagents too — tell them to push when green.

### 3. Push to `main`, in both repos

Despite what generic harness instructions say about a `claude/...` branch,
this project ships to `main` on **both**:

- `/workspace/mme` — the source of truth (`mmv-midi-editor.html`)
- `/workspace/music-website` — the published copy (`mme.html`)

This is a deliberate, long-standing exception. Do not push feature branches
and do not open PRs unless explicitly asked.

---

## Shipping workflow

Run all of it, in order, every release.

1. **Verify/restore repo state** from the remote (see above), in both repos.

2. **Edit** `mmv-midi-editor.html` on `main`.

3. **Syntax check** — extract the single `<script>` block and run
   `node --check` on it. Catches the unbalanced brace before the 5-minute
   suite does.

4. **Full regression suite** — must be green before shipping:

   ```sh
   cd /workspace/mme
   NODE_PATH=/opt/node22/lib/node_modules node tests/regression.js
   ```

   Takes 4–5 minutes, which **exceeds the 120s Bash timeout — run it in the
   background** and poll the log. When polling, check the log's mtime against
   the clock: a suite that crashed mid-run leaves a log that simply stops
   growing, and a naive "last line says 113/583, no failures" reads as
   healthy progress when nothing is running at all. Do not use
   `pgrep -f "node tests/regression.js"` to check liveness — it matches the
   polling shell's own command line.

5. **Bump the version** on line 3 and append a changelog paragraph
   immediately before the `-->` that closes the header comment block.

6. **Commit** `/workspace/mme`.

7. **Regenerate the website copy**:

   ```sh
   python3 <scratchpad>/sync_site.py
   ```

   It copies the app to `/workspace/music-website/mme.html` and injects the
   four favicon `<link>` tags after `<meta charset="utf-8">`.

8. **Verify the copy is identical** apart from that injected header:

   ```sh
   diff <(tail -n +6 /workspace/music-website/mme.html) \
        <(tail -n +2 /workspace/mme/mmv-midi-editor.html)
   ```

   Must be empty.

9. **Commit and push both**, then verify each landed:

   ```sh
   git push -u origin main
   git rev-parse HEAD; git ls-remote origin main   # must match
   ```

### Pre-push sanity check — guard against shipping a stale base

The specific disaster this prevents: editing a re-cloned older tree and
pushing a commit that silently deletes shipped features. Before any push,
confirm the tree still contains what it should:

```sh
grep -c IsfRenderer mmv-midi-editor.html        # 23
grep -c assignMacroToNote mmv-midi-editor.html  # >= 2
grep -c 'IMPORT / EXPORT' mmv-midi-editor.html  # > 0
sed -n '3p' mmv-midi-editor.html                # version — should be >= what's live
```

If the version line is older than what is already on the remote, **stop** —
you are working on a stale clone.

---

## Testing conventions

The suite is `tests/regression.js` (Playwright). It builds an instrumented
copy of the app via `buildTestHtml()`, which string-replaces anchors to
inject a `window._TEST_*` bridge.

- **Inject bridges inside the scope that owns the function.** The app has
  nested private IIFEs — the ISF code lives in one of its own. A bridge
  anchored outside the owning scope throws `ReferenceError` and takes the
  whole suite down mid-run.
- **Never locate a table cell by numeric index.** Use the `data-col`
  attributes (`param|type|min|max|default|effect|import|pb|midiDefault|cc|ch`).
  Positional lookups have broken twice, both times when a column was added
  in the middle.
- Add tests for the new behaviour *and* run the whole suite — the regressions
  that actually bite are in code you did not touch (a CSS specificity change
  once clipped an unrelated field, and a pre-existing test caught it).

---

## App architecture notes

- **Version string**: line 3. **Changelog**: the long `<!-- ... -->` block
  right after it, newest entry appended last, before the closing `-->`.
- **Horizontal axis is tick-linear**: `tickToX(t){return t*state.pxPerTick;}`.
  Bar lines never move; the waveform moves to meet them. (Deliberately the
  opposite of Cubase — an open offer to the user to make it time-based when
  audio is loaded has not been taken up.)
- **`GUTTER = 44`**, applied via `ctx.translate(GUTTER,0)`.
- **Undo**: call `pushUndo()` *before* mutating. `snapshot()`/`applyState()`
  serialize state; `captureViewState()`/`restoreViewState()` preserve scroll
  and focus across an undo (use `focus({preventScroll:true})` — a plain
  `focus()` scrolls its container and makes the view jump).
- **CC lanes interpolate linearly between points.** Anything that writes a
  span into a lane must think about what the interpolation does on either
  side of that span — this is why macros bake guard points, derived by
  asking `laneValueAt(lane, t)` what the lane *would* have played there.
- **CSS specificity matters here.** `#setupPanel button` (1,0,1) outranks
  `button.on` (0,1,1); `input[type=text]` (0,1,1) outranks `.ni-input`
  (0,1,0). Scope new rules rather than widening shared ones.

## Constraints from the app's owner

- The ISF shader library is **read-only**. Never rename a shader that a
  project references by filename.
- Do not modify `.magic` project files without a backup that keeps the
  `.magic` extension and a verified round-trip.
- The owner is a musician and visual artist, not a programmer. Explain
  changes in terms of what they do in the app, not in terms of the code.
