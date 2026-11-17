/* A small animated-GIF writer, enough for the stroke-order GIFs: one global palette of up
   to 256 colours, frames that cover only the part of the picture that changed, and a
   loop that never ends. No dependencies; app.js uses it as window.GifWriter.

     const gif = new GifWriter(width, height, palette);   // palette: [[r, g, b], …]
     gif.addFrame(x, y, w, h, indices, delayMs);          // indices: one palette index per pixel
     gif.extendLastFrame(ms);                              // hold the last frame longer
     const blob = gif.finish();                            // image/gif */
(() => {
  'use strict';

  /* LZW-compress one frame's palette indices into GIF data sub-blocks. */
  function compress(indices, out) {
    const minCodeSize = 8;
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let table = new Map();

    let block = [];
    let buffer = 0;
    let bits = 0;
    const flushBlock = () => {
      if (!block.length) return;
      out.push(block.length, ...block);
      block = [];
    };
    const emit = (code) => {
      buffer |= code << bits;
      bits += codeSize;
      while (bits >= 8) {
        block.push(buffer & 0xff);
        buffer >>>= 8;
        bits -= 8;
        if (block.length === 255) flushBlock();
      }
    };

    out.push(minCodeSize);
    emit(clearCode);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      const pixel = indices[i];
      const key = (prefix << 8) | pixel;
      const code = table.get(key);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      emit(prefix);
      if (nextCode === 4096) {
        // The table is full: start a fresh one.
        emit(clearCode);
        table = new Map();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      } else {
        if (nextCode >= 1 << codeSize) codeSize += 1;
        table.set(key, nextCode);
        nextCode += 1;
      }
      prefix = pixel;
    }
    emit(prefix);
    emit(endCode);
    if (bits > 0) block.push(buffer & 0xff);
    flushBlock();
    out.push(0); // block terminator
  }

  class GifWriter {
    constructor(width, height, palette) {
      this.width = width;
      this.height = height;
      this.palette = palette.slice(0, 256);
      this.frames = [];
    }

    addFrame(x, y, w, h, indices, delayMs) {
      const data = [];
      compress(indices, data);
      this.frames.push({ x, y, w, h, data: Uint8Array.from(data), delay: delayMs });
    }

    extendLastFrame(ms) {
      const last = this.frames[this.frames.length - 1];
      if (last) last.delay += ms;
    }

    finish() {
      const parts = [];
      const bytes = (...values) => parts.push(Uint8Array.from(values));
      const word = (n) => [n & 0xff, (n >> 8) & 0xff];
      const ascii = (text) => Array.from(text, (c) => c.charCodeAt(0));

      bytes(...ascii('GIF89a'), ...word(this.width), ...word(this.height), 0xf7, 0, 0);
      const table = new Uint8Array(256 * 3);
      this.palette.forEach(([r, g, b], i) => table.set([r, g, b], i * 3));
      parts.push(table);
      bytes(0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0); // loop forever

      // Delays are whole hundredths of a second; carry the rounding over so the timing
      // does not drift across hundreds of short frames.
      let clock = 0;
      let written = 0;
      for (const frame of this.frames) {
        clock += frame.delay;
        const delay = Math.max(2, Math.round(clock / 10) - written);
        written += delay;
        // Graphic control: keep the picture under the frame (disposal 1).
        bytes(0x21, 0xf9, 4, 0x04, ...word(delay), 0, 0);
        bytes(0x2c, ...word(frame.x), ...word(frame.y), ...word(frame.w), ...word(frame.h), 0);
        parts.push(frame.data);
      }
      bytes(0x3b);
      return new Blob(parts, { type: 'image/gif' });
    }
  }

  window.GifWriter = GifWriter;
})();
