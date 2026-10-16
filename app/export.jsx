// ---------- video export ----------
// Steps the player through every frame, draws the stage into a canvas with html2canvas-pro and encodes it in
// the browser (WebCodecs, muxed by Mediabunny). Both libraries load from the CDN on the first export only.
// frame rates offered in Settings; each frame takes about 0.2 s to draw, so the export time scales with it
const EXPORT_FPS_OPTIONS = [8, 12, 15, 24, 30];
const EXPORT_LIBS = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js',
  mediabunny: 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/dist/bundles/mediabunny.min.mjs',
};
let exportLibs = null;
function loadExportLibs() {
  if (!exportLibs) {
    const script = new Promise((ok, fail) => {
      if (window.html2canvas) return ok();
      const s = document.createElement('script');
      s.src = EXPORT_LIBS.html2canvas; s.onload = ok; s.onerror = () => fail(new Error('could not load html2canvas-pro'));
      document.head.appendChild(s);
    });
    exportLibs = Promise.all([script, import(EXPORT_LIBS.mediabunny)]).then(([, MB]) => ({ html2canvas: window.html2canvas, MB }));
    exportLibs.catch(() => { exportLibs = null; });
  }
  return exportLibs;
}
// the stage re-renders synchronously inside dispatchEvent, so the frame can be drawn straight after
const seekStage = (t) => window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time: t, sync: true } }));

function useVideoExport({ total, fps, save, stem }) {
  const [state, setState] = React.useState(null); // { phase: 'load' | 'render' | 'save', done, N, eta } or { phase: 'error', msg }
  const stopRef = React.useRef(false);
  const run = async () => {
    if (state && state.phase !== 'error') return;
    stopRef.current = false;
    setState({ phase: 'load', done: 0, N: 0 });
    let output = null;
    try {
      const { html2canvas, MB } = await loadExportLibs();
      const el = document.querySelector('.stage-frame > div');
      // the frame on screen is scaled to fit; the export draws it at its own size (1920×1080, or the portrait frame)
      const W = el.offsetWidth & ~1, H = el.offsetHeight & ~1;
      const avc = await MB.canEncodeVideo('avc', { width: W, height: H });
      const codec = avc ? 'avc' : (await MB.canEncodeVideo('vp9', { width: W, height: H })) ? 'vp9' : null;
      if (!codec) throw new Error('this browser cannot encode video. Try a recent Chrome, Edge or Firefox.');
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      output = new MB.Output({ format: avc ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat(), target: new MB.BufferTarget() });
      const src = new MB.CanvasSource(cv, { codec, bitrate: MB.QUALITY_HIGH });
      output.addVideoTrack(src, { frameRate: fps });
      await output.start();
      // html2canvas copies the whole document every frame: leave out the scripts (the artifact inlines a 2.4 MB
      // engine) and the page around the stage, but keep the head and every stylesheet (fonts and base styles)
      const keep = (n) => n.tagName === 'STYLE' || n.tagName === 'LINK' || n.tagName === 'HEAD' || n.closest('head');
      const skip = (n) => n.tagName === 'SCRIPT' || (!keep(n) && n !== el && !n.contains(el) && !el.contains(n));
      const N = Math.floor(total * fps) + 1, t0 = performance.now();
      let prev = null;
      for (let i = 0; i < N; i++) {
        if (stopRef.current) { await output.cancel(); setState(null); return; }
        seekStage(i / fps);
        // a frame whose markup matches the last one (holds, the title and end cards) reuses the canvas as it is
        const html = el.innerHTML;
        if (html !== prev) {
          const shot = await html2canvas(el, { scale: 1, width: W, height: H, logging: false, ignoreElements: skip, onclone: (doc, c) => { c.style.transform = 'none'; } });
          cx.clearRect(0, 0, W, H); cx.drawImage(shot, 0, 0, W, H);
          prev = html;
        }
        await src.add(i / fps, 1 / fps);
        const per = (performance.now() - t0) / (i + 1);
        setState({ phase: 'render', done: i + 1, N, eta: per * (N - i - 1) / 1000 });
      }
      setState({ phase: 'save', done: N, N });
      await output.finalize();
      await save(stem + (avc ? '.mp4' : '.webm'), new Blob([output.target.buffer], { type: avc ? 'video/mp4' : 'video/webm' }));
      setState(null);
    } catch (e) {
      try { if (output && output.state === 'started') await output.cancel(); } catch (_) {}
      setState({ phase: 'error', msg: 'Export failed: ' + ((e && e.message) || e) });
    }
  };
  return { state, run, cancel: () => { stopRef.current = true; }, dismiss: () => setState(null), busy: !!state && state.phase !== 'error' };
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
  const line = s.phase === 'load' ? 'Loading the video encoder…'
    : s.phase === 'save' ? 'Finishing the file…'
    : `Frame ${s.done} of ${s.N} · about ${min} min left`;
  return (
    <div className="export" role="dialog" aria-label="Exporting video">
      <div className="export-box">
        <div className="export-title">Exporting video</div>
        <div className="export-bar"><div style={{ width: pct + '%' }} /></div>
        <div className="export-line">{line}</div>
        <div className="export-note">Keep this tab open and visible: the export pauses while it is hidden.</div>
        {s.phase === 'render' && <button type="button" className="twk-btn secondary" onClick={x.cancel}>Cancel</button>}
      </div>
    </div>
  );
}
