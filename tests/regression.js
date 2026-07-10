// Headless regression suite for mmv-midi-editor.html.
//
// Dev tooling only — has zero effect on the shipped single-file app. Requires
// Node.js and Playwright (`npm install -g playwright` or a local install) plus
// a Chromium binary Playwright can launch. Run with:
//   node tests/regression.js
//
// It serves a copy of mmv-midi-editor.html with a small test bridge injected
// (exposes internal state/functions on `window._TEST_*` so tests can drive
// and inspect the app without needing real MIDI hardware or file downloads),
// runs a battery of scenarios covering both baseline app behavior and the
// features added since v0.5.0, and exits non-zero if anything fails.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_PATH = path.join(__dirname, '..', 'mmv-midi-editor.html');
const PORT = 8973;
const URL = `http://localhost:${PORT}/app.html`;

function buildTestHtml() {
  let html = fs.readFileSync(APP_PATH, 'utf8');
  html = html.replace('  const state = {', '  window._TEST_state = null;\n  const state = {');
  html = html.replace(
    '  init();',
    [
      '  window._TEST_state = state;',
      '  window._TEST_onMidiIn = onMidiIn;',
      '  window._TEST_sched = () => sched;',
      '  window._TEST_updateNoteInfo = updateNoteInfo;',
      '  window._TEST_snapshot = snapshot;',
      '  window._TEST_applyState = applyState;',
      '  window._TEST_buildMidi = () => Array.from(buildMidi());',
      '  window._TEST_parseMidi = (bytes) => { const r = parseMidi(new Uint8Array(bytes).buffer); return { notes: r.notes, ccMap: r.ccMap, bpm: r.bpm, tsN: r.tsN, tsD: r.tsD, div: r.div, tsEvents: r.tsEvents }; };',
      '  window._TEST_addLane = (cc, ch) => { const l = addLane(cc, ch); return l.id; };',
      '  window._TEST_upsertPoint = (laneId, t, v) => { const l = state.ccLanes.find(x => x.id === laneId); upsertPoint(l, t, v); };',
      '  window._TEST_tickToBBT = (t) => tickToBBT(t);',
      '  window._TEST_bbtToTick = (s) => bbtToTick(s);',
      '  window._TEST_barToTick = (b) => barToTick(b);',
      '  window._TEST_totalTicks = () => totalTicks();',
      '  window._TEST_tickToSeconds = (t) => tickToSeconds(t);',
      '  window._TEST_fmtClockHundredths = (sec) => fmtClockHundredths(sec);',
      '  window._TEST_laneClientPos = (laneId, t, v) => { const l = state.ccLanes.find(x => x.id === laneId); const rect = l._scroll.getBoundingClientRect(); return { x: tickToX(t) + rect.left - state.scrollLeft, y: val2yForLane(l._canvas.height, v, l) + rect.top }; };',
      '  init();',
    ].join('\n')
  );
  return html;
}

let results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}

async function withPage(browser, fn) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));
  await page.goto(URL);
  await page.waitForTimeout(250);
  try { await fn(page); } finally { await page.close(); }
}

async function run() {
  const testHtml = buildTestHtml();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(testHtml);
  });
  await new Promise(resolve => server.listen(PORT, resolve));

  const browser = await chromium.launch();

  // ---------------- Baseline / core ----------------

  await withPage(browser, async (page) => {
    const bars = await page.evaluate(() => window._TEST_state.bars);
    check('default bars is 100', bars === 100, { bars });
  });

  await withPage(browser, async (page) => {
    // undo/redo via real keyboard shortcuts on a real UI action (Delete)
    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 60, start: 0, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
    });
    const before = await page.evaluate(() => window._TEST_state.notes.length);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Delete');
    await page.waitForTimeout(50);
    const afterDelete = await page.evaluate(() => window._TEST_state.notes.length);
    const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${ctrl}+z`);
    await page.waitForTimeout(50);
    const afterUndo = await page.evaluate(() => window._TEST_state.notes.length);
    await page.keyboard.press(`${ctrl}+y`);
    await page.waitForTimeout(50);
    const afterRedo = await page.evaluate(() => window._TEST_state.notes.length);
    check('undo/redo roundtrip after delete', before === 1 && afterDelete === 0 && afterUndo === 1 && afterRedo === 0,
      { before, afterDelete, afterUndo, afterRedo });
  });

  await withPage(browser, async (page) => {
    const laneId = await page.evaluate(() => window._TEST_addLane(74, 1));
    await page.evaluate((laneId) => { window._TEST_upsertPoint(laneId, 480, 100); }, laneId);
    const lane = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId), laneId);
    check('CC lane add + point upsert', lane && lane.cc === 74 && lane.ch === 1 && lane.points.some(p => p.t === 480 && p.v === 100), lane);
  });

  await withPage(browser, async (page) => {
    // snapshot/applyState roundtrip — the same mechanism used by undo, save, and load
    await page.evaluate(() => {
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 67, start: 960, length: 480, vel: 110, ch: 2 });
      window._TEST_state.bpm = 140;
    });
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate(() => { window._TEST_state.notes = []; window._TEST_state.bpm = 120; });
    await page.evaluate((snap) => window._TEST_applyState(snap), snap);
    const restored = await page.evaluate(() => ({ notes: window._TEST_state.notes.length, bpm: window._TEST_state.bpm }));
    check('snapshot/applyState roundtrip (save/load, undo mechanism)', restored.notes === 1 && restored.bpm === 140, restored);
  });

  await withPage(browser, async (page) => {
    // MIDI export -> reimport roundtrip through the real binary encoder/decoder
    await page.evaluate(() => {
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 64, start: 480, length: 240, vel: 90, ch: 3 });
    });
    const bytes = await page.evaluate(() => window._TEST_buildMidi());
    const parsed = await page.evaluate((bytes) => window._TEST_parseMidi(bytes), bytes);
    const found = parsed.notes.find(n => n.pitch === 64 && n.ch === 3);
    check('MIDI export -> reimport roundtrip preserves note', !!found && found.start === 480 && found.length === 240, found);
  });

  // ---------------- MIDI import merge/replace ----------------

  const midiBytes = [
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0d, 0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00, 0x00, 0xff, 0x2f, 0x00,
  ];
  const midiTmpPath = path.join(require('os').tmpdir(), 'mmv-regression-test.mid');
  fs.writeFileSync(midiTmpPath, Buffer.from(midiBytes));

  await withPage(browser, async (page) => {
    await page.setInputFiles('#fileInput', midiTmpPath);
    await page.waitForTimeout(200);
    const dialogPresent = await page.evaluate(() => !!document.getElementById('midiImportDialog'));
    const notes = await page.evaluate(() => window._TEST_state.notes.length);
    check('fresh project MIDI import: no dialog, direct import', !dialogPresent && notes === 1, { dialogPresent, notes });
  });

  await withPage(browser, async (page) => {
    await page.click('#addLane');
    await page.setInputFiles('#fileInput', midiTmpPath);
    await page.waitForTimeout(200);
    const dialogPresent = await page.evaluate(() => !!document.getElementById('midiImportDialog'));
    await page.click('#midiImportDialog button:has-text("Cancel")');
    await page.waitForTimeout(100);
    const notes = await page.evaluate(() => window._TEST_state.notes.length);
    check('existing project MIDI import: dialog shown, Cancel is a no-op', dialogPresent && notes === 0, { dialogPresent, notes });
  });

  await withPage(browser, async (page) => {
    await page.evaluate(() => { window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 64, start: 0, length: 240, vel: 90, ch: 0 }); });
    await page.setInputFiles('#fileInput', midiTmpPath);
    await page.waitForTimeout(200);
    await page.click('#midiImportDialog button:has-text("Merge")'); // conflict on ch0 -> default remap-on
    await page.waitForTimeout(150);
    const notes = await page.evaluate(() => window._TEST_state.notes.map(n => ({ ch: n.ch })));
    check('MIDI merge with channel conflict auto-remaps', notes.length === 2 && notes.filter(n => n.ch === 0).length === 1, notes);
  });

  fs.unlinkSync(midiTmpPath);

  // ---------------- Recording ----------------

  await withPage(browser, async (page) => {
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCountIn', '0');
    await page.click('#recordBtn');
    await page.waitForTimeout(100);
    const armedState = await page.evaluate(() => ({ recording: window._TEST_state.recording, playing: window._TEST_state.playing }));
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x90, 60, 100] }));
    await page.waitForTimeout(200);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x80, 60, 0] }));
    await page.waitForTimeout(100);
    const notes = await page.evaluate(() => window._TEST_state.notes.map(n => ({ pitch: n.pitch, ch: n.ch, length: n.length })));
    await page.click('#recordBtn');
    check('record without count-in captures a note with real length', armedState.recording && armedState.playing &&
      notes.length === 1 && notes[0].pitch === 60 && notes[0].length > 0, { armedState, notes });
  });

  await withPage(browser, async (page) => {
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCountIn', '1');
    const bpm = await page.evaluate(() => window._TEST_state.bpm);
    const tsNum = await page.evaluate(() => window._TEST_state.tsNum);
    const mspb = 60000 / bpm, beatsTotal = tsNum;
    await page.click('#recordBtn');
    await page.waitForTimeout(100);
    const armed = await page.evaluate(() => ({ recording: window._TEST_state.recording, recArmed: window._TEST_state.recArmed }));
    await page.waitForTimeout(beatsTotal * mspb + 200);
    const afterCountIn = await page.evaluate(() => ({ recording: window._TEST_state.recording, recArmed: window._TEST_state.recArmed, playing: window._TEST_state.playing }));
    await page.click('#recordBtn');
    check('count-in arms then transitions to recording', armed.recArmed && !armed.recording &&
      afterCountIn.recording && !afterCountIn.recArmed && afterCountIn.playing, { armed, afterCountIn });
  });

  await withPage(browser, async (page) => {
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCountIn', '4');
    await page.click('#recordBtn');
    await page.waitForTimeout(200);
    await page.click('#recordBtn'); // cancel mid count-in
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => ({ recording: window._TEST_state.recording, recArmed: window._TEST_state.recArmed, playing: window._TEST_state.playing }));
    check('cancel during count-in leaves nothing running', !st.recording && !st.recArmed && !st.playing, st);
  });

  await withPage(browser, async (page) => {
    // stuck-note regression: a very short note straddling the recording boundary
    // must not get a length anywhere near the size of the whole timeline
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCountIn', '1');
    const bpm = await page.evaluate(() => window._TEST_state.bpm);
    const tsNum = await page.evaluate(() => window._TEST_state.tsNum);
    await page.click('#recordBtn');
    await page.waitForTimeout((60000 / bpm) * tsNum + 150);
    const t0 = await page.evaluate(() => window._TEST_sched().t0);
    await page.evaluate((t0) => window._TEST_onMidiIn({ data: [0x90, 60, 100], timeStamp: t0 - 5 }), t0);
    await page.evaluate((t0) => window._TEST_onMidiIn({ data: [0x80, 60, 0], timeStamp: t0 + 20 }), t0);
    await page.waitForTimeout(100);
    const totalTicks = await page.evaluate(() => window._TEST_state.bars * window._TEST_state.tsNum * (window._TEST_state.ppq * 4 / window._TEST_state.tsDen));
    const note = await page.evaluate(() => window._TEST_state.notes.find(n => n.pitch === 60));
    await page.click('#recordBtn');
    check('short note at recording boundary does not get a huge length', note && note.length > 0 && note.length < totalTicks / 100, { note, totalTicks });
  });

  await withPage(browser, async (page) => {
    // coalesced/stale e.timeStamp must not collapse rapid successive notes together
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCountIn', '0');
    await page.click('#recordBtn');
    await page.waitForTimeout(100);
    const bogus = await page.evaluate(() => performance.now());
    const pitches = [60, 64, 67];
    for (const p of pitches) {
      await page.evaluate(({ p, bogus }) => window._TEST_onMidiIn({ data: [0x90, p, 100], timeStamp: bogus }), { p, bogus });
      await page.waitForTimeout(150);
      await page.evaluate(({ p, bogus }) => window._TEST_onMidiIn({ data: [0x80, p, 0], timeStamp: bogus }), { p, bogus });
      await page.waitForTimeout(150);
    }
    const notes = await page.evaluate(() => window._TEST_state.notes.slice().sort((a, b) => a.start - b.start).map(n => n.start));
    await page.click('#recordBtn');
    const separated = notes.length === 3 && (notes[1] - notes[0]) > 50 && (notes[2] - notes[1]) > 50;
    check('recording ignores stale/coalesced e.timeStamp', separated, notes);
  });

  // ---------------- Recording channel UX (right-click popover) ----------------

  await withPage(browser, async (page) => {
    const info = await page.evaluate(() => ({
      inSetup: document.getElementById('setupPanel').contains(document.getElementById('recCh')),
      inRecPopover: document.getElementById('recPopover').contains(document.getElementById('recCh')),
    }));
    check('Rec Ch/Count-in/Rec Offset moved out of Setup into the record popover', !info.inSetup && info.inRecPopover, info);
  });

  await withPage(browser, async (page) => {
    const beforeOpen = await page.evaluate(() => document.getElementById('recPopover').classList.contains('open'));
    await page.click('#recordBtn', { button: 'right' });
    const afterOpen = await page.evaluate(() => document.getElementById('recPopover').classList.contains('open'));
    const recordingAfterRightClick = await page.evaluate(() => window._TEST_state.recording);
    await page.click('#recordBtn'); // left-click still toggles record, unaffected by the popover
    await page.waitForTimeout(50);
    const armedOrRecording = await page.evaluate(() => window._TEST_state.recording || window._TEST_state.recArmed);
    await page.click('#recordBtn'); // cancel
    check('right-click opens the recording popover; left-click still toggles record',
      !beforeOpen && afterOpen && !recordingAfterRightClick && armedOrRecording,
      { beforeOpen, afterOpen, recordingAfterRightClick, armedOrRecording });
  });

  await withPage(browser, async (page) => {
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCh', '');
    await page.waitForTimeout(50);
    const info = await page.evaluate(() => ({
      recCh: window._TEST_state.recCh,
      badge: document.getElementById('recChBadge').textContent,
    }));
    check('selecting "All" in Rec Ch sets recCh to null and badges the button "All"', info.recCh === null && info.badge === 'All', info);
  });

  await withPage(browser, async (page) => {
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCh', { value: '15' });
    await page.waitForTimeout(50);
    const info = await page.evaluate(() => ({
      recCh: window._TEST_state.recCh,
      badge: document.getElementById('recChBadge').textContent,
      warnClass: document.getElementById('recordBtn').classList.contains('ch16warn'),
      warnRowVisible: document.getElementById('recCh16Warn').style.display !== 'none',
    }));
    check('selecting channel 16 badges "16" and shows the amber sync-track warning',
      info.recCh === 15 && info.badge === '16' && info.warnClass && info.warnRowVisible, info);
  });

  await withPage(browser, async (page) => {
    // "All" mode: each recorded note keeps whatever channel it actually arrived
    // on; channel 16 stays excluded (reserved for the Follow MMV sync-track)
    // even in All mode.
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCh', '');
    await page.selectOption('#recCountIn', '0');
    await page.click('#recordBtn');
    await page.waitForTimeout(100);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x91, 60, 100] })); // note on incoming ch 2
    await page.waitForTimeout(60);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x81, 60, 0] }));
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x9F, 64, 100] })); // note on incoming ch 16 -> dropped
    await page.waitForTimeout(60);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x8F, 64, 0] }));
    await page.waitForTimeout(60);
    const notes = await page.evaluate(() => window._TEST_state.notes.map(n => ({ pitch: n.pitch, ch: n.ch })));
    await page.click('#recordBtn');
    check('All mode records notes on their arriving channel; channel 16 is still dropped',
      notes.length === 1 && notes[0].pitch === 60 && notes[0].ch === 1, notes);
  });

  await withPage(browser, async (page) => {
    // Same pitch arriving on two different incoming channels while both are
    // held must not let one note-off close the other's note-on (the open-note
    // map is keyed by pitch+channel, not pitch alone).
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCh', '');
    await page.selectOption('#recCountIn', '0');
    await page.click('#recordBtn');
    await page.waitForTimeout(100);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x90, 60, 100] })); // ch1 note-on
    await page.waitForTimeout(80);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x91, 60, 100] })); // ch2 note-on, same pitch
    await page.waitForTimeout(80);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x80, 60, 0] })); // ch1 note-off only
    await page.waitForTimeout(80);
    const midway = await page.evaluate(() => window._TEST_state.notes.length);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x81, 60, 0] })); // ch2 note-off
    await page.waitForTimeout(80);
    const notes = await page.evaluate(() => window._TEST_state.notes.map(n => ({ ch: n.ch, length: n.length })));
    await page.click('#recordBtn');
    check('All mode: same-pitch notes on different incoming channels do not cross-close each other',
      midway === 1 && notes.length === 2 && notes.every(n => n.length > 0), { midway, notes });
  });

  await withPage(browser, async (page) => {
    // Changing Rec Ch while a note is held must not retroactively reassign
    // the channel of a note that's already sounding.
    await page.click('#recordBtn', { button: 'right' });
    await page.selectOption('#recCh', { value: '0' });
    await page.selectOption('#recCountIn', '0');
    await page.click('#recordBtn');
    await page.waitForTimeout(100);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x90, 60, 100] }));
    await page.waitForTimeout(80);
    await page.selectOption('#recCh', { value: '4' }); // switch to channel 5 mid-hold
    await page.waitForTimeout(50);
    await page.evaluate(() => window._TEST_onMidiIn({ data: [0x80, 60, 0] }));
    await page.waitForTimeout(80);
    const notes = await page.evaluate(() => window._TEST_state.notes.map(n => ({ pitch: n.pitch, ch: n.ch })));
    await page.click('#recordBtn');
    check('changing Rec Ch mid-hold does not retroactively reassign an already-sounding note',
      notes.length === 1 && notes[0].ch === 0, notes);
  });

  // ---------------- Time signature map ----------------

  await withPage(browser, async (page) => {
    const bbt = await page.evaluate(() => window._TEST_tickToBBT(1920));
    check('default 4/4 project: bar 2 starts at tick 1920', bbt === '2.1.1.0', bbt);
  });

  await withPage(browser, async (page) => {
    await page.click('#tsBtn');
    await page.fill('#tsMapBar', '3');
    await page.fill('#tsMapNum', '3');
    await page.selectOption('#tsMapDen', '4');
    await page.click('#tsMapAddBtn');
    await page.waitForTimeout(50);

    const bar3Tick = await page.evaluate(() => window._TEST_barToTick(2)); // 0-indexed bar 3
    const bar3Bbt = await page.evaluate((t) => window._TEST_tickToBBT(t), bar3Tick);
    const beat2InBar3 = await page.evaluate((t) => window._TEST_tickToBBT(t + 480), bar3Tick); // 1 beat later in 3/4
    const bar4Tick = await page.evaluate(() => window._TEST_barToTick(3)); // bar 4 should start 3 beats (1440 ticks) after bar3Tick
    check('meter change: bar 3 starts at 2 bars of 4/4 (tick 3840)', bar3Tick === 3840, bar3Tick);
    check('meter change: BBT at bar 3 start is 3.1.1.0', bar3Bbt === '3.1.1.0', bar3Bbt);
    check('meter change: beat 2 of bar 3 (3/4) is 3.2.1.0', beat2InBar3 === '3.2.1.0', beat2InBar3);
    check('meter change: bar 4 starts 3 beats after bar 3 (5280), not 4', bar4Tick === 5280, bar4Tick);

    const listText = await page.evaluate(() => document.getElementById('tsMapList').textContent);
    check('Time Signature Changes list shows the new entry', listText.includes('Bar 3: 3/4'), listText);

    // remove it, bar 4 (0-indexed 3) should revert to plain 4/4: 3 * 1920 = 5760
    await page.click('#tsMapList button');
    await page.waitForTimeout(50);
    const bar4TickAfterRemove = await page.evaluate(() => window._TEST_barToTick(3));
    check('removing the change reverts later bars to 4/4 (bar 4 = 5760)', bar4TickAfterRemove === 5760, bar4TickAfterRemove);
  });

  await withPage(browser, async (page) => {
    await page.evaluate(() => { window._TEST_state.tsMap.push({ tick: 3840, num: 3, den: 4 }); });
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate(() => { window._TEST_state.tsMap = [{ tick: 0, num: 4, den: 4 }]; });
    await page.evaluate((snap) => window._TEST_applyState(snap), snap);
    const tsMap = await page.evaluate(() => window._TEST_state.tsMap);
    check('snapshot/applyState preserves the time-signature map', tsMap.length === 2 && tsMap[1].tick === 3840 && tsMap[1].num === 3, tsMap);
  });

  await withPage(browser, async (page) => {
    await page.evaluate(() => { window._TEST_state.tsMap.push({ tick: 3840, num: 3, den: 4 }); });
    const bytes = await page.evaluate(() => window._TEST_buildMidi());
    const parsed = await page.evaluate((bytes) => window._TEST_parseMidi(bytes), bytes);
    const hasInitial = parsed.tsEvents.some(e => e.tick === 0 && e.num === 4 && e.den === 4);
    const hasChange = parsed.tsEvents.some(e => e.tick === 3840 && e.num === 3 && e.den === 4);
    check('MIDI export writes one Time Signature event per map entry', hasInitial && hasChange, parsed.tsEvents);
  });

  await withPage(browser, async (page) => {
    // Inserting a meter change must not move existing notes: their tick (and
    // therefore their real-world seconds position) stays fixed — only the
    // bar/beat label recomputed against them can change.
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 60, start: 3840, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      return n;
    });
    const before = await page.evaluate((t) => ({ seconds: window._TEST_tickToSeconds(t), bbt: window._TEST_tickToBBT(t) }), note.start);
    await page.click('#tsBtn');
    await page.fill('#tsMapBar', '2');
    await page.fill('#tsMapNum', '3');
    await page.selectOption('#tsMapDen', '4');
    await page.click('#tsMapAddBtn');
    await page.waitForTimeout(50);
    const noteAfter = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id), note.id);
    const after = await page.evaluate((t) => ({ seconds: window._TEST_tickToSeconds(t), bbt: window._TEST_tickToBBT(t) }), noteAfter.start);
    check('adding a meter change does not move existing note ticks',
      noteAfter.start === note.start && before.seconds === after.seconds, { before, after, tickUnchanged: noteAfter.start === note.start });
  });

  // ---------------- Metronome / transport UI ----------------

  await withPage(browser, async (page) => {
    // metronome click generation must follow the time-signature map: bar 1 in
    // 4/4 (4 beats, downbeat accented), then a meter change to 3/4 partway
    // through must switch to 3 beats per bar with the accent on each new
    // bar's downbeat — no drift, no leftover 4/4-shaped grouping.
    await page.click('#tsBtn');
    await page.fill('#tsMapBar', '2');
    await page.fill('#tsMapNum', '3');
    await page.selectOption('#tsMapDen', '4');
    await page.click('#tsMapAddBtn');
    await page.click('#tsBtn');
    await page.click('#metroBtn');
    await page.click('#playBtn');
    await page.waitForTimeout(150);
    const clicks = await page.evaluate(() => window._TEST_sched().evs.filter(e => e.click).map(e => ({ tick: e.tick, accent: e.accent })));
    await page.click('#stopBtn');
    const bar1ok = [0, 480, 960, 1440].every((t, i) => clicks.some(c => c.tick === t && c.accent === (i === 0)));
    const bar2ok = [1920, 2400, 2880].every((t, i) => clicks.some(c => c.tick === t && c.accent === (i === 0)));
    const bar3DownbeatAccented = clicks.some(c => c.tick === 3360 && c.accent === true); // next 3/4 bar's downbeat
    check('metronome follows a meter change (4/4 -> 3/4) with correct accents', bar1ok && bar2ok && bar3DownbeatAccented, clicks.slice(0, 8));
  });

  await withPage(browser, async (page) => {
    const initial = await page.evaluate(() => ({
      stPlaySec: document.getElementById('stPlaySec').textContent,
      stPosSec: document.getElementById('stPosSec').textContent,
    }));
    check('MM:SS fields exist next to Play (hundredths) and Cursor (tenths)', initial.stPlaySec === '0:00.00' && initial.stPosSec === '0:00.0', initial);
  });

  await withPage(browser, async (page) => {
    // clicking the ruler moves the playhead; its BBT and MM:SS readouts must agree
    const r = await page.evaluate(() => {
      const rr = document.getElementById('rulerScroll').getBoundingClientRect();
      return { left: rr.left, top: rr.top, height: rr.height, px: window._TEST_state.pxPerTick, scrollLeft: window._TEST_state.scrollLeft };
    });
    await page.mouse.click(r.left + 3840 * r.px - r.scrollLeft, r.top + r.height / 2);
    await page.waitForTimeout(50);
    const afterClick = await page.evaluate(() => ({
      stPlay: document.getElementById('stPlay').textContent,
      stPlaySec: document.getElementById('stPlaySec').textContent,
    }));
    check('clicking the ruler updates Play BBT and MM:SS together', afterClick.stPlay === '3.1.1.0' && afterClick.stPlaySec === '0:04.00', afterClick);
  });

  await withPage(browser, async (page) => {
    // hovering the ruler (no click/drag) must live-update the Cursor readout
    const r = await page.evaluate(() => {
      const rr = document.getElementById('rulerScroll').getBoundingClientRect();
      return { left: rr.left, top: rr.top, height: rr.height, px: window._TEST_state.pxPerTick, scrollLeft: window._TEST_state.scrollLeft };
    });
    await page.mouse.move(r.left + 2000 * r.px - r.scrollLeft + 20, r.top + r.height / 2);
    await page.waitForTimeout(50);
    const hover = await page.evaluate(() => ({
      stPos: document.getElementById('stPos').textContent,
      stPosSec: document.getElementById('stPosSec').textContent,
    }));
    check('hovering the ruler live-updates the Cursor BBT and MM:SS', hover.stPos.startsWith('2.') && hover.stPosSec.startsWith('0:02'), hover);
  });

  await withPage(browser, async (page) => {
    // Time-signature change indicator: the bar line at the change draws
    // thicker (accent color), and once bars are wide enough for per-bar
    // labels, the new signature is spelled out to the left of that line.
    await page.click('#tsBtn');
    await page.fill('#tsMapBar', '2');
    await page.fill('#tsMapNum', '3');
    await page.selectOption('#tsMapDen', '4');
    await page.click('#tsMapAddBtn');
    await page.click('#tsBtn');
    const draws = await page.evaluate(() => {
      const ctx = document.getElementById('rulerCanvas').getContext('2d');
      const strokeWidths = [], texts = [];
      const origStroke = ctx.stroke.bind(ctx), origFillText = ctx.fillText.bind(ctx);
      ctx.stroke = (...a) => { strokeWidths.push(ctx.lineWidth); return origStroke(...a); };
      ctx.fillText = (text, x, y) => { texts.push({ text, x: Math.round(x) }); return origFillText(text, x, y); };
      window.dispatchEvent(new Event('resize'));
      return new Promise(resolve => setTimeout(() => resolve({ strokeWidths, texts }), 200));
    });
    const px = await page.evaluate(() => window._TEST_state.pxPerTick);
    const changeX = Math.round(1920 * px); // bar 2 starts at tick 1920
    const thickLineDrawn = draws.strokeWidths.includes(2);
    const label = draws.texts.find(t => t.text === '3/4');
    check('ruler draws a thicker line at the time-signature change', thickLineDrawn, draws.strokeWidths);
    check('ruler labels the new signature "3/4" to the left of the change', !!label && label.x < changeX, { label, changeX });
  });

  await withPage(browser, async (page) => {
    // Zooming in should populate more position markers: beat numbers fill in
    // once there's enough room per beat, beyond just the bar numbers.
    await page.evaluate(() => { window._TEST_state.pxPerTick = 0.5; });
    const texts = await page.evaluate(() => {
      const ctx = document.getElementById('rulerCanvas').getContext('2d');
      const out = [];
      const origFillText = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => { out.push(text); return origFillText(text, x, y); };
      window.dispatchEvent(new Event('resize'));
      return new Promise(resolve => setTimeout(() => resolve(out), 200));
    });
    check('zoomed in, beat-number labels (2/3/4) appear on the ruler', ['2', '3', '4'].every(n => texts.includes(n)), texts);
  });

  await withPage(browser, async (page) => {
    const inToolbar = await page.evaluate(() => document.querySelector('.toolbar-r1').contains(document.getElementById('stPlay')));
    const inStatusbar = await page.evaluate(() => document.querySelector('.statusbar').contains(document.getElementById('stPlay')));
    check('play position lives in the top toolbar, not the status bar', inToolbar && !inStatusbar, { inToolbar, inStatusbar });
  });

  await withPage(browser, async (page) => {
    await page.click('#metroBtn');
    const onAfterClick = await page.evaluate(() => window._TEST_state.metronomeOn);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('c');
    const onAfterKey = await page.evaluate(() => window._TEST_state.metronomeOn);
    check('metronome toggles via button and "c" key', onAfterClick === true && onAfterKey === false, { onAfterClick, onAfterKey });
  });

  // ---------------- Note editing: left/right edge resize ----------------

  async function dragNoteEdge(page, note, edge, deltaTicks) {
    const pt = await page.evaluate(({ note, edge }) => {
      const rect = document.getElementById('prScroll').getBoundingClientRect();
      const px = window._TEST_state.pxPerTick, nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const tick = edge === 'left' ? note.start : note.start + note.length;
      const nudge = edge === 'left' ? 2 : -2;
      const x = tick * px - window._TEST_state.scrollLeft + nudge;
      const y = (PITCH_MAX - note.pitch) * nh + nh / 2 - document.getElementById('prScroll').scrollTop;
      return { clientX: rect.left + x, clientY: rect.top + y };
    }, { note, edge });
    const pxPerTick = await page.evaluate(() => window._TEST_state.pxPerTick);
    await page.mouse.move(pt.clientX, pt.clientY);
    await page.mouse.down();
    await page.mouse.move(pt.clientX + deltaTicks * pxPerTick, pt.clientY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }

  await withPage(browser, async (page) => {
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 75, start: 960, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await dragNoteEdge(page, note, 'left', 240);
    const after = await page.evaluate((id) => { const n = window._TEST_state.notes.find(n => n.id === id); return { start: n.start, end: n.start + n.length }; }, note.id);
    check('left-edge drag moves start, keeps end', after.start > 960 && after.end === 1440, after);
  });

  await withPage(browser, async (page) => {
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 75, start: 960, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await dragNoteEdge(page, note, 'right', 240);
    const after = await page.evaluate((id) => { const n = window._TEST_state.notes.find(n => n.id === id); return { start: n.start, length: n.length }; }, note.id);
    check('right-edge drag keeps start, changes length (regression)', after.start === 960 && after.length > 480, after);
  });

  // ---------------- Multi-note group drag ----------------

  async function dragNoteBody(page, note, deltaTicks) {
    const pt = await page.evaluate((note) => {
      const rect = document.getElementById('prScroll').getBoundingClientRect();
      const px = window._TEST_state.pxPerTick, nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const tick = note.start + note.length / 2; // click mid-note, away from edge-resize zones
      const x = tick * px - window._TEST_state.scrollLeft;
      const y = (PITCH_MAX - note.pitch) * nh + nh / 2 - document.getElementById('prScroll').scrollTop;
      return { clientX: rect.left + x, clientY: rect.top + y };
    }, note);
    const pxPerTick = await page.evaluate(() => window._TEST_state.pxPerTick);
    await page.mouse.move(pt.clientX, pt.clientY);
    await page.mouse.down();
    await page.mouse.move(pt.clientX + deltaTicks * pxPerTick, pt.clientY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }

  await withPage(browser, async (page) => {
    // Two notes selected together, at different phases relative to the snap
    // grid (120 ticks at the default 1/16 snap). Dragging the anchor note by
    // a raw delta that lands off-grid must snap ONLY the anchor; the other
    // note should move by that same resulting delta, not independently snap
    // to its own nearest grid point (which would land it somewhere else,
    // since it starts at a different grid phase).
    const notes = await page.evaluate(() => {
      const a = { id: window._TEST_state.nextId++, pitch: 70, start: 960, length: 480, vel: 100, ch: 0 };  // phase 0 mod 120
      const b = { id: window._TEST_state.nextId++, pitch: 65, start: 2450, length: 200, vel: 100, ch: 0 }; // phase 50 mod 120
      window._TEST_state.notes.push(a, b);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(a.id); window._TEST_state.selection.add(b.id);
      return [a, b];
    });
    await dragNoteBody(page, notes[0], 90); // anchor raw target 1050 -> snaps to 1080 (delta +120)
    const after = await page.evaluate((ids) => ids.map(id => window._TEST_state.notes.find(n => n.id === id).start), notes.map(n => n.id));
    const expected = [960 + 120, 2450 + 120]; // both shift by the anchor's snap delta, relative spacing preserved
    check('dragging a multi-note selection moves the group by the anchor\'s snap delta (not per-note snapping)',
      after[0] === expected[0] && after[1] === expected[1], { after, expected });
  });

  // ---------------- Axis-lock modifiers (Ctrl/Alt while dragging) ----------------

  async function dragNoteBodyXY(page, note, deltaTicks, deltaPitchSteps, modifier) {
    const pt = await page.evaluate((note) => {
      const rect = document.getElementById('prScroll').getBoundingClientRect();
      const px = window._TEST_state.pxPerTick, nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const tick = note.start + note.length / 2;
      const x = tick * px - window._TEST_state.scrollLeft;
      const y = (PITCH_MAX - note.pitch) * nh + nh / 2 - document.getElementById('prScroll').scrollTop;
      return { clientX: rect.left + x, clientY: rect.top + y };
    }, note);
    const pxPerTick = await page.evaluate(() => window._TEST_state.pxPerTick);
    const nh = await page.evaluate(() => window._TEST_state.noteHeight);
    await page.mouse.move(pt.clientX, pt.clientY);
    await page.mouse.down();
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(pt.clientX + deltaTicks * pxPerTick, pt.clientY - deltaPitchSteps * nh, { steps: 5 });
    if (modifier) await page.keyboard.up(modifier);
    await page.mouse.up();
    await page.waitForTimeout(100);
  }

  await withPage(browser, async (page) => {
    // pitch 70 sits within the piano roll's default scroll viewport (unlike,
    // say, 64, which the earlier group-drag test never needed to click on)
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 70, start: 960, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await dragNoteBodyXY(page, note, 240, 5, 'Control'); // held during drag, not at mousedown -> starts as a normal move
    const after = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id), note.id);
    check('Ctrl held mid-drag locks a note to horizontal-only (pitch unchanged)', after.pitch === 70 && after.start !== 960, after);
  });

  await withPage(browser, async (page) => {
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 70, start: 960, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await dragNoteBodyXY(page, note, 240, 5, 'Alt');
    const after = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id), note.id);
    check('Alt held mid-drag locks a note to vertical-only (start tick unchanged)', after.start === 960 && after.pitch !== 70, after);
  });

  await withPage(browser, async (page) => {
    const laneId = await page.evaluate(() => window._TEST_addLane(20, 0));
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 960, 64), laneId);
    // A freshly-added lane can sit below the fold; scroll it into view so its
    // canvas (not some other row) is actually under the synthetic mouse coords.
    await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId)._row.scrollIntoView({ block: 'center' }), laneId);
    await page.waitForTimeout(50);
    const start = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 960, 64), laneId);
    const target = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 1440, 100), laneId);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.down('Control');
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.keyboard.up('Control');
    await page.mouse.up();
    await page.waitForTimeout(100);
    const pt = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => p.v === 64), laneId);
    check('Ctrl held mid-drag locks a CC point to horizontal-only (value unchanged)', pt && pt.v === 64 && pt.t !== 960, pt);
  });

  await withPage(browser, async (page) => {
    const laneId = await page.evaluate(() => window._TEST_addLane(20, 0));
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 960, 64), laneId);
    await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId)._row.scrollIntoView({ block: 'center' }), laneId);
    await page.waitForTimeout(50);
    const start = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 960, 64), laneId);
    const target = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 1440, 100), laneId);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.down('Alt');
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.keyboard.up('Alt');
    await page.mouse.up();
    await page.waitForTimeout(100);
    const pt = await page.evaluate(laneId => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => p.t === 960), laneId);
    check('Alt held mid-drag locks a CC point to vertical-only (time unchanged)', pt && pt.t === 960 && pt.v !== 64, pt);
  });

  await withPage(browser, async (page) => {
    // Line tool: dragging normally ramps from the origin value to wherever the
    // mouse ends up; holding Ctrl forces a flat/horizontal line at the origin value.
    const laneId = await page.evaluate(() => window._TEST_addLane(21, 0));
    await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId)._row.scrollIntoView({ block: 'center' }), laneId);
    await page.waitForTimeout(50);
    await page.click('[data-tool="line"]');
    const start = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 480, 50), laneId);
    const target = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 1920, 110), laneId);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.down('Control');
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.keyboard.up('Control');
    await page.mouse.up();
    await page.waitForTimeout(100);
    await page.click('[data-tool="select"]');
    const pts = await page.evaluate(laneId => window._TEST_state.ccLanes.find(l => l.id === laneId).points.map(p => ({ t: p.t, v: p.v })), laneId);
    const startPt = pts.find(p => Math.abs(p.t - 480) < 60);
    const endPt = pts.find(p => Math.abs(p.t - 1920) < 60);
    check('Ctrl held while drawing a Line forces a flat/horizontal line at the origin value',
      !!startPt && !!endPt && endPt.v === startPt.v, { pts, startPt, endPt });
  });

  // ---------------- Quantise ----------------

  await withPage(browser, async (page) => {
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 64, start: 100, length: 200, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await page.click('#quantStartBtn');
    await page.waitForTimeout(50);
    const after = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id), note.id);
    check('quantise start snaps to grid, preserves length', after.start === 120 && after.length === 200, after);
  });

  await withPage(browser, async (page) => {
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 64, start: 50, length: 260, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await page.click('#quantEndBtn');
    await page.waitForTimeout(50);
    const after = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id), note.id);
    check('quantise end keeps start, snaps end', after.start === 50 && (after.start + after.length) === 360, after);
  });

  await withPage(browser, async (page) => {
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 64, start: 100, length: 200, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      return n;
    });
    await page.keyboard.down('Alt');
    await page.click('#quantStartBtn');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(50);
    const after = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id), note.id);
    check('Alt+quantise start is a 10% iterative nudge, not a full snap', after.start === 102, after);
  });

  // ---------------- Note Info panel ----------------

  await withPage(browser, async (page) => {
    const order = await page.evaluate(() => [...document.querySelectorAll('.note-info-grid .ni-col .ni-lbl')].map(el => el.textContent));
    check('Note Info column order is Note, Vel, Pos, Ch', JSON.stringify(order) === JSON.stringify(['Note', 'Vel', 'Pos', 'Ch']), order);
  });

  await withPage(browser, async (page) => {
    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 64, start: 480, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    });
    const posVal = await page.inputValue('#noteInfoPos');
    check('Pos field shows BBT position for a single selected note', posVal === '1.2.1.0', posVal);
  });

  await withPage(browser, async (page) => {
    const tops = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect().top;
      return { pos: r('noteInfoPos'), ch: r('noteInfoCh'), note: r('noteInfoNote') };
    });
    check('Note Info Ch sits on the same row as Pos (and Note)', tops.pos === tops.ch && tops.ch === tops.note, tops);
  });

  // ---------------- Toolbar / Setup panel restructuring ----------------

  await withPage(browser, async (page) => {
    const classes = await page.evaluate(() => ({
      tool: [...document.querySelector('.tool-grp').classList],
      snap: [...document.querySelector('.snap-grp').classList],
    }));
    check('Tool and Snap groups use the same blue-ring styling class as Project/New Note',
      classes.tool.includes('tool-grp') && classes.snap.includes('snap-grp'), classes);
  });

  await withPage(browser, async (page) => {
    const disabled = await page.evaluate(() => ({
      out: document.getElementById('midiOut').disabled,
      in: document.getElementById('midiIn').disabled,
    }));
    check('MIDI Out/In selects start disabled until MIDI is enabled', disabled.out === true && disabled.in === true, disabled);
  });

  await withPage(browser, async (page) => {
    const exportHasOnClass = await page.evaluate(() => document.getElementById('exportBtn').classList.contains('on'));
    check('Export .mid button no longer has the fake "on" look (matches Import .mid)', exportHasOnClass === false, exportHasOnClass);
  });

  await withPage(browser, async (page) => {
    // Time Signature Changes now lives in its own popover next to New Note,
    // not inside the Setup panel.
    const inSetupPanel = await page.evaluate(() => document.getElementById('setupPanel').contains(document.getElementById('tsMapList')));
    const inTsPanel = await page.evaluate(() => document.getElementById('tsPanel').contains(document.getElementById('tsMapList')));
    await page.click('#tsBtn');
    const openAfterClick = await page.evaluate(() => document.getElementById('tsPanel').classList.contains('open'));
    check('Time Signature Changes lives in its own popover (not Setup), opened via #tsBtn',
      !inSetupPanel && inTsPanel && openAfterClick, { inSetupPanel, inTsPanel, openAfterClick });
  });

  await withPage(browser, async (page) => {
    // MMV Smooth moved down next to Clear All; Advanced (PPQ/CC Res) moved
    // below Channel Names, both now trailing the Setup panel.
    const order = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('#setupPanel .setup-section')];
      return sections.map(s => s.querySelector('.setup-title')?.textContent || '');
    });
    const dangerIdx = order.indexOf('Danger zone');
    const advancedIdx = order.indexOf('Advanced');
    const mmvSmoothInDanger = await page.evaluate(() => {
      const danger = [...document.querySelectorAll('#setupPanel .setup-section')].find(s => s.querySelector('.setup-title')?.textContent === 'Danger zone');
      return !!danger && danger.contains(document.getElementById('mmvSmooth'));
    });
    check('MMV Smooth sits in Danger zone, and Advanced is near the bottom of Setup',
      mmvSmoothInDanger && advancedIdx > 0 && advancedIdx < dangerIdx, { order, mmvSmoothInDanger });
  });

  await withPage(browser, async (page) => {
    const keysW = await page.evaluate(() => window._TEST_state.keysW);
    check('left side-panel default width is doubled (156px, was 78px)', keysW === 156, keysW);
  });

  await withPage(browser, async (page) => {
    const sec = await page.evaluate(() => window._TEST_tickToSeconds(240)); // half a beat at 120bpm ≈ 0.25s
    const hundredths = await page.evaluate(() => window._TEST_fmtClockHundredths(0.256));
    check('top-row mm:ss formats to hundredths of a second', hundredths === '0:00.25', hundredths);
  });

  // ---------------- Lane tags / filter bar ----------------

  await withPage(browser, async (page) => {
    await page.evaluate(() => window._TEST_addLane(20, 0));
    const display = await page.evaluate(() => document.getElementById('tagFilterBar').style.display);
    check('tag filter bar stays hidden until a lane has a tag', display === 'none', display);
  });

  await withPage(browser, async (page) => {
    const id = await page.evaluate(() => window._TEST_addLane(21, 0));
    await page.fill(`.lane[data-id="${id}"] input.ltags`, 'sceneA, kaleido');
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    const tags = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('lane tags parsed from comma/space separated input', JSON.stringify(tags) === JSON.stringify(['sceneA', 'kaleido']), tags);
    const barDisplay = await page.evaluate(() => document.getElementById('tagFilterBar').style.display);
    const chipTexts = await page.evaluate(() => [...document.querySelectorAll('#tagFilterBar .tag-chip')].map(b => b.textContent));
    check(
      'tag filter bar shows chips for All + each tag once a lane is tagged',
      barDisplay === 'flex' && chipTexts.includes('All') && chipTexts.some(t => t.startsWith('sceneA')) && chipTexts.some(t => t.startsWith('kaleido')),
      chipTexts
    );
  });

  await withPage(browser, async (page) => {
    const idA = await page.evaluate(() => window._TEST_addLane(22, 0));
    const idB = await page.evaluate(() => window._TEST_addLane(23, 0));
    await page.fill(`.lane[data-id="${idA}"] input.ltags`, 'sceneA');
    await page.dispatchEvent(`.lane[data-id="${idA}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(b => b.textContent.startsWith('sceneA'));
      chip.click();
    });
    await page.waitForTimeout(50);
    const aFiltered = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-filtered'), idA);
    const bFiltered = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-filtered'), idB);
    const bPointsIntact = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).points.length, idB);
    check(
      'filtering hides non-matching lane rows visually but keeps their data (MIDI still plays)',
      aFiltered === false && bFiltered === true && bPointsIntact > 0,
      { aFiltered, bFiltered, bPointsIntact }
    );

    const idC = await page.evaluate(() => window._TEST_addLane(24, 0));
    const tagsC = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, idC);
    check('a lane created while a filter is active inherits the selected filter tags', JSON.stringify(tagsC) === JSON.stringify(['sceneA']), tagsC);
  });

  await withPage(browser, async (page) => {
    const id = await page.evaluate(() => window._TEST_addLane(25, 0));
    await page.fill(`.lane[data-id="${id}"] input.ltags`, 'persistTag');
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    const snap = await page.evaluate(() => window._TEST_snapshot());
    const roundTrip = await page.evaluate((s) => { window._TEST_applyState(s); return window._TEST_state.ccLanes.map(l => l.tags); }, snap);
    check('lane tags survive snapshot()/applyState() roundtrip', roundTrip.some(t => Array.isArray(t) && t.includes('persistTag')), roundTrip);
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log('FAILURES:', failed.map(f => f.name).join(', '));
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
