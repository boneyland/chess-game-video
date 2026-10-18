// ---------- video export ----------
// Steps the player through every frame, draws the stage into a canvas with html2canvas-pro and encodes it in
// the browser: an MP4 (WebCodecs, muxed by Mediabunny), or an animated WebP (each frame a still from the canvas,
// joined by webp-core.js). The libraries load from the CDN on the first export only.
// frame rates offered in Settings; each frame takes about 0.2 s to draw, so the export time scales with it
const EXPORT_FPS_OPTIONS = [8, 12, 15, 24, 30];
// a new version needs a new hash: html2canvas-pro's here, mediabunny's in the import map in shell.html
const EXPORT_LIBS = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js',
  html2canvasHash: 'sha384-IT/7L8+t0nqitKnKyUD1rh3hC/qPQehh1Et4A2dTqUuxKbomoRs73yhSQoALaYeI',
  mediabunny: 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/dist/bundles/mediabunny.min.mjs',
};
const EXPORT_FORMATS = ['MP4', 'WebP'];
// WebP frames are lossy stills at this quality (0–1); 0.9 made frames about a quarter larger for little gain
const WEBP_QUALITY = 0.8;
// the WebP's size against the frame's own (1920×1080, or the portrait frame); Half makes files about a third the size
const WEBP_SIZES = { Full: 1, Half: 0.5 };
// each library loads once; a failed load is tried again on the next export
const once = (load) => { let p = null; return () => (p = p || load().catch((e) => { p = null; throw e; })); };
const loadHtml2canvas = once(() => new Promise((ok, fail) => {
  if (window.html2canvas) return ok(window.html2canvas);
  const s = document.createElement('script');
  s.src = EXPORT_LIBS.html2canvas; s.integrity = EXPORT_LIBS.html2canvasHash; s.crossOrigin = 'anonymous';
  s.onload = () => ok(window.html2canvas); s.onerror = () => fail(new Error('could not load html2canvas-pro'));
  document.head.appendChild(s);
}));
const loadMediabunny = once(() => import(EXPORT_LIBS.mediabunny));

// The two encoders behind one interface: frame(isNew) after each frame is drawn into the canvas (isNew false when
// it is the same picture as the last), then finish() gives the file as { blob, ext }, or cancel()
async function mp4Encoder(cv, W, H, fps, audio) {
  const MB = await loadMediabunny();
  const avc = await MB.canEncodeVideo('avc', { width: W, height: H });
  const codec = avc ? 'avc' : (await MB.canEncodeVideo('vp9', { width: W, height: H })) ? 'vp9' : null;
  if (!codec) throw new Error('this browser cannot encode video. Try a recent Chrome, Edge or Firefox.');
  const output = new MB.Output({ format: avc ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat(), target: new MB.BufferTarget() });
  const src = new MB.CanvasSource(cv, { codec, bitrate: MB.QUALITY_HIGH });
  output.addVideoTrack(src, { frameRate: fps });
  // the move sounds, when the browser can encode them: AAC in an MP4, else Opus (which MP4 and WebM both hold)
  const sound = audio ? await audio() : null;
  let asrc = null;
  if (sound) {
    const acodec = await MB.getFirstEncodableAudioCodec(avc ? ['aac', 'opus'] : ['opus'], { numberOfChannels: sound.numberOfChannels, sampleRate: sound.sampleRate });
    if (acodec) { asrc = new MB.AudioBufferSource({ codec: acodec, bitrate: MB.QUALITY_MEDIUM }); output.addAudioTrack(asrc); }
  }
  await output.start();
  if (asrc) { await asrc.add(sound); asrc.close(); }
  let i = 0;
  return {
    frame: async () => { await src.add(i / fps, 1 / fps); i++; },
    finish: async () => {
      await output.finalize();
      return { blob: new Blob([output.target.buffer], { type: avc ? 'video/mp4' : 'video/webm' }), ext: avc ? '.mp4' : '.webm' };
    },
    cancel: async () => { if (output.state === 'started') await output.cancel(); },
  };
}

// a held picture (a pause, the title and end cards) stays one frame whose duration grows, so holds cost nothing.
// scale below 1 draws each frame smaller into a canvas of its own before encoding it
async function webpEncoder(cv, W, H, fps, scale = 1) {
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const out = scale === 1 ? cv : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ox = scale === 1 ? null : out.getContext('2d');
  if (ox) ox.imageSmoothingQuality = 'high';
  const still = () => {
    if (ox) { ox.clearRect(0, 0, w, h); ox.drawImage(cv, 0, 0, w, h); }
    return new Promise((ok) => out.toBlob(ok, 'image/webp', WEBP_QUALITY));
  };
  const test = await still();
  if (!test || test.type !== 'image/webp') throw new Error('this browser cannot make WebP images. Try a recent Chrome, Edge or Firefox, or export an MP4.');
  const frames = [];
  let i = 0;
  // frame i ends at round((i + 1) * 1000 / fps) ms, so the whole file keeps time (see WebPAnim.durations)
  const end = (k) => Math.round((k * 1000) / fps);
  return {
    frame: async (isNew) => {
      const last = frames[frames.length - 1];
      if (isNew || !last) {
        const blob = await still();
        const { offset, alpha } = window.WebPAnim.stillImage(new Uint8Array(await blob.slice(0, 65536).arrayBuffer()));
        frames.push({ data: blob.slice(offset), size: blob.size - offset, duration: end(i + 1) - end(i), alpha });
      } else last.duration += end(i + 1) - end(i);
      i++;
    },
    finish: async () => ({ blob: new Blob(window.WebPAnim.mux(frames, { width: w, height: h }), { type: 'image/webp' }), ext: '.webp' }),
    cancel: async () => {},
  };
}
// the stage re-renders synchronously inside dispatchEvent, so the frame can be drawn straight after
const seekStage = (t) => window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time: t, sync: true } }));

// run() takes the stretch of the timeline to export in seconds ({ start, end }), a file name suffix, and audio: an
// async function giving the stretch's soundtrack as an AudioBuffer (or null for none; a WebP has no sound).
// format: one of EXPORT_FORMATS; webpSize: a WEBP_SIZES key
function useVideoExport({ fps, format, webpSize, save, stem }) {
  const [state, setState] = React.useState(null); // { phase: 'load' | 'render' | 'save', done, N, eta } or { phase: 'error', msg }
  const stopRef = React.useRef(false);
  const run = async ({ start, end, suffix = '', audio }) => {
    if (state && state.phase !== 'error') return;
    stopRef.current = false;
    setState({ phase: 'load', done: 0, N: 0 });
    let enc = null;
    try {
      const html2canvas = await loadHtml2canvas();
      const el = document.querySelector('.stage-frame > div');
      // the frame on screen is scaled to fit; the export draws it at its own size (1920×1080, or the portrait frame)
      const W = el.offsetWidth & ~1, H = el.offsetHeight & ~1;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      enc = format === 'WebP' ? await webpEncoder(cv, W, H, fps, WEBP_SIZES[webpSize] || 1) : await mp4Encoder(cv, W, H, fps, audio);
      // html2canvas copies the whole document every frame: leave out the scripts (the artifact inlines a 2.4 MB
      // engine) and the page around the stage, but keep the head and every stylesheet (fonts and base styles)
      const keep = (n) => n.tagName === 'STYLE' || n.tagName === 'LINK' || n.tagName === 'HEAD' || n.closest('head');
      const skip = (n) => n.tagName === 'SCRIPT' || (!keep(n) && n !== el && !n.contains(el) && !el.contains(n));
      const N = Math.floor((end - start) * fps) + 1, t0 = performance.now();
      let prev = null;
      for (let i = 0; i < N; i++) {
        if (stopRef.current) { await enc.cancel(); setState(null); return; }
        seekStage(start + i / fps);
        // a frame whose markup matches the last one (holds, the title and end cards) reuses the canvas as it is
        const html = el.innerHTML, isNew = html !== prev;
        if (isNew) {
          const shot = await html2canvas(el, { scale: 1, width: W, height: H, logging: false, ignoreElements: skip, onclone: (doc, c) => { c.style.transform = 'none'; } });
          cx.clearRect(0, 0, W, H); cx.drawImage(shot, 0, 0, W, H);
          prev = html;
        }
        await enc.frame(isNew);
        const per = (performance.now() - t0) / (i + 1);
        setState({ phase: 'render', done: i + 1, N, eta: per * (N - i - 1) / 1000 });
      }
      setState({ phase: 'save', done: N, N });
      const { blob, ext } = await enc.finish();
      await save(stem + suffix + ext, blob);
      setState(null);
    } catch (e) {
      try { if (enc) await enc.cancel(); } catch (_) {}
      setState({ phase: 'error', msg: 'Export failed: ' + ((e && e.message) || e) });
    }
  };
  return { state, run, format, cancel: () => { stopRef.current = true; }, dismiss: () => setState(null), busy: !!state && state.phase !== 'error' };
}

function ExportOverlay({ x }) {
  const s = x.state;
  if (!s) return null;
  if (s.phase === 'error') return (
    <div className="export" role="alertdialog" aria-label="Export failed">
      <div className="export-box">
        <div className="export-title">Export failed</div>
        <div className="export-line export-err">{s.msg.replace(/^Export failed: /, '')}</div>
        <button type="button" className="twk-btn secondary" onClick={x.dismiss}>Close</button>
      </div>
    </div>
  );
  const pct = s.N ? Math.round((100 * s.done) / s.N) : 0;
  const min = s.eta != null ? Math.max(1, Math.round(s.eta / 60)) : null;
  const line = s.phase === 'load' ? 'Loading the encoder…'
    : s.phase === 'save' ? 'Finishing the file…'
    : `Frame ${s.done} of ${s.N} · about ${min} min left`;
  return (
    <div className="export" role="dialog" aria-label="Exporting">
      <div className="export-box">
        <div className="export-title">Exporting {x.format === 'WebP' ? 'animated WebP' : 'video'}</div>
        <div className="export-bar"><div style={{ width: pct + '%' }} /></div>
        <div className="export-line">{line}</div>
        <div className="export-note">Keep this tab open and visible: the export pauses while it is hidden. Resizing the window or turning the phone changes the layout, and the video with it.</div>
        {s.phase === 'render' && <button type="button" className="twk-btn secondary" onClick={x.cancel}>Cancel</button>}
      </div>
    </div>
  );
}
