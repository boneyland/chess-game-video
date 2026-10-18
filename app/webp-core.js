// Animated WebP for the export: the browser encodes each frame as a still WebP (canvas.toBlob), and this wraps
// those stills' image chunks in one animated file (RIFF: VP8X, ANIM, then an ANMF chunk per frame).
// Frames stay Blobs throughout, so a long export never needs the whole file in one buffer.
(function () {
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const u24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  const le32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

  // Where a still WebP's image data starts, from its first bytes: past the RIFF header and any VP8X, ICCP (Chromium
  // adds a colour profile), EXIF or XMP chunk. What follows is ALPH + VP8, VP8 or VP8L, which is exactly what an ANMF
  // chunk holds. alpha: whether the frame has transparency.
  function stillImage(head) {
    if (head.length < 20 || fourcc(head, 0) !== 'RIFF' || fourcc(head, 8) !== 'WEBP') throw new Error('not a WebP image');
    let alpha = false;
    for (let at = 12; at + 8 <= head.length;) {
      const id = fourcc(head, at), len = le32(head, at + 4);
      if (id === 'ALPH' || id === 'VP8 ') return { offset: at, alpha: alpha || id === 'ALPH' };
      // VP8L: signature byte, then 14 + 14 bits of width and height, then the alpha bit
      if (id === 'VP8L') return { offset: at, alpha: alpha || !!(head[at + 12] & 0x10) };
      if (id === 'VP8X') alpha = !!(head[at + 8] & 0x10);
      at += 8 + len + (len & 1);
    }
    throw new Error('no image data in the first ' + head.length + ' bytes');
  }

  // Each frame's duration in whole milliseconds (all WebP can hold), rounded so the frames add up to the right time:
  // at 12 fps that is 83, 84, 83, 83, 84, … rather than 83 throughout, which would drift 4 s behind per 10 minutes
  const durations = (n, fps) => Array.from({ length: n }, (_, i) => Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps));

  // frames: [{ data: Blob or Uint8Array holding a frame's image chunks, size: its length in bytes, duration: ms,
  // alpha }], every one the full canvas. Returns the file's parts, for new Blob(parts, { type: 'image/webp' }).
  // loop: 0 plays forever.
  function mux(frames, { width, height, loop = 0 }) {
    if (!frames.length) throw new Error('no frames');
    const alpha = frames.some((f) => f.alpha);
    const vp8x = [...ascii('VP8X'), ...u32(10), (alpha ? 0x10 : 0) | 0x02, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)];
    const anim = [...ascii('ANIM'), ...u32(6), 0, 0, 0, 0, loop & 255, (loop >> 8) & 255];
    const parts = [], pad = new Uint8Array(1);
    let size = 4 + vp8x.length + anim.length;
    for (const f of frames) {
      if (f.duration < 1 || f.duration > 0xffffff) throw new Error('frame duration out of range: ' + f.duration);
      // offset 0,0 at full size; flags 0x02: drawn over nothing (no blending), and not disposed
      const body = [0, 0, 0, 0, 0, 0, ...u24(width - 1), ...u24(height - 1), ...u24(f.duration), 0x02];
      parts.push(new Uint8Array([...ascii('ANMF'), ...u32(body.length + f.size), ...body]), f.data);
      // RIFF chunks are padded to even length
      if (f.size & 1) parts.push(pad);
      size += 8 + body.length + f.size + (f.size & 1);
    }
    return [new Uint8Array([...ascii('RIFF'), ...u32(size), ...ascii('WEBP'), ...vp8x, ...anim])].concat(parts);
  }

  window.WebPAnim = { stillImage, durations, mux };
})();
