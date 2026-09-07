// 2400 bits/s, 8 data + 1 start + 1 stop bit = 240 wire bytes/s.
// The model is an uncompressed CP437-era stream, not a timing claim about LoRD.
export function wireSchedule(text, { bps = 2400, random = Math.random, stalls = true, overhead = 0, state = {} } = {}) {
  const byteMs = 10_000 / bps;
  let at = overhead * byteMs;
  let nextStall = state.nextStall ?? 480 + Math.floor(random() * 721);
  let wireBytes = (state.wireBytes || 0) + overhead;
  const result = [];
  for (const char of Array.from(text)) {
    // A displayed newline represents CR+LF; legacy glyphs occupy one wire byte.
    const bytes = char === '\n' ? 2 : 1;
    at += bytes * byteMs;
    wireBytes += bytes;
    if (stalls && wireBytes >= nextStall) {
      at += 30 + Math.floor(random() * 111);
      nextStall = wireBytes + 480 + Math.floor(random() * 721);
    }
    result.push({ char, at });
  }
  state.nextStall = nextStall; state.wireBytes = wireBytes;
  return result;
}

export function createWriter(screen) {
  let generation = 0;
  const wire = {};
  return {
    clear() { generation++; screen.replaceChildren(); screen.scrollTop = 0; },
    async write(lines) {
      const ticket = generation;
      const nodes = [];
      const frames = [];
      let offset = 0;
      for (const item of lines) {
        const { text, style = '' } = typeof item === 'string' ? { text: item } : item;
        const node = document.createElement('div');
        node.className = 'boot-line door-line' + (style ? ' ' + style : '');
        node.append(document.createTextNode(''));
        nodes.push(node);
        // Approximate ANSI color/reset byte cost; style bytes take time but do not print.
        const schedule = wireSchedule(text + '\n', { overhead: style ? 9 : 0, state: wire });
        for (const frame of schedule) frames.push({ ...frame, at: frame.at + offset, node });
        offset = frames.at(-1)?.at || offset;
      }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        lines.forEach((line, i) => { nodes[i].textContent = typeof line === 'string' ? line : line.text; screen.append(nodes[i]); });
        screen.scrollTop = screen.scrollHeight;
        return;
      }
      await new Promise(resolve => {
        let start = performance.now();
        let last = start;
        let i = 0;
        function draw(now) {
          if (ticket !== generation) { resolve(); return; }
          // A hidden tab or stalled browser must not fast-forward all buffered output.
          if (now - last > 100) start += now - last;
          last = now;
          let changed = false;
          while (i < frames.length && frames[i].at <= now - start) {
            const { char, node } = frames[i++];
            if (!node.isConnected) screen.append(node);
            if (char !== '\n') node.firstChild.appendData(char);
            changed = true;
          }
          if (changed) screen.scrollTop = screen.scrollHeight;
          if (i < frames.length) requestAnimationFrame(draw);
          else resolve();
        }
        requestAnimationFrame(draw);
      });
    }
  };
}
