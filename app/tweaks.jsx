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

// tabs: [{ id, label, body }], falsy ones left out; tab is the open one's id (the first tab when it isn't shown). Every
// layout gets the same panel: one column under a fixed grid of tabs, of one height whichever tab is open
function TweaksPanel({ open, onClose, title = 'Settings', tabs, tab, onTab }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const strip = React.useRef(null);
  if (!open) return null;
  const shown = tabs.filter(Boolean), cur = shown.find((x) => x.id === tab) || shown[0];
  // arrows, Home and End move between the tabs, as in a tab list
  const onKeyDown = (e) => {
    const i = shown.indexOf(cur), n = shown.length;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    onTab(shown[j % n].id);
    strip.current.children[j % n].focus();
  };
  return (
    <aside className="twk-panel twk-tabbed" aria-label={title}>
      <div className="twk-hd">
        <b>{title}</b>
        <button type="button" className="twk-x" aria-label="Close settings" onClick={onClose}>✕</button>
      </div>
      <div ref={strip} className="twk-tabs" role="tablist" aria-label={title} style={{ '--twk-tab-cols': shown.length <= 4 ? shown.length : Math.ceil(shown.length / 2) }} onKeyDown={onKeyDown}>
        {shown.map((x) => (
          <button key={x.id} id={'twk-tab-' + x.id} type="button" role="tab" aria-selected={x === cur} aria-controls="twk-tabpanel" tabIndex={x === cur ? 0 : -1} onClick={() => onTab(x.id)}>{x.label}</button>
        ))}
      </div>
      <div key={cur.id} className="twk-body" id="twk-tabpanel" role="tabpanel" aria-labelledby={'twk-tab-' + cur.id}>{cur.body}</div>
    </aside>
  );
}

// a titled group of rows within a tab
function TweakSection({ label, children }) { return <section className="twk-group"><div className="twk-sect">{label}</div>{children}</section>; }

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

function TweakSelect({ id, label, aria, value, options, onChange }) {
  return (
    <TweakRow label={label}>
      <select id={id} className="twk-field" value={value} aria-label={aria || label} onChange={(e) => onChange(e.target.value)}>
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
