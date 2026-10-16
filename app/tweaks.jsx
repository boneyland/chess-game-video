// Settings panel + controls, adapted from Claude Design's tweaks-panel.jsx.
// Values persist per viewer in localStorage instead of being written back by the design host.

const TWEAK_STORE = 'chess-video.tweaks.v1';

function useTweaks(defaults) {
  const [values, setValues] = React.useState(() => {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(TWEAK_STORE) || 'null') || {}) }; } catch (e) { return defaults; }
  });
  const setTweak = React.useCallback((key, val) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      try { localStorage.setItem(TWEAK_STORE, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, []);
  return [values, setTweak];
}

function TweaksPanel({ open, onClose, title = 'Settings', children }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside className="twk-panel" aria-label={title}>
      <div className="twk-hd">
        <b>{title}</b>
        <button type="button" className="twk-x" aria-label="Close settings" onClick={onClose}>✕</button>
      </div>
      <div className="twk-body">{children}</div>
    </aside>
  );
}

function TweakSection({ label }) { return <div className="twk-sect">{label}</div>; }

function TweakRow({ label, value, children }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}</span>{value != null && <span className="twk-val">{value}</span>}</div>
      {children}
    </div>
  );
}

function TweakSlider({ id, label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input id={id} type="range" className="twk-slider" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ id, label, value, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <label className="twk-lbl" htmlFor={id}><span>{label}</span></label>
      <button id={id} type="button" className="twk-toggle" data-on={value ? '1' : '0'} role="switch" aria-checked={!!value} onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakSelect({ id, label, value, options, onChange }) {
  return (
    <TweakRow label={label}>
      <select id={id} className="twk-field" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </TweakRow>
  );
}

// Segmented control for 2–3 short options; longer labels fall back to a select
function TweakRadio({ id, label, value, options, onChange }) {
  const maxLen = options.reduce((m, o) => Math.max(m, String(o).length), 0);
  if (maxLen > ({ 2: 16, 3: 10 }[options.length] || 0)) return <TweakSelect id={id} label={label} value={value} options={options} onChange={onChange} />;
  const idx = Math.max(0, options.indexOf(value)), n = options.length;
  return (
    <TweakRow label={label}>
      <div className="twk-seg" role="radiogroup" aria-label={label}>
        <div className="twk-seg-thumb" style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`, width: `calc((100% - 4px) / ${n})` }} />
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </TweakRow>
  );
}

function TweakButton({ label, onClick, secondary = false, disabled = false }) {
  return <button type="button" className={secondary ? 'twk-btn secondary' : 'twk-btn'} disabled={disabled} onClick={onClick}>{label}</button>;
}

Object.assign(window, { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakButton });
