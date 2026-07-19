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
      '  window._TEST_GUTTER = () => GUTTER;',
      '  window._TEST_requestDraw = () => { drawAll(); };',
      '  window._TEST_laneClientPos = (laneId, t, v) => { const l = state.ccLanes.find(x => x.id === laneId); const rect = l._scroll.getBoundingClientRect(); return { x: tickToX(t) + rect.left - state.scrollLeft + GUTTER, y: val2yForLane(l._canvas.height, v, l) + rect.top }; };',
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
      '  window._TEST_generate = (kind) => generate(kind);',
      '  window._TEST_autosaveTick = () => autosaveTick();',
      '  window._TEST_autosaveMarkClean = () => autosaveMarkClean();',
      '  window._TEST_checkAutosaveRestore = () => checkAutosaveRestore();',
      '  window._TEST_noteName = (p) => noteName(p);',
      '  init();',
    ].join('\n')
  );
  html = html.replace(
    'function showISFDialog(header, filename, sourceText){',
    'window._TEST_showISFDialog=(h,f,s)=>showISFDialog(h,f,s);\n    function showISFDialog(header, filename, sourceText){'
  );
  html = html.replace(
    'function openMigrateSheet(entry){',
    [
      'window._TEST_openMigratePicker=()=>openMigratePicker();',
      '    window._TEST_openMigrateSheet=(entry)=>openMigrateSheet(entry);',
      '    window._TEST_isLaneAutomated=(id)=>isLaneAutomated(state.ccLanes.find(l=>l.id===id));',
      '    window._TEST_computeModifiers=(row)=>computeModifiers(row);',
      '    window._TEST_ccToNative=(row,cc)=>ccToNative(row,cc);',
      '    function openMigrateSheet(entry){',
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
  // A real desktop viewport, not Playwright's 1280x720 default: this app's
  // toolbar/audio/piano/velocity rows alone are a fixed ~520px tall, which
  // left so little room for the lane list at 720px tall that a single
  // default-height lane could be squeezed below its own content's natural
  // minimum size and silently overflow its scroll container's clipped box
  // — a real, but purely viewport-driven, layout edge case unrelated to
  // whatever a given test is actually exercising.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => console.log('  [page error]', e.message));
  await page.goto(URL);
  await page.waitForTimeout(250);
  // A fresh project no longer seeds a default CC1 lane (v0.9.10) — most
  // tests aren't exercising that startup behavior at all and just relied on
  // a lane existing as scaffolding (ccLanes[0], etc). Seed one baseline lane
  // here so every test's actual premise still holds; the couple of tests
  // that specifically verify the NEW empty-start behavior open their own
  // page directly instead of going through this helper.
  await page.evaluate(() => window._TEST_addLane(1, 0));
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

  {
    // A genuinely fresh load (not routed through withPage(), which seeds a
    // baseline lane as scaffolding for the rest of this suite) must start
    // with zero CC lanes — the old always-add-a-default-CC1-lane startup
    // behavior was removed in v0.9.10.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await page.goto(URL);
    await page.waitForTimeout(250);
    const laneCount = await page.evaluate(() => window._TEST_state.ccLanes.length);
    check('a fresh project starts with zero CC lanes (no default CC1 auto-added)', laneCount === 0, laneCount);
    await page.close();
  }

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
    // withPage() seeds one baseline pristine CC1/Ch0 lane; adding a second
    // (non-pristine, cc=2) is what makes projectHasContent() true here.
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
      return { left: rr.left, top: rr.top, height: rr.height, px: window._TEST_state.pxPerTick, scrollLeft: window._TEST_state.scrollLeft, gutter: window._TEST_GUTTER() };
    });
    await page.mouse.click(r.left + 3840 * r.px - r.scrollLeft + r.gutter, r.top + r.height / 2);
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
      return { left: rr.left, top: rr.top, height: rr.height, px: window._TEST_state.pxPerTick, scrollLeft: window._TEST_state.scrollLeft, gutter: window._TEST_GUTTER() };
    });
    await page.mouse.move(r.left + 2000 * r.px - r.scrollLeft + r.gutter + 20, r.top + r.height / 2);
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

  // ---------------- v0.9.3: ringed transport cluster (metronome/follow/scroll-lock) ----------------

  await withPage(browser, async (page) => {
    // Play/Stop/Record/Metronome/Follow MMV/Scroll Lock now all live inside
    // one ringed .transport-grp (same styling as .tool-grp/.snap-grp), in
    // that order, and the old big standalone "Follow MMV"/"Scroll Lock" text
    // buttons are gone.
    const info = await page.evaluate(() => {
      const grp = document.querySelector('.transport-grp');
      const ids = ['playBtn', 'stopBtn', 'recordBtn', 'metroBtn', 'syncFollow', 'scrollLockBtn'];
      const allInGroup = grp ? ids.every(id => grp.contains(document.getElementById(id))) : false;
      const order = grp ? [...grp.querySelectorAll('button, #recWrapper button')].map(el => el.id).filter(Boolean) : [];
      return {
        hasTransportGrp: !!grp,
        grpClasses: grp ? [...grp.classList] : [],
        allInGroup,
        metroBeforeFollow: order.indexOf('metroBtn') >= 0 && order.indexOf('metroBtn') < order.indexOf('syncFollow'),
        followBeforeScrollLock: order.indexOf('syncFollow') >= 0 && order.indexOf('syncFollow') < order.indexOf('scrollLockBtn'),
        noBigFollowText: ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Follow MMV'),
        noBigScrollLockText: ![...document.querySelectorAll('button')].some(b => b.textContent.includes('Scroll Lock')),
      };
    });
    check('transport cluster (play/stop/record/metronome/follow/scroll-lock) is wrapped in the ringed .transport-grp',
      info.hasTransportGrp && info.grpClasses.includes('transport-grp') && info.allInGroup, info);
    check('metronome sits before Follow MMV, which sits before Scroll Lock, in the transport cluster',
      info.metroBeforeFollow && info.followBeforeScrollLock, info);
    check('the old big "Follow MMV" / "Scroll Lock" text buttons are gone (now compact icons)',
      info.noBigFollowText && info.noBigScrollLockText, info);
  });

  await withPage(browser, async (page) => {
    // Metronome button now shows an inline SVG icon (cross-platform-safe),
    // not the old bell emoji glyph.
    const metro = await page.evaluate(() => {
      const btn = document.getElementById('metroBtn');
      return { hasSvg: !!btn.querySelector('svg'), text: btn.textContent.trim() };
    });
    check('metronome button uses an inline SVG icon instead of the bell emoji', metro.hasSvg && metro.text === '', metro);
  });

  await withPage(browser, async (page) => {
    // Follow MMV: now icon-only but still the same toggle on the same id.
    const before = await page.evaluate(() => ({ state: window._TEST_state.syncFollow, on: document.getElementById('syncFollow').classList.contains('on') }));
    await page.click('#syncFollow');
    const afterOn = await page.evaluate(() => ({ state: window._TEST_state.syncFollow, on: document.getElementById('syncFollow').classList.contains('on') }));
    await page.click('#syncFollow');
    const afterOff = await page.evaluate(() => ({ state: window._TEST_state.syncFollow, on: document.getElementById('syncFollow').classList.contains('on') }));
    check('Follow MMV toggle button still works (compact icon form)',
      before.state === false && !before.on && afterOn.state === true && afterOn.on && afterOff.state === false && !afterOff.on,
      { before, afterOn, afterOff });
  });

  await withPage(browser, async (page) => {
    // Scroll Lock: now icon-only but the same #scrollLockBtn id/semantics.
    const before = await page.evaluate(() => ({ state: window._TEST_state.scrollLock, on: document.getElementById('scrollLockBtn').classList.contains('on') }));
    await page.click('#scrollLockBtn');
    const afterOn = await page.evaluate(() => ({ state: window._TEST_state.scrollLock, on: document.getElementById('scrollLockBtn').classList.contains('on') }));
    await page.click('#scrollLockBtn');
    const afterOff = await page.evaluate(() => ({ state: window._TEST_state.scrollLock, on: document.getElementById('scrollLockBtn').classList.contains('on') }));
    check('Scroll Lock toggle button still works (compact icon form)',
      before.state === false && !before.on && afterOn.state === true && afterOn.on && afterOff.state === false && !afterOff.on,
      { before, afterOn, afterOff });
  });

  await withPage(browser, async (page) => {
    // Toggling the metronome mid-playback must start (or stop) producing
    // clicks on the very next scheduler pass, not only once the loop happens
    // to restart. Spy on OscillatorNode.prototype.start (playClickTone is
    // closure-scoped and otherwise unreachable) to observe actual click
    // scheduling.
    await page.evaluate(() => {
      window.__oscStarts = [];
      const orig = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (when) {
        window.__oscStarts.push(when);
        return orig.call(this, when);
      };
      window._TEST_state.metronomeOn = false;
      // A long note spanning the whole test window — "a track is already
      // playing" (the user's report) implies real content in the pass;
      // without it the pass's event list would be empty from tick 0, which
      // hits an unrelated pre-existing scheduler quirk (immediate pass
      // rollover with no events to actually play) that isn't what's under
      // test here.
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 60, start: 0, length: window._TEST_state.ppq * 64, vel: 100, ch: 0 });
    });

    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(150);
    const beforeToggle = await page.evaluate(() => window.__oscStarts.length);
    check('no clicks are scheduled while the metronome is off during playback', beforeToggle === 0, beforeToggle);

    await page.click('#metroBtn'); // toggle ON mid-playback
    await page.waitForTimeout(700);
    const afterToggleOn = await page.evaluate(() => window.__oscStarts.length);
    check('toggling the metronome ON mid-playback starts producing clicks without stopping/restarting playback',
      afterToggleOn > 0, afterToggleOn);

    await page.click('#metroBtn'); // toggle OFF mid-playback
    await page.waitForTimeout(300); // let any already-committed lookahead clicks flush through
    const settleCount = await page.evaluate(() => window.__oscStarts.length);
    await page.waitForTimeout(700);
    const afterToggleOff = await page.evaluate(() => window.__oscStarts.length);
    await page.evaluate(() => window._TEST_stop());
    check('toggling the metronome OFF mid-playback stops further clicks from being scheduled',
      afterToggleOff === settleCount, { settleCount, afterToggleOff });
  });

  // ---------------- v0.9.3: ruler segment labels honor the timeline format ----------------

  await withPage(browser, async (page) => {
    async function subLabels(mode) {
      await page.evaluate((m) => { window._TEST_state.pxPerTick = 0.5; }, mode);
      await page.selectOption('#rulerMode', mode);
      return page.evaluate(() => {
        const ctx = document.getElementById('rulerCanvas').getContext('2d');
        const out = [];
        const origFillText = ctx.fillText.bind(ctx);
        ctx.fillText = (text, x, y) => { out.push(text); return origFillText(text, x, y); };
        window.dispatchEvent(new Event('resize'));
        return new Promise(resolve => setTimeout(() => resolve(out), 200));
      });
    }
    const mmss = await subLabels('mmss');
    const noBeatNumbersMmss = !['2', '3', '4'].some(n => mmss.includes(n));
    const hasMmssLabel = mmss.some(t => /^\d+:\d{2}$/.test(t));
    check('ruler mm:ss format: intra-bar labels show times (m:ss), not bare beat numbers', noBeatNumbersMmss && hasMmssLabel, mmss);

    const hhmmss = await subLabels('hhmmss');
    const noBeatNumbersHms = !['2', '3', '4'].some(n => hhmmss.includes(n));
    const hasHmsLabel = hhmmss.some(t => /^\d{2}:\d{2}:\d{2}$/.test(t));
    check('ruler hh:mm:ss format: intra-bar labels show times (hh:mm:ss), not bare beat numbers', noBeatNumbersHms && hasHmsLabel, hhmmss);

    const secs = await subLabels('secs');
    const noBeatNumbersSecs = !['2', '3', '4'].some(n => secs.includes(n));
    const hasSecsLabel = secs.some(t => /^\d+\.\d{2}$/.test(t));
    check('ruler seconds format: intra-bar labels show times (ssss.ss), not bare beat numbers', noBeatNumbersSecs && hasSecsLabel, secs);

    // Switching back to bars mode restores plain beat numbers (no regression).
    const bars = await subLabels('bars');
    check('switching back to bars mode restores plain beat-number labels (2/3/4)',
      ['2', '3', '4'].every(n => bars.includes(n)), bars);
  });

  // ---------------- Note editing: left/right edge resize ----------------

  async function dragNoteEdge(page, note, edge, deltaTicks) {
    const pt = await page.evaluate(({ note, edge }) => {
      const rect = document.getElementById('prScroll').getBoundingClientRect();
      const px = window._TEST_state.pxPerTick, nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const tick = edge === 'left' ? note.start : note.start + note.length;
      const nudge = edge === 'left' ? 2 : -2;
      const x = tick * px - window._TEST_state.scrollLeft + window._TEST_GUTTER() + nudge;
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
      const x = tick * px - window._TEST_state.scrollLeft + window._TEST_GUTTER();
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
      const x = tick * px - window._TEST_state.scrollLeft + window._TEST_GUTTER();
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
    // Note Info is a true single row (v0.9.13, replacing the old header-row
    // + 4-column-grid layout): toggle, title (width-permitting), note
    // details, V label+value, Position, Channel button — all direct
    // children of #noteInfoLeft .ni-row, in that left-to-right order.
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('#noteInfoLeft .ni-row > *')].map(el => el.id || el.className));
    check('Note Info renders as one row: toggle, title, note, V-label, V, Pos, Ch — in order',
      JSON.stringify(order) === JSON.stringify(['niToggleBtn', 'ni-title', 'noteInfoNote', 'mini-lbl', 'velValInput', 'noteInfoPos', 'noteInfoCh']),
      order);
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
    // Note Info's whole box is one row now (v0.9.13) — Note/V/Pos/Ch (and
    // the toggle/title) all share the same top, not just Ch and Pos.
    const tops = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect().top;
      return { pos: r('noteInfoPos'), ch: r('noteInfoCh'), note: r('noteInfoNote'), vel: r('velValInput'), toggle: r('niToggleBtn') };
    });
    // Small tolerance: the row's children have slightly different natural
    // heights (e.g. the 16px Channel button vs the 19px Pos/Vel inputs) and
    // are vertically centered (align-items:center), so their tops can differ
    // by a couple of px while still genuinely sharing the same flex row.
    const vals = Object.values(tops);
    const spread = Math.max(...vals) - Math.min(...vals);
    check('Note Info Ch/Pos/Note/Vel/toggle all sit on the same single row', spread <= 3, tops);
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
    check('left side-panel defaults to its max width (300px)', keysW === 300, keysW);
    const cssVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--keys-w').trim());
    check('the --keys-w CSS var matches the 300px default at load', cssVar === '300px', cssVar);
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
    // Shrinking a lane via the grip has a floor of "row 1 (Toggle/CC/Name/
    // Channel/Colour, always visible outside .lanebody) + row 2 (×/Val/Pos/
    // Steps/Mute/Solo)" — it can never go small enough for row 2 to be cut
    // off, and row 3 (Tag pill/Move) hides outright once it no longer fits,
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
      const row1 = r.querySelector('.lane-row1'), row2 = r.querySelector('.row2'), row3 = r.querySelector('.row3');
      return {
        rowHeight: r.offsetHeight,
        compact2: r.classList.contains('lane-compact2'),
        row1Visible: row1.getBoundingClientRect().height > 0,
        row2Visible: row2.getBoundingClientRect().height > 0,
        row3Visible: getComputedStyle(row3).display !== 'none',
      };
    });
    check('shrinking a lane below the 3-row height hides row 3 (Tag pill/Move) but keeps rows 1+2 visible',
      shrunk.compact2 && shrunk.row1Visible && shrunk.row2Visible && !shrunk.row3Visible, shrunk);
    check('the grip cannot shrink a lane below the row-1+row-2 minimum height (LANE_MIN_H)',
      shrunk.rowHeight >= 64, shrunk.rowHeight);
  });

  await withPage(browser, async (page) => {
    // Minimizing a lane (row 1's single ▾/▸ toggle) hides row 2, row 3, and
    // the curve canvas, but row 1 itself — the SAME CC/Name/Channel/Colour
    // elements used when expanded, not a duplicate — stays exactly as it
    // was: showing the custom name, CC#, and now (unlike the old v0.9.7
    // top-bar, which deliberately dropped it) the Channel button too, since
    // Channel lives in row 1 now rather than behind a hidden row 2.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.fill('.lane input.lname', 'sequenceProgress');
    await page.dispatchEvent('.lane input.lname', 'input');
    // Set the channel via the popover flow (channel is a button, not a
    // fill-able number input) so we can prove it's still tracked correctly
    // and still visibly shown while minimized.
    await page.click('.lane .chn-btn');
    await page.waitForTimeout(30);
    await page.click('#chPopover .ch-opt:nth-child(3)'); // "3" (index 2 = channel 3)
    await page.waitForTimeout(30);
    // Real pointer click, not a dispatched one: proving every icon is a
    // real, unclipped hit target — see the "hittable at real pointer
    // coordinates" test below, which proves this for every icon in the row.
    await page.click('.lane .toggle-btn[title="Minimize lane"]');
    await page.waitForTimeout(50);
    const info = await page.evaluate((id) => {
      const row = document.querySelector('.lane');
      return {
        hidden: row.classList.contains('lane-hidden'),
        name: row.querySelector('input.lname').value,
        cc: row.querySelector('.lane-row1 .ccn').textContent,
        chnLabel: row.querySelector('.chn-btn').textContent,
        toggleGlyph: row.querySelector('.toggle-btn').textContent,
        toggleTitle: row.querySelector('.toggle-btn').title,
        row1Visible: row.querySelector('.lane-row1').getBoundingClientRect().height > 0,
        lanebodyHidden: getComputedStyle(row.querySelector('.lanebody')).display === 'none',
        laneCh: window._TEST_state.ccLanes.find(l => l.id === id).ch,
      };
    }, laneId);
    check('minimizing a lane hides the canvas/rows 2-3 but keeps row 1 (Name/CC/Channel) showing the same live data',
      info.hidden && info.lanebodyHidden && info.row1Visible && info.name === 'sequenceProgress'
      && info.cc !== '' && info.chnLabel === 'Ch3' && info.laneCh === 2, info);
    check('the toggle button flips to the "maximize" glyph/title once minimized',
      info.toggleGlyph === '▸' && info.toggleTitle === 'Maximize lane', info);
  });

  await withPage(browser, async (page) => {
    // The Minimize/Maximize control is ONE real two-state toggle, not a
    // one-way Hide paired with a separate Show — prove both directions work
    // by checking row 2/row 3/canvas visibility (not just a CSS class) each
    // time, and that the same click target and glyph/title convention holds
    // in both states.
    const laneId = await page.evaluate(() => window._TEST_addLane(33, 0));
    await page.waitForTimeout(50);
    async function state() {
      return page.evaluate((id) => {
        const row = document.querySelector(`.lane[data-id="${id}"]`);
        const row2 = row.querySelector('.row2'), row3 = row.querySelector('.row3'), canvas = row.querySelector('canvas');
        const toggle = row.querySelector('.toggle-btn');
        return {
          hiddenClass: row.classList.contains('lane-hidden'),
          row2Visible: row2.getBoundingClientRect().height > 0 && getComputedStyle(row.querySelector('.lanebody')).display !== 'none',
          row3Visible: row3.getBoundingClientRect().height > 0 && getComputedStyle(row.querySelector('.lanebody')).display !== 'none',
          canvasVisible: getComputedStyle(canvas).display !== 'none' && canvas.getBoundingClientRect().width > 0,
          glyph: toggle.textContent, title: toggle.title, on: toggle.classList.contains('on'),
        };
      }, laneId);
    }
    const initial = await state();
    check('a freshly added lane starts expanded: row 2, row 3, and the canvas all visible, toggle shows ▾/"Minimize lane"',
      !initial.hiddenClass && initial.row2Visible && initial.row3Visible && initial.canvasVisible
      && initial.glyph === '▾' && initial.title === 'Minimize lane' && !initial.on, initial);

    await page.click(`.lane[data-id="${laneId}"] .toggle-btn`);
    await page.waitForTimeout(50);
    const afterMin = await state();
    check('clicking the toggle minimizes: row 2, row 3, and the canvas all hide, toggle flips to ▸/"Maximize lane"/.on',
      afterMin.hiddenClass && !afterMin.row2Visible && !afterMin.row3Visible && !afterMin.canvasVisible
      && afterMin.glyph === '▸' && afterMin.title === 'Maximize lane' && afterMin.on, afterMin);

    await page.click(`.lane[data-id="${laneId}"] .toggle-btn`);
    await page.waitForTimeout(50);
    const afterMax = await state();
    check('clicking the SAME toggle again maximizes it back: row 2, row 3, and the canvas all reappear, toggle flips back to ▾/"Minimize lane"',
      !afterMax.hiddenClass && afterMax.row2Visible && afterMax.row3Visible && afterMax.canvasVisible
      && afterMax.glyph === '▾' && afterMax.title === 'Minimize lane' && !afterMax.on, afterMax);
  });

  await withPage(browser, async (page) => {
    // Row 1 is the SAME element tree whether expanded or minimized (no
    // stripped-down duplicate) — prove every one of its controls is still
    // genuinely functional while minimized: CC# edit, Name edit, the
    // Channel popover, and colour cycling (colour cycling is covered by its
    // own dedicated test elsewhere; this one covers CC/Name/Channel).
    const laneId = await page.evaluate(() => window._TEST_addLane(60, 0));
    await page.waitForTimeout(50);
    await page.click(`.lane[data-id="${laneId}"] .toggle-btn`);
    await page.waitForTimeout(50);
    const hiddenNow = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-hidden'), laneId);
    check('lane is minimized before exercising row 1 controls', hiddenNow, hiddenNow);

    // CC# picker popover opens + a selection commits, while minimized (same
    // click-to-open-popover UX as Channel, exercised below).
    await page.click(`.lane[data-id="${laneId}"] .lane-row1 .ccn`);
    await page.waitForTimeout(30);
    const ccPopOpen = await page.evaluate(() => document.getElementById('ccPopover').classList.contains('open'));
    check('the CC# popover opens from row 1 while the lane is minimized', ccPopOpen, ccPopOpen);
    await page.click('#ccPopover .cc-opt:nth-child(78)'); // 78th entry = CC 77
    await page.waitForTimeout(30);
    const ccAfter = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).cc, laneId);
    check('selecting a CC from the popover works while the lane is minimized', ccAfter === 77, ccAfter);

    // Name edit while minimized
    await page.fill(`.lane[data-id="${laneId}"] input.lname`, 'brightnessCurve');
    await page.dispatchEvent(`.lane[data-id="${laneId}"] input.lname`, 'input');
    await page.waitForTimeout(30);
    const nameAfter = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).name, laneId);
    check('editing the Name input works while the lane is minimized', nameAfter === 'brightnessCurve', nameAfter);

    // Channel popover opens + a selection commits, while minimized
    await page.click(`.lane[data-id="${laneId}"] .chn-btn`);
    await page.waitForTimeout(30);
    const popOpen = await page.evaluate(() => document.getElementById('chPopover').classList.contains('open'));
    check('the Channel popover opens from row 1 while the lane is minimized', popOpen, popOpen);
    await page.click('#chPopover .ch-opt:nth-child(7)'); // channel index 6 (Ch7)
    await page.waitForTimeout(30);
    const chAfter = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).ch, laneId);
    const btnLabelAfter = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"] .chn-btn`).textContent, laneId);
    check('selecting a channel from the popover while minimized updates lane.ch and the button label',
      chAfter === 6 && btnLabelAfter === 'Ch7', { chAfter, btnLabelAfter });
  });

  // ---------------- Lane icon ergonomics (item 4) ----------------

  await withPage(browser, async (page) => {
    // Row 1's icon/button controls (Minimize/Maximize toggle, Channel,
    // Colour swatch, Move/drag-to-reorder handle — back in row 1 as of
    // v0.9.13) must be real, unclipped, >=16px hit targets that a genuine
    // pointer click can land on, in the order: toggle — CC# — Name —
    // Channel — Colour — Move.
    const laneId = await page.evaluate(() => window._TEST_addLane(30, 0));
    await page.waitForTimeout(50);
    const sel = {
      toggle: `.lane[data-id="${laneId}"] .toggle-btn`,
      chn: `.lane[data-id="${laneId}"] .lane-row1 .chn-btn`,
      swatch: `.lane[data-id="${laneId}"] .lane-row1 .swatch`,
      drag: `.lane[data-id="${laneId}"] .lane-row1 .drag-handle`,
    };
    const hittable = await page.evaluate((sel) => {
      const out = {};
      for (const [k, s] of Object.entries(sel)) {
        const el = document.querySelector(s);
        if (!el) { out[k] = false; continue; }
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) { out[k] = false; continue; }
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        out[k] = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }
      return out;
    }, sel);
    check('every per-lane row-1 icon (Minimize toggle/Channel/swatch/Move) has a real, unclipped hit target at its own screen coordinates',
      Object.values(hittable).every(Boolean), hittable);

    const sizes = await page.evaluate((sel) => {
      const out = {};
      for (const k of Object.keys(sel)) {
        const r = document.querySelector(sel[k]).getBoundingClientRect();
        out[k] = { w: Math.round(r.width), h: Math.round(r.height) };
      }
      return out;
    }, sel);
    check('per-lane row-1 toggle/Channel/swatch/Move icons are all >=16px hit targets',
      Object.values(sizes).every(s => s.w >= 16 && s.h >= 16), sizes);

    const positions = await page.evaluate((laneId) => {
      const row = document.querySelector(`.lane[data-id="${laneId}"] .lane-row1`);
      const q = sel => row.querySelector(sel).getBoundingClientRect().left;
      return { toggle: q('.toggle-btn'), ccn: q('.ccn'), lname: q('.lname'), chn: q('.chn-btn'), swatch: q('.swatch'), drag: q('.drag-handle') };
    }, laneId);
    check('row 1 layout: Toggle is left of CC#, which is left of Name, which is left of Channel, which is left of Colour, which is left of Move',
      positions.toggle < positions.ccn && positions.ccn < positions.lname && positions.lname < positions.chn && positions.chn < positions.swatch && positions.swatch < positions.drag, positions);

    // Real Playwright pointer click (no force:true, no dispatchEvent) must
    // actually land and trigger the real behavior, not just report a
    // non-empty bounding box.
    await page.click(sel.toggle);
    const hiddenAfterRealClick = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-hidden'), laneId);
    check('a real pointer click on the toggle button actually minimizes the lane (not force-clicked, not dispatched)',
      hiddenAfterRealClick === true, hiddenAfterRealClick);
  });

  await withPage(browser, async (page) => {
    // Row 2's icon controls (×, Mute, Solo) must be real, unclipped,
    // >=16px hit targets. Row 2's deliberate left/right split: × sits
    // alone on the far left, Value/Position/Steps/Mute/Solo grouped on the
    // far right — proven here by real coordinates, not just class presence.
    const laneId = await page.evaluate(() => window._TEST_addLane(31, 0));
    await page.waitForTimeout(50);
    const sel = {
      del: `.lane[data-id="${laneId}"] .x`,
      mute: `.lane[data-id="${laneId}"] .mute-btn`,
      solo: `.lane[data-id="${laneId}"] .solo-btn`,
    };
    const hittable = await page.evaluate((sel) => {
      const out = {};
      for (const [k, s] of Object.entries(sel)) {
        const el = document.querySelector(s);
        if (!el) { out[k] = false; continue; }
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) { out[k] = false; continue; }
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        out[k] = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }
      return out;
    }, sel);
    check('every per-lane row-2 icon (×/Mute/Solo) has a real, unclipped hit target at its own screen coordinates',
      Object.values(hittable).every(Boolean), hittable);

    const sizes = await page.evaluate((sel) => {
      const out = {};
      for (const k of Object.keys(sel)) {
        const r = document.querySelector(sel[k]).getBoundingClientRect();
        out[k] = { w: Math.round(r.width), h: Math.round(r.height) };
      }
      return out;
    }, sel);
    check('per-lane ×/Mute/Solo icons are all >=16px hit targets', Object.values(sizes).every(s => s.w >= 16 && s.h >= 16), sizes);

    const positions = await page.evaluate((sel) => {
      const out = {};
      for (const [k, s] of Object.entries(sel)) { out[k] = document.querySelector(s).getBoundingClientRect().left; }
      return out;
    }, sel);
    check('row 2 layout: × is left of Mute, which is left of Solo',
      positions.del < positions.mute && positions.mute < positions.solo, positions);

    // Real Playwright pointer clicks (no force:true, no dispatchEvent) must
    // actually land and trigger the real behavior, not just report a
    // non-empty bounding box.
    await page.click(sel.mute);
    const mutedAfterRealClick = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).muted, laneId);
    check('a real pointer click on the Mute icon actually toggles mute (not force-clicked, not dispatched)',
      mutedAfterRealClick === true, mutedAfterRealClick);
  });

  await withPage(browser, async (page) => {
    // v0.9.13: the drag-to-reorder handle moved back to row 1 (after
    // Colour) — row 3 now keeps just the Tag pill. Still a real, unclipped,
    // >=16px hit target, and it's no longer present in row 3 at all.
    const laneId = await page.evaluate(() => window._TEST_addLane(31, 0));
    await page.waitForTimeout(50);
    const info = await page.evaluate((id) => {
      const row = document.querySelector(`.lane[data-id="${id}"]`);
      const drag = row.querySelector('.lane-row1 .drag-handle');
      const row3HasDrag = !!row.querySelector('.row3 .drag-handle');
      if (!drag) return { found: false, row3HasDrag };
      const r = drag.getBoundingClientRect();
      const swatchRect = row.querySelector('.lane-row1 .swatch').getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        found: true, row3HasDrag,
        w: Math.round(r.width), h: Math.round(r.height),
        hittable: !!hit && (hit === drag || drag.contains(hit) || hit.contains(drag)),
        afterSwatch: r.left >= swatchRect.right - 1,
      };
    }, laneId);
    check('row 1 ends with a real, unclipped, >=16px drag-to-reorder handle after Colour, and row 3 no longer has one',
      info.found && info.w >= 16 && info.h >= 16 && info.hittable && info.afterSwatch && info.row3HasDrag === false, info);
  });

  await withPage(browser, async (page) => {
    // Lane colour is a swatch button in row 1 (moved there from row 2 in
    // v0.9.9) — same click-to-cycle-LANE_COLORS behavior via a real pointer
    // click, and every element showing this lane's color (row 1's swatch,
    // the tag-pill dot) stays in sync.
    const laneId = await page.evaluate(() => window._TEST_addLane(40, 0));
    await page.waitForTimeout(50);
    const before = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).color, laneId);
    await page.click(`.lane[data-id="${laneId}"] .lane-row1 .swatch`);
    await page.waitForTimeout(30);
    const after = await page.evaluate((id) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === id);
      const row = document.querySelector(`.lane[data-id="${id}"]`);
      return {
        color: lane.color,
        row1SwatchBg: getComputedStyle(row.querySelector('.lane-row1 .swatch')).backgroundColor,
        tagDotBg: getComputedStyle(row.querySelector('.tag-pill-dot')).backgroundColor,
      };
    }, laneId);
    check('a real pointer click on the row-1 colour swatch cycles the lane\'s color',
      after.color !== before, { before, after });
    check('cycling the colour keeps the row-1 swatch and the tag-pill dot in sync',
      after.row1SwatchBg === after.tagDotBg, after);

    // Row 1 (including its swatch) is the SAME element while minimized —
    // no separate duplicate — so clicking it there must cycle color too.
    const beforeMin = after.color;
    await page.click(`.lane[data-id="${laneId}"] .toggle-btn`);
    await page.waitForTimeout(30);
    await page.click(`.lane[data-id="${laneId}"] .lane-row1 .swatch`);
    await page.waitForTimeout(30);
    const afterMin = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).color, laneId);
    check('a real pointer click on the swatch still cycles the lane\'s color while the lane is minimized (same element, no duplicate)',
      afterMin !== beforeMin, { beforeMin, afterMin });
  });

  // ---------------- Row 2: Position field width + 3-way alignment (v0.9.13) ----------------

  await withPage(browser, async (page) => {
    // .pos-input widened to comfortably fit up to a 4-digit-bar BBT string
    // ("1234.12.12.123") without truncating — previously only ~38px wide,
    // enough for "1.1.1." before clipping.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    const fit = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      const input = lane._posInput;
      input.value = '1234.12.12.123';
      return { value: input.value, clientWidth: input.clientWidth, scrollWidth: input.scrollWidth };
    }, laneId);
    check('the widened .pos-input comfortably fits the largest realistic BBT string ("1234.12.12.123") without truncating',
      fit.scrollWidth <= fit.clientWidth + 1, fit);
  });

  await withPage(browser, async (page) => {
    // Row 2 now has three explicit groups: × hard left, Value/Position/
    // Steps grouped and CENTERED (.row2-center), Mute/Solo hard right
    // (.row2-right) — not just "whatever's left after the other two".
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    const layout = await page.evaluate((laneId) => {
      const row = document.querySelector(`.lane[data-id="${laneId}"] .row2`);
      const rowRect = row.getBoundingClientRect();
      const center = row.querySelector('.row2-center').getBoundingClientRect();
      const right = row.querySelector('.row2-right').getBoundingClientRect();
      const x = row.querySelector('.x').getBoundingClientRect();
      return {
        rowCenterX: rowRect.left + rowRect.width / 2,
        centerGroupMidX: center.left + center.width / 2,
        xRight: x.right, centerLeft: center.left, centerRight: center.right, rightLeft: right.left,
      };
    }, laneId);
    const offset = Math.abs(layout.rowCenterX - layout.centerGroupMidX);
    check('row 2\'s Value/Position/Steps group reads as genuinely centered in the row (not lopsided toward either edge)',
      offset <= 15, { offset, ...layout });
    check('× stays left of the center group, which stays left of Mute/Solo (3-way split, not clipped/overlapping)',
      layout.xRight <= layout.centerLeft + 1 && layout.centerRight <= layout.rightLeft + 1, layout);
  });

  // ---------------- CC lane: full-height curve canvas (v0.9.13) ----------------

  await withPage(browser, async (page) => {
    // The curve canvas now visually spans the lane's FULL height (row 1 +
    // row 2 + row 3 combined) when expanded, not just rows 2+3 — reclaiming
    // the "dead" strip to the right of row 1 that existed since v0.9.9 (row
    // 1 became a sibling of .lanebody so it stays visible when minimized,
    // which meant the curve canvas — a normal-flow child of .lanebody —
    // only ever spanned .lanebody's own height).
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    const info = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      const laneRect = lane._row.getBoundingClientRect();
      const scrollRect = lane._scroll.getBoundingClientRect();
      const row1Rect = lane._row.querySelector('.lane-row1').getBoundingClientRect();
      const gripRect = lane._row.querySelector('.grip').getBoundingClientRect();
      return {
        laneTop: laneRect.top, laneBottom: laneRect.bottom,
        scrollTop: scrollRect.top, scrollBottom: scrollRect.bottom,
        row1Top: row1Rect.top, row1Bottom: row1Rect.bottom,
        gripTop: gripRect.top,
        canvasHeight: lane._canvas.height,
      };
    }, laneId);
    check('the curve canvas starts at the very top of the lane (level with row 1), not below row 1',
      Math.abs(info.scrollTop - info.laneTop) <= 1, info);
    check('the curve canvas extends down to just above the grip (full lane height), not stopping at rows 2+3',
      info.scrollBottom > info.row1Bottom + 10 && Math.abs(info.scrollBottom - info.gripTop) <= 2, info);
    check('the canvas\'s own pixel height (._canvas.height) matches the full lane height, not just rows 2+3',
      Math.abs(info.canvasHeight - (info.laneBottom - info.laneTop - 7)) <= 2, info);
  });

  await withPage(browser, async (page) => {
    // Minimized lane: canvas must still be FULLY hidden (a confirmed
    // decision from an earlier round) — this is not regressed by the
    // full-height change, since the canvas's scroll wrapper is still a DOM
    // descendant of .lanebody, which display:none hides regardless of its
    // own position:absolute.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.click(`.lane[data-id="${laneId}"] .toggle-btn`);
    await page.waitForTimeout(50);
    const info = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      const r = lane._scroll.getBoundingClientRect();
      return {
        lanebodyDisplay: getComputedStyle(lane._row.querySelector('.lanebody')).display,
        scrollVisible: r.width > 0 && r.height > 0,
      };
    }, laneId);
    check('a minimized lane still shows NO canvas at all (the full-height change did not regress this)',
      info.lanebodyDisplay === 'none' && info.scrollVisible === false, info);
  });

  await withPage(browser, async (page) => {
    // Click-to-value hit-testing must still resolve to the correct value
    // given the new taller canvas — the Y math (laneCoords()/
    // y2valForLane()) reads off lane._scroll's own getBoundingClientRect()
    // and lane._canvas.height, both of which now reflect the full lane
    // height, so this should "just work" without touching the hit-test math
    // itself. Use the existing _TEST_laneClientPos bridge (computes real
    // screen coordinates for a given tick/value) to click a specific value.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.evaluate(() => { window._TEST_state.tool = 'draw'; }); // pencil tool creates a point on mousedown unconditionally
    const pos = await page.evaluate((laneId) => window._TEST_laneClientPos(laneId, 480, 100), laneId);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(30);
    const pt = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      return lane.points.find(p => Math.abs(p.t - 480) < 20);
    }, laneId);
    check('clicking at a computed (tick,value) screen position on the full-height canvas still creates a point at the correct value',
      !!pt && Math.abs(pt.v - 100) <= 2, pt);
  });

  await withPage(browser, async (page) => {
    // The grip still resizes the lane's overall height, and the canvas
    // grows/shrinks along with it (its CSS height is derived from the
    // lane's own height via top:0/bottom:7px, not a fixed value).
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    const before = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      return { rowH: lane._row.offsetHeight, canvasH: lane._canvas.height };
    }, laneId);
    const gripBox = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      const r = lane._row.querySelector('.grip').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, laneId);
    await page.mouse.move(gripBox.x, gripBox.y);
    await page.mouse.down();
    await page.mouse.move(gripBox.x, gripBox.y + 80, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const after = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      return { rowH: lane._row.offsetHeight, canvasH: lane._canvas.height };
    }, laneId);
    check('dragging the grip resizes the lane, and the canvas grows along with it',
      after.rowH > before.rowH + 40 && after.canvasH > before.canvasH + 40, { before, after });
  });

  await withPage(browser, async (page) => {
    // Horizontal scroll sync: scrolling the timeline still keeps the
    // curve's horizontal position correct relative to the ruler/piano-roll/
    // other lanes — worth re-confirming since the canvas's scroll wrapper
    // switched from normal flex flow to position:absolute.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.evaluate(() => { window._TEST_state.pxPerTick = 0.5; window._TEST_requestDraw(); });
    await page.evaluate(() => { document.getElementById('prScroll').scrollLeft = 300; });
    await page.waitForTimeout(50);
    const synced = await page.evaluate((laneId) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === laneId);
      return {
        prScrollLeft: document.getElementById('prScroll').scrollLeft,
        laneScrollLeft: lane._scroll.scrollLeft,
      };
    }, laneId);
    check('scrolling the timeline keeps the CC lane canvas horizontally in sync with the piano roll',
      synced.laneScrollLeft === synced.prScrollLeft && synced.prScrollLeft === 300, synced);
  });

  // ---------------- Channel picker popover ----------------

  await withPage(browser, async (page) => {
    // Channel is now a button (not a free-typing number input) that opens a
    // shared popover listing all 16 MIDI channels by number and configured
    // name (state.channelNames[]), matching the "N (name)" convention
    // already used by the View Ch select / Recording Setup select.
    await page.evaluate(() => {
      window._TEST_state.channelNames[0] = 'Kick';
      window._TEST_state.channelNames[15] = 'Sync Track';
    });
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    const btnLabelBefore = await page.evaluate(() => document.querySelector('.lane .chn-btn').textContent);
    check('the Channel control in row 1 is a button labeled "Ch N", not a number input',
      btnLabelBefore === 'Ch1', btnLabelBefore);

    await page.click('.lane .chn-btn');
    await page.waitForTimeout(30);
    const popState = await page.evaluate(() => {
      const pop = document.getElementById('chPopover');
      const opts = [...pop.querySelectorAll('.ch-opt')];
      return {
        open: pop.classList.contains('open'),
        count: opts.length,
        firstLabel: opts[0].textContent,
        ch16Label: opts[15].textContent,
        ch16IsAmber: getComputedStyle(opts[15]).color,
        otherColor: getComputedStyle(opts[1]).color,
        ch16HasWarnClass: opts[15].classList.contains('ch16'),
      };
    });
    check('clicking the Channel button opens a popover listing all 16 MIDI channels with their configured names',
      popState.open && popState.count === 16 && popState.firstLabel === '1 (Kick)' && popState.ch16Label === '16 (Sync Track)', popState);
    check('Channel 16 in the popover is visually flagged amber (reserved for the Follow-MMV sync track)',
      popState.ch16HasWarnClass && popState.ch16IsAmber !== popState.otherColor && popState.ch16IsAmber === 'rgb(255, 180, 84)', popState);

    // Selecting a channel updates lane.ch, the button's own label, and
    // closes the popover.
    await page.click('#chPopover .ch-opt:nth-child(5)'); // "5 (...)" = channel index 4
    await page.waitForTimeout(30);
    const afterSelect = await page.evaluate((id) => ({
      ch: window._TEST_state.ccLanes.find(l => l.id === id).ch,
      btnLabel: document.querySelector('.lane .chn-btn').textContent,
      popoverOpen: document.getElementById('chPopover').classList.contains('open'),
    }), laneId);
    check('selecting a channel in the popover updates lane.ch, the button label, and closes the popover',
      afterSelect.ch === 4 && afterSelect.btnLabel === 'Ch5' && !afterSelect.popoverOpen, afterSelect);
  });

  await withPage(browser, async (page) => {
    // The channel popover closes on outside click and on Escape, matching
    // how #recPopover/#tsPanel/#projPopover already behave.
    await page.click('.lane .chn-btn');
    await page.waitForTimeout(30);
    const openBefore = await page.evaluate(() => document.getElementById('chPopover').classList.contains('open'));
    await page.mouse.click(5, 5); // far corner, outside the popover and the button
    await page.waitForTimeout(30);
    const closedAfterOutsideClick = await page.evaluate(() => !document.getElementById('chPopover').classList.contains('open'));
    check('the channel popover opens on click and closes on an outside click',
      openBefore && closedAfterOutsideClick, { openBefore, closedAfterOutsideClick });

    await page.click('.lane .chn-btn');
    await page.waitForTimeout(30);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(30);
    const closedAfterEscape = await page.evaluate(() => !document.getElementById('chPopover').classList.contains('open'));
    check('the channel popover closes on Escape',
      closedAfterEscape, closedAfterEscape);
  });

  // ---------------- Minimized-lane drag-to-reorder (v0.9.13: restored) ----------------

  await withPage(browser, async (page) => {
    // v0.9.9 moved the drag-to-reorder handle out of row 1 into row 3
    // (hidden along with the rest of .lanebody while minimized) because row
    // 1 didn't have room; that meant a minimized lane could no longer be
    // reordered without maximizing it first. v0.9.13 moves the handle back
    // into row 1 (after Colour) now that there's room, which — as a direct
    // consequence — restores the ability to drag-reorder a MINIMIZED lane
    // without expanding it first. This test proves the NEW capability
    // (replacing the old test that proved the opposite limitation): the
    // handle stays usable while minimized, and a real HTML5 DnD sequence
    // (mousedown arms row.draggable, then dragstart/dragover/drop) actually
    // reorders a minimized lane.
    const idA = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    const idB = await page.evaluate(() => window._TEST_addLane(50, 0));
    await page.waitForTimeout(50);
    await page.click(`.lane[data-id="${idB}"] .toggle-btn`);
    await page.waitForTimeout(50);
    const minimizedState = await page.evaluate((idB) => {
      const rowB = document.querySelector(`.lane[data-id="${idB}"]`);
      const dragHandle = rowB.querySelector('.lane-row1 .drag-handle');
      return {
        hidden: rowB.classList.contains('lane-hidden'),
        dragUsable: !!dragHandle && dragHandle.getBoundingClientRect().height > 0,
      };
    }, idB);
    check('a minimized lane\'s row-1 drag-to-reorder handle is still a real, visible, usable hit target',
      minimizedState.hidden === true && minimizedState.dragUsable === true, minimizedState);

    // Actually drag-reorder it WHILE STILL MINIMIZED (no maximize step).
    const orderBefore = await page.evaluate(() => window._TEST_state.ccLanes.map(l => l.id));
    const result = await page.evaluate(({ idA, idB }) => {
      const rowA = document.querySelector(`.lane[data-id="${idA}"]`);
      const rowB = document.querySelector(`.lane[data-id="${idB}"]`);
      if (!rowB.classList.contains('lane-hidden')) return { error: 'lane B unexpectedly not minimized' };
      const dragHandle = rowB.querySelector('.lane-row1 .drag-handle');
      if (!dragHandle) return { error: 'no row-1 drag handle on the minimized lane' };
      dragHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      if (!rowB.draggable) return { error: 'row.draggable not armed by drag-handle mousedown', draggable: rowB.draggable };
      const dt = new DataTransfer();
      rowB.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const r = rowA.getBoundingClientRect();
      rowA.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: r.top + 1, dataTransfer: dt }));
      rowA.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientY: r.top + 1, dataTransfer: dt }));
      rowB.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }, { idA, idB });
    await page.waitForTimeout(50);
    const orderAfter = await page.evaluate(() => window._TEST_state.ccLanes.map(l => l.id));
    check('a MINIMIZED lane can be drag-reordered via row 1\'s Move handle, with no maximize step required',
      !result.error && orderBefore.indexOf(idB) > orderBefore.indexOf(idA) && orderAfter.indexOf(idB) < orderAfter.indexOf(idA),
      { result, orderBefore, orderAfter });
  });

  // ---------------- Password-manager opt-out attributes ----------------

  await withPage(browser, async (page) => {
    // 1Password/LastPass/Bitwarden autofill icons collided with the lane
    // Name field's typed text; both free-text fields (Name, Tags) opt out
    // with every ignore attribute each password manager respects. Number/
    // select inputs (Steps, Val, Pos) deliberately do NOT get these —
    // password managers don't target them. CC# is no longer even an input —
    // it's a button that opens the #ccPopover picker — so it's structurally
    // immune to autofill rather than needing an opt-out attribute.
    const attrs = await page.evaluate(() => {
      const lname = document.querySelector('.lane input.lname');
      const ltags = document.querySelector('.lane input.ltags');
      const ccn = document.querySelector('.lane .lane-row1 .ccn');
      const get = (el) => ({
        autocomplete: el.getAttribute('autocomplete'),
        onep: el.getAttribute('data-1p-ignore'),
        lp: el.getAttribute('data-lpignore'),
        bw: el.getAttribute('data-bwignore'),
      });
      return { lname: get(lname), ltags: get(ltags), ccnTag: ccn.tagName };
    });
    check('the lane Name field carries autocomplete=off + 1Password/LastPass/Bitwarden ignore attributes',
      attrs.lname.autocomplete === 'off' && attrs.lname.onep === 'true' && attrs.lname.lp === 'true' && attrs.lname.bw === 'true', attrs.lname);
    check('the lane Tags field carries autocomplete=off + 1Password/LastPass/Bitwarden ignore attributes',
      attrs.ltags.autocomplete === 'off' && attrs.ltags.onep === 'true' && attrs.ltags.lp === 'true' && attrs.ltags.bw === 'true', attrs.ltags);
    check('CC# is a real <button> (picker popover), not a free-text/number field a password manager could target',
      attrs.ccnTag === 'BUTTON', attrs.ccnTag);
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
    // Setting Steps via the val-row input snaps future points to N
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
    // Tolerance widened from +/-2 to +/-4 in v0.9.9: row 1 now sits above the
    // canvas as its own fixed-height strip instead of sharing the lanebody's
    // column with rows 2/3 (see buildLaneDom), so a default-height lane's
    // canvas is ~30px shorter than before — coarser value-per-pixel
    // resolution means a few steps of mouse interpolation land a couple of
    // value-units further off target than they used to. The behavior under
    // test (Shift bypasses the Steps snap) is unchanged; only the pixel
    // math changed.
    check('holding Shift while dragging a point bypasses Steps snapping', Math.abs(bypassedV - 60) <= 4, bypassedV);
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

  // ---------------- Migrate to MMV: automation classifier + modifier math ----------------

  await withPage(browser, async (page) => {
    // isLaneAutomated must classify by whether the sampled value ever
    // changes, not by where the points sit on the timeline — a lane with
    // two points at different ticks but the same value should still read as
    // static (this is the exact refinement over a position-based heuristic
    // discussed in the strategy notes).
    const laneId = await page.evaluate(() => window._TEST_addLane(30, 0));
    await page.evaluate((id) => window._TEST_upsertPoint(id, 0, 50), laneId);
    let auto = await page.evaluate((id) => window._TEST_isLaneAutomated(id), laneId);
    check('isLaneAutomated: a single point is always static', auto === false, auto);

    await page.evaluate((id) => window._TEST_upsertPoint(id, 5000, 50), laneId);
    auto = await page.evaluate((id) => window._TEST_isLaneAutomated(id), laneId);
    check('isLaneAutomated: two points, same value, second one far from bar 1 -> still static (value-based, not position-based)', auto === false, auto);

    await page.evaluate((id) => window._TEST_upsertPoint(id, 5000, 100), laneId);
    auto = await page.evaluate((id) => window._TEST_isLaneAutomated(id), laneId);
    check('isLaneAutomated: value actually changes across the timeline -> automated', auto === true, auto);
  });

  await withPage(browser, async (page) => {
    // computeModifiers: Scale=MAX-MIN / Offset=MIN for every type, Step only
    // for discrete long/bool with even native spacing, and an explicit
    // warning (never a silently wrong guess) for an irregular VALUES array.
    const cutTypeRow = { name: 'CutType', type: 'long', min: 0, max: 7, steps: 8, values: null };
    const girdleRow = { name: 'GirdleRadius', type: 'float', min: 0.1, max: 10 };
    const weirdRow = { name: 'Weird', type: 'long', min: 0, max: 9, values: [0, 1, 2, 5, 9], steps: 5 };
    const boolRow = { name: 'Enabled', type: 'bool', min: 0, max: 1 };
    const modsCut = await page.evaluate((r) => window._TEST_computeModifiers(r), cutTypeRow);
    const modsGirdle = await page.evaluate((r) => window._TEST_computeModifiers(r), girdleRow);
    const modsWeird = await page.evaluate((r) => window._TEST_computeModifiers(r), weirdRow);
    const modsBool = await page.evaluate((r) => window._TEST_computeModifiers(r), boolRow);
    check('computeModifiers: integer long range -> Scale=MAX-MIN, Offset=MIN, Step=1 (matches the CutType example from the strategy notes)',
      modsCut.scale === 7 && modsCut.offset === 0 && modsCut.step === 1, modsCut);
    check('computeModifiers: continuous float -> Scale=MAX-MIN, Offset=MIN, Step not applicable',
      Math.abs(modsGirdle.scale - 9.9) < 1e-9 && Math.abs(modsGirdle.offset - 0.1) < 1e-9 && modsGirdle.step === null, modsGirdle);
    check('computeModifiers: bool -> Step=1', modsBool.step === 1, modsBool);
    check('computeModifiers: irregular VALUES spacing flags a warning instead of guessing a Step',
      modsWeird.step === null && !!modsWeird.warning, modsWeird);

    const native0 = await page.evaluate((r) => window._TEST_ccToNative(r, 0), girdleRow);
    const native127 = await page.evaluate((r) => window._TEST_ccToNative(r, 127), girdleRow);
    check('ccToNative maps CC 0 -> MIN and CC 127 -> MAX', Math.abs(native0 - 0.1) < 1e-9 && Math.abs(native127 - 10) < 1e-9, { native0, native127 });
  });

  await withPage(browser, async (page) => {
    // Full migrate-sheet flow: import an ISF (including a color, which
    // splits into 4 lanes), automate one parameter, open the sheet, and
    // check the table reflects automation state correctly before exporting.
    const migHeader = {
      INPUTS: [
        { NAME: 'CutType', TYPE: 'long', MIN: 0, MAX: 7, DEFAULT: 1 },
        { NAME: 'GirdleRadius', TYPE: 'float', MIN: 0.1, MAX: 10, DEFAULT: 3.0 },
        { NAME: 'TintColor', TYPE: 'color', DEFAULT: [0.2, 0.4, 0.6, 1] },
      ],
    };
    const migSource = '/*\n' + JSON.stringify(migHeader, null, 2) + '\n*/\nvoid main(){ gl_FragColor = vec4(1.0); }\n';

    await page.evaluate(({ h, s }) => window._TEST_showISFDialog(h, 'gem.fs', s), { h: migHeader, s: migSource });
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.querySelectorAll('#isfDialog tbody tr').forEach(tr => tr.querySelector('input[type=checkbox]').click()); });
    await page.click('#isfDialog button:has-text("Import Lanes")');
    await page.waitForTimeout(100);

    const linked = await page.evaluate(() => window._TEST_state.ccLanes.filter(l => l.isf).map(l => ({ name: l.isf.name, min: l.isf.min, max: l.isf.max, type: l.isf.type, batchId: l.isf.batchId })));
    const cutLinked = linked.find(l => l.name === 'CutType');
    check('ISF import links each lane to its source param via lane.isf (name/min/max/type)',
      cutLinked && cutLinked.min === 0 && cutLinked.max === 7 && cutLinked.type === 'long', cutLinked);
    check('ISF import creates 4 linked lanes for a color input (R/G/B/A)', linked.filter(l => l.name.startsWith('TintColor.')).length === 4, linked.map(l => l.name));

    const entry = await page.evaluate(() => { const h = window._TEST_state.isfHistory; return h[h.length - 1]; });
    check('isfHistory entry retains the raw ISF source text (the prerequisite gap from the strategy notes is closed)',
      typeof entry.source === 'string' && entry.source.includes('CutType'), entry.source.slice(0, 40));
    check('every imported lane\'s isf.batchId matches its isfHistory entry id', linked.every(l => l.batchId === entry.id), { entryId: entry.id, batchIds: linked.map(l => l.batchId) });

    const girdleId = await page.evaluate(() => window._TEST_state.ccLanes.find(l => l.isf && l.isf.name === 'GirdleRadius').id);
    await page.evaluate((id) => window._TEST_upsertPoint(id, 10000, 100), girdleId); // makes GirdleRadius automated

    await page.evaluate((e) => window._TEST_openMigrateSheet(e), entry);
    await page.waitForTimeout(150);
    const rowsInfo = await page.evaluate(() => Array.from(document.querySelectorAll('#isfMigrateDialog tbody tr')).map(tr => {
      const tds = tr.querySelectorAll('td');
      return { name: tds[0].textContent, automated: tds[3].textContent.trim(), updateChecked: tds[4].querySelector('input').checked, wireChecked: tds[5].querySelector('input').checked };
    }));
    const girdleRow = rowsInfo.find(r => r.name === 'GirdleRadius');
    const cutRow = rowsInfo.find(r => r.name === 'CutType');
    check('Migrate sheet marks the modified lane as automated, with Wiring Sheet pre-checked',
      girdleRow && girdleRow.automated === 'automated' && girdleRow.wireChecked === true, girdleRow);
    check('Migrate sheet marks an untouched lane as static, with Wiring Sheet NOT pre-checked',
      cutRow && cutRow.automated === 'static' && cutRow.wireChecked === false, cutRow);
    check('Migrate sheet pre-checks "Update Default" for every row regardless of automation state',
      rowsInfo.every(r => r.updateChecked === true), rowsInfo);

    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('#isfMigrateDialog button:has-text("Export")');
    await page.waitForTimeout(400);
    check('Export produces two downloads: the migrated ISF and the wiring sheet', downloads.length === 2,
      downloads.map(d => d.suggestedFilename()));

    const isfDl = downloads.find(d => d.suggestedFilename().endsWith('.migrated.fs'));
    const sheetDl = downloads.find(d => d.suggestedFilename().endsWith('-wiring-sheet.txt'));
    if (isfDl) {
      const content = fs.readFileSync(await isfDl.path(), 'utf8');
      const m = content.match(/\/\*\s*([\s\S]*?)\s*\*\//);
      const newHeader = m && JSON.parse(m[1]);
      const cutInput = newHeader && newHeader.INPUTS.find(i => i.NAME === 'CutType');
      // playhead is at tick 0; CutType's lane still holds only its import-time
      // default CC (round((1-0)/7*127) = 18), so baking it back through
      // ccToNative should land on 18/127*7 = 126/127, not the original 1 —
      // this is the CC-quantization loss the feature is expected to apply,
      // not a bug to round away.
      check('Exported ISF rewrites a static parameter\'s DEFAULT to the playhead-derived native value (through real CC quantization)',
        cutInput && Math.abs(cutInput.DEFAULT - 126 / 127) < 1e-6, cutInput);
    } else {
      check('Exported ISF download present', false, downloads.map(d => d.suggestedFilename()));
    }
    if (sheetDl) {
      const sheetText = fs.readFileSync(await sheetDl.path(), 'utf8');
      check('Wiring sheet includes the automated parameter but not the static one',
        sheetText.includes('GirdleRadius') && !sheetText.includes('CutType'), sheetText.slice(0, 200));
      check('Wiring sheet states the Scale-before-Offset stacking requirement',
        /Scale.*ABOVE.*Offset/.test(sheetText), sheetText.includes('ABOVE'));
    } else {
      check('Wiring sheet download present', false, downloads.map(d => d.suggestedFilename()));
    }
  });

  await withPage(browser, async (page) => {
    // lane.isf and isfHistory[].source must survive the same snapshot()/
    // applyState() roundtrip every other piece of lane/project data does
    // (undo, save/load) — otherwise a reloaded project would silently lose
    // its ability to migrate.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.evaluate((id) => {
      window._TEST_state.ccLanes.find(l => l.id === id).isf = { batchId: 99, name: 'Foo', type: 'float', min: 0, max: 1, steps: 0, values: null, isColor: false, colorCh: null };
      window._TEST_state.isfHistory.push({ id: 99, filename: 'foo.fs', label: 'Foo', importedAt: new Date().toISOString(), source: '/* {"INPUTS":[]} */', lanes: [] });
    }, laneId);
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate((id) => { window._TEST_state.ccLanes.find(l => l.id === id).isf = null; window._TEST_state.isfHistory = []; }, laneId);
    await page.evaluate((s) => window._TEST_applyState(s), snap);
    const restored = await page.evaluate((id) => ({
      isf: window._TEST_state.ccLanes.find(l => l.id === id).isf,
      historyLen: window._TEST_state.isfHistory.length,
      source: window._TEST_state.isfHistory[0] && window._TEST_state.isfHistory[0].source,
    }), laneId);
    check('lane.isf survives snapshot()/applyState() roundtrip', restored.isf && restored.isf.name === 'Foo' && restored.isf.min === 0 && restored.isf.max === 1, restored.isf);
    check('isfHistory[].source survives snapshot()/applyState() roundtrip', restored.historyLen === 1 && restored.source === '/* {"INPUTS":[]} */', restored);
  });

  await withPage(browser, async (page) => {
    // With more than one retained-source import, the picker lists both and
    // clicking an entry opens that entry's sheet.
    const h1 = { INPUTS: [{ NAME: 'A', TYPE: 'float', MIN: 0, MAX: 1, DEFAULT: 0.5 }] };
    const h2 = { INPUTS: [{ NAME: 'B', TYPE: 'float', MIN: 0, MAX: 1, DEFAULT: 0.5 }] };
    for (const [h, name] of [[h1, 'one.fs'], [h2, 'two.fs']]) {
      const src = '/*\n' + JSON.stringify(h, null, 2) + '\n*/\nvoid main(){}\n';
      await page.evaluate(({ hh, ss, nn }) => window._TEST_showISFDialog(hh, nn, ss), { hh: h, ss: src, nn: name });
      await page.waitForTimeout(100);
      await page.evaluate(() => { document.querySelectorAll('#isfDialog tbody tr').forEach(tr => tr.querySelector('input[type=checkbox]').click()); });
      await page.click('#isfDialog button:has-text("Import Lanes")');
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => window._TEST_openMigratePicker());
    await page.waitForTimeout(100);
    const pickerCount = await page.locator('#isfMigratePicker button').count(); // includes Cancel
    check('Migrate picker lists both retained-source imports (plus Cancel)', pickerCount === 3, pickerCount);
    await page.click('#isfMigratePicker button:has-text("two.fs")');
    await page.waitForTimeout(100);
    const sheetTitle = await page.locator('#isfMigrateDialog').isVisible().catch(() => false);
    check('Clicking a picker entry opens that entry\'s migrate sheet', sheetTitle === true, sheetTitle);
  });

  // ---------------- GENERATE strip: 6 shapes + direction toggle (item 6) ----------------

  await withPage(browser, async (page) => {
    // The old strip was 12 buttons (Ramp/Exp/Sine/Tri/Sqr/Step x up/down);
    // the new one is 6 shape buttons plus a single #genDirToggle that
    // applies to all of them. generate(kind) itself didn't change — the
    // buttons just keep their [data-gen] kind string in sync with the
    // toggle — so for every shape+direction combo, clicking the shape
    // button through the real UI must produce byte-identical points to
    // calling generate() directly with the old kind string.
    const laneId = await page.evaluate(() => window._TEST_addLane(20, 0));
    await page.waitForTimeout(50);
    await page.evaluate((laneId) => {
      window._TEST_state.activeLaneId = laneId;
      window._TEST_state.locStart = 0;
      window._TEST_state.locEnd = 1920; // fixed range, independent of playhead
    }, laneId);

    const OLD_PAIRS = {
      ramp: ['rampUp', 'rampDown'],
      exp: ['exp', 'expDown'],
      sine: ['sine', 'sineDown'],
      tri: ['tri', 'triDown'],
      square: ['square', 'squareDown'],
      step: ['step', 'stepDown'],
    };
    async function resetLanePoints(laneId) {
      await page.evaluate((id) => {
        const l = window._TEST_state.ccLanes.find(x => x.id === id);
        l.points = [{ t: 0, v: 0 }];
      }, laneId);
    }
    async function lanePointsJson(laneId) {
      return page.evaluate((id) => JSON.stringify(window._TEST_state.ccLanes.find(x => x.id === id).points), laneId);
    }
    async function directGenerate(kind, laneId) {
      await resetLanePoints(laneId);
      await page.evaluate((kind) => window._TEST_generate(kind), kind);
      return lanePointsJson(laneId);
    }
    async function uiGenerate(shape, laneId) {
      await resetLanePoints(laneId);
      await page.click(`.gen-grp [data-shape="${shape}"]`);
      return lanePointsJson(laneId);
    }

    const mismatches = [];
    // Direction starts at Up (↗) by default — verify all 6 shapes there first.
    for (const [shape, [upKind]] of Object.entries(OLD_PAIRS)) {
      const expected = await directGenerate(upKind, laneId);
      const actual = await uiGenerate(shape, laneId);
      if (expected !== actual) mismatches.push({ shape, dir: 'up', expected, actual });
    }
    // Flip the single toggle once, then verify all 6 shapes Down (↘).
    await page.click('#genDirToggle');
    const toggleLabel = await page.evaluate(() => document.getElementById('genDirToggle').textContent.trim());
    check('the direction toggle button shows ↘ after one click', toggleLabel === '↘', toggleLabel);
    for (const [shape, [, downKind]] of Object.entries(OLD_PAIRS)) {
      const expected = await directGenerate(downKind, laneId);
      const actual = await uiGenerate(shape, laneId);
      if (expected !== actual) mismatches.push({ shape, dir: 'down', expected, actual });
    }
    check('every shape+direction combination produces byte-identical points to the old 12-button pairing',
      mismatches.length === 0, mismatches);
  });

  await withPage(browser, async (page) => {
    // With no active lane, the shape buttons must be disabled with an
    // explanatory tooltip — deleting the only lane (going through the real
    // removeLane()/refreshActive() path, not a manual state edit) drops
    // activeLaneId back to null and should disable them again.
    const before = await page.evaluate(() => ({
      disabled: document.querySelector('.gen-grp [data-shape="ramp"]').disabled,
      hasActiveLane: !!window._TEST_state.ccLanes.find(l => l.id === window._TEST_state.activeLaneId),
    }));
    check('GENERATE shape buttons start enabled with the app\'s default active lane',
      before.hasActiveLane && before.disabled === false, before);

    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    page.once('dialog', d => d.accept());
    await page.click(`.lane[data-id="${laneId}"] .x`);
    await page.waitForTimeout(50);

    const after = await page.evaluate(() => ({
      lanesLeft: window._TEST_state.ccLanes.length,
      activeLaneId: window._TEST_state.activeLaneId,
      disabled: document.querySelector('.gen-grp [data-shape="ramp"]').disabled,
      title: document.querySelector('.gen-grp [data-shape="ramp"]').title,
    }));
    check('deleting the only lane disables the GENERATE shape buttons and explains why',
      after.lanesLeft === 0 && after.activeLaneId === null && after.disabled === true && /lane/i.test(after.title), after);
  });

  // ---------------- Lane tags / filter bar ----------------

  await withPage(browser, async (page) => {
    // withPage's own baseline lane is added with no active filter, so it
    // already carries the default "New" tag (see _addLane / item 1 below) —
    // the tag bar is therefore visible from the very start here, not
    // hidden. Confirm that, then prove the bar's visibility still genuinely
    // tracks "does any lane have any tag" (not just hardcoded on) by
    // clearing that lane's only tag and checking the bar hides again.
    const barState = await page.evaluate(() => ({
      display: document.getElementById('tagFilterBar').style.display,
      chipTexts: [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].map(b => b.textContent),
    }));
    check('a freshly added lane (no active filter) defaults to a "New" tag, so the tag bar shows immediately',
      barState.display === 'flex' && barState.chipTexts.some(t => t.startsWith('New')), barState);

    const firstId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.click(`.lane[data-id="${firstId}"] .tag-pill`);
    await page.fill(`.lane[data-id="${firstId}"] input.ltags`, '');
    await page.dispatchEvent(`.lane[data-id="${firstId}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    const displayAfterClear = await page.evaluate(() => document.getElementById('tagFilterBar').style.display);
    check('clearing the only lane\'s tag hides the tag bar again (visibility still tracks "any lane has any tag", not hardcoded on)',
      displayAfterClear === 'none', displayAfterClear);
  });

  // ---------------- Item 1: new lanes default to tag "New" ----------------

  await withPage(browser, async (page) => {
    // No active filter (the common case) -> defaults to tags:['New'].
    const id = await page.evaluate(() => window._TEST_addLane(30, 0));
    const tags = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('a new lane added with no active tag filter defaults to tags:["New"]',
      JSON.stringify(tags) === JSON.stringify(['New']), tags);
  });

  await withPage(browser, async (page) => {
    // When a tag filter IS active, a newly added lane must inherit ONLY the
    // active filter's tag(s), unchanged from the existing behavior — "New"
    // must NOT also be tacked on top of that (that would just be clutter on
    // an already-organized lane). Also covered incidentally by the older
    // "lane created while a filter is active inherits the selected filter
    // tags" test further down; this one isolates it against the new "New"
    // default specifically.
    const idA = await page.evaluate(() => window._TEST_addLane(31, 0));
    await page.click(`.lane[data-id="${idA}"] .tag-pill`);
    await page.fill(`.lane[data-id="${idA}"] input.ltags`, 'kaleido');
    await page.dispatchEvent(`.lane[data-id="${idA}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].find(b => b.textContent.startsWith('kaleido'));
      chip.click();
    });
    await page.waitForTimeout(50);
    const idB = await page.evaluate(() => window._TEST_addLane(32, 0));
    const tagsB = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, idB);
    check('a lane added while a tag filter is active inherits ONLY the filter\'s tag(s), not "New" on top',
      JSON.stringify(tagsB) === JSON.stringify(['kaleido']), tagsB);
  });

  await withPage(browser, async (page) => {
    const id = await page.evaluate(() => window._TEST_addLane(21, 0));
    // The tag field is now a compact pill until clicked (item 3) — a real
    // click swaps it for the editable input, same as a user would do.
    await page.click(`.lane[data-id="${id}"] .tag-pill`);
    await page.fill(`.lane[data-id="${id}"] input.ltags`, 'sceneA, kaleido');
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    const tags = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('lane tags parsed from comma-separated input', JSON.stringify(tags) === JSON.stringify(['sceneA', 'kaleido']), tags);
    const barDisplay = await page.evaluate(() => document.getElementById('tagFilterBar').style.display);
    const chipTexts = await page.evaluate(() => [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].map(b => b.textContent));
    check(
      'tag filter bar shows chips for All + each tag once a lane is tagged',
      barDisplay === 'flex' && chipTexts.includes('All') && chipTexts.some(t => t.startsWith('sceneA')) && chipTexts.some(t => t.startsWith('kaleido')),
      chipTexts
    );
  });

  await withPage(browser, async (page) => {
    // Tags now split ONLY on commas — a single tag may contain internal
    // spaces (e.g. an ISF-imported tag renamed from "Chaser_Stage_Lights" to
    // "chaser stage lights"). Typing a tag with a space, committing, and
    // reopening the pill must show that same single tag, not two.
    const id = await page.evaluate(() => window._TEST_addLane(26, 0));
    await page.click(`.lane[data-id="${id}"] .tag-pill`);
    await page.fill(`.lane[data-id="${id}"] input.ltags`, 'chaser stage lights');
    // blur (not just 'change') so the field commits AND swaps back to the
    // pill display, exactly like a real user typing then clicking away.
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'blur');
    await page.waitForTimeout(50);
    const tags = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('a tag with an internal space is NOT split into multiple tags (comma is the only delimiter)',
      JSON.stringify(tags) === JSON.stringify(['chaser stage lights']), tags);

    // Reopen the pill (blur without typing anything) and re-commit — this is
    // exactly the round-trip that used to silently merge two space-free tags
    // into one when the display was space-joined but the parser was
    // comma-only. Here there's only one tag, so the round-trip must be a
    // pure no-op.
    await page.click(`.lane[data-id="${id}"] .tag-pill`);
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'blur');
    await page.waitForTimeout(50);
    const tagsAfterReopen = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('reopening and blurring the tag pill without editing leaves a space-containing tag intact',
      JSON.stringify(tagsAfterReopen) === JSON.stringify(['chaser stage lights']), tagsAfterReopen);
  });

  await withPage(browser, async (page) => {
    // The display join delimiter (', ') must stay in lockstep with the
    // comma-only parser: two genuinely distinct single-word tags, displayed
    // space-joined-then-reopened-and-reparsed, must NOT silently merge into
    // one tag the way they would if the join delimiter were still a plain
    // space (a real correctness trap the comma-only parsing change
    // introduces if the join side isn't updated to match).
    const id = await page.evaluate(() => window._TEST_addLane(27, 0));
    await page.click(`.lane[data-id="${id}"] .tag-pill`);
    await page.fill(`.lane[data-id="${id}"] input.ltags`, 'sceneA,kaleido');
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'blur');
    await page.waitForTimeout(50);
    // Reopen the pill (no edits) and re-commit via blur — this re-parses
    // whatever the field re-displayed after the first commit.
    await page.click(`.lane[data-id="${id}"] .tag-pill`);
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'blur');
    await page.waitForTimeout(50);
    const tags = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('two distinct tags survive a display/reopen/recommit round-trip without merging into one',
      JSON.stringify(tags) === JSON.stringify(['sceneA', 'kaleido']), tags);
  });

  await withPage(browser, async (page) => {
    const idA = await page.evaluate(() => window._TEST_addLane(22, 0));
    const idB = await page.evaluate(() => window._TEST_addLane(23, 0));
    await page.click(`.lane[data-id="${idA}"] .tag-pill`);
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
    await page.click(`.lane[data-id="${id}"] .tag-pill`);
    await page.fill(`.lane[data-id="${id}"] input.ltags`, 'persistTag');
    await page.dispatchEvent(`.lane[data-id="${id}"] input.ltags`, 'change');
    await page.waitForTimeout(50);
    const snap = await page.evaluate(() => window._TEST_snapshot());
    const roundTrip = await page.evaluate((s) => { window._TEST_applyState(s); return window._TEST_state.ccLanes.map(l => l.tags); }, snap);
    check('lane tags survive snapshot()/applyState() roundtrip', roundTrip.some(t => Array.isArray(t) && t.includes('persistTag')), roundTrip);
  });

  // ---------------- Tag rename (right-click a tag chip) ----------------

  await withPage(browser, async (page) => {
    // Right-clicking a tag chip's label opens a rename prompt; confirming
    // rewrites that exact tag string on every lane that has it (deduping if
    // the new name collides with a tag already on that lane), keeps an
    // active tagFilter selection pointed at the renamed tag, and is a single
    // undo step.
    const idA = await page.evaluate(() => window._TEST_addLane(50, 0));
    const idB = await page.evaluate(() => window._TEST_addLane(51, 0));
    const idC = await page.evaluate(() => window._TEST_addLane(52, 0));
    await page.evaluate((ids) => {
      const a = document.querySelector(`.lane[data-id="${ids.a}"] input.ltags`);
      a.value = 'oldName'; a.dispatchEvent(new Event('change'));
      const b = document.querySelector(`.lane[data-id="${ids.b}"] input.ltags`);
      b.value = 'oldName, other'; b.dispatchEvent(new Event('change'));
    }, { a: idA, b: idB });
    await page.waitForTimeout(80);

    // Activate "oldName" as the active filter so we can prove it survives the rename.
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].find(b => b.textContent.startsWith('oldName'));
      chip.click();
    });
    await page.waitForTimeout(50);
    const cFilteredBefore = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-filtered'), idC);
    check('lane C (untagged) is filtered out while the "oldName" filter is active', cFilteredBefore === true, cFilteredBefore);

    // Real right-click (not a dispatched contextmenu) on the chip's label.
    page.once('dialog', d => { check('right-clicking a tag chip opens a rename prompt pre-filled with the current name', d.type() === 'prompt' && d.defaultValue() === 'oldName', { type: d.type(), defaultValue: d.defaultValue() }); d.accept('newName'); });
    const chipSel = await page.evaluateHandle(() => [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].find(b => b.textContent.startsWith('oldName')));
    const chipBox = await chipSel.asElement().boundingBox();
    await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2, { button: 'right' });
    await page.waitForTimeout(80);

    const [tagsA, tagsB] = await Promise.all([idA, idB].map(id => page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id)));
    check('renaming a tag rewrites it on every lane that has it (deduped where it collides with an existing tag)',
      JSON.stringify(tagsA) === JSON.stringify(['newName']) && JSON.stringify(tagsB) === JSON.stringify(['newName', 'other']),
      { tagsA, tagsB });

    const cFilteredAfter = await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-filtered'), idC);
    check('the active tagFilter selection survives the rename instead of silently clearing', cFilteredAfter === true, cFilteredAfter);

    const chipTextsAfter = await page.evaluate(() => [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].map(b => b.textContent));
    check('the tag bar shows the new name and no longer shows the old one',
      chipTextsAfter.some(t => t.startsWith('newName')) && !chipTextsAfter.some(t => t.startsWith('oldName')), chipTextsAfter);

    await page.evaluate(() => window._TEST_undo());
    await page.waitForTimeout(80);
    const [tagsAafterUndo, tagsBafterUndo] = await Promise.all([idA, idB].map(id => page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id)));
    check('undo restores the pre-rename tag name on every lane',
      JSON.stringify(tagsAafterUndo) === JSON.stringify(['oldName']) && JSON.stringify(tagsBafterUndo) === JSON.stringify(['oldName', 'other']),
      { tagsAafterUndo, tagsBafterUndo });
  });

  await withPage(browser, async (page) => {
    // An empty or unchanged rename name is a no-op — the prompt's Cancel
    // (null) and an unchanged/whitespace-only confirmed value must both
    // leave the tag exactly as it was.
    const id = await page.evaluate(() => window._TEST_addLane(53, 0));
    await page.evaluate((id) => {
      const inp = document.querySelector(`.lane[data-id="${id}"] input.ltags`);
      inp.value = 'keepMe'; inp.dispatchEvent(new Event('change'));
    }, id);
    await page.waitForTimeout(50);

    page.once('dialog', d => d.dismiss());
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].find(b => b.textContent.startsWith('keepMe'));
      chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await page.waitForTimeout(50);
    const afterCancel = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('cancelling the rename prompt leaves the tag unchanged', JSON.stringify(afterCancel) === JSON.stringify(['keepMe']), afterCancel);

    page.once('dialog', d => d.accept('   '));
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip-label')].find(b => b.textContent.startsWith('keepMe'));
      chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await page.waitForTimeout(50);
    const afterBlank = await page.evaluate((id) => window._TEST_state.ccLanes.find(l => l.id === id).tags, id);
    check('confirming the rename prompt with a blank/whitespace-only name is a no-op', JSON.stringify(afterBlank) === JSON.stringify(['keepMe']), afterBlank);
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
      return { scrollLeft: window._TEST_state.scrollLeft, expected: px - viewW / 2 + window._TEST_GUTTER() };
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
      const proj = (name) => JSON.stringify({ version: 1, projectName: name, snapshot: { notes: [], lanes: [], bpm: 120, bars: 4, tsNum: 4, tsDen: 4, tsMap: [{ tick: 0, num: 4, den: 4 }], ppq: 480, next: 1, pitchNames: {}, projectName: name, locS: null, locE: null } });
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
    await page.waitForTimeout(150);
    const projectName = await page.evaluate(() => window._TEST_state.projectName);
    check('opening a project from the Recent Projects list loads it', projectName === 'song-a', projectName);

    // v0.9.3: loadProject() now auto-locates matching audio itself (no
    // separate window._TEST_tryAutoLoadAudio(...) call needed here) — every
    // way of opening a project gets the same auto-audio-load behavior.
    const audioName = await page.evaluate(() => window._TEST_audioFileName());
    check('opening a project auto-locates and loads a same-named audio file next to it, with no separate call needed',
      audioName === 'song-a.wav', audioName);

    await page.evaluate(() => { window._TEST_state.projectName = 'brand-new-song'; });
    await page.evaluate(() => window._TEST_saveProject());
    await page.waitForTimeout(50);
    const savedInDir = await page.evaluate(() => window.__mockDir._files.has('brand-new-song.mmvp'));
    check('Save Project writes directly into the remembered folder when one is set', savedInDir === true, savedInDir);

    await page.evaluate(() => window._TEST_setProjDirHandle(null));
  });

  await withPage(browser, async (page) => {
    // v0.9.3: auto-audio-load prefers the project's own saved audioFile name
    // over a basename match — covers a project whose audio was renamed or
    // never shared its own basename. Also proves the auto-load fires on the
    // plain "Browse for file" / <input type=file> path, not just the Recent
    // Projects list — loadProject() itself now owns this, so every entry
    // point gets it for free.
    const seeded = await page.evaluate(() => {
      class MockFileHandle {
        constructor(name, content, lastModified) { this.kind = 'file'; this.name = name; this._content = content; this._lastModified = lastModified; }
        async getFile() { return new File([this._content], this.name, { lastModified: this._lastModified }); }
      }
      class MockDirHandle {
        constructor(name) { this.kind = 'directory'; this.name = name; this._files = new Map(); }
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
        async getFileHandle(name) {
          if (!this._files.has(name)) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; }
          return this._files.get(name);
        }
      }
      const wavBytes = new Uint8Array([
        0x52,0x49,0x46,0x46, 0x2c,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
        0x66,0x6d,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00, 0x01,0x00,
        0x44,0xac,0x00,0x00, 0x88,0x58,0x01,0x00, 0x02,0x00, 0x10,0x00,
        0x64,0x61,0x74,0x61, 0x08,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      ]);
      const dir = new MockDirHandle('MyProjects');
      // Both a basename-matching decoy AND the project's real (differently
      // named) audioFile are present — the audioFile name must win.
      dir._files.set('mysong.wav', new MockFileHandle('mysong.wav', wavBytes, Date.now()));
      dir._files.set('special-track.wav', new MockFileHandle('special-track.wav', wavBytes, Date.now()));
      window._TEST_setProjDirHandle(dir);
      window.__mockDir2 = dir;
      return true;
    });
    check('mock projects folder (preference test) seeded', seeded === true, seeded);

    const projJson = JSON.stringify({
      version: 1, projectName: 'mysong', audioFile: 'special-track.wav',
      snapshot: { notes: [], lanes: [], bpm: 120, bars: 4, tsNum: 4, tsDen: 4, tsMap: [{ tick: 0, num: 4, den: 4 }], ppq: 480, next: 1, pitchNames: {}, projectName: 'mysong', locS: null, locE: null },
    });
    // Loaded as a plain File — simulating the <input type=file> "Browse for
    // file…"/plain-Load-button path, not the Recent Projects list handle.
    await page.evaluate((json) => {
      const file = new File([json], 'mysong.mmvp', { type: 'application/json' });
      return window._TEST_loadProject(file);
    }, projJson);
    await page.waitForTimeout(150);
    const audioName = await page.evaluate(() => window._TEST_audioFileName());
    check('auto-load prefers the project\'s saved audioFile name over a basename match, even via plain file-picker load',
      audioName === 'special-track.wav', audioName);

    await page.evaluate(() => window._TEST_setProjDirHandle(null));
  });

  await withPage(browser, async (page) => {
    // Without a Projects Folder handle ever having been granted, a plain
    // <input type=file> genuinely cannot see sibling files (browser
    // sandbox) — auto-load must no-op gracefully (no throw) and the old
    // "reload it yourself" flash message still tells the user what to do.
    const projJson = JSON.stringify({
      version: 1, projectName: 'no-folder-song', audioFile: 'no-folder-song.wav',
      snapshot: { notes: [], lanes: [], bpm: 120, bars: 4, tsNum: 4, tsDen: 4, tsMap: [{ tick: 0, num: 4, den: 4 }], ppq: 480, next: 1, pitchNames: {}, projectName: 'no-folder-song', locS: null, locE: null },
    });
    await page.evaluate((json) => {
      const file = new File([json], 'no-folder-song.mmvp', { type: 'application/json' });
      return window._TEST_loadProject(file);
    }, projJson);
    await page.waitForTimeout(120);
    const audioName = await page.evaluate(() => window._TEST_audioFileName());
    const flashMsg = await page.evaluate(() => document.getElementById('stCtx').textContent);
    check('with no Projects Folder ever granted, loading a project with a saved audioFile does not throw and leaves audio unloaded',
      audioName === 'No audio', audioName);
    check('...and still flashes the "reload audio file" message so the user knows to do it manually',
      flashMsg === 'Project loaded. Reload audio file: no-folder-song.wav', flashMsg);
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

    // A long-press must be a genuinely different, one-way action from a short
    // click, not just an alias for it: holding the button again while the
    // group is ALREADY all-Muted must re-assert Muted, never toggle it off
    // (a short click in that situation would smart-toggle everyone off).
    const btnBox2 = await (await sceneAMute()).boundingBox();
    await page.mouse.move(btnBox2.x + btnBox2.width / 2, btnBox2.y + btnBox2.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(30);
    const afterSecondLongPress = await page.evaluate((ids) => [ids.a, ids.b].map(id => window._TEST_state.ccLanes.find(x => x.id === id).muted), ids);
    check('holding a tag\'s Mute button on an already-all-Muted group re-asserts Muted rather than toggling it off (long-press differs from a short click)',
      afterSecondLongPress.every(m => m === true), afterSecondLongPress);

    // ALL button reaches every lane, including untagged ones
    const allSoloBtn = async () => {
      const chip = await page.evaluateHandle(() => [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.querySelector('.tag-chip-label').textContent.trim() === 'All'));
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
      snapshot: { notes: [], lanes: [], bpm: 120, bars: 4, tsNum: 4, tsDen: 4, tsMap: [{ tick: 0, num: 4, den: 4 }], ppq: 480, next: 1, pitchNames: {}, projectName: 'project-b', locS: null, locE: null, audioOffset: 0 },
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

  // ---------------- Audio latency/sync trim ----------------

  await withPage(browser, async (page) => {
    const bytes = makeWavBytes(4);
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.wav', { type: 'audio/wav' });
      return window._TEST_loadAudio(file);
    }, bytes);
    await page.waitForTimeout(120);

    await page.evaluate(() => {
      window.__startCalls = [];
      const orig = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
        window.__startCalls.push({ offset });
        return orig.call(this, when, offset, duration);
      };
    });

    const runAt = async (latencyMs) => {
      await page.evaluate((ms) => {
        window._TEST_state.audioOffset = 0;
        window._TEST_state.audioLatencyMs = ms;
        window._TEST_state.playhead = window._TEST_state.ppq * 2;
      }, latencyMs);
      await page.evaluate(() => window._TEST_play());
      await page.waitForTimeout(80);
      await page.evaluate(() => window._TEST_stop());
      return page.evaluate(() => window.__startCalls[window.__startCalls.length - 1].offset);
    };

    const baseline = await runAt(0);
    const withPositiveTrim = await runAt(50);
    const withNegativeTrim = await runAt(-30);
    check('a +50ms latency trim advances the scheduled audio buffer offset by 0.05s',
      Math.abs((withPositiveTrim - baseline) - 0.05) < 0.002, { baseline, withPositiveTrim });
    check('a -30ms latency trim retards the scheduled audio buffer offset by 0.03s',
      Math.abs((withNegativeTrim - baseline) - (-0.03)) < 0.002, { baseline, withNegativeTrim });

    await page.click('#setupBtn');
    await page.waitForTimeout(80);
    await page.fill('#audioLatencyMs', '75');
    await page.dispatchEvent('#audioLatencyMs', 'change');
    const viaUI = await page.evaluate(() => window._TEST_state.audioLatencyMs);
    check('the Setup panel Audio Latency Trim field updates state.audioLatencyMs', viaUI === 75, viaUI);

    await page.fill('#audioLatencyMs', '99999');
    await page.dispatchEvent('#audioLatencyMs', 'change');
    const clamped = await page.evaluate(() => window._TEST_state.audioLatencyMs);
    check('the latency trim field clamps extreme values to +/-2000ms', clamped === 2000, clamped);

    await page.evaluate(() => { window._TEST_state.audioLatencyMs = 42; });
    const snap = await page.evaluate(() => window._TEST_snapshot());
    await page.evaluate(() => { window._TEST_state.audioLatencyMs = 0; });
    await page.evaluate((s) => window._TEST_applyState(s), snap);
    const restored = await page.evaluate(() => window._TEST_state.audioLatencyMs);
    check('audioLatencyMs survives snapshot()/applyState() roundtrip', restored === 42, restored);

    await page.evaluate(() => { window._TEST_state.audioOffset = 0; window._TEST_state.audioLatencyMs = 500; });
    const badgeHidden = await page.evaluate(() => document.getElementById('audioOffsetBadge').style.display === 'none');
    check('a large latency trim alone (no audioOffset) does not make the audio-offset badge visible', badgeHidden, badgeHidden);
  });

  // ---------------- Delete CC Lane confirmation ----------------

  await withPage(browser, async (page) => {
    const laneId = await page.evaluate(() => window._TEST_addLane(50, 0));
    await page.waitForTimeout(50);

    page.once('dialog', d => d.dismiss());
    await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"] .x`).click(), laneId);
    await page.waitForTimeout(50);
    const stillThere = await page.evaluate((id) => !!window._TEST_state.ccLanes.find(l => l.id === id), laneId);
    check('dismissing the "Delete CC Lane?" confirmation leaves the lane intact', stillThere, stillThere);

    page.once('dialog', d => { check('deleting a CC lane prompts "Delete CC Lane?"', d.message() === 'Delete CC Lane?', d.message()); d.accept(); });
    await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"] .x`).click(), laneId);
    await page.waitForTimeout(50);
    const gone = await page.evaluate((id) => !window._TEST_state.ccLanes.find(l => l.id === id), laneId);
    check('accepting the "Delete CC Lane?" confirmation removes the lane', gone, gone);
  });

  // ---------------- Minimized CC lane height ----------------

  await withPage(browser, async (page) => {
    // A crushed flex-shrink bug used to let minimized lanes collapse toward
    // 0px once enough of them were competing for space with the rest of the
    // lane list — they'd visually vanish. v0.9.9 retune: the old fixed
    // 22px top-bar floor is gone along with the top-bar itself; a minimized
    // lane's whole visible content is now row 1 alone (Toggle/CC/Name/
    // Channel/Colour), so its natural height (~29-30px) is what must survive
    // being crushed, and — since row 1 is now the SAME functional controls
    // shown when expanded, not a stripped-down duplicate — its actual text
    // must still be genuinely visible/readable, not just "tall enough on
    // paper" (same class of check as the 27-expanded-lanes test below).
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(await page.evaluate((cc) => window._TEST_addLane(cc, 0), 40 + i));
    await page.waitForTimeout(150);

    for (const id of ids) {
      await page.evaluate((id) => document.querySelector(`.lane[data-id="${id}"] .toggle-btn`).click(), id);
      await page.waitForTimeout(15);
    }
    await page.waitForTimeout(100);

    const info = await page.evaluate((ids) => {
      const heights = ids.map(id => document.querySelector(`.lane[data-id="${id}"]`).offsetHeight);
      const lastCcn = document.querySelector(`.lane[data-id="${ids[ids.length - 1]}"] .lane-row1 .ccn`);
      const r = lastCcn.getBoundingClientRect();
      return {
        heights,
        allHidden: ids.every(id => document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-hidden')),
        lastCcVisible: r.height > 8 && getComputedStyle(lastCcn).display !== 'none' && getComputedStyle(lastCcn).visibility !== 'hidden',
      };
    }, ids);
    check('every minimized lane keeps a real, non-crushed row-1 height (>=26px) even with 20 minimized at once',
      info.allHidden && info.heights.every(h => h >= 26), info.heights);
    check('the last of many minimized lanes still has a genuinely visible (non-zero-height) row-1 CC# field',
      info.lastCcVisible, info.lastCcVisible);
  });

  await withPage(browser, async (page) => {
    // Same defect, but for ordinary EXPANDED lanes: a large ISF import (e.g.
    // 27 CC lanes at once, as reported) has a combined natural height far
    // exceeding a normal window — .lane previously had min-height:0 and the
    // flexbox default flex-shrink:1, so instead of .lanes' own overflow-y:
    // auto kicking in to scroll, every lane got crushed toward 0px and
    // rendered with no visible text at all. Every expanded lane must keep at
    // least its functional floor (LANE_MIN_H, 64px — enough for row 1 + row
    // 2) regardless of how many siblings exist, with the container scrolling
    // to accommodate the rest instead.
    const ids = [];
    for (let i = 0; i < 27; i++) ids.push(await page.evaluate((cc) => window._TEST_addLane(cc, 0), 40 + i));
    await page.waitForTimeout(150);

    const info = await page.evaluate((ids) => {
      const heights = ids.map(id => document.querySelector(`.lane[data-id="${id}"]`).offsetHeight);
      const lanesEl = document.getElementById('lanes');
      return { heights, scrollHeight: lanesEl.scrollHeight, clientHeight: lanesEl.clientHeight };
    }, ids);
    check('27 expanded lanes at once (a large ISF import) keep every lane at/above its 64px functional floor, not crushed toward 0',
      info.heights.every(h => h >= 64), info.heights);
    check('the lane list scrolls (content taller than the viewport) instead of shrinking lanes to fit',
      info.scrollHeight > info.clientHeight, { scrollHeight: info.scrollHeight, clientHeight: info.clientHeight });

    // And each lane's row-1 text (name input, CC number) is genuinely visible,
    // not just "tall enough on paper" — the user's actual complaint was that
    // no text rendered at all.
    const nameVisible = await page.evaluate((id) => {
      const inp = document.querySelector(`.lane[data-id="${id}"] input.lname`);
      const r = inp.getBoundingClientRect();
      return r.height > 8 && getComputedStyle(inp).display !== 'none' && getComputedStyle(inp).visibility !== 'hidden';
    }, ids[ids.length - 1]);
    check('the last of many expanded lanes still has a genuinely visible (non-zero-height) name field', nameVisible, nameVisible);

    // v0.9.13: the curve canvas is now absolutely positioned to span the
    // lane's FULL height (not just rows 2+3), re-verify this crush-guard
    // scenario still leaves every canvas a real, non-crushed height too —
    // the same class of regression this whole test exists to catch, now
    // extended to the new canvas-sizing mechanism.
    const canvasHeights = await page.evaluate((ids) => ids.map(id => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === id);
      return lane._canvas.height;
    }), ids);
    check('with 27 expanded lanes, every lane\'s curve canvas still has a real, non-crushed height (>=64px, matching its lane)',
      canvasHeights.every(h => h >= 64), canvasHeights);
  });

  // ---------------- Autosave & crash recovery ----------------

  await withPage(browser, async (page) => {
    await page.evaluate(() => window._TEST_idbSet('autosave', null)); // isolate from earlier pages in this shared context
    await page.waitForTimeout(100); // let init's baseline-setting settle

    // A change followed by a tick writes a dirty record containing the change.
    await page.evaluate(() => {
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 61, start: 480, length: 240, vel: 90, ch: 0 });
      window._TEST_state.projectName = 'wip-song';
      return window._TEST_autosaveTick();
    });
    const rec1 = await page.evaluate(() => window._TEST_idbGet('autosave'));
    check('autosave tick after a change writes a dirty record with the change in it',
      rec1 && rec1.dirty === true && rec1.projectName === 'wip-song' && rec1.snapshot.includes('"pitch":61'),
      rec1 && { dirty: rec1.dirty, projectName: rec1.projectName });

    // A tick with nothing new leaves the stored record untouched.
    await page.waitForTimeout(20);
    await page.evaluate(() => window._TEST_autosaveTick());
    const rec2 = await page.evaluate(() => window._TEST_idbGet('autosave'));
    check('an autosave tick with no changes does not rewrite the record', rec2.time === rec1.time, { t1: rec1.time, t2: rec2.time });

    // An explicit save supersedes the dirty record.
    await page.evaluate(() => window._TEST_saveProject());
    await page.waitForTimeout(150);
    const rec3 = await page.evaluate(() => window._TEST_idbGet('autosave'));
    check('Save Project marks the autosave record clean (no restore prompt next startup)', rec3 && rec3.dirty === false, rec3 && rec3.dirty);
  });

  await withPage(browser, async (page) => {
    // Accepting the restore prompt brings back the crashed session's work.
    await page.evaluate(() => window._TEST_idbSet('autosave', null));
    await page.waitForTimeout(100);
    const crashedSnap = await page.evaluate(() => {
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 72, start: 0, length: 480, vel: 100, ch: 0 });
      const s = window._TEST_snapshot();
      window._TEST_state.notes = []; // "fresh session" — the work only lives in the autosave record now
      return s;
    });
    await page.evaluate((s) => window._TEST_idbSet('autosave', { time: Date.now() - 60000, projectName: 'crash-proj', dirty: true, snapshot: s }), crashedSnap);

    let promptMsg = null;
    page.once('dialog', d => { promptMsg = d.message(); d.accept(); });
    const restored = await page.evaluate(() => window._TEST_checkAutosaveRestore());
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({
      notes: window._TEST_state.notes.length,
      projectName: window._TEST_state.projectName,
    }));
    const recAfter = await page.evaluate(() => window._TEST_idbGet('autosave'));
    check('restore prompt names the crashed project and accepting it restores the work',
      restored === true && promptMsg && promptMsg.includes('crash-proj') && after.notes === 1 && after.projectName === 'crash-proj',
      { restored, promptMsg, notes: after.notes, projectName: after.projectName });
    check('an accepted restore re-marks the record clean so the next startup does not re-prompt',
      recAfter && recAfter.dirty === false, recAfter && recAfter.dirty);

    // The restore itself is one undo step.
    await page.evaluate(() => window._TEST_undo());
    const afterUndo = await page.evaluate(() => window._TEST_state.notes.length);
    check('an accepted restore is undoable', afterUndo === 0, afterUndo);
  });

  await withPage(browser, async (page) => {
    // Declining the restore prompt keeps the current state and discards the record.
    await page.evaluate(() => window._TEST_idbSet('autosave', null));
    await page.waitForTimeout(100);
    const crashedSnap = await page.evaluate(() => {
      window._TEST_state.notes.push({ id: window._TEST_state.nextId++, pitch: 72, start: 0, length: 480, vel: 100, ch: 0 });
      const s = window._TEST_snapshot();
      window._TEST_state.notes = [];
      return s;
    });
    await page.evaluate((s) => window._TEST_idbSet('autosave', { time: Date.now() - 60000, projectName: 'crash-proj', dirty: true, snapshot: s }), crashedSnap);
    page.once('dialog', d => d.dismiss());
    const restored = await page.evaluate(() => window._TEST_checkAutosaveRestore());
    await page.waitForTimeout(100);
    const notes = await page.evaluate(() => window._TEST_state.notes.length);
    const recAfter = await page.evaluate(() => window._TEST_idbGet('autosave'));
    check('declining the restore prompt keeps the fresh session and discards the stale record',
      restored === false && notes === 0 && recAfter && recAfter.dirty === false, { restored, notes, dirty: recAfter && recAfter.dirty });

    // Loading a project also supersedes any dirty autosave.
    await page.evaluate((s) => window._TEST_idbSet('autosave', { time: Date.now(), projectName: 'x', dirty: true, snapshot: s }), crashedSnap);
    const proj = JSON.stringify({ version: 1, projectName: 'loaded-proj', audioFile: '', snapshot: JSON.parse(crashedSnap) });
    await page.evaluate((json) => {
      const file = new File([json], 'loaded-proj.mmvp', { type: 'application/json' });
      return window._TEST_loadProject(file);
    }, proj);
    await page.waitForTimeout(200);
    const recAfterLoad = await page.evaluate(() => window._TEST_idbGet('autosave'));
    check('loading a project marks the autosave record clean', recAfterLoad && recAfterLoad.dirty === false, recAfterLoad && recAfterLoad.dirty);
  });

  // ---------------- Scheduler: empty pass must not inflate passIndex ----------------

  await withPage(browser, async (page) => {
    // With nothing schedulable in the pass (no notes, lane muted, metronome
    // off), passIndex used to increment once per scheduler tick instead of
    // once per actual loop pass — so events appearing mid-play (metronome
    // toggled on) landed minutes in the future. It must now stay pinned to
    // the wall-clock pass (0, for a 100-bar span just started).
    await page.evaluate(() => {
      window._TEST_state.metronomeOn = false;
      window._TEST_state.ccLanes.forEach(l => { l.muted = true; });
      window.__oscStarts = [];
      const orig = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (when) { window.__oscStarts.push({ when, now: this.context.currentTime }); return orig.call(this, when); };
    });
    await page.evaluate(() => window._TEST_play());
    await page.waitForTimeout(500);
    const passIndex = await page.evaluate(() => window._TEST_sched().passIndex);
    check('an empty scheduler pass keeps passIndex pinned to the wall clock instead of inflating per tick',
      passIndex <= 1, passIndex);

    // And the metronome, toggled on over that empty pass, clicks promptly.
    await page.click('#metroBtn');
    await page.waitForTimeout(700);
    const clicks = await page.evaluate(() => window.__oscStarts);
    await page.evaluate(() => window._TEST_stop());
    const prompt = clicks.length > 0 && clicks.every(c => c.when - c.now < 5);
    check('metronome toggled on over an empty pass starts clicking promptly (not minutes in the future)',
      prompt, { count: clicks.length, first: clicks[0] });
  });

  // ---------------- Touch long-press on tag/ALL Mute-Solo ----------------

  await withPage(browser, async (page) => {
    const ids = await page.evaluate(() => [window._TEST_addLane(60, 0), window._TEST_addLane(61, 0)]);
    await page.evaluate((ids) => {
      ids.forEach(id => {
        const inp = document.querySelector(`.lane[data-id="${id}"] input.ltags`);
        inp.value = 'touchgrp'; inp.dispatchEvent(new Event('change'));
      });
      // Mixed starting state: chips hold live lane references, so mutating
      // after the tag bar is built is fine.
      window._TEST_state.ccLanes.find(x => x.id === ids[0]).muted = true;
    }, ids);
    await page.waitForTimeout(100);

    // A touch long-press fires pointer events but (on most mobile platforms)
    // NO trailing click — force-on must fire from the pointer path alone.
    const forced = await page.evaluate(async (ids) => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.textContent.includes('touchgrp'));
      if (!chip) return { error: 'chip not found' };
      const btn = chip.querySelector('.mute-btn');
      btn.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      await new Promise(r => setTimeout(r, 650));
      btn.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
      return ids.map(id => window._TEST_state.ccLanes.find(l => l.id === id).muted);
    }, ids);
    check('a touch long-press (pointer events only, no click) force-mutes the whole group',
      Array.isArray(forced) && forced.every(m => m === true), forced);

    // A quick touch tap (pointerdown/up then the browser's synthesized click)
    // still smart-toggles: all muted -> all unmuted.
    const tapped = await page.evaluate(async (ids) => {
      const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.textContent.includes('touchgrp'));
      const btn = chip.querySelector('.mute-btn');
      btn.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      btn.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return ids.map(id => window._TEST_state.ccLanes.find(l => l.id === id).muted);
    }, ids);
    check('a quick touch tap still smart-toggles the group (all muted -> all unmuted)',
      Array.isArray(tapped) && tapped.every(m => m === false), tapped);
  });

  // ---------------- Item 2: tag-group minimize toggle ----------------

  await withPage(browser, async (page) => {
    // A min/max mini-toggle on each tag chip (and "All"), mirroring the
    // existing M/S mini-buttons' smart-toggle convention: if every lane in
    // the group is already minimized, maximize them all; otherwise minimize
    // them all. Verify the REAL functional effect (lane.visible + the
    // .lane-hidden class on each row), not just the button's own look, and
    // that a lane outside the group is untouched.
    const ids = await page.evaluate(() => ({
      a: window._TEST_addLane(70, 0), b: window._TEST_addLane(71, 0), c: window._TEST_addLane(72, 0),
    }));
    await page.evaluate((ids) => {
      [ids.a, ids.b].forEach(id => {
        const inp = document.querySelector(`.lane[data-id="${id}"] input.ltags`);
        inp.value = 'minGrp'; inp.dispatchEvent(new Event('change'));
      });
    }, ids);
    await page.waitForTimeout(80);

    async function laneState(id) {
      return page.evaluate((id) => ({
        visible: window._TEST_state.ccLanes.find(l => l.id === id).visible,
        hiddenClass: document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-hidden'),
      }), id);
    }
    async function minGrpToggleBtn() {
      const chip = await page.evaluateHandle(() => [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.textContent.includes('minGrp')));
      return chip.asElement().$('.toggle-btn');
    }
    async function minGrpChipOn() {
      return page.evaluate(() => {
        const chip = [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.textContent.includes('minGrp'));
        return chip.querySelector('.toggle-btn').classList.contains('on');
      });
    }

    const beforeOn = await minGrpChipOn();
    check('the group minimize toggle is NOT lit before anything in the group is minimized', beforeOn === false, beforeOn);

    await (await minGrpToggleBtn()).click();
    await page.waitForTimeout(50);
    const [aAfter1, bAfter1, cAfter1, chipOn1] = await Promise.all([laneState(ids.a), laneState(ids.b), laneState(ids.c), minGrpChipOn()]);
    check('the tag-group minimize toggle minimizes every lane in the group (lane.visible=false AND .lane-hidden set)',
      aAfter1.visible === false && aAfter1.hiddenClass === true && bAfter1.visible === false && bAfter1.hiddenClass === true,
      { aAfter1, bAfter1 });
    check('a lane NOT tagged into the group is untouched by the group minimize toggle',
      cAfter1.visible !== false && cAfter1.hiddenClass === false, cAfter1);
    check('the chip\'s own minimize toggle lights up (.on) once every lane in the group is minimized',
      chipOn1 === true, chipOn1);

    // Mixed state: maximize just A by hand -> group is now mixed (A up, B
    // still minimized) -> the chip must NOT show "on" for a mixed group,
    // and clicking it again must be a smart toggle (minimize everyone),
    // not a naive "flip from last-known state".
    await page.click(`.lane[data-id="${ids.a}"] .toggle-btn`);
    await page.waitForTimeout(50);
    const chipOnMixed = await minGrpChipOn();
    check('the chip\'s minimize toggle is NOT lit while the group is in a mixed state (one up, one still minimized)',
      chipOnMixed === false, chipOnMixed);

    await (await minGrpToggleBtn()).click();
    await page.waitForTimeout(50);
    const [aAfter2, bAfter2] = await Promise.all([laneState(ids.a), laneState(ids.b)]);
    check('clicking the group toggle on a MIXED group minimizes everyone (smart toggle: not-all-minimized -> minimize all)',
      aAfter2.visible === false && aAfter2.hiddenClass === true && bAfter2.visible === false && bAfter2.hiddenClass === true,
      { aAfter2, bAfter2 });

    // Now every lane in the group is minimized again -> clicking once more
    // (all already minimized) must maximize the whole group back.
    await (await minGrpToggleBtn()).click();
    await page.waitForTimeout(50);
    const [aAfter3, bAfter3, chipOn3] = await Promise.all([laneState(ids.a), laneState(ids.b), minGrpChipOn()]);
    check('clicking the group toggle again (all already minimized) maximizes the whole group back',
      aAfter3.visible !== false && aAfter3.hiddenClass === false && bAfter3.visible !== false && bAfter3.hiddenClass === false,
      { aAfter3, bAfter3 });
    check('the chip\'s minimize toggle un-lights once the whole group is maximized again', chipOn3 === false, chipOn3);
  });

  await withPage(browser, async (page) => {
    // The "All" chip gets the same min/max toggle as every tag chip, same
    // as it already has M/S — reaches every lane, tagged or not.
    const ids = await page.evaluate(() => [window._TEST_addLane(73, 0), window._TEST_addLane(74, 0)]);
    async function allToggleBtn() {
      const chip = await page.evaluateHandle(() => [...document.querySelectorAll('#tagFilterBar .tag-chip')].find(c => c.querySelector('.tag-chip-label').textContent.trim() === 'All'));
      return chip.asElement().$('.toggle-btn');
    }
    await (await allToggleBtn()).click();
    await page.waitForTimeout(50);
    const states = await page.evaluate((ids) => ids.map(id => ({
      visible: window._TEST_state.ccLanes.find(l => l.id === id).visible,
      hiddenClass: document.querySelector(`.lane[data-id="${id}"]`).classList.contains('lane-hidden'),
    })), ids);
    check('the ALL chip\'s minimize toggle reaches every lane, tagged or not',
      states.every(s => s.visible === false && s.hiddenClass === true), states);
  });

  // ---------------- Note Info: true one-row layout (v0.9.13) ----------------

  await withPage(browser, async (page) => {
    // Exactly ONE row in the DOM at all times — minimized, expanded with
    // nothing selected, and expanded with a selection all render the same
    // single .ni-row; there is no more separate collapsed-only placeholder
    // element/DOM branch swapped in (the old .ni-empty / .note-info-grid
    // pair from before v0.9.13). Verify by counting #noteInfoLeft's own
    // direct children, and confirm the box's own height doesn't grow when a
    // selection appears (proof there's no second row hiding underneath).
    const rowCountNoSel = await page.evaluate(() => document.querySelectorAll('#noteInfoLeft > *').length);
    check('Note Info has exactly one direct child row with nothing selected', rowCountNoSel === 1, rowCountNoSel);
    const heightNoSel = await page.evaluate(() => document.getElementById('noteInfoLeft').getBoundingClientRect().height);

    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 60, start: 0, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    });
    const rowCountSel = await page.evaluate(() => document.querySelectorAll('#noteInfoLeft > *').length);
    const heightSel = await page.evaluate(() => document.getElementById('noteInfoLeft').getBoundingClientRect().height);
    check('Note Info still has exactly one direct child row once a note is selected', rowCountSel === 1, rowCountSel);
    check('Note Info\'s rendered height does not grow when a note is selected (no second row appears)',
      Math.abs(heightSel - heightNoSel) <= 1, { heightNoSel, heightSel });

    await page.click('#niToggleBtn');
    const rowCountMin = await page.evaluate(() => document.querySelectorAll('#noteInfoLeft > *').length);
    const heightMin = await page.evaluate(() => document.getElementById('noteInfoLeft').getBoundingClientRect().height);
    check('Note Info still has exactly one direct child row when manually minimized (with a note still selected)',
      rowCountMin === 1, rowCountMin);
    check('minimizing does not grow Note Info\'s own height either (true one-row minimized view)',
      heightMin <= heightSel + 1, { heightSel, heightMin });
  });

  await withPage(browser, async (page) => {
    // "NOTE INFO" only renders when the leftcol is wide enough not to
    // crowd the row's other fields — a real layout collapse (the title
    // contributes zero width when hidden, via a CSS container query keyed
    // off this element's own inline size, which tracks var(--keys-w)
    // exactly like the CC lanes' leftcol) — tested at a few different
    // widths, not just one boundary guess. A note must be selected (i.e.
    // Note Info is EXPANDED, not auto-collapsed) to isolate this width-only
    // behavior from the separate .ni-collapsed rule, which always hides the
    // title regardless of width — that's covered by its own test elsewhere.
    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 60, start: 0, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    });
    async function setKeysW(w) {
      await page.evaluate((w) => {
        window._TEST_state.keysW = w;
        document.documentElement.style.setProperty('--keys-w', w + 'px');
      }, w);
      await page.waitForTimeout(30);
    }
    async function titleInfo() {
      return page.evaluate(() => {
        const el = document.querySelector('#noteInfoLeft .ni-title');
        const cs = getComputedStyle(el);
        return { display: cs.display, width: el.getBoundingClientRect().width };
      });
    }
    await setKeysW(300);
    const wide = await titleInfo();
    check('at the default 300px --keys-w, the "Note Info" title shows and takes real width',
      wide.display !== 'none' && wide.width > 0, wide);

    await setKeysW(220);
    const mid = await titleInfo();
    check('at 220px --keys-w (still above the crowding threshold), the title still shows',
      mid.display !== 'none' && mid.width > 0, mid);

    await setKeysW(150);
    const narrow = await titleInfo();
    check('at 150px --keys-w (below the crowding threshold), the title hides entirely (display:none, zero width)',
      narrow.display === 'none' && narrow.width === 0, narrow);
  });

  await withPage(browser, async (page) => {
    // Note details format: "<name>  <pitch>" — a couple of spaces, no
    // colon (changed from the old "A#4:82").
    const pitch = 70;
    await page.evaluate((pitch) => {
      const n = { id: window._TEST_state.nextId++, pitch, start: 0, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    }, pitch);
    const text = await page.evaluate(() => document.getElementById('noteInfoNote').textContent);
    const expectedName = await page.evaluate((pitch) => window._TEST_noteName(pitch), pitch);
    check('Note Info note-details format is "<name>  <pitch>" (two spaces, no colon)',
      text === (expectedName + '  ' + pitch) && !text.includes(':'), { text, expectedName, pitch });
  });

  await withPage(browser, async (page) => {
    // A 3-digit velocity (e.g. 100) must render fully inside #velValInput,
    // not clip — the field's DOM value being correct isn't enough to prove
    // this: an earlier version had the right value ("100") but the wrong
    // (larger) font/padding actually applied, from a global
    // input[type=number] rule beating the field's own class on specificity,
    // so it visually clipped to an unreadable "10" + a sliver despite the
    // underlying data being fine. clientWidth < scrollWidth is exactly that
    // failure mode.
    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 64, start: 0, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    });
    const m = await page.evaluate(() => {
      const el = document.getElementById('velValInput');
      return { value: el.value, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, fontSize: getComputedStyle(el).fontSize };
    });
    check('a 3-digit velocity value renders without clipping (clientWidth >= scrollWidth)',
      m.value === '100' && m.clientWidth >= m.scrollWidth, m);
  });

  await withPage(browser, async (page) => {
    // Nothing selected -> "—" placeholders in note-details/V/Pos and a
    // "Ch—" channel button, same convention the CC lane's V/P/S fields
    // already use with no active point.
    const placeholders = await page.evaluate(() => ({
      note: document.getElementById('noteInfoNote').textContent,
      vel: document.getElementById('velValInput').value,
      pos: document.getElementById('noteInfoPos').value,
      ch: document.getElementById('noteInfoCh').textContent,
    }));
    check('with nothing selected, Note Info shows "—" placeholders (note/vel/pos) and "Ch—"',
      placeholders.note === '—' && placeholders.vel === '' && placeholders.pos === '' && placeholders.ch === 'Ch—', placeholders);
  });

  await withPage(browser, async (page) => {
    // Channel is now a button (not a free-typing number field) that opens
    // the SAME shared #chPopover the CC lane's row-1 Channel button uses —
    // openChPopover() was generalized in v0.9.13 to take a channel number
    // instead of a lane object. Verify it opens, lists all 16 channels, and
    // selecting one applies to EVERY currently-selected note.
    const ids = await page.evaluate(() => {
      const a = { id: window._TEST_state.nextId++, pitch: 60, start: 0, length: 240, vel: 100, ch: 0 };
      const b = { id: window._TEST_state.nextId++, pitch: 64, start: 240, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(a, b);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(a.id); window._TEST_state.selection.add(b.id);
      window._TEST_updateNoteInfo();
      return [a.id, b.id];
    });
    const btnBefore = await page.evaluate(() => document.getElementById('noteInfoCh').textContent);
    check('Note Info\'s Channel control is a button labeled "Ch N" (both notes share channel 1)', btnBefore === 'Ch1', btnBefore);

    await page.click('#noteInfoCh');
    await page.waitForTimeout(30);
    const popState = await page.evaluate(() => ({
      open: document.getElementById('chPopover').classList.contains('open'),
      count: document.querySelectorAll('#chPopover .ch-opt').length,
    }));
    check('Note Info\'s Channel button opens the shared #chPopover listing all 16 channels',
      popState.open && popState.count === 16, popState);

    await page.click('#chPopover .ch-opt:nth-child(9)'); // channel index 8 (Ch9)
    await page.waitForTimeout(30);
    const chsAfter = await page.evaluate((ids) => ids.map(id => window._TEST_state.notes.find(n => n.id === id).ch), ids);
    const btnAfter = await page.evaluate(() => document.getElementById('noteInfoCh').textContent);
    check('selecting a channel from the popover applies it to every currently-selected note, and updates the button label',
      chsAfter.every(ch => ch === 8) && btnAfter === 'Ch9', { chsAfter, btnAfter });
  });

  await withPage(browser, async (page) => {
    // Manual minimize/maximize toggle (#niToggleBtn) — independent of the
    // existing auto-collapse-on-no-selection behavior (.ni-collapsed, driven
    // purely by selection state). Bug fix: the manual toggle used to ALSO
    // force .ni-collapsed (hiding the literal "Note Info" title) even while
    // a note was selected — that's gone. The manual toggle no longer touches
    // the title at all; its only effect now is on #velRow's real height
    // (covered by the dedicated tests below). The note/vel/pos/ch fields
    // keep showing their real values throughout, unchanged.
    const noSel = await page.evaluate(() => ({
      collapsed: document.getElementById('noteInfoLeft').classList.contains('ni-collapsed'),
      manual: window._TEST_state.noteInfoManuallyCollapsed,
    }));
    check('with nothing selected and the manual toggle untouched (off), Note Info still auto-collapses as before',
      noSel.collapsed === true && noSel.manual === false, noSel);

    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 67, start: 0, length: 240, vel: 90, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    });
    const withSel = await page.evaluate(() => document.getElementById('noteInfoLeft').classList.contains('ni-collapsed'));
    check('selecting a note auto-expands Note Info (manual toggle still off, unchanged legacy behavior)',
      withSel === false, withSel);

    // Manually minimize WHILE a note is selected — this must NOT force
    // .ni-collapsed or hide the title anymore; it only sets the manual flag
    // (state.noteInfoManuallyCollapsed / .ni-min) and shrinks #velRow (see
    // the dedicated height tests below).
    await page.click('#niToggleBtn');
    const manualWithSel = await page.evaluate(() => ({
      collapsed: document.getElementById('noteInfoLeft').classList.contains('ni-collapsed'),
      manual: window._TEST_state.noteInfoManuallyCollapsed,
      niMinClass: document.getElementById('noteInfoLeft').classList.contains('ni-min'),
      selSize: window._TEST_state.selection.size,
      glyph: document.getElementById('niToggleBtn').textContent,
      titleHidden: getComputedStyle(document.querySelector('#noteInfoLeft .ni-title')).display === 'none',
      noteText: document.getElementById('noteInfoNote').textContent,
    }));
    check('the manual toggle sets the manual-minimized flag/glyph/.ni-min while a note IS selected, but does NOT set .ni-collapsed',
      manualWithSel.collapsed === false && manualWithSel.manual === true && manualWithSel.niMinClass === true
      && manualWithSel.selSize === 1 && manualWithSel.glyph === '▸', manualWithSel);
    check('manually minimizing no longer hides the "Note Info" title text at all (only the width-based rule can do that)',
      manualWithSel.titleHidden === false, manualWithSel);
    check('manually minimizing does NOT blank the still-selected note\'s own info',
      manualWithSel.noteText !== '—' && manualWithSel.noteText.length > 0, manualWithSel.noteText);

    // Toggling back off — still selected, so .ni-collapsed was never
    // involved and stays false throughout; the manual flag/.ni-min clear.
    await page.click('#niToggleBtn');
    const backToAuto = await page.evaluate(() => ({
      collapsed: document.getElementById('noteInfoLeft').classList.contains('ni-collapsed'),
      manual: window._TEST_state.noteInfoManuallyCollapsed,
      niMinClass: document.getElementById('noteInfoLeft').classList.contains('ni-min'),
      titleShown: getComputedStyle(document.querySelector('#noteInfoLeft .ni-title')).display !== 'none',
    }));
    check('un-toggling the manual override clears the manual flag/.ni-min (still expanded, title still shows)',
      backToAuto.collapsed === false && backToAuto.manual === false && backToAuto.niMinClass === false && backToAuto.titleShown === true, backToAuto);

    // Clearing the selection while the manual toggle is off returns to
    // auto-collapsed — proving the manual flag didn't get stuck "on" and
    // isn't fighting the auto behavior in the other direction either.
    await page.evaluate(() => { window._TEST_state.selection.clear(); window._TEST_updateNoteInfo(); });
    const clearedSel = await page.evaluate(() => document.getElementById('noteInfoLeft').classList.contains('ni-collapsed'));
    check('clearing the selection with the manual toggle off re-collapses via auto-collapse alone', clearedSel === true, clearedSel);
  });

  // ---------------- Item 3: Note Info minimize actually shrinks #velRow ----------------

  await withPage(browser, async (page) => {
    // The bug this fixes: the Note Info min/max toggle used to only hide
    // the literal "Note Info" text — the row's real height never changed,
    // so nothing was actually more compact. Now it must resize #velRow down
    // to the CC lane's own minimized floor (30px, matching
    // .lane.lane-hidden{min-height:30px}) and restore whatever height it
    // had before on maximize, all WITHOUT hiding #velCanvas — it must keep
    // rendering at the compressed height, same as an ordinary #gripVel drag.
    // A note must be selected here — with nothing selected, the title
    // legitimately hides via the separate, unrelated "nothing selected"
    // auto-collapse rule, which would make the title-stays-visible check
    // below pass for the wrong reason (or fail here for a reason that has
    // nothing to do with the manual-minimize behavior under test).
    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 67, start: 0, length: 240, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      window._TEST_state.selection.add(n.id);
      window._TEST_updateNoteInfo();
    });
    const initialH = await page.evaluate(() => document.getElementById('velRow').getBoundingClientRect().height);
    check('#velRow starts at its 84px CSS default height', Math.round(initialH) === 84, initialH);

    await page.click('#niToggleBtn');
    await page.waitForTimeout(80);
    const afterMin = await page.evaluate(() => {
      const row = document.getElementById('velRow');
      const cv = document.getElementById('velCanvas');
      return {
        rowH: row.getBoundingClientRect().height,
        cvDisplay: getComputedStyle(cv).display,
        cvW: cv.width, cvH: cv.height,
        titleDisplay: getComputedStyle(document.querySelector('#noteInfoLeft .ni-title')).display,
      };
    });
    check('minimizing Note Info shrinks #velRow\'s REAL (measured) height down to the ~30px CC-lane-minimized floor',
      Math.round(afterMin.rowH) === 30, afterMin.rowH);
    check('the velocity canvas is NOT hidden while Note Info is minimized, and is resized (not just clipped) to the compressed row',
      afterMin.cvDisplay !== 'none' && afterMin.cvW > 0 && afterMin.cvH > 0 && afterMin.cvH < 60, afterMin);
    check('the "Note Info" title text stays visible while manually minimized (compression, not hiding)',
      afterMin.titleDisplay !== 'none', afterMin);

    await page.click('#niToggleBtn');
    await page.waitForTimeout(80);
    const afterMax = await page.evaluate(() => {
      const row = document.getElementById('velRow');
      const cv = document.getElementById('velCanvas');
      return { rowH: row.getBoundingClientRect().height, cvDisplay: getComputedStyle(cv).display, cvH: cv.height };
    });
    check('maximizing restores #velRow to its previous (84px default) height', Math.round(afterMax.rowH) === 84, afterMax.rowH);
    check('the velocity canvas is still visible and resized back up after maximizing',
      afterMax.cvDisplay !== 'none' && afterMax.cvH > 60, afterMax);
  });

  await withPage(browser, async (page) => {
    // If the user had previously dragged #velRow to a custom height via
    // #gripVel, minimizing then maximizing Note Info must restore that
    // exact custom height, not silently reset to the 84px CSS default.
    const grip = await page.$('#gripVel');
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 5 }); // drag down -> grows the row (dir:'down' in attachGrip)
    await page.mouse.up();
    await page.waitForTimeout(80);
    const draggedH = await page.evaluate(() => document.getElementById('velRow').getBoundingClientRect().height);
    check('dragging #gripVel resizes #velRow to a custom (non-default) height', draggedH > 100, draggedH);

    await page.click('#niToggleBtn');
    await page.waitForTimeout(80);
    const minH = await page.evaluate(() => document.getElementById('velRow').getBoundingClientRect().height);
    check('minimizing after a manual drag still shrinks to the ~30px floor', Math.round(minH) === 30, minH);

    await page.click('#niToggleBtn');
    await page.waitForTimeout(80);
    const restoredH = await page.evaluate(() => document.getElementById('velRow').getBoundingClientRect().height);
    check('maximizing restores the CUSTOM dragged height (not the 84px default)',
      Math.abs(restoredH - draggedH) <= 2, { draggedH, restoredH });
  });

  // ---------------- Piano roll: lower resize floor ----------------

  await withPage(browser, async (page) => {
    const minHeightCss = await page.evaluate(() => getComputedStyle(document.querySelector('.piano-row')).minHeight);
    check('the piano-row CSS floor is lowered to 28px (from the old 70px)', minHeightCss === '28px', minHeightCss);

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const sp = await page.$('#prSplitter');
    const box = await sp.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Drag the splitter far up (shrinking the piano row above it) well past
    // any realistic floor, to prove the JS clamp actually reaches the new
    // 28px minimum rather than stopping at the old 70px one.
    await page.mouse.move(box.x + box.width / 2, box.y - 2000, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const h = await page.evaluate(() => document.querySelector('.piano-row').offsetHeight);
    check('dragging #prSplitter all the way up shrinks the piano roll down to the new 28px floor',
      h === 28, h);
    check('shrinking the piano roll to its new minimum does not throw (resizeCanvases/drawPiano/drawKeys survive)',
      errors.length === 0, errors);

    // Dragging back down should grow it again, well past the floor — proves
    // the floor is a one-sided clamp, not a stuck value. The splitter itself
    // has moved (the piano row above it is now only 28px tall), so its
    // bounding box must be re-measured rather than reusing the stale one
    // from before the first drag.
    const box2 = await sp.boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const h2 = await page.evaluate(() => document.querySelector('.piano-row').offsetHeight);
    check('the piano roll can still be dragged back up above the floor afterward', h2 > 28, h2);
  });

  // ---------------- Piano roll notes: dual custom-name/pitch-name labels ----------------

  await withPage(browser, async (page) => {
    // A wide note (nw well past the two-label gate of 40px) with a custom
    // pitch name must draw BOTH labels in the same pass: the custom name
    // left-aligned, and the standard note name right-aligned — mirroring
    // the keys column's own long-standing dual-label behavior, instead of
    // noteLabel()'s old either/or.
    const expectedStd = await page.evaluate(() => window._TEST_noteName(60));
    await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 60, start: 0, length: 3840, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.pitchNames['0_60'] = 'Kick';
    });
    const draws = await page.evaluate(() => {
      const ctx = document.getElementById('prCanvas').getContext('2d');
      const out = [];
      const orig = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => { out.push({ text, x: Math.round(x), align: ctx.textAlign }); return orig(text, x, y); };
      window.dispatchEvent(new Event('resize'));
      return new Promise(resolve => setTimeout(() => resolve(out), 200));
    });
    const custom = draws.find(d => d.text === 'Kick');
    const std = draws.find(d => d.text === expectedStd);
    check('a wide named note draws its custom pitch name, left-aligned', !!custom && custom.align === 'left', { custom, draws });
    check('the SAME wide named note ALSO draws the standard note name, right-aligned, in the same pass',
      !!std && std.align === 'right', { std, expectedStd, draws });
    check('the custom name sits to the left of the standard name', !!custom && !!std && custom.x < std.x, { custom, std });
  });

  await withPage(browser, async (page) => {
    // A named note too NARROW for both labels (nw <= 40) falls back to the
    // single left-aligned label it always showed (today's noteLabel() call,
    // unchanged) — degrades sensibly instead of cramming two labels in.
    await page.evaluate(() => {
      // pxPerTick defaults to 0.18 -> 112 ticks is ~20px wide (>14 so still
      // drawn, but <=40 so the two-label gate should NOT fire).
      const n = { id: window._TEST_state.nextId++, pitch: 62, start: 0, length: 112, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.pitchNames['0_62'] = 'Snare';
    });
    const draws = await page.evaluate(() => {
      const ctx = document.getElementById('prCanvas').getContext('2d');
      const out = [];
      const orig = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => { out.push({ text, align: ctx.textAlign }); return orig(text, x, y); };
      window.dispatchEvent(new Event('resize'));
      return new Promise(resolve => setTimeout(() => resolve(out), 200));
    });
    const snareDraws = draws.filter(d => d.text === 'Snare');
    check('a narrow named note (too small for both labels) still draws its custom name once, left-aligned',
      snareDraws.length === 1 && snareDraws[0].align === 'left', { snareDraws, draws });
  });

  // ---------------- CC# picker popover (mirrors the Channel picker) ----------------

  await withPage(browser, async (page) => {
    // Baseline lane from withPage(): CC1 on Ch0 (current for this test).
    const lane0 = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    // Same channel as lane0 -> CC10 must show as "used" in lane0's popover.
    await page.evaluate(() => window._TEST_addLane(10, 0));
    // A different channel -> CC20 must NOT show as "used" in lane0's popover.
    await page.evaluate(() => window._TEST_addLane(20, 1));
    await page.waitForTimeout(50);

    await page.click(`.lane[data-id="${lane0}"] .lane-row1 .ccn`);
    await page.waitForTimeout(30);

    const info = await page.evaluate(() => {
      const pop = document.getElementById('ccPopover');
      const opts = [...pop.querySelectorAll('.cc-opt')];
      return {
        open: pop.classList.contains('open'),
        count: opts.length,
        namedText: opts[7] ? opts[7].textContent : null,   // CC 7 -> named, not current, not used
        unnamedText: opts[3] ? opts[3].textContent : null, // CC 3 -> free/undefined
        currentClass: opts[1] ? opts[1].className : '',    // CC 1 is lane0's current CC
        usedClass: opts[10] ? opts[10].className : '',     // CC 10, used by another lane on Ch0
        diffChClass: opts[20] ? opts[20].className : '',   // CC 20, used but on Ch1 (different channel)
      };
    });
    check('the CC popover opens on clicking the CC# button and lists all 128 entries', info.open && info.count === 128, info);
    check('a CC with a known GM name shows "N: Name" (e.g. "7: Volume")',
      info.namedText === '7: Volume', info.namedText);
    check('a CC with no GM name (a free/undefined CC) shows just the bare number',
      info.unnamedText === '3', info.unnamedText);
    check('the CC currently assigned to this lane is marked "current"', info.currentClass.includes('current'), info.currentClass);
    check('a CC already used by ANOTHER lane on the SAME channel is highlighted "used" (amber)',
      info.usedClass.includes('used'), info.usedClass);
    check('a CC used on a DIFFERENT channel is NOT flagged as "used" for this lane',
      !info.diffChClass.includes('used'), info.diffChClass);

    // Selecting an entry applies the same side effects the old free-typing
    // input's handler used to (lane.cc, button label/title, Name placeholder
    // when unnamed) and closes the popover.
    await page.click('#ccPopover .cc-opt:nth-child(51)'); // 51st entry (1-indexed) = CC 50
    await page.waitForTimeout(30);
    const after = await page.evaluate((id) => {
      const lane = window._TEST_state.ccLanes.find(l => l.id === id);
      const btn = document.querySelector(`.lane[data-id="${id}"] .lane-row1 .ccn`);
      const lname = document.querySelector(`.lane[data-id="${id}"] input.lname`);
      return {
        cc: lane.cc, btnText: btn.textContent, btnTitle: btn.title,
        lnamePlaceholder: lname.placeholder,
        popOpen: document.getElementById('ccPopover').classList.contains('open'),
      };
    }, lane0);
    check('selecting a CC from the popover updates lane.cc, the button label/title, and the unnamed lane\'s placeholder',
      after.cc === 50 && after.btnText === '50' && after.btnTitle.includes('50') && after.lnamePlaceholder.length > 0,
      after);
    check('selecting a CC from the popover closes it', after.popOpen === false, after.popOpen);
  });

  await withPage(browser, async (page) => {
    // v0.9.13 fix: a CC already used by another lane on the same channel
    // should show that lane's own CUSTOM name in the popover label (e.g.
    // "18: CutType"), not the generic GM default — falling back to the GM
    // default only when the lane using it has no custom name of its own,
    // and to the bare number when the CC is genuinely unused. The
    // used/amber-highlight logic itself is unchanged (already correct);
    // only the label TEXT is being fixed here.
    const lane0 = await page.evaluate(() => window._TEST_state.ccLanes[0].id); // baseline CC1, Ch0
    const namedLaneId = await page.evaluate(() => window._TEST_addLane(18, 0)); // GM default: "General Purpose Slider 3"
    await page.evaluate((id) => {
      const l = window._TEST_state.ccLanes.find(x => x.id === id);
      l.name = 'CutType';
    }, namedLaneId);
    await page.evaluate(() => window._TEST_addLane(19, 0)); // used, but no custom name -> GM default should still show
    await page.waitForTimeout(50);

    await page.click(`.lane[data-id="${lane0}"] .lane-row1 .ccn`);
    await page.waitForTimeout(30);
    const info = await page.evaluate(() => {
      const pop = document.getElementById('ccPopover');
      const opts = [...pop.querySelectorAll('.cc-opt')];
      return {
        customNamedText: opts[18] ? opts[18].textContent : null, // CC 18, used by the "CutType" lane
        customNamedClass: opts[18] ? opts[18].className : '',
        fallbackGmText: opts[19] ? opts[19].textContent : null,  // CC 19, used but no custom name -> GM default
      };
    });
    check('a used CC whose lane has a custom name shows that CUSTOM name, not the GM default (e.g. "18: CutType")',
      info.customNamedText === '18: CutType', info.customNamedText);
    check('the custom-named entry is still flagged "used" (amber) — only the label text changed, not the highlight logic',
      info.customNamedClass.includes('used'), info.customNamedClass);
    check('a used CC whose lane has NO custom name still falls back to the GM default name',
      info.fallbackGmText === '19: General Purpose Slider 4', info.fallbackGmText);
  });

  await withPage(browser, async (page) => {
    // Outside-click and Escape both close the CC popover, same as #chPopover.
    const laneId = await page.evaluate(() => window._TEST_state.ccLanes[0].id);
    await page.click(`.lane[data-id="${laneId}"] .lane-row1 .ccn`);
    await page.waitForTimeout(30);
    const openBefore = await page.evaluate(() => document.getElementById('ccPopover').classList.contains('open'));
    await page.mouse.click(5, 5);
    await page.waitForTimeout(30);
    const closedAfterOutsideClick = await page.evaluate(() => !document.getElementById('ccPopover').classList.contains('open'));
    check('clicking outside the CC popover closes it', openBefore && closedAfterOutsideClick, { openBefore, closedAfterOutsideClick });

    await page.click(`.lane[data-id="${laneId}"] .lane-row1 .ccn`);
    await page.waitForTimeout(30);
    const openAgain = await page.evaluate(() => document.getElementById('ccPopover').classList.contains('open'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(30);
    const closedAfterEscape = await page.evaluate(() => !document.getElementById('ccPopover').classList.contains('open'));
    check('pressing Escape closes the CC popover', openAgain && closedAfterEscape, { openAgain, closedAfterEscape });
  });

  await withPage(browser, async (page) => {
    // Pitch-bend lanes show "PB" instead of a CC#, and must not have a CC
    // picker button at all — the popover only ever applies to CC lanes.
    await page.click('#addPbLane');
    await page.waitForTimeout(50);
    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.lane')].find(r => r.querySelector('.pb-tag'));
      return {
        found: !!row,
        hasPbTag: row ? !!row.querySelector('.pb-tag') : false,
        hasCcBtn: row ? !!row.querySelector('.lane-row1 .ccn') : true,
      };
    });
    check('a PB lane shows the "PB" tag and has no CC# picker button in row 1',
      info.found && info.hasPbTag && !info.hasCcBtn, info);
  });

  // ---------------- Timeline left-margin gutter (v0.9.12) ----------------
  // A note/CC point at tick 0 used to render flush against the leftcol
  // divider (border-right on .leftcol), making it hard to see or click.
  // Every horizontally-scrolling pane now nudges its tick-based content a
  // fixed GUTTER px to the right at draw time (via ctx.translate after each
  // pane's own edge-to-edge background is painted), while tickToX/xToTick
  // and every scroll/zoom formula stay exactly as they were — only the
  // screen<->tick coordinate helpers (rulerX/prCoords/velCoords/laneCoords/
  // zoomHAt) know about the gutter, subtracting it back out so a click still
  // lands on the tick that's visually under the cursor.

  await withPage(browser, async (page) => {
    // 1) Visual clearance: sample actual canvas pixels (not just the
    // formula) to prove a tick-0 note is inset from the border by ~GUTTER
    // px, and that the border itself (x=0) is still plain background.
    const gutter = await page.evaluate(() => window._TEST_GUTTER());
    check('GUTTER is a small positive inset (a few px, not zero and not huge)', gutter > 0 && gutter <= 12, gutter);

    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 70, start: 0, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      return n;
    });
    await page.evaluate(() => window._TEST_requestDraw());
    const scan = await page.evaluate((pitch) => {
      const cv = document.getElementById('prCanvas'), ctx = cv.getContext('2d');
      const nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const y = Math.round((PITCH_MAX - pitch) * nh + nh / 2);
      const row = ctx.getImageData(0, y, Math.min(40, cv.width), 1).data;
      const bg = [row[0], row[1], row[2]];
      let firstDiff = -1;
      for (let x = 0; x < row.length / 4; x++) {
        const o = x * 4;
        if (Math.abs(row[o] - bg[0]) + Math.abs(row[o + 1] - bg[1]) + Math.abs(row[o + 2] - bg[2]) > 40) { firstDiff = x; break; }
      }
      return { firstDiff, bg };
    }, note.pitch);
    check('a tick-0 note\'s fill color starts roughly GUTTER px in from the canvas edge, not at x=0',
      scan.firstDiff >= gutter - 1 && scan.firstDiff <= gutter + 2, { ...scan, gutter });
    check('the column right at the leftcol border (x=0) is still plain pane background, not note fill — a real margin, not a coincidence',
      scan.firstDiff > 0, scan);
  });

  await withPage(browser, async (page) => {
    // 2) Hit-testing follows the same shift: a click at the OLD tick-0 spot
    // (flush against the border) no longer hits the note, but a click at its
    // actual gutter-shifted on-screen position does.
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 68, start: 0, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      return n;
    });
    const pos = await page.evaluate((pitch) => {
      const rect = document.getElementById('prScroll').getBoundingClientRect();
      const nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const y = rect.top + (PITCH_MAX - pitch) * nh + nh / 2 - document.getElementById('prScroll').scrollTop;
      return { xBorder: rect.left + 1, xNote: rect.left + window._TEST_GUTTER() + 20, y };
    }, note.pitch);
    await page.mouse.click(pos.xBorder, pos.y);
    const selAtBorder = await page.evaluate(() => [...window._TEST_state.selection]);
    check('clicking right at the leftcol border (the pre-gutter tick-0 spot) no longer hits the tick-0 note',
      selAtBorder.length === 0, selAtBorder);

    await page.mouse.click(pos.xNote, pos.y);
    const selAtNote = await page.evaluate(() => [...window._TEST_state.selection]);
    check('clicking at the note\'s actual (gutter-shifted) on-screen position selects it',
      selAtNote.includes(note.id), { selAtNote, noteId: note.id });
  });

  await withPage(browser, async (page) => {
    // 3) Round-trip: clicking the ruler at the on-screen position of tick T
    // (computed the same way the app renders it, i.e. through the gutter)
    // must resolve back to exactly tick T — both at tick 0 (the reported
    // bug) and at a nonzero tick (so the fix isn't accidentally tick-0-only).
    for (const T of [0, 960]) {
      const clientX = await page.evaluate((T) => {
        const r = document.getElementById('rulerScroll').getBoundingClientRect();
        return r.left + T * window._TEST_state.pxPerTick - window._TEST_state.scrollLeft + window._TEST_GUTTER();
      }, T);
      const clientY = await page.evaluate(() => {
        const r = document.getElementById('rulerScroll').getBoundingClientRect();
        return r.top + r.height / 2;
      });
      await page.evaluate(() => { window._TEST_state.playhead = -1; });
      await page.mouse.click(clientX, clientY);
      const playhead = await page.evaluate(() => window._TEST_state.playhead);
      check(`clicking the ruler at tick ${T}'s on-screen position sets the playhead to exactly tick ${T} (round-trips through the gutter)`,
        playhead === T, { T, playhead });
    }
  });

  await withPage(browser, async (page) => {
    // 4) Drag deltas are unaffected: the gutter is a constant baked into both
    // the drag-start and drag-move coordinate reads, so it must cancel out.
    // Verified explicitly (not just reasoned about) for a note starting at
    // tick 0 and one starting at a nonzero tick, with snap off so the raw
    // pixel->tick arithmetic isn't obscured by grid snapping.
    await page.evaluate(() => { window._TEST_state.snap = 'off'; });
    const pxPerTick = await page.evaluate(() => window._TEST_state.pxPerTick);
    for (const startTick of [0, 960]) {
      const note = await page.evaluate((startTick) => {
        const n = { id: window._TEST_state.nextId++, pitch: 72, start: startTick, length: 480, vel: 100, ch: 0 };
        window._TEST_state.notes.push(n);
        window._TEST_state.selection.clear();
        window._TEST_state.selection.add(n.id);
        return n;
      }, startTick);
      const pt = await page.evaluate((note) => {
        const rect = document.getElementById('prScroll').getBoundingClientRect();
        const nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
        const tick = note.start + note.length / 2;
        const x = tick * window._TEST_state.pxPerTick - window._TEST_state.scrollLeft + window._TEST_GUTTER();
        const y = (PITCH_MAX - note.pitch) * nh + nh / 2 - document.getElementById('prScroll').scrollTop;
        return { clientX: rect.left + x, clientY: rect.top + y };
      }, note);
      const rawDeltaPx = 137; // arbitrary, deliberately not aligned to any tick/snap boundary
      await page.mouse.move(pt.clientX, pt.clientY);
      await page.mouse.down();
      await page.mouse.move(pt.clientX + rawDeltaPx, pt.clientY, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const after = await page.evaluate((id) => window._TEST_state.notes.find(n => n.id === id).start, note.id);
      const expectedDelta = Math.round(rawDeltaPx / pxPerTick);
      check(`dragging a note starting at tick ${startTick} by ${rawDeltaPx}px moves it by the same tick delta the gutter has no effect on drag deltas`,
        after - startTick === expectedDelta, { startTick, after, expectedDelta, actualDelta: after - startTick });
      await page.evaluate((id) => { window._TEST_state.notes = window._TEST_state.notes.filter(n => n.id !== id); }, note.id);
    }
  });

  await withPage(browser, async (page) => {
    // 5) Cross-pane pixel alignment: the ruler's bar line and a note at that
    // same tick must land at the same physical x — this is exactly what
    // would break if the gutter translate weren't applied identically to
    // every horizontally-scrolling pane.
    const rulerRect = await page.evaluate(() => document.getElementById('rulerCanvas').getBoundingClientRect());
    const prRect = await page.evaluate(() => document.getElementById('prCanvas').getBoundingClientRect());
    check('ruler and piano-roll canvases share the same horizontal screen position (precondition for the alignment check below)',
      Math.abs(rulerRect.left - prRect.left) < 1, { rulerLeft: rulerRect.left, prLeft: prRect.left });

    // Bar 2 starts at tick 1920 (ppq 480 * 4 ticks/beat * 4/4 time) — a
    // guaranteed full-height bar line in the ruler.
    const note = await page.evaluate(() => {
      const n = { id: window._TEST_state.nextId++, pitch: 66, start: 1920, length: 480, vel: 100, ch: 0 };
      window._TEST_state.notes.push(n);
      window._TEST_state.selection.clear();
      return n;
    });
    await page.evaluate(() => window._TEST_requestDraw());
    const xs = await page.evaluate((pitch) => {
      const prCv = document.getElementById('prCanvas'), rulerCv = document.getElementById('rulerCanvas');
      const pctx = prCv.getContext('2d'), rctx = rulerCv.getContext('2d');
      const nh = window._TEST_state.noteHeight, PITCH_MAX = 127;
      const y = Math.round((PITCH_MAX - pitch) * nh + nh / 2);
      const row = pctx.getImageData(0, y, prCv.width, 1).data;
      const bg = [row[0], row[1], row[2]];
      let noteX = -1;
      for (let x = 0; x < row.length / 4; x++) {
        const o = x * 4;
        if (Math.abs(row[o] - bg[0]) + Math.abs(row[o + 1] - bg[1]) + Math.abs(row[o + 2] - bg[2]) > 40) { noteX = x; break; }
      }
      const rrow = rctx.getImageData(0, 2, rulerCv.width, 1).data;
      const rbg = [rrow[0], rrow[1], rrow[2]];
      let barX = -1;
      for (let x = 0; x < rrow.length / 4; x++) {
        const o = x * 4;
        if (Math.abs(rrow[o] - rbg[0]) + Math.abs(rrow[o + 1] - rbg[1]) + Math.abs(rrow[o + 2] - rbg[2]) > 30) { barX = x; break; }
      }
      return { noteX, barX };
    }, note.pitch);
    check('the tick-1920 note (piano roll) and the ruler\'s bar line at the same tick land within 2px of each other',
      xs.noteX >= 0 && xs.barX >= 0 && Math.abs(xs.noteX - xs.barX) <= 2, xs);
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
