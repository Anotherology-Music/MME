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

// Minimal valid mono 16-bit WAV (silence) — decodeAudioData needs real bytes,
// and a zero-length data chunk gets rejected as invalid audio.
function makeWavBytes(seconds) {
  const sampleRate = 44100, numSamples = Math.round(sampleRate * seconds), bytesPerSample = 2, numChannels = 1;
  const dataSize = numSamples * bytesPerSample * numChannels;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return [...buf];
}

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
      '  window._TEST_buildMidi = (opts) => Array.from(buildMidi(opts));',
      '  window._TEST_parseMidi = (bytes) => { const r = parseMidi(new Uint8Array(bytes).buffer); return { notes: r.notes, ccMap: r.ccMap, bpm: r.bpm, tsN: r.tsN, tsD: r.tsD, div: r.div, tsEvents: r.tsEvents }; };',
      '  window._TEST_addLane = (cc, ch) => { const l = addLane(cc, ch); return l.id; };',
      '  window._TEST_upsertPoint = (laneId, t, v) => { const l = state.ccLanes.find(x => x.id === laneId); upsertPoint(l, t, v); };',
      '  window._TEST_tickToBBT = (t) => tickToBBT(t);',
      '  window._TEST_bbtToTick = (s) => bbtToTick(s);',
      '  window._TEST_barToTick = (b) => barToTick(b);',
      '  window._TEST_totalTicks = () => totalTicks();',
      '  window._TEST_tickToSeconds = (t) => tickToSeconds(t);',
      '  window._TEST_secondsToTicks = (s) => secondsToTicks(s);',
      '  window._TEST_audioGainValue = () => (typeof audioGain !== "undefined" && audioGain) ? audioGain.gain.value : null;',
      '  window._TEST_fmtClockHundredths = (sec) => fmtClockHundredths(sec);',
      '  window._TEST_laneClientPos = (laneId, t, v) => { const l = state.ccLanes.find(x => x.id === laneId); const rect = l._scroll.getBoundingClientRect(); return { x: tickToX(t) + rect.left - state.scrollLeft, y: val2yForLane(l._canvas.height, v, l) + rect.top }; };',
      '  window._TEST_pushUndo = pushUndo;',
      '  window._TEST_undo = undo;',
      '  window._TEST_play = (t0) => play(t0);',
      '  window._TEST_pause = () => pause();',
      '  window._TEST_stop = () => stop();',
      '  window._TEST_seekPlayhead = (t) => seekPlayhead(t);',
      '  window._TEST_updateLaneValInput = (laneId) => { const l = state.ccLanes.find(x => x.id === laneId); updateLaneValInput(l); };',
      '  window._TEST_nearestBarAt = (t) => nearestBarAt(t);',
      '  window._TEST_applyScrollLock = () => applyScrollLock();',
      '  window._TEST_prScrollWidth = () => document.getElementById(\'prScroll\').clientWidth;',
      '  window._TEST_hasFSA = () => hasFSA;',
      '  window._TEST_setProjDirHandle = (h) => { projDirHandle = h; };',
      '  window._TEST_getProjDirHandle = () => projDirHandle;',
      '  window._TEST_renderProjList = () => renderProjList();',
      '  window._TEST_saveProject = () => saveProject();',
      '  window._TEST_loadProject = (file) => loadProject(file);',
      '  window._TEST_tryAutoLoadAudio = (n) => tryAutoLoadAudio(n);',
      '  window._TEST_idbGet = (k) => idbGet(k);',
      '  window._TEST_idbSet = (k, v) => idbSet(k, v);',
      '  window._TEST_audioFileName = () => document.getElementById(\'audioFileName\').textContent;',
      '  window._TEST_setMidiOutById = (id) => setMidiOutById(id);',
      '  window._TEST_setMidiInById = (id) => setMidiInById(id);',
      '  window._TEST_loadAudio = (file) => loadAudio(file);',
      '  window._TEST_audioBufDuration = () => (typeof audioBuf !== "undefined" && audioBuf) ? audioBuf.duration : null;',
      '  window._TEST_laneAudible = (id) => laneAudible(state.ccLanes.find(l => l.id === id));',
      '  window._TEST_buildPassEvents = (a, b) => buildPassEvents(a, b);',
      '  init();',
    ].join('\n')
  );
  html = html.replace(
    'function showISFDialog(header, filename){',
    'window._TEST_showISFDialog=(h,f)=>showISFDialog(h,f);\n    function showISFDialog(header, filename){'
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
  const swPath = path.join(__dirname, '..', 'mmv-sw.js');
  const server = http.createServer((req, res) => {
    // The app registers its service worker via a relative 'mmv-sw.js' URL —
    // serve the real sibling file for that path (with a JS MIME type, which
    // browsers require for SW registration) so that behavior is actually
    // exercised, and fall back to the injected test HTML for everything else.
    if (req.url.split('?')[0] === '/mmv-sw.js' && fs.existsSync(swPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(fs.readFileSync(swPath, 'utf8'));
      return;
    }
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

  // ---------------- Editor UX fixes ----------------

  await withPage(browser, async (page) => {
    // Alt+wheel (or grip-drag) resized row height must survive undo — undo
    // should only revert data, not the view.
    await page.evaluate(() => {
      const l = window._TEST_state.ccLanes[0];
      l._row.style.height = '400px'; l._row.style.flex = '0 0 auto';
    });
    const before = await page.evaluate(() => window._TEST_state.ccLanes[0]._row.style.height);
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.evaluate(() => window._TEST_pushUndo());
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 500, 90), laneId);
    await page.evaluate(() => window._TEST_undo());
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => window._TEST_state.ccLanes[0]._row.style.height);
    check('undo preserves a lane\'s zoomed/resized row height instead of resetting it',
      before === '400px' && after === '400px', { before, after });
  });

  await withPage(browser, async (page) => {
    // Multi-selecting CC points that share a value should show that value,
    // not blank — only genuinely differing values should blank the field.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.evaluate((laneId) => { window._TEST_upsertPoint(laneId, 960, 77); window._TEST_upsertPoint(laneId, 1920, 77); }, laneId);
    await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId)._row.scrollIntoView({ block: 'center' }), laneId);
    await page.waitForTimeout(50);
    const p1 = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 960, 77), laneId);
    const p2 = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 1920, 77), laneId);
    await page.mouse.move(p1.x - 20, p1.y - 20);
    await page.mouse.down();
    await page.mouse.move(p2.x + 20, p2.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const sameVal = await page.evaluate(() => window._TEST_state.ccLanes[0]._valInput.value);
    check('multi-selecting CC points with the same value shows that shared value',
      sameVal === '77', sameVal);

    // now nudge one point's value so they differ, re-select, expect blank
    await page.evaluate((laneId) => { const l = window._TEST_state.ccLanes.find(x => x.id === laneId); l.points.find(p => p.t === 1920).v = 90; }, laneId);
    await page.mouse.move(p1.x - 20, p1.y - 20);
    await page.mouse.down();
    await page.mouse.move(p2.x + 20, p2.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const diffVal = await page.evaluate(() => window._TEST_state.ccLanes[0]._valInput.value);
    check('multi-selecting CC points with different values shows blank', diffVal === '', diffVal);
  });

  await withPage(browser, async (page) => {
    // Name/CC/Val/Pos controls should stay visible and within the lane's own
    // bounds (never spilling into the row above/below) at any scroll depth
    // through a very tall (Alt+wheel-zoomed) lane. Exact pixel-centering
    // isn't guaranteed by the sticky+auto-margin technique used here — what
    // matters is it never escapes its row and stays on screen.
    await page.evaluate(() => {
      const l = window._TEST_state.ccLanes[0];
      l._row.style.height = '1500px'; l._row.style.flex = '0 0 auto';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100);
    const samples = [];
    for (const st of [0, 300, 700, 1100]) {
      await page.evaluate((st) => { document.querySelector('.lanes').scrollTop = st; }, st);
      await page.waitForTimeout(60);
      samples.push(await page.evaluate(() => {
        const lanesEl = document.querySelector('.lanes'), row = document.querySelector('.lane'), inner = document.querySelector('.leftcol-inner');
        const lr = lanesEl.getBoundingClientRect(), rr = row.getBoundingClientRect(), ir = inner.getBoundingClientRect();
        return {
          withinRow: ir.top >= rr.top - 0.5 && ir.bottom <= rr.bottom + 0.5,
          withinViewport: ir.bottom > lr.top && ir.top < lr.bottom,
        };
      }));
    }
    check('a tall lane\'s left-column controls stay within their row and on screen while scrolling',
      samples.every(s => s.withinRow && s.withinViewport), samples);
  });

  await withPage(browser, async (page) => {
    // Shrinking a lane via the grip has a floor of "name-row + compact-row"
    // (2 rows) — it can never go small enough for those two rows to be cut
    // off, and val-row (the 3rd row) hides outright once it no longer fits,
    // instead of clipping mid-row.
    const row = await page.$('.lane');
    const grip = await page.$('.lane .grip');
    const gripBox = await grip.boundingBox();
    // Click near the top of the (7px-tall) handle, not dead-center — the
    // row immediately below it can overlap the handle's last couple of
    // pixels by rounding, which makes a dead-center click land on that
    // row instead of the grip.
    const gripY = gripBox.y + 2;
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripY);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripY - 500, { steps: 10 }); // drag way up (shrink)
    await page.mouse.up();
    await page.waitForTimeout(100);
    const shrunk = await page.evaluate(() => {
      const r = document.querySelector('.lane');
      const nameRow = r.querySelector('.name-row'), compRow = r.querySelector('.compact-row'), valRow = r.querySelector('.val-row');
      return {
        rowHeight: r.offsetHeight,
        compact2: r.classList.contains('lane-compact2'),
        nameVisible: nameRow.getBoundingClientRect().height > 0,
        compVisible: compRow.getBoundingClientRect().height > 0,
        valVisible: getComputedStyle(valRow).display !== 'none',
      };
    });
    check('shrinking a lane below the 3-row height hides val-row but keeps name/compact rows visible',
      shrunk.compact2 && shrunk.nameVisible && shrunk.compVisible && !shrunk.valVisible, shrunk);
    check('the grip cannot shrink a lane below the 2-row minimum height',
      shrunk.rowHeight >= 63, shrunk.rowHeight);
  });

  await withPage(browser, async (page) => {
    // Minimizing a lane (the ● hide button) collapses it to a single top-bar
    // row that shows the custom name, CC number, and MIDI channel together —
    // not just the name — so a minimized lane stays identifiable.
    await page.fill('.lane input.lname', 'sequenceProgress');
    await page.dispatchEvent('.lane input.lname', 'input');
    await page.fill('.lane .compact-row .chn', '3');
    await page.dispatchEvent('.lane .compact-row .chn', 'input');
    await page.waitForTimeout(50);
    // Dispatched, not page.click(): the compact-row's trailing icons
    // (including this hide button) overflow the fixed 156px leftcol column
    // and are clipped/unhittable by real pointer coordinates — a real,
    // pre-existing layout bug (confirmed present on main before this
    // change) that's a separate fix from what's under test here.
    await page.evaluate(() => document.querySelector('.lane .move-btn[title="Hide lane"]').click());
    await page.waitForTimeout(50);
    const info = await page.evaluate(() => {
      const row = document.querySelector('.lane');
      return {
        hidden: row.classList.contains('lane-hidden'),
        name: row.querySelector('.tb-name').textContent,
        meta: row.querySelector('.tb-meta').textContent,
      };
    });
    check('minimized lane top-bar shows custom name plus CC# and Channel',
      info.hidden && info.name === 'sequenceProgress' && /CC\d+/.test(info.meta) && info.meta.includes('Ch3'), info);
  });

  await withPage(browser, async (page) => {
    // Left/Right arrow steps a single selected CC point to the previous/next
    // point on the same lane.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.evaluate((laneId) => {
      window._TEST_upsertPoint(laneId, 480, 30);
      window._TEST_upsertPoint(laneId, 960, 60);
      window._TEST_upsertPoint(laneId, 1440, 90);
    }, laneId);
    await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId)._row.scrollIntoView({ block: 'center' }), laneId);
    await page.waitForTimeout(50);
    const p = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 960, 60), laneId);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    const afterRight = await page.evaluate(() => window._TEST_state.ccLanes[0]._activePt.t);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    const afterLeft = await page.evaluate(() => window._TEST_state.ccLanes[0]._activePt.t);
    check('Left/Right arrow steps the selected CC point to the previous/next point on the lane',
      afterRight === 1440 && afterLeft === 480, { afterRight, afterLeft });
  });

  await withPage(browser, async (page) => {
    // Left/Right arrow steps a single selected note to the previous/next
    // note in time.
    await page.evaluate(() => {
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 70, start: 480, length: 240, vel: 100, ch: 0 });
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 71, start: 960, length: 240, vel: 100, ch: 0 });
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 72, start: 1440, length: 240, vel: 100, ch: 0 });
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(window._TEST_state.notes.find(n => n.start === 960).id);
      window._TEST_state.focus = 'piano';
      window._TEST_updateNoteInfo();
    });
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    const afterRight = await page.evaluate(() => window._TEST_state.notes.find(n => window._TEST_state.selection.has(n.id)).start);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    const afterLeft = await page.evaluate(() => window._TEST_state.notes.find(n => window._TEST_state.selection.has(n.id)).start);
    check('Left/Right arrow steps the selected note to the previous/next note in time',
      afterRight === 1440 && afterLeft === 480, { afterRight, afterLeft });
  });

  await withPage(browser, async (page) => {
    // D/S/E/L keyboard shortcuts switch tools.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const results = {};
    for (const [key, tool] of [['d', 'draw'], ['e', 'erase'], ['l', 'line'], ['s', 'select']]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(20);
      results[key] = await page.evaluate(() => window._TEST_state.tool);
    }
    check('D/S/E/L keyboard shortcuts switch Draw/Select/Erase/Line tools',
      results.d === 'draw' && results.e === 'erase' && results.l === 'line' && results.s === 'select', results);
  });

  // ---------------- CC lane Steps (snap-to) ----------------

  await withPage(browser, async (page) => {
    // Setting Steps via the compact-row input snaps future points to N
    // evenly-spaced values across the lane's own range; turning it off (0)
    // stops snapping without retroactively touching existing points.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.fill('.lane .stepsn', '12');
    await page.dispatchEvent('.lane .stepsn', 'change');
    await page.waitForTimeout(50);
    const steps = await page.evaluate(() => window._TEST_state.ccLanes[0].steps);
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 480, 100), laneId);
    const snapped = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => Math.abs(p.t - 480) < 5).v, laneId);
    check('Steps=12 snaps a new point to the nearest of 12 evenly-spaced values (100 -> 104)',
      steps === 12 && snapped === 104, { steps, snapped });

    await page.fill('.lane .stepsn', '0');
    await page.dispatchEvent('.lane .stepsn', 'change');
    await page.waitForTimeout(50);
    const stillSnapped = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => Math.abs(p.t - 480) < 5).v, laneId);
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 1440, 77), laneId);
    const offValue = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => Math.abs(p.t - 1440) < 5).v, laneId);
    check('turning Steps off does not retroactively re-snap existing points, and stops snapping new ones',
      stillSnapped === 104 && offValue === 77, { stillSnapped, offValue });
  });

  await withPage(browser, async (page) => {
    // Steps is capped at the lane's own value range (128 for a CC lane) —
    // typing a much larger number clamps rather than accepting a
    // meaningless value with no distinct levels to snap to.
    await page.fill('.lane .stepsn', '500');
    await page.dispatchEvent('.lane .stepsn', 'change');
    await page.waitForTimeout(50);
    const steps = await page.evaluate(() => window._TEST_state.ccLanes[0].steps);
    check('Steps is capped at the CC lane\'s own range (128), not left at an out-of-range value', steps === 128, steps);
  });

  await withPage(browser, async (page) => {
    // Dragging an existing point also snaps to Steps; Shift bypasses it,
    // matching the existing "Shift ignores the time grid" convention.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.fill('.lane .stepsn', '2'); // on/off: only 0 and 127
    await page.dispatchEvent('.lane .stepsn', 'change');
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 960, 0), laneId);
    await page.waitForTimeout(50);
    const start = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 960, 0), laneId);
    const target = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 960, 60), laneId); // drag to 60 -> should snap to 0 (nearer than 127)
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const snappedV = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => Math.abs(p.t - 960) < 5).v, laneId);
    check('dragging a point snaps its value to Steps (on/off: 60 -> nearest of 0/127)', snappedV === 0, snappedV);

    // Now the same drag with Shift held should bypass the snap
    await page.evaluate((laneId) => { const l = window._TEST_state.ccLanes.find(x => x.id === laneId); l.points.find(p => Math.abs(p.t - 960) < 5).v = 0; }, laneId);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await page.waitForTimeout(80);
    const bypassedV = await page.evaluate((laneId) => window._TEST_state.ccLanes.find(l => l.id === laneId).points.find(p => Math.abs(p.t - 960) < 5).v, laneId);
    check('holding Shift while dragging a point bypasses Steps snapping', Math.abs(bypassedV - 60) <= 2, bypassedV);
  });

  await withPage(browser, async (page) => {
    // The Val row shows a compact "X/N" step-index badge for the active point
    // once Steps is on, and hides it again once Steps is off or nothing is
    // selected. Kept prefix-free (no "step " text) so it has room to show
    // 2-3 digit step counts without truncating.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.fill('.lane .stepsn', '12');
    await page.dispatchEvent('.lane .stepsn', 'change');
    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 480, 100), laneId);
    await page.waitForTimeout(50);
    const p = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 480, 104), laneId);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
    const badge = await page.evaluate((laneId) => {
      const l = window._TEST_state.ccLanes.find(x => x.id === laneId);
      return { text: l._stepBadge.textContent, visible: l._stepBadge.style.display !== 'none' };
    }, laneId);
    check('Val row shows a "X/N" step-index badge for the active point when Steps is on',
      badge.visible && /^\d+\/12$/.test(badge.text), badge);
  });

  await withPage(browser, async (page) => {
    // ISF import auto-sets a lane's Steps from the shader parameter's own
    // discrete option count — VALUES array length, or the integer range
    // span for a plain long/int without explicit enum labels.
    const header = {
      INPUTS: [
        { NAME: 'preset', TYPE: 'long', VALUES: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], LABELS: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] }, // 11 options
        { NAME: 'lightCount', TYPE: 'long', MIN: 0, MAX: 15 }, // plain range, 16 discrete integers
        { NAME: 'enabled', TYPE: 'bool' },
        { NAME: 'brightness', TYPE: 'float', MIN: 0, MAX: 1 },
      ],
    };
    await page.evaluate((h) => window._TEST_showISFDialog(h, 'chaser.fs'), header);
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.querySelectorAll('#isfDialog tbody tr').forEach(tr => tr.querySelector('input[type=checkbox]').click()); });
    await page.click('#isfDialog button:has-text("Import Lanes")');
    await page.waitForTimeout(100);
    const lanes = await page.evaluate(() => window._TEST_state.ccLanes.map(l => ({ name: l.name, steps: l.steps })));
    const preset = lanes.find(l => l.name === 'preset');
    const lightCount = lanes.find(l => l.name === 'lightCount');
    const enabled = lanes.find(l => l.name === 'enabled');
    const brightness = lanes.find(l => l.name === 'brightness');
    check('ISF import auto-sets Steps from an enum VALUES array (11 options)', preset && preset.steps === 11, preset);
    check('ISF import auto-sets Steps from a plain integer range (0-15 -> 16 steps)', lightCount && lightCount.steps === 16, lightCount);
    check('ISF import auto-sets Steps=2 for a bool parameter', enabled && enabled.steps === 2, enabled);
    check('ISF import leaves Steps off (0) for a continuous float parameter', brightness && brightness.steps === 0, brightness);
  });

  await withPage(browser, async (page) => {
    // Steps persists through snapshot()/applyState() (undo, save/load), same
    // pattern as tags; MIDI export still just emits plain resampled CC
    // values regardless of Steps — nothing about it is (or needs to be)
    // encoded in the exported file.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.fill('.lane .stepsn', '5');
    await page.dispatchEvent('.lane .stepsn', 'change');
    await page.waitForTimeout(50);
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate(() => { window._TEST_state.ccLanes[0].steps = 0; });
    await page.evaluate((s) => window._TEST_applyState(s), snap);
    const restoredSteps = await page.evaluate(() => window._TEST_state.ccLanes[0].steps);
    check('lane.steps survives snapshot()/applyState() roundtrip', restoredSteps === 5, restoredSteps);

    await page.evaluate((laneId) => window._TEST_upsertPoint(laneId, 2400, 100), laneId); // snaps under steps=5
    const bytes = await page.evaluate(() => window._TEST_buildMidi());
    const parsed = await page.evaluate((bytes) => window._TEST_parseMidi(bytes), bytes);
    const ccVals = Object.values(parsed.ccMap || {}).flatMap(l => l.points.map(p => p.v));
    check('exported MIDI CC values are plain 0-127 integers regardless of Steps (no proprietary encoding)',
      ccVals.length > 0 && ccVals.every(v => Number.isInteger(v) && v >= 0 && v <= 127), ccVals.slice(0, 5));
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
    const chipTexts = await page.evaluate(() => [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].map(b => b.textContent));
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
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].find(b => b.textContent.startsWith('sceneA'));
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

  // ---------------- Transport shortcuts, project buttons, Time Sig default, Scroll Lock ----------------

  await withPage(browser, async (page) => {
    // Numpad0 jumps back to wherever the current/last playback was started
    // from; while paused it just moves the (stopped) playhead.
    const startTick = await page.evaluate(() => window._TEST_bbtToTick('9.1.1.0'));
    await page.evaluate((t) => { window._TEST_state.playhead = t; }, startTick);
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(250);
    await page.evaluate(() => window._TEST_pause());
    const advanced = await page.evaluate(() => window._TEST_state.playhead);
    await page.keyboard.press('Numpad0');
    await page.waitForTimeout(30);
    const afterNumpad0 = await page.evaluate(() => window._TEST_state.playhead);
    check('Numpad0 jumps the playhead back to where playback was last started',
      advanced > startTick && afterNumpad0 === startTick, { startTick, advanced, afterNumpad0 });

    // Period key returns to the very start of the track (tick 0).
    await page.keyboard.press('.');
    await page.waitForTimeout(30);
    const afterPeriod = await page.evaluate(() => window._TEST_state.playhead);
    check('Period key returns the playhead to the start of the track', afterPeriod === 0, afterPeriod);

    // While already playing, both keys jump and keep playing immediately.
    await page.evaluate((t) => { window._TEST_state.playhead = t; }, startTick);
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(250);
    await page.keyboard.press('Numpad0');
    await page.waitForTimeout(30);
    const stillPlaying = await page.evaluate(() => window._TEST_state.playing);
    const seekTick = await page.evaluate(() => window._TEST_state.playhead);
    await page.waitForTimeout(150);
    const continuedTick = await page.evaluate(() => window._TEST_state.playhead);
    check('Numpad0/period seek while playing keeps playback running from the new position',
      stillPlaying && Math.abs(seekTick - startTick) < 5 && continuedTick > seekTick,
      { stillPlaying, seekTick, continuedTick });
    await page.evaluate(() => window._TEST_stop());
  });

  await withPage(browser, async (page) => {
    // Save/Load Project buttons now live in the top toolbar row next to the
    // Project Name field, not buried in the Setup panel.
    const info = await page.evaluate(() => {
      const projectGrp = document.querySelector('.project-grp');
      return {
        oneOfEach: document.querySelectorAll('#saveProjectBtn').length === 1 && document.querySelectorAll('#loadProjectBtn').length === 1,
        inProjectGrp: !!(projectGrp && projectGrp.contains(document.getElementById('saveProjectBtn')) && projectGrp.contains(document.getElementById('loadProjectBtn'))),
        notInSetupPanel: !document.querySelector('#setupPanel #saveProjectBtn') && !document.querySelector('#setupPanel #loadProjectBtn'),
      };
    });
    check('Save/Load Project buttons sit in the top row next to Project Name (not duplicated, not in Setup)',
      info.oneOfEach && info.inProjectGrp && info.notInSetupPanel, info);
  });

  await withPage(browser, async (page) => {
    // Opening the Time Sig popover defaults "At bar" to the bar closest to
    // the playhead, not always bar 1.
    const t1 = await page.evaluate(() => window._TEST_bbtToTick('9.3.1.0')); // past halfway of bar 9
    await page.evaluate((t) => { window._TEST_state.playhead = t; }, t1);
    await page.click('#tsBtn');
    await page.waitForTimeout(50);
    const bar1 = await page.evaluate(() => document.getElementById('tsMapBar').value);
    await page.click('#tsBtn');

    const t2 = await page.evaluate(() => window._TEST_bbtToTick('5.1.1.0')); // exact bar start
    await page.evaluate((t) => { window._TEST_state.playhead = t; }, t2);
    await page.click('#tsBtn');
    await page.waitForTimeout(50);
    const bar2 = await page.evaluate(() => document.getElementById('tsMapBar').value);

    check('Time Sig popover defaults At Bar to the bar closest to the playhead',
      bar1 === '10' && bar2 === '5', { bar1, bar2 });
  });

  await withPage(browser, async (page) => {
    // Scroll Lock: off by default (no auto-scroll); once on, the view only
    // starts following the playhead after it passes the middle of the
    // viewport, then keeps it centered.
    const viewW = await page.evaluate(() => window._TEST_prScrollWidth());
    const farTick = await page.evaluate(() => window._TEST_bbtToTick('50.1.1.0'));

    await page.evaluate((t) => { window._TEST_state.scrollLock = false; window._TEST_state.playhead = t; window._TEST_applyScrollLock(); }, farTick);
    const scrollWhileOff = await page.evaluate(() => window._TEST_state.scrollLeft);
    check('Scroll Lock does nothing while off', scrollWhileOff === 0, scrollWhileOff);

    const nearTick = await page.evaluate(() => window._TEST_bbtToTick('2.1.1.0'));
    await page.evaluate((t) => { window._TEST_state.scrollLock = true; window._TEST_state.scrollLeft = 0; document.getElementById('prScroll').scrollLeft = 0; window._TEST_state.playhead = t; window._TEST_applyScrollLock(); }, nearTick);
    const scrollBeforeCenter = await page.evaluate(() => window._TEST_state.scrollLeft);
    check('Scroll Lock leaves the view alone before the playhead reaches the middle', scrollBeforeCenter === 0, scrollBeforeCenter);

    const result = await page.evaluate(({ farTick, viewW }) => {
      window._TEST_state.playhead = farTick; window._TEST_applyScrollLock();
      const px = farTick * window._TEST_state.pxPerTick;
      return { scrollLeft: window._TEST_state.scrollLeft, expected: px - viewW / 2 };
    }, { farTick, viewW });
    check('Scroll Lock centers the playhead once it is past the middle of the view',
      Math.abs(result.scrollLeft - result.expected) < 2, result);
  });

  // ---------------- File System Access: recent projects, direct-folder save, auto-audio ----------------
  // Chromium ships the File System Access API but showDirectoryPicker()/
  // showOpenFilePicker() need a real native dialog — unreachable headlessly.
  // Instead these tests inject an in-memory mock FileSystemDirectoryHandle
  // (same shape: kind/name/queryPermission/requestPermission/getFileHandle/
  // entries) via the projDirHandle test hook, exercising every layer of app
  // logic above the picker call itself (which is a single line we trust the
  // browser to implement correctly).

  await withPage(browser, async (page) => {
    const hasFSA = await page.evaluate(() => window._TEST_hasFSA());
    check('File System Access API is available in this browser', hasFSA === true, hasFSA);

    const seeded = await page.evaluate(() => {
      class MockFileHandle {
        constructor(name, content, lastModified) { this.kind = 'file'; this.name = name; this._content = content; this._lastModified = lastModified; }
        async getFile() { return new File([this._content], this.name, { lastModified: this._lastModified }); }
        async createWritable() {
          const self = this;
          return { async write(s) { this._buf = s; }, async close() { self._content = this._buf; self._lastModified = Date.now(); } };
        }
      }
      class MockDirHandle {
        constructor(name) { this.kind = 'directory'; this.name = name; this._files = new Map(); }
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
        async getFileHandle(name, opts) {
          if (!this._files.has(name)) {
            if (opts && opts.create) this._files.set(name, new MockFileHandle(name, '', Date.now()));
            else { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; }
          }
          return this._files.get(name);
        }
        async *entries() { for (const [name, handle] of this._files) yield [name, handle]; }
      }
      const proj = (name) => JSON.stringify({ version: 1, projectName: name, snapshot: { notes: [], ccLanes: [], bpm: 120, bars: 4, tsNum: 4, tsDen: 4, tsMap: [{ tick: 0, num: 4, den: 4 }], ppq: 480, next: 1, pitchNames: {}, projectName: name, locS: null, locE: null } });
      // A minimal (silent, 4-sample) valid WAV so decodeAudioData actually
      // succeeds — a zero-length data chunk gets rejected as invalid audio.
      const wavBytes = new Uint8Array([
        0x52,0x49,0x46,0x46, 0x2c,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
        0x66,0x6d,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00, 0x01,0x00,
        0x44,0xac,0x00,0x00, 0x88,0x58,0x01,0x00, 0x02,0x00, 0x10,0x00,
        0x64,0x61,0x74,0x61, 0x08,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      ]);
      const dir = new MockDirHandle('MyProjects');
      dir._files.set('song-a.mmvp', new MockFileHandle('song-a.mmvp', proj('song-a'), Date.now() - 5000));
      dir._files.set('song-b.mmvp', new MockFileHandle('song-b.mmvp', proj('song-b'), Date.now() - 1000));
      dir._files.set('notes.txt', new MockFileHandle('notes.txt', 'not a project', Date.now()));
      dir._files.set('song-a.wav', new MockFileHandle('song-a.wav', wavBytes, Date.now() - 5000));
      window._TEST_setProjDirHandle(dir);
      window.__mockDir = dir;
      return { fileCount: dir._files.size };
    });
    check('mock projects folder seeded', seeded.fileCount === 4, seeded);

    await page.evaluate(() => window._TEST_renderProjList());
    const listItems = await page.evaluate(() => [...document.querySelectorAll('#projList button')].map(b => b.querySelector('span').textContent));
    check('Recent Projects list shows only .mmvp files, newest first', JSON.stringify(listItems) === JSON.stringify(['song-b', 'song-a']), listItems);

    await page.evaluate(async () => {
      const fh = window.__mockDir._files.get('song-a.mmvp');
      window._TEST_loadProject(await fh.getFile());
    });
    await page.waitForTimeout(80);
    const projectName = await page.evaluate(() => window._TEST_state.projectName);
    check('opening a project from the Recent Projects list loads it', projectName === 'song-a', projectName);

    await page.evaluate(() => window._TEST_tryAutoLoadAudio('song-a'));
    await page.waitForTimeout(150);
    const audioName = await page.evaluate(() => window._TEST_audioFileName());
    check('auto-locates and loads a same-named audio file next to the opened project', audioName === 'song-a.wav', audioName);

    await page.evaluate(() => { window._TEST_state.projectName = 'brand-new-song'; });
    await page.evaluate(() => window._TEST_saveProject());
    await page.waitForTimeout(50);
    const savedInDir = await page.evaluate(() => window.__mockDir._files.has('brand-new-song.mmvp'));
    check('Save Project writes directly into the remembered folder when one is set', savedInDir === true, savedInDir);

    await page.evaluate(() => window._TEST_setProjDirHandle(null));
  });

  await withPage(browser, async (page) => {
    // IndexedDB plumbing (open/upgrade/get/put) with a plain cloneable value —
    // real FileSystemDirectoryHandle round-tripping can't be exercised
    // headlessly since it requires a native picker, but the DB layer itself
    // (shared by both) is fully testable this way.
    await page.evaluate(() => window._TEST_idbSet('testKey', { hello: 'world' }));
    const val = await page.evaluate(() => window._TEST_idbGet('testKey'));
    check('IndexedDB handle-store get/set round-trips a value', JSON.stringify(val) === JSON.stringify({ hello: 'world' }), val);
  });

  await withPage(browser, async (page) => {
    // The Recent Projects popover opens on click and closes on an outside click,
    // matching the existing recPopover/tsPanel dismissal pattern.
    await page.click('#loadProjectBtn');
    await page.waitForTimeout(50);
    const openAfterClick = await page.evaluate(() => document.getElementById('projPopover').classList.contains('open'));
    await page.mouse.click(5, 5);
    await page.waitForTimeout(50);
    const closedAfterOutsideClick = await page.evaluate(() => !document.getElementById('projPopover').classList.contains('open'));
    check('Recent Projects popover opens on click and closes on outside click',
      openAfterClick && closedAfterOutsideClick, { openAfterClick, closedAfterOutsideClick });
  });

  // ---------------- MIDI: auto-init on already-granted permission, device persistence ----------------

  await withPage(browser, async (page) => {
    // Without permission pre-granted, the app must NOT auto-connect (no
    // surprise prompt/side effect on a plain page load).
    const outDisabled = await page.evaluate(() => document.getElementById('midiOut').disabled);
    check('MIDI does not auto-connect on load without a prior permission grant', outDisabled === true, outDisabled);
  });

  {
    const midiCtx = await browser.newContext();
    await midiCtx.grantPermissions(['midi'], { origin: `http://localhost:${PORT}` });
    const page = await midiCtx.newPage();
    page.on('pageerror', e => console.log('  [page error]', e.message));
    await page.goto(URL);
    await page.waitForTimeout(600);
    // Auto-init fires (calls initMidi()) purely because navigator.permissions
    // reports 'granted', with zero clicks — verified by midiStatus changing
    // from its empty default. (Asserting a successful *connection* isn't
    // possible here: requestMIDIAccess() itself fails in this headless/CDP
    // environment since there's no real MIDI backend to attach to, even
    // though the permission grant is honored — that's an environment limit,
    // not something this test claims to cover. The button-click path already
    // uses this identical initMidi() call and works in real desktop Chrome.)
    const statusNonEmpty = await page.evaluate(() => document.getElementById('midiStatus').textContent.length > 0);
    check('MIDI auto-init fires with no click when permission is already granted',
      statusNonEmpty, { statusNonEmpty });
    await midiCtx.close();
  }

  await withPage(browser, async (page) => {
    // Device-preference persistence: localStorage round-trip for the
    // remembered MIDI Out/In device (id + name fallback). Real MIDIPort
    // objects can't be constructed in script, so this covers the storage
    // layer that populateOuts()/populateIns() read from on the next launch.
    await page.evaluate(() => localStorage.removeItem('mmv-midi-out'));
    await page.evaluate(() => window._TEST_setMidiOutById(''));
    const afterEmpty = await page.evaluate(() => localStorage.getItem('mmv-midi-out'));
    check('selecting no MIDI device does not write a bogus preference', afterEmpty === null, afterEmpty);
  });

  // ---------------- PWA: manifest + service worker ----------------

  await withPage(browser, async (page) => {
    await page.waitForTimeout(400); // let setupPWA()'s SW registration settle
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href);
    check('a web app manifest link is injected', !!href && href.startsWith('blob:'), href);

    const manifest = await page.evaluate(async (h) => (await fetch(h)).json(), href);
    check('manifest has a name, standalone display, and two icon sizes',
      manifest.name && manifest.display === 'standalone' && manifest.icons?.length === 2 &&
      manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'),
      { name: manifest.name, display: manifest.display, iconSizes: manifest.icons?.map(i => i.sizes) });

    const iconDims = await page.evaluate((src) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res(null);
      img.src = src;
    }), manifest.icons[1].src);
    check('the 512x512 manifest icon is a decodable image of the right size',
      iconDims && iconDims.w === 512 && iconDims.h === 512, iconDims);

    const swReg = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return null;
      await navigator.serviceWorker.ready;
      return { scope: reg.scope, active: !!reg.active };
    });
    check('the service worker (mmv-sw.js) registers and activates', swReg && swReg.active === true, swReg);
  });

  // ---------------- Audio track: draggable start offset ----------------

  await withPage(browser, async (page) => {
    const bytes = makeWavBytes(0.5);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(150);
    check('audio file loads', await page.evaluate(() => window._TEST_audioBufDuration()) === 0.5,
      await page.evaluate(() => window._TEST_audioBufDuration()));

    // Dragging the waveform (default: snaps to the global Snap grid, 1/16 here).
    const canvasBox = await page.locator('#audioCanvas').boundingBox();
    const y = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(canvasBox.x + 50, y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 250, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const snapped = await page.evaluate(() => window._TEST_state.audioOffset);
    const sixteenth = await page.evaluate(() => window._TEST_state.ppq / 4);
    check('dragging the audio waveform snaps the offset to the Snap grid by default',
      snapped !== 0 && snapped % sixteenth === 0, { snapped, sixteenth });

    const badge = await page.evaluate(() => ({
      text: document.getElementById('audioOffsetBadge').textContent,
      visible: document.getElementById('audioOffsetBadge').style.display !== 'none',
    }));
    check('the offset badge shows and displays a +/- duration once dragged', badge.visible && /^Off [+-]/.test(badge.text), badge);

    // Shift-drag bypasses the snap for a free-form offset (reset to 0 first
    // so the drag delta below isn't added on top of the previous sub-test's
    // leftover offset).
    await page.evaluate(() => { window._TEST_state.audioOffset = 0; });
    await page.keyboard.down('Shift');
    await page.mouse.move(canvasBox.x + 50, y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 50 + 137, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(50);
    const free = await page.evaluate(() => window._TEST_state.audioOffset);
    const pxPerTick = await page.evaluate(() => window._TEST_state.pxPerTick);
    check('holding Shift while dragging bypasses the snap for a free offset',
      Math.abs(free - Math.round(137 / pxPerTick)) <= 1, { free, expected: Math.round(137 / pxPerTick) });

    // Double-click resets the offset, and it's undoable.
    await page.mouse.dblclick(canvasBox.x + 300, y);
    await page.waitForTimeout(50);
    const afterReset = await page.evaluate(() => window._TEST_state.audioOffset);
    check('double-clicking the waveform resets the offset to 0', afterReset === 0, afterReset);

    await page.evaluate(() => window._TEST_undo());
    await page.waitForTimeout(50);
    const afterUndo = await page.evaluate(() => window._TEST_state.audioOffset);
    check('the offset drag is undoable', afterUndo === free, { afterUndo, free });

    // Roundtrips through snapshot/applyState (and therefore .mmvp saves).
    await page.evaluate((t) => { window._TEST_state.audioOffset = t; }, sixteenth * 5);
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate(() => { window._TEST_state.audioOffset = 0; });
    await page.evaluate((s) => window._TEST_applyState(s), snap);
    const roundTripped = await page.evaluate(() => window._TEST_state.audioOffset);
    check('audioOffset survives snapshot()/applyState() roundtrip', roundTripped === sixteenth * 5, roundTripped);

    // Loading a NEW file via loadAudio() alone (not through the manual
    // load-button/drop handlers) must NOT reset a just-restored offset —
    // this is exactly the path tryAutoLoadAudio takes right after opening a
    // project, and the project's saved offset has to survive it.
    await page.evaluate((t) => { window._TEST_state.audioOffset = t; }, 999);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test2.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    const preservedAcrossAutoLoad = await page.evaluate(() => window._TEST_state.audioOffset);
    check('loadAudio() alone preserves an existing offset (needed for auto-audio-load after opening a project)',
      preservedAcrossAutoLoad === 999, preservedAcrossAutoLoad);
  });

  await withPage(browser, async (page) => {
    // Playback scheduling: spy on AudioBufferSourceNode.start() to verify
    // play() accounts for the offset correctly in both directions.
    await page.evaluate(() => {
      window.__startCalls = [];
      const origStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
        window.__startCalls.push({ when, offset, duration, loopStart: this.loopStart, loopEnd: this.loopEnd, currentTime: this.context.currentTime });
        return origStart.call(this, when, offset, duration);
      };
    });
    const bytes = makeWavBytes(4);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(150);

    const oneBarTicks = await page.evaluate(() => window._TEST_state.ppq * 4);

    // Playhead before the audio's mapped start -> delayed start, buffer offset 0.
    await page.evaluate((off) => { window._TEST_state.audioOffset = off; window._TEST_state.playhead = 0; }, oneBarTicks);
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(80);
    await page.evaluate(() => window._TEST_stop());
    const call1 = await page.evaluate(() => window.__startCalls[window.__startCalls.length - 1]);
    const expectedDelay = await page.evaluate((off) => window._TEST_tickToSeconds(off), oneBarTicks);
    check('play() delays the audio source until the playhead reaches a positive offset (silent lead-in)',
      call1.offset === 0 && (call1.when - call1.currentTime) > expectedDelay * 0.9, call1);

    // Playhead already past the offset -> starts immediately at the right buffer position.
    await page.evaluate((off) => {
      window._TEST_state.audioOffset = off;
      window._TEST_state.playhead = off + window._TEST_state.ppq * 2;
    }, oneBarTicks);
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(80);
    await page.evaluate(() => window._TEST_stop());
    const call2 = await page.evaluate(() => window.__startCalls[window.__startCalls.length - 1]);
    const expectedOffsetSec = await page.evaluate(() => window._TEST_tickToSeconds(window._TEST_state.ppq * 2));
    check('play() starts immediately at the correct buffer position once the playhead is past the offset',
      Math.abs(call2.offset - expectedOffsetSec) < 0.02, { got: call2.offset, expected: expectedOffsetSec });

    // Negative offset (trim) -> starts immediately, buffer offset = |offset| + playhead.
    await page.evaluate(() => { window._TEST_state.audioOffset = -window._TEST_state.ppq; window._TEST_state.playhead = 0; });
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(80);
    await page.evaluate(() => window._TEST_stop());
    const call3 = await page.evaluate(() => window.__startCalls[window.__startCalls.length - 1]);
    const expectedTrimSec = await page.evaluate(() => window._TEST_tickToSeconds(window._TEST_state.ppq));
    check('a negative offset trims the buffer start (plays from partway into the file, no delay)',
      Math.abs(call3.offset - expectedTrimSec) < 0.02, { got: call3.offset, expected: expectedTrimSec });
  });

  // ---------------- Audio: volume slider, anti-click fades, Set Loop to Audio, arrow-key nudge ----------------

  await withPage(browser, async (page) => {
    const bytes = makeWavBytes(2);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(150);

    // Volume slider sets the gain node's target level (sampled after the
    // start fade completes) and Mute overrides it to 0 without losing the
    // slider's own value.
    await page.evaluate(() => {
      const el = document.getElementById('audioVolume');
      el.value = '40'; el.dispatchEvent(new Event('input'));
    });
    await page.evaluate(() => { window._TEST_state.audioOffset = 0; window._TEST_state.playhead = 0; });
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(120); // past the ~8ms start fade
    const gainAt40 = await page.evaluate(() => window._TEST_audioGainValue());
    check('the volume slider sets the audio gain to the chosen level', Math.abs(gainAt40 - 0.4) < 0.02, gainAt40);

    await page.click('#audioMuteBtn');
    await page.waitForTimeout(60); // past the ~8ms mute fade
    const gainMuted = await page.evaluate(() => window._TEST_audioGainValue());
    const muteOn = await page.evaluate(() => document.getElementById('audioMuteBtn').classList.contains('on'));
    check('Mute ramps the live gain to 0 without changing the volume slider', muteOn && Math.abs(gainMuted) < 0.02, { muteOn, gainMuted });

    await page.click('#audioMuteBtn');
    await page.waitForTimeout(60);
    const gainUnmuted = await page.evaluate(() => window._TEST_audioGainValue());
    const volumeVal = await page.evaluate(() => document.getElementById('audioVolume').value);
    check('unmuting restores the volume slider\'s level (not always 100%)',
      volumeVal === '40' && Math.abs(gainUnmuted - 0.4) < 0.02, { volumeVal, gainUnmuted });

    await page.evaluate(() => window._TEST_stop());
  });

  await withPage(browser, async (page) => {
    // Anti-click fades: spy on the gain AudioParam to confirm play()/stop()
    // ramp instead of jumping the value instantly.
    await page.evaluate(() => {
      window.__gainCalls = [];
      const proto = AudioParam.prototype;
      ['setValueAtTime', 'linearRampToValueAtTime', 'cancelScheduledValues'].forEach((m) => {
        const orig = proto[m];
        proto[m] = function (...args) { window.__gainCalls.push({ m, args }); return orig.apply(this, args); };
      });
    });
    const bytes = makeWavBytes(2);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__gainCalls.length = 0; });
    await page.evaluate(() => { window._TEST_state.audioOffset = 0; window._TEST_state.playhead = 0; });
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(100);
    const startRamp = await page.evaluate(() => window.__gainCalls.filter((c) => c.m === 'linearRampToValueAtTime').length);
    check('play() ramps the gain in (not an instant jump) to avoid a click', startRamp > 0, startRamp);

    await page.evaluate(() => { window.__gainCalls.length = 0; });
    await page.evaluate(() => window._TEST_stop());
    const stopRamp = await page.evaluate(() => window.__gainCalls.some((c) => c.m === 'linearRampToValueAtTime' && c.args[0] === 0));
    check('stop() ramps the gain down to 0 (not an instant cut) to avoid a click', stopRamp, stopRamp);
  });

  await withPage(browser, async (page) => {
    // "Set Loop to Audio" sets the A/B loop markers to exactly the audio's
    // current mapped span (accounting for the offset).
    const bytes = makeWavBytes(2); // 2-second buffer
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(150);
    const oneBeat = await page.evaluate(() => window._TEST_state.ppq);
    await page.evaluate((off) => { window._TEST_state.audioOffset = off; }, oneBeat);
    await page.click('#audioSetLoopBtn');
    await page.waitForTimeout(50);
    const loop = await page.evaluate(() => ({ a: window._TEST_state.locStart, b: window._TEST_state.locEnd }));
    const expectedA = oneBeat;
    const expectedB = oneBeat + await page.evaluate(() => window._TEST_secondsToTicks(2));
    check('Set Loop to Audio sets locStart to the audio offset', loop.a === expectedA, { got: loop.a, expected: expectedA });
    check('Set Loop to Audio sets locEnd to offset + audio duration (in ticks)',
      Math.abs(loop.b - expectedB) < 2, { got: loop.b, expected: expectedB });
  });

  await withPage(browser, async (page) => {
    // Arrow-key nudge: only active once the audio row has focus (set on
    // mousedown, same convention as 'cc'/'piano' focus elsewhere).
    const bytes = makeWavBytes(2);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(150);
    await page.evaluate(() => { window._TEST_state.audioOffset = 0; window._TEST_state.focus = 'piano'; });

    // Without audio focus, arrow keys must not touch audioOffset.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    const untouched = await page.evaluate(() => window._TEST_state.audioOffset);
    check('arrow keys do not nudge the audio offset unless the audio row has focus', untouched === 0, untouched);

    // Click the waveform once (without dragging) to give it focus, then nudge.
    const canvasBox = await page.locator('#audioCanvas').boundingBox();
    await page.mouse.click(canvasBox.x + 5, canvasBox.y + canvasBox.height / 2);
    await page.waitForTimeout(30);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    const afterOneNudge = await page.evaluate(() => window._TEST_state.audioOffset);
    check('ArrowRight nudges the audio offset by 1 tick once focused', afterOneNudge === 1, afterOneNudge);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    const afterBack = await page.evaluate(() => window._TEST_state.audioOffset);
    check('ArrowLeft nudges it back', afterBack === 0, afterBack);

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(30);
    const afterShiftNudge = await page.evaluate(() => window._TEST_state.audioOffset);
    const snapTick = await page.evaluate(() => window._TEST_state.ppq / 4);
    check('Shift+ArrowRight nudges by a full snap-grid step instead of 1 tick',
      afterShiftNudge === snapTick, { afterShiftNudge, snapTick });
  });

  // ---------------- CC lane Mute/Solo ----------------

  await withPage(browser, async (page) => {
    const ids = await page.evaluate(() => ({ a: window._TEST_addLane(20, 0), b: window._TEST_addLane(21, 0), c: window._TEST_addLane(22, 0) }));
    await page.evaluate((ids) => {
      document.querySelector(`.lane[data-id="${ids.a}"] input.ltags`).value = 'sceneA';
      document.querySelector(`.lane[data-id="${ids.a}"] input.ltags`).dispatchEvent(new Event('change'));
      document.querySelector(`.lane[data-id="${ids.b}"] input.ltags`).value = 'sceneA';
      document.querySelector(`.lane[data-id="${ids.b}"] input.ltags`).dispatchEvent(new Event('change'));
    }, ids);
    await page.waitForTimeout(80);

    // Individual mute
    await page.click(`.lane[data-id="${ids.a}"] .mute-btn`);
    await page.waitForTimeout(30);
    const aMuted = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).muted, ids.a);
    const aIconLit = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"] .mute-btn`).classList.contains('on'), ids.a);
    check('clicking a lane\'s M button mutes it and lights the icon', aMuted && aIconLit, { aMuted, aIconLit });

    // Individual solo on B: audibility derives correctly, A's icon is untouched by B's solo
    await page.click(`.lane[data-id="${ids.b}"] .solo-btn`);
    await page.waitForTimeout(30);
    const [audibleA, audibleB, audibleC] = await Promise.all([ids.a, ids.b, ids.c].map(id => page.evaluate((id) => window._TEST_laneAudible(id), id)));
    check('while B is soloed, only B is audible (A muted, C plain-suppressed)',
      !audibleA && audibleB && !audibleC, { audibleA, audibleB, audibleC });
    const [dimmedA, dimmedC, aIconStillLit] = await Promise.all([
      page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-dimmed'), ids.a),
      page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-dimmed'), ids.c),
      page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"] .mute-btn`).classList.contains('on'), ids.a),
    ]);
    check('solo-suppressed rows dim, but a suppressed lane\'s own Mute icon is untouched',
      dimmedA && dimmedC && aIconStillLit, { dimmedA, dimmedC, aIconStillLit });

    // Un-solo B: everyone reverts to their own stored state
    await page.click(`.lane[data-id="${ids.b}"] .solo-btn`);
    await page.waitForTimeout(30);
    const [audibleA2, audibleC2] = await Promise.all([ids.a, ids.c].map(id => page.evaluate((id) => window._TEST_laneAudible(id), id)));
    check('un-soloing reverts every lane to its own stored Mute state', !audibleA2 && audibleC2, { audibleA2, audibleC2 });

    // Rule from the spec: soloing a lane then applying tag-group Mute changes it to Muted
    // ("whichever was clicked last dictates the lane's state").
    await page.click(`.lane[data-id="${ids.a}"] .solo-btn`); // A: soloed, not muted
    const beforeTag = await page.evaluate((id) => { const l = window._TEST_state.ccLanes.find(x => x.id === id); return { muted: l.muted, soloed: l.soloed }; }, ids.a);
    const sceneAMute = async () => {
      const chip = await page.evaluateHandle(() => [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.textContent.includes('sceneA')));
      return chip.asElement().$('.mute-btn');
    };
    await (await sceneAMute()).click();
    await page.waitForTimeout(30);
    const afterTag = await page.evaluate((ids) => [ids.a, ids.b].map(id => { const l = window._TEST_state.ccLanes.find(x => x.id === id); return { muted: l.muted, soloed: l.soloed }; }), ids);
    check('a tag-group Mute click overrides an individually-soloed lane in that tag (last action wins)',
      beforeTag.soloed === true && afterTag.every(l => l.muted === true && l.soloed === false),
      { beforeTag, afterTag });

    // Smart toggle: clicking again while everyone in the group matches turns it off for all
    await (await sceneAMute()).click();
    await page.waitForTimeout(30);
    const afterSecond = await page.evaluate((ids) => [ids.a, ids.b].map(id => window._TEST_state.ccLanes.find(x => x.id === id).muted), ids);
    check('clicking a tag\'s Mute again (all already muted) un-mutes the whole group',
      afterSecond.every(m => m === false), afterSecond);

    // Long-press forces a mixed group back to one state
    await page.click(`.lane[data-id="${ids.a}"] .mute-btn`); // A muted, B not — a mixed group
    await page.waitForTimeout(30);
    const btnBox = await (await sceneAMute()).boundingBox();
    await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(30);
    const afterLongPress = await page.evaluate((ids) => [ids.a, ids.b].map(id => window._TEST_state.ccLanes.find(x => x.id === id).muted), ids);
    check('holding a tag\'s Mute button forces every lane in the group to Muted from a mixed state',
      afterLongPress.every(m => m === true), afterLongPress);

    // ALL button reaches every lane, including untagged ones
    const allSoloBtn = async () => {
      const chip = await page.evaluateHandle(() => [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.textContent.trim().startsWith('All')));
      return chip.asElement().$('.solo-btn');
    };
    await (await allSoloBtn()).click();
    await page.waitForTimeout(30);
    const allSoloed = await page.evaluate((ids) => [ids.a, ids.b, ids.c].map(id => window._TEST_state.ccLanes.find(x => x.id === id).soloed), ids);
    check('the ALL chip\'s Solo button reaches every lane, tagged or not', allSoloed.every(s => s === true), allSoloed);
  });

  await withPage(browser, async (page) => {
    // Live playback (buildPassEvents) skips inaudible lanes; export ignores
    // Mute/Solo by default and only respects them via the opt-in checkboxes.
    const ids = await page.evaluate(() => ({ a: window._TEST_addLane(30, 0), b: window._TEST_addLane(31, 0) }));
    await page.evaluate((ids) => {
      window._TEST_upsertPoint(ids.a, 0, 50);
      window._TEST_upsertPoint(ids.b, 0, 90);
      window._TEST_state.ccLanes.find(l => l.id === ids.a).muted = true;
    }, ids);

    const totalTicks = await page.evaluate(() => window._TEST_totalTicks());
    const evs = await page.evaluate((t) => window._TEST_buildPassEvents(0, t), totalTicks);
    const ccNumbers = [...new Set(evs.filter(e => e.msg && (e.msg[0] & 0xF0) === 0xB0).map(e => e.msg[1]))];
    check('live playback (buildPassEvents) skips a Muted lane\'s CC data', !ccNumbers.includes(30) && ccNumbers.includes(31), ccNumbers);

    const defaultBytes = await page.evaluate(() => window._TEST_buildMidi({}));
    const defaultParsed = await page.evaluate((b) => window._TEST_parseMidi(b), defaultBytes);
    check('export ignores Mute/Solo by default', '0_30' in defaultParsed.ccMap, Object.keys(defaultParsed.ccMap));

    const exclBytes = await page.evaluate(() => window._TEST_buildMidi({ excludeMuted: true }));
    const exclParsed = await page.evaluate((b) => window._TEST_parseMidi(b), exclBytes);
    check('export with "Exclude Muted lanes" checked leaves the muted lane out',
      !('0_30' in exclParsed.ccMap) && '0_31' in exclParsed.ccMap, Object.keys(exclParsed.ccMap));

    await page.evaluate((id) => { window._TEST_state.ccLanes.find(l => l.id === id).soloed = true; window._TEST_state.ccLanes.find(l => l.id === id).muted = false; }, ids.a);
    const soloBytes = await page.evaluate(() => window._TEST_buildMidi({ soloOnly: true }));
    const soloParsed = await page.evaluate((b) => window._TEST_parseMidi(b), soloBytes);
    check('export with "Export Solo lanes only" checked includes just the soloed lane',
      '0_30' in soloParsed.ccMap && !('0_31' in soloParsed.ccMap), Object.keys(soloParsed.ccMap));

    await page.evaluate((id) => { window._TEST_state.ccLanes.find(l => l.id === id).soloed = false; }, ids.a);
    const soloNoneBytes = await page.evaluate(() => window._TEST_buildMidi({ soloOnly: true }));
    const soloNoneParsed = await page.evaluate((b) => window._TEST_parseMidi(b), soloNoneBytes);
    check('"Export Solo lanes only" with nothing soloed is a no-op (exports everything, not nothing)',
      '0_30' in soloNoneParsed.ccMap && '0_31' in soloNoneParsed.ccMap, Object.keys(soloNoneParsed.ccMap));
  });

  await withPage(browser, async (page) => {
    // Mute/Solo are mutually exclusive on a single lane, undoable, and
    // persist through snapshot()/applyState() (and therefore .mmvp saves).
    const id = await page.evaluate(() => window._TEST_addLane(40, 0));
    await page.click(`.lane[data-id="${id}"] .solo-btn`);
    await page.click(`.lane[data-id="${id}"] .mute-btn`);
    await page.waitForTimeout(30);
    const state1 = await page.evaluate((id) => { const l = window._TEST_state.ccLanes.find(x => x.id === id); return { muted: l.muted, soloed: l.soloed }; }, id);
    check('setting Mute on a lane clears its Solo', state1.muted === true && state1.soloed === false, state1);

    await page.evaluate(() => window._TEST_undo());
    await page.waitForTimeout(30);
    const afterUndo = await page.evaluate((id) => { const l = window._TEST_state.ccLanes.find(x => x.id === id); return { muted: l.muted, soloed: l.soloed }; }, id);
    check('mute/solo toggles are undoable', afterUndo.muted === false && afterUndo.soloed === true, afterUndo);

    await page.evaluate((id) => { window._TEST_state.ccLanes.find(l => l.id === id).muted = true; window._TEST_state.ccLanes.find(l => l.id === id).soloed = false; }, id);
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate((id) => { const l = window._TEST_state.ccLanes.find(x => x.id === id); l.muted = false; }, id);
    await page.evaluate((s) => window._TEST_applyState(s), snap);
    const restored = await page.evaluate((id) => window._TEST_state.ccLanes.find(x => x.id === id).muted, id);
    check('lane.muted/lane.soloed survive snapshot()/applyState() roundtrip', restored === true, restored);
  });

  // ---------------- Audio doesn't silently carry over between projects ----------------

  await withPage(browser, async (page) => {
    // Loading a different project must clear any audio left over from
    // whatever was open before — audio isn't part of a .mmvp's own data,
    // so without this it would silently keep playing the wrong track.
    const bytes = makeWavBytes(1);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'projA.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(120);
    check('audio loads into the current project', await page.evaluate(() => window._TEST_audioBufDuration()) === 1, null);

    const projB = JSON.stringify({
      version: 1, projectName: 'project-b', audioFile: '',
      snapshot: { notes: [], ccLanes: [], bpm: 120, bars: 4, tsNum: 4, tsDen: 4, tsMap: [{ tick: 0, num: 4, den: 4 }], ppq: 480, next: 1, pitchNames: {}, projectName: 'project-b', locS: null, locE: null, audioOffset: 0 },
    });
    await page.evaluate((json) => {
      const file = new File([json], 'projB.mmvp', { type: 'application/json' });
      return window._TEST_loadProject(file);
    }, projB);
    await page.waitForTimeout(120);
    const durationAfter = await page.evaluate(() => window._TEST_audioBufDuration());
    const nameAfter = await page.evaluate(() => window._TEST_audioFileName());
    check('loading a project with no audio of its own clears the previous project\'s audio',
      durationAfter === null && nameAfter === 'No audio', { durationAfter, nameAfter });
  });

  await withPage(browser, async (page) => {
    // Manual removal via the × button next to Load.
    const bytes = makeWavBytes(1);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(120);
    await page.click('#audioClearBtn');
    await page.waitForTimeout(80);
    const duration = await page.evaluate(() => window._TEST_audioBufDuration());
    const name = await page.evaluate(() => window._TEST_audioFileName());
    check('the audio clear (×) button removes the loaded audio', duration === null && name === 'No audio', { duration, name });
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
