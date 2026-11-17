/* Ordem dos Traços: the page script. Everything runs in the browser; there is no server.

   - Words, pinyin and meanings come from data/dictionary.json (built from CC-CEDICT).
   - Each character's radical and its meaning come from data/radicals.json (built from
     Make Me a Hanzi, the source of the stroke data).
   - Stroke data is downloaded per character from jsDelivr, where Hanzi Writer keeps it.
   - Hanzi Writer (lib/) draws the characters.

   This file splits the text into words, builds the sheet of squares, and runs the
   Play / Pause control and the settings panel. The interface is in Brazilian Portuguese; dictionary
   meanings stay in English. */
(() => {
  'use strict';

  const INK = '#1f2528';
  const RED = '#d2382d';
  const OUTLINE = '#d3ddd7';
  const STROKE_GAP = 260; // pause between strokes in ms, at 1× speed
  const CHAR_GAP = 520; // pause between characters in ms, at 1× speed
  const STORAGE_KEY = 'stroke-order:v2';
  const OLD_STORAGE_KEY = 'stroke-order:v1'; // only its text is carried over
  const AUTOPLAY_DELAY = 2000; // ms between the squares appearing and the writing starting
  const STROKE_DATA = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/';
  const MAX_HANZI = 200; // characters drawn at once; keeps the page responsive
  const MAX_TEXT = 4000; // characters of raw input looked at
  const MAX_ASIDE = 40; // characters kept of any non-Chinese text between words
  const MAX_WORD = 8; // longest word in the dictionary, in characters

  const ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3.6v12H3zM9.4 2H13v12H9.4z"/></svg>',
    restart: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3a5 5 0 1 1-4.6 3H1.3A7 7 0 1 0 8 1V0L4.5 2.5 8 5z"/></svg>',
    download: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.5 6.5 8 10l3.5-3.5M3 13.5h10"/></svg>',
    progress: '<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="ring-track" cx="8" cy="8" r="6"/><circle class="ring-fill" cx="8" cy="8" r="6" pathLength="1"/></svg>',
  };

  const $ = (selector) => document.querySelector(selector);
  const input = $('#text');
  const sheet = $('#sheet');
  const statusLine = $('#status');
  const playButton = $('#play');
  const stepBackButton = $('#step-back');
  const stepNextButton = $('#step-next');
  const stepWhere = $('#step-where');
  const gifButton = $('#gif');
  const repeatBox = $('#repeat');
  const outlineBox = $('#outline');
  const radicalBox = $('#radical');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------- settings

  const settings = {
    text: '我喜欢学习中文',
    split: 'auto', // 'auto' (words) | 'chars'
    layout: 'mi', // the lines in each square: 'mi' (米字格: cross and diagonals) | 'tian' (田字格: cross)
    speed: 1,
    repeat: true,
    outline: true,
    radical: true,
  };

  function restoreSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Settings from before the toolbar was simplified: keep the text, take the new defaults.
        const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY)) || {};
        if (typeof old.text === 'string') saved = { text: old.text };
      }
    } catch (error) {
      /* private browsing or a damaged entry: start from the defaults */
    }
    if (typeof saved.text === 'string') settings.text = saved.text;
    if (['auto', 'chars'].includes(saved.split)) settings.split = saved.split;
    if (['tian', 'mi'].includes(saved.layout)) settings.layout = saved.layout;
    if ([0.5, 1, 2].includes(saved.speed)) settings.speed = saved.speed; // Devagar, Normal, Rápido
    for (const key of ['repeat', 'outline', 'radical']) {
      if (typeof saved[key] === 'boolean') settings[key] = saved[key];
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      /* nothing to do: the page works without remembering */
    }
  }

  function setStatus(message, isError = false) {
    statusLine.textContent = message;
    statusLine.classList.toggle('is-error', isError);
  }

  // ---------------------------------------------------------------- the dictionary

  /* data/dictionary.json holds, for every word, its pinyin (one syllable per character)
     and its English senses: {"喜欢": ["xǐ huan", "to like", "to be fond of"]}.
     tools/build_dictionary.py explains how it is made. */

  const NO_DICTIONARY = { loaded: false, words: {}, readings: {}, simplified: new Map(), drawable: null };
  let dictionary = null; // null while it is still downloading
  let dictionaryNote = ''; // what to tell the reader if it could not be loaded

  const chars = (text) => Array.from(text); // by character, not by UTF-16 unit
  const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

  function prepareDictionary(data) {
    const simplified = new Map(); // traditional character -> simplified character
    const pairs = chars(data.simplified || '');
    for (let i = 0; i + 1 < pairs.length; i += 2) simplified.set(pairs[i], pairs[i + 1]);
    return {
      loaded: true,
      words: data.words || {},
      readings: data.readings || {},
      simplified,
      drawable: data.drawable ? new Set(chars(data.drawable)) : null,
    };
  }

  async function loadDictionary() {
    const slow = setTimeout(() => setStatus('Carregando o dicionário (cerca de 3 MB, só na primeira visita)…'), 400);
    const radicalsLoaded = loadRadicals();
    try {
      const response = await fetch('data/dictionary.json');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      dictionary = prepareDictionary(await response.json());
    } catch (error) {
      dictionary = NO_DICTIONARY;
      dictionaryNote =
        window.location.protocol === 'file:'
          ? 'Esta página foi aberta direto de uma pasta, então não consegue ler o dicionário. Abra-a por um endereço web: o README.md explica como em "Testar no seu computador".'
          : 'Não foi possível carregar o dicionário, então faltam pinyin e significados. Recarregue a página para tentar de novo.';
    }
    await radicalsLoaded;
    clearTimeout(slow);
    analyze();
  }

  /* data/radicals.json: every character's radical, and the pinyin and English meaning of
     each radical. tools/build_radicals.py explains how it is made. Without it the page
     still works; the radical line under each square is simply left out. */
  let radicalOf = new Map(); // character -> its radical
  let radicalInfo = {}; // radical -> [pinyin, meaning]

  async function loadRadicals() {
    try {
      const response = await fetch('data/radicals.json');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const pairs = chars(data.chars || '');
      for (let i = 0; i + 1 < pairs.length; i += 2) radicalOf.set(pairs[i], pairs[i + 1]);
      radicalInfo = data.radicals || {};
    } catch (error) {
      /* no radical meanings; everything else still works */
    }
  }

  function radicalFor(char) {
    const radical = radicalOf.get(char) || (dictionary && radicalOf.get(simplify(char)));
    if (!radical) return null;
    const [pinyin, meaning] = own(radicalInfo, radical) || ['', ''];
    return { radical, pinyin, meaning };
  }

  function simplify(text) {
    let out = '';
    for (const char of text) out += dictionary.simplified.get(char) || char;
    return out;
  }

  /* The entry for a word, written with simplified or traditional characters. */
  function lookup(word) {
    return own(dictionary.words, word) || own(dictionary.words, simplify(word)) || null;
  }

  // ---------------------------------------------------------------- from text to words

  const HAN = '\\u2e80-\\u2eff\\u3007\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{323af}';
  // Chinese characters | a line break | other white space | anything else
  const TOKEN = new RegExp(`([${HAN}]+)|(\\s*\\n\\s*)|(\\s+)|([^${HAN}\\s]+)`, 'gu');

  // ---------------------------------------------------------------- the text in the link

  /* The page address carries the text, so a link opens straight on it:
     …/?t=我没有钱. Only Chinese goes into a link or is taken from one: Chinese characters,
     Chinese punctuation (、。「」，！ and so on), spaces and line breaks. Anything else in a
     link is dropped, and a link without a single Chinese character is ignored. */
  const LINK_PARAM = 't';
  const NOT_FOR_LINKS = new RegExp(`[^${HAN}\\u3000-\\u303f\\uff00-\\uffef\\s]`, 'gu');
  const HAS_HAN = new RegExp(`[${HAN}]`, 'u');

  function linkText(text) {
    const kept = text.replace(NOT_FOR_LINKS, '').trim().slice(0, MAX_TEXT);
    return HAS_HAN.test(kept) ? kept : '';
  }

  function textFromLink() {
    try {
      return linkText(new URLSearchParams(window.location.search).get(LINK_PARAM) || '');
    } catch (error) {
      return '';
    }
  }

  /* Keep the address in step with the text box, without adding to the browser history. */
  function updateLink(text) {
    try {
      const url = new URL(window.location.href);
      const kept = linkText(text);
      if (kept) url.searchParams.set(LINK_PARAM, kept);
      else url.searchParams.delete(LINK_PARAM);
      if (url.href !== window.location.href) window.history.replaceState(null, '', url);
    } catch (error) {
      /* opened from a folder, or the browser refuses: the page works without it */
    }
  }

  // The browser's own word splitter. Every current browser has one; without it the
  // dictionary alone does the splitting.
  const segmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

  /* Cut text into the longest dictionary words, left to right. */
  function splitByDictionary(text) {
    const letters = chars(text);
    const out = [];
    for (let i = 0; i < letters.length; ) {
      let size = 1;
      for (let n = Math.min(MAX_WORD, letters.length - i); n > 1; n -= 1) {
        if (lookup(letters.slice(i, i + n).join(''))) {
          size = n;
          break;
        }
      }
      out.push(letters.slice(i, i + size).join(''));
      i += size;
    }
    return out;
  }

  /* Put back together what the splitter cut inside a longer dictionary word:
     中华 + 人民 + 共和国 is one name, 没 + 关系 is one phrase. Three-character results are
     only built from two pieces, so 他 + 妈 + 的 ("his mother's") is left alone. */
  function joinLongWords(pieces) {
    const out = [];
    for (let i = 0; i < pieces.length; ) {
      let take = 1;
      for (let n = Math.min(4, pieces.length - i); n > 1; n -= 1) {
        const joined = pieces.slice(i, i + n).join('');
        const length = chars(joined).length;
        if (length <= MAX_WORD && (length >= 4 || (length === 3 && n === 2)) && lookup(joined)) {
          take = n;
          break;
        }
      }
      out.push(pieces.slice(i, i + take).join(''));
      i += take;
    }
    return out;
  }

  /* Split one unbroken run of Chinese characters into words. */
  function segment(run) {
    const length = chars(run).length;
    if (length > 1 && length <= MAX_WORD && lookup(run)) return [run];
    const pieces = segmenter ? Array.from(segmenter.segment(run), (part) => part.segment) : [run];
    if (!dictionary.loaded) return segmenter ? pieces : chars(run);
    // Prefer words a learner can look up: anything the dictionary does not know is cut
    // again into words it does know.
    const known = pieces.flatMap((piece) => (chars(piece).length > 1 && !lookup(piece) ? splitByDictionary(piece) : [piece]));
    return joinLongWords(known);
  }

  function readPiece(piece) {
    const entry = lookup(piece);
    const letters = chars(piece);
    const syllables = entry ? entry[0].split(' ') : [];
    return {
      text: piece,
      syllables: letters.map((_, i) => (syllables.length === letters.length ? syllables[i] : '')),
      senses: entry ? entry.slice(1) : [],
    };
  }

  const withoutTone = (syllable) => syllable.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* A character taken out of its word: 行 in 银行 is háng "row", not its usual xíng "to walk". */
  function readCharacter(char, syllable) {
    const usual = lookup(char);
    const others = own(dictionary.readings, char) || own(dictionary.readings, simplify(char)) || [];
    const all = usual ? [usual, ...others] : others;
    const wanted = syllable.toLowerCase();
    const found = all.find((reading) => reading[0].toLowerCase() === wanted) || all.find((reading) => withoutTone(reading[0]) === withoutTone(wanted));
    return found ? { pinyin: found[0], senses: found.slice(1) } : { pinyin: wanted, senses: [] };
  }

  function wordToken(text, syllables, senses) {
    return { type: 'word', text, senses, chars: chars(text).map((char, i) => ({ char, pinyin: syllables[i] || '' })) };
  }

  function wordsIn(run, mode) {
    const pieces = segment(run).map(readPiece);
    if (mode === 'chars') {
      return pieces.flatMap((piece) => {
        const letters = chars(piece.text);
        if (letters.length === 1) return [wordToken(piece.text, piece.syllables, piece.senses)];
        return letters.map((char, i) => {
          const reading = readCharacter(char, piece.syllables[i]);
          return wordToken(char, [reading.pinyin], reading.senses);
        });
      });
    }
    return pieces.map((piece) => wordToken(piece.text, piece.syllables, piece.senses));
  }

  /* The whole text box: words to draw, plus the punctuation, notes and line breaks between them. */
  function analyzeText(text, mode) {
    const tokens = [];
    let used = 0;
    let truncated = false;
    for (const [, han, newline, , other] of text.slice(0, MAX_TEXT).matchAll(TOKEN)) {
      if (han) {
        let run = chars(han);
        if (used + run.length > MAX_HANZI) {
          run = run.slice(0, MAX_HANZI - used);
          truncated = true;
        }
        if (run.length) {
          tokens.push(...wordsIn(run.join(''), mode));
          used += run.length;
        }
        if (truncated) break;
      } else if (newline) {
        if (tokens.length && tokens[tokens.length - 1].type !== 'break') tokens.push({ type: 'break' });
      } else if (other) {
        const last = tokens[tokens.length - 1];
        if (last && last.type === 'text') last.text += ` ${other}`; // "thank you" stays one note
        else tokens.push({ type: 'text', text: other });
      }
    }
    while (tokens.length && tokens[tokens.length - 1].type === 'break') tokens.pop();
    for (const token of tokens) {
      if (token.type === 'text' && chars(token.text).length > MAX_ASIDE) {
        token.text = `${chars(token.text).slice(0, MAX_ASIDE - 1).join('').trimEnd()}…`;
      }
    }
    return { tokens, truncated: truncated || text.length > MAX_TEXT };
  }

  // ---------------------------------------------------------------- stroke data

  const strokeRequests = new Map(); // character -> Promise of its data (null: none exists)

  function loadStrokes(char) {
    // The dictionary lists which characters can be drawn, so the others need no request.
    if (dictionary && dictionary.drawable && !dictionary.drawable.has(char)) return Promise.resolve(null);
    if (!strokeRequests.has(char)) {
      const request = fetch(`${STROKE_DATA}${encodeURIComponent(char)}.json`)
        .then((response) => {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .catch((error) => {
          strokeRequests.delete(char); // let the next render try again
          throw error;
        });
      strokeRequests.set(char, request);
    }
    return strokeRequests.get(char);
  }

  // ---------------------------------------------------------------- building the sheet

  let cells = []; // every square on the sheet, in reading order
  let words = []; // the squares of each word, and the line of the text box it is on
  let glosses = []; // the English line under each word, with all the senses it could show
  let renderId = 0; // bumped on each render so late downloads for an old sheet are dropped
  let retryDownloads = false; // a download failed, so the next change should rebuild the sheet

  const strokesLabel = (count) => `${count} ${count === 1 ? 'traço' : 'traços'}`;

  function squareSize(cell) {
    return cell.square.clientWidth; // the inside of the square, without its border
  }

  /* The line under the count: the radical in red, then its English meaning. */
  function buildRadical(char) {
    const line = el('div', 'radical');
    const info = radicalFor(char);
    if (!info) return line;
    const glyph = el('span', 'radical-char', info.radical);
    glyph.lang = 'zh';
    const meaning = el('span', 'radical-meaning', info.meaning.split(';')[0]);
    meaning.lang = 'en';
    line.append(glyph, meaning);
    const reading = info.pinyin ? ` (${info.pinyin})` : '';
    line.title = `Radical ${info.radical}${reading}: ${info.meaning}`;
    return line;
  }

  function buildCell(char, pinyin) {
    const root = el('div', 'cell');
    const staff = el('div', 'pinyin', pinyin);
    staff.lang = 'zh-Latn';
    const square = el('div', 'square');
    const ghost = el('span', 'ghost', char); // plain glyph until the strokes arrive
    const target = el('div', 'target');
    square.append(ghost, target);
    const count = el('div', 'count', ' ');
    root.append(staff, square, count);
    root.append(buildRadical(char)); // always there, so every square is the same height

    const cell = { char, pinyin, root, square, target, ghost, count, writer: null, strokes: 0, data: null, loading: null };
    square.addEventListener('click', () => activateSquare(cell));
    square.addEventListener('keydown', (event) => {
      // Enter only: Space pauses and plays everywhere on the page.
      if (event.key === 'Enter') {
        event.preventDefault();
        activateSquare(cell);
      }
    });
    cells.push(cell);
    return cell;
  }

  function buildWord(token, line) {
    const word = el('section', 'word');
    word.style.setProperty('--n', token.chars.length);
    const strip = el('div', 'strip');
    const wordCells = token.chars.map((entry) => buildCell(entry.char, entry.pinyin));
    strip.append(...wordCells.map((cell) => cell.root));
    words.push({ cells: wordCells, line });

    // Baixar GIF for this word alone: a small arrow in the corner of its pinyin strip,
    // shown only while the word is pointed at (see style.css).
    const gif = el('button', 'icon-button word-gif');
    gif.type = 'button';
    gif.innerHTML = ICON.download;
    gif.title = `Baixar GIF de ${token.text}`;
    gif.setAttribute('aria-label', gif.title);
    gif.addEventListener('click', () => downloadGif([{ cells: wordCells, line: 0 }], gif));

    const note = el('div', 'note');
    const play = el('button', 'word-play');
    play.type = 'button';
    play.innerHTML = ICON.play;
    play.setAttribute('aria-label', `Reproduzir ${token.text}`);
    play.title = `Reproduzir ${token.text}`;
    play.addEventListener('click', () => player.play(wordCells, false));
    const gloss = el('p', 'gloss');
    gloss.lang = 'en';
    if (token.senses.length) gloss.title = token.senses.join('; ');
    glosses.push({ node: gloss, senses: token.senses });
    note.append(play, gloss);

    if (token.chars.length === 1) word.classList.add('is-single');
    word.append(strip, note, gif);
    return word;
  }

  /* Show as many senses as fit in three lines under the word: a two-character word has
     room for more than a single square does. The full list is in the tooltip. */
  function fitGlosses() {
    for (const { node, senses } of glosses) {
      const room = Math.floor(node.clientWidth / 7.3) * 3 * 0.85; // about 7.3px per letter
      let text = '';
      for (const sense of senses) {
        const longer = text ? `${text}; ${sense}` : sense;
        if (text && longer.length > room) break;
        text = longer;
      }
      node.textContent = text;
    }
  }

  function buildEmptyState() {
    const empty = el('div', 'empty');
    const strip = el('div', 'strip');
    for (let i = 0; i < 4; i += 1) {
      const cell = el('div', 'cell');
      cell.append(el('div', 'pinyin'), el('div', 'square'));
      strip.append(cell);
    }
    empty.append(strip, el('p', '', 'Seus quadrados aparecem aqui. Digite algo em chinês acima ou escolha um dos exemplos.'));
    return empty;
  }

  function renderSheet(tokens) {
    cancelAutoplay();
    player.stop();
    player.scope = null;
    renderId += 1;
    cells = [];
    words = [];
    glosses = [];
    sheet.replaceChildren();

    if (!tokens.some((token) => token.type === 'word')) {
      sheet.append(buildEmptyState());
      refreshToolbar();
      return;
    }

    let line = el('div', 'line');
    line.lang = 'zh';
    sheet.append(line);
    let lineNumber = 0;
    for (const token of tokens) {
      if (token.type === 'break') {
        line = el('div', 'line');
        line.lang = 'zh';
        sheet.append(line);
        lineNumber += 1;
      } else if (token.type === 'text') {
        // Punctuation is set large like the characters; other text is a small side note.
        const hasWords = /[\p{L}\p{N}]/u.test(token.text);
        line.append(el('span', hasWords ? 'aside is-words' : 'aside', token.text));
      } else {
        line.append(buildWord(token, lineNumber));
      }
    }
    fitGlosses();
    scheduleAutoplay(cells.map((cell) => (cell.loading = mountCell(cell, renderId))));
  }

  /* A new sheet starts writing itself AUTOPLAY_DELAY after it appears, once the stroke
     data of every square has arrived. Until then the squares are blank (outline only). */
  let autoplay = null; // { cancelled } while a new sheet waits to start

  function scheduleAutoplay(mounts) {
    cancelAutoplay();
    const pending = { cancelled: false };
    autoplay = pending;
    const delay = new Promise((resolve) => setTimeout(resolve, AUTOPLAY_DELAY));
    Promise.all([Promise.allSettled(mounts), delay]).then(() => {
      if (pending.cancelled) return;
      autoplay = null;
      player.play(cells);
      refreshToolbar(); // in case nothing could be drawn
    });
    refreshToolbar();
  }

  function cancelAutoplay() {
    if (autoplay) autoplay.cancelled = true;
    autoplay = null;
  }

  async function mountCell(cell, id) {
    let data;
    try {
      data = await loadStrokes(cell.char);
    } catch (error) {
      if (id !== renderId) return;
      retryDownloads = true;
      cell.root.classList.add('is-missing');
      cell.count.textContent = 'não carregado';
      setStatus('Não foi possível baixar alguns traços. Verifique sua conexão com a internet e edite o texto para tentar de novo.', true);
      return;
    }
    if (id !== renderId) return;
    if (!data) {
      cell.root.classList.add('is-missing');
      cell.count.textContent = 'sem dados de traços';
      return;
    }

    const size = squareSize(cell);
    cell.data = data;
    cell.strokes = data.strokes.length;
    cell.writer = HanziWriter.create(cell.target, cell.char, {
      width: size,
      height: size,
      padding: Math.round(size * 0.08),
      showCharacter: false, // blank until it is written; the outline shows what is coming
      showOutline: settings.outline,
      strokeColor: INK,
      radicalColor: settings.radical ? RED : null,
      outlineColor: OUTLINE,
      strokeAnimationSpeed: settings.speed,
      charDataLoader: () => data, // already downloaded, so hand it straight over
    });
    cell.ghost.remove();
    cell.root.classList.add('is-ready');
    cell.count.textContent = strokesLabel(cell.strokes);
    cell.square.setAttribute('role', 'button');
    cell.square.tabIndex = 0;
    cell.square.setAttribute('aria-label', `Reproduzir ${cell.char}`);
    refreshToolbar();
  }

  function activateSquare(cell) {
    if (cell.writer) player.play([cell], false);
  }

  // ---------------------------------------------------------------- watching

  /* Show a square with only its first `count` strokes, at once. Hanzi Writer has no public
     call for this, so it sets the drawing state directly. The bundled library version is
     fixed (see lib/), so these internals do not move. */
  function showStrokes(cell, count) {
    const state = cell.writer._renderState;
    if (!state) return;
    state.cancelMutations(['character.main']);
    const strokes = {};
    for (let i = 0; i < cell.strokes; i += 1) strokes[i] = { opacity: i < count ? 1 : 0, displayPortion: 1 };
    state.updateState({ character: { main: { opacity: 1, strokes } } });
  }

  /* Plays a list of squares one after another, stroke by stroke. Only one run is ever
     active; starting another (a word, a single square) replaces it.

     The whole sheet (whole = true) starts over at the end while Repetir is on. A word or
     square the reader touched is written once, and then everything waits for the main
     button, which offers to start the whole sheet over.

     While the whole sheet plays, `at` keeps the place in it: the square and how many of
     its strokes are complete. Step mode (the ‹ › buttons, or the arrow keys) moves that
     place one stroke at a time, and Reproduzir carries on from there. */
  const player = {
    status: 'idle', // 'idle' | 'playing' | 'paused' | 'stepping'
    scope: null, // what was last played: 'all' (the whole sheet) | 'part' (a word or square)
    queue: [], // the squares of the whole sheet that can be drawn
    at: { cell: 0, stroke: 0 },
    shown: 0, // the stroke number to show beside the step arrows
    run: null,
    current: null,

    async play(queue, whole = true, from = { cell: 0, stroke: 0 }) {
      queue = queue.filter((cell) => cell.writer);
      if (!queue.length) return;
      cancelAutoplay();
      this.stop();
      const run = { cancelled: false };
      this.run = run;
      this.status = 'playing';
      this.scope = whole ? 'all' : 'part';
      // The place is always kept in terms of the whole sheet, also while a touched word
      // or square plays, so step mode can carry on from wherever the writing is.
      this.queue = cells.filter((cell) => cell.writer);
      refreshToolbar();

      let first = from;
      do {
        // Squares before the starting point stay complete, the rest are blanked; then
        // they are filled in reading order.
        this.layout(queue, first);
        for (let i = first.cell; i < queue.length; i += 1) {
          const done = await this.draw(queue[i], run, queue.length > 1, i === first.cell ? first.stroke : 0, this.queue.indexOf(queue[i]));
          if (!done) return;
        }
        this.setCurrent(null);
        first = { cell: 0, stroke: 0 };
        if (whole && settings.repeat && !(await this.wait(1100, run))) return;
      } while (whole && settings.repeat && !run.cancelled);

      if (this.run === run) {
        this.run = null;
        this.status = 'idle';
        refreshToolbar();
      }
    },

    /* Write the strokes of one square from stroke `from` on. `index` is its place in the
       whole sheet. */
    async draw(cell, run, follow, from, index) {
      this.setCurrent(cell);
      if (follow) {
        cell.root.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      }
      for (let i = from; i < cell.strokes; i += 1) {
        this.at = { cell: index, stroke: i };
        this.shown = i + 1; // the stroke being written
        refreshToolbar();
        cell.count.textContent = `${i + 1} / ${cell.strokes}`;
        const result = await cell.writer.animateStroke(i);
        if (run.cancelled || !result || result.canceled) return false;
        this.at = { cell: index, stroke: i + 1 };
        const gap = i < cell.strokes - 1 ? STROKE_GAP : CHAR_GAP;
        if (!(await this.wait(gap / settings.speed, run))) return false;
      }
      cell.count.textContent = strokesLabel(cell.strokes);
      return true;
    },

    /* Draw the queue as it looks at a place in it: earlier squares complete, the square
       there with its first strokes, later squares blank. */
    layout(queue, place) {
      this.shown = place.stroke;
      queue.forEach((cell, i) => {
        const count = i < place.cell ? cell.strokes : i === place.cell ? place.stroke : 0;
        showStrokes(cell, count);
        cell.count.textContent = i === place.cell && count > 0 && count < cell.strokes ? `${count} / ${cell.strokes}` : strokesLabel(cell.strokes);
      });
    },

    /* One stroke forward (+1) or back (-1) through the whole sheet. Whatever was playing
       stops where it is; forward writes the next stroke, back takes the last one away. */
    async step(direction) {
      // Fresh: nothing has been written yet (the sheet is new), so start at the very
      // beginning. Otherwise carry on from the stroke on screen, wherever that is.
      const fresh = this.scope === null || !this.queue.length;
      if (fresh && direction < 0) return; // already at the beginning
      if (fresh) {
        cancelAutoplay();
        this.stop();
        this.queue = cells.filter((cell) => cell.writer);
        if (!this.queue.length) return;
        this.scope = 'all';
        this.at = { cell: 0, stroke: 0 };
      }
      if (this.run) this.run.cancelled = true;
      if (this.current && this.status === 'paused') this.current.writer.resumeAnimation();
      const run = { cancelled: false };
      this.run = run;
      this.status = 'stepping';
      this.scope = 'all'; // from here on, Reproduzir carries on through the whole sheet

      const queue = this.queue;
      // The stroke shown as current (also one caught halfway) counts as written, so the
      // first press moves on from the number the reader sees.
      let cell = this.at.cell;
      let stroke = fresh ? 0 : Math.min(this.shown, queue[cell].strokes);
      if (direction > 0) {
        if (stroke >= queue[cell].strokes) {
          cell += 1;
          stroke = 0;
        }
        if (cell >= queue.length) cell = 0; // past the end: start over, as Repetir does
      } else {
        if (stroke === 0 && cell > 0) {
          cell -= 1;
          stroke = queue[cell].strokes;
        }
        stroke = Math.max(0, stroke - 1);
      }
      this.at = { cell, stroke };
      this.layout(queue, this.at);
      this.setCurrent(queue[cell]);
      queue[cell].root.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      refreshToolbar();
      if (direction < 0) return;

      // The place moves on at once, so quick presses each count even when the stroke
      // before has not finished drawing (the next step shows it complete).
      this.at = { cell, stroke: stroke + 1 };
      this.shown = stroke + 1;
      refreshToolbar();
      queue[cell].count.textContent = `${stroke + 1} / ${queue[cell].strokes}`;
      const result = await queue[cell].writer.animateStroke(stroke);
      if (run.cancelled || !result || result.canceled) return;
      if (stroke + 1 === queue[cell].strokes) queue[cell].count.textContent = strokesLabel(queue[cell].strokes);
    },

    /* A timer that stands still while paused and gives up when the run is cancelled. */
    wait(ms, run) {
      return new Promise((resolve) => {
        let left = ms;
        let last = performance.now();
        const tick = () => {
          if (run.cancelled) return resolve(false);
          const now = performance.now();
          if (this.status !== 'paused') left -= now - last;
          last = now;
          if (left <= 0) return resolve(true);
          setTimeout(tick, Math.min(left, 40));
        };
        setTimeout(tick, Math.min(ms, 40));
      });
    },

    pause() {
      if (this.status !== 'playing') return;
      this.status = 'paused';
      if (this.current) this.current.writer.pauseAnimation();
      refreshToolbar();
    },

    resume() {
      if (this.status === 'stepping') {
        this.play(this.queue, true, this.at); // carry on from the stroke reached
        return;
      }
      if (this.status !== 'paused') return;
      this.status = 'playing';
      if (this.current) this.current.writer.resumeAnimation();
      refreshToolbar();
    },

    /* Cancel whatever is running. Each square keeps what has been written in it so far: a
       character is only ever filled in by writing it. A stroke caught halfway is let
       finish, so no square is left with half a stroke. */
    stop() {
      if (this.run) this.run.cancelled = true;
      if (this.current && this.status === 'paused') this.current.writer.resumeAnimation();
      this.run = null;
      this.status = 'idle';
      this.setCurrent(null);
      for (const cell of cells) if (cell.writer) cell.count.textContent = strokesLabel(cell.strokes);
      refreshToolbar();
    },

    setCurrent(cell) {
      if (this.current) this.current.root.classList.remove('is-active');
      this.current = cell;
      if (cell) cell.root.classList.add('is-active');
    },
  };

  /* One button, three faces:
       Pausar          the whole sheet is being written, or is about to start on its own
       Recomeçar tudo  a touched word or square is being written, or just was
       Reproduzir      otherwise: paused, stepping, or finished */
  function buttonAction() {
    if (autoplay || (player.status === 'playing' && player.scope === 'all')) return 'pause';
    if (player.scope === 'part') return 'restart';
    return 'play';
  }

  const BUTTON = {
    pause: [ICON.pause, 'Pausar'],
    restart: [ICON.restart, 'Recomeçar tudo'],
    play: [ICON.play, 'Reproduzir'],
  };

  function refreshToolbar() {
    const action = buttonAction();
    const [icon, label] = BUTTON[action];
    const ready = cells.some((cell) => cell.writer);
    playButton.innerHTML = `${icon}<span>${label}</span>`;
    playButton.disabled = action !== 'pause' && !ready;
    const atStart = !player.scope || (player.at.cell === 0 && player.shown === 0);
    stepBackButton.disabled = !ready || atStart;
    stepNextButton.disabled = !ready;
    gifButton.disabled = !ready;
    showWhere();
  }

  /* Between the step arrows: the character being written and its stroke, "我 3 / 7", the
     same numbers as under the square. A dash while the whole sheet is not being written. */
  function showWhere() {
    const cell = player.scope ? player.queue[player.at.cell] : null;
    if (!cell) {
      stepWhere.textContent = '–';
      return;
    }
    const glyph = el('span', '', cell.char);
    glyph.lang = 'zh';
    const shown = player.shown;
    stepWhere.replaceChildren(glyph, el('span', '', `${shown} / ${cell.strokes}`));
    stepWhere.setAttribute('aria-label', `${cell.char}, traço ${shown} de ${cell.strokes}`);
  }

  function togglePlay() {
    const action = buttonAction();
    if (action === 'pause') {
      if (autoplay) {
        cancelAutoplay(); // pressed before the writing started on its own
        refreshToolbar();
      } else player.pause();
    } else if (action === 'restart') {
      player.play(cells); // the whole sheet, from the first character
    } else if (player.status === 'paused' || player.status === 'stepping') {
      player.resume();
    } else {
      player.play(cells);
    }
  }

  // ---------------------------------------------------------------- downloading a GIF

  /* The writing saved as an animated GIF: the whole sheet (the arrow beside Configurações)
     or one word (the arrow in the corner of its pinyin strip). The GIF is not a recording
     of the page: it is drawn here, square by square, from the same stroke data and with the
     same timing and drawing rules as Hanzi Writer, so it looks the same whatever the screen.
     It follows the settings in force (speed, outline, radical in red, 米字格 or 田字格) and
     always loops. Punctuation and notes between words are left out. */
  const GIF = {
    cell: 112, // side of a square, border included, in GIF pixels
    staff: 32, // height of the pinyin strip
    line: 2, // border width
    margin: 20,
    wordGap: 24,
    rowGap: 22,
    columns: 8, // squares per row at most
    frameMs: 40, // one frame every 40 ms while a stroke is being written
    startMs: 400, // the blank squares, before the first stroke
    endMs: 1100, // the finished text, before it starts over (as the page does)
    maxChars: 60, // keeps the file and the wait reasonable
  };
  const GIF_COLORS = { paper: '#ffffff', grid: '#3d9b76', gridSoft: '#b3d6c6' };
  const STROKE_WIDTH = 200; // Hanzi Writer's mask width, in character units

  const hexColor = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  /* Every colour the GIF can contain: white, and soft steps from white (and from the
     outline grey) to each colour drawn, for the anti-aliased edges. */
  function gifPalette() {
    const white = [255, 255, 255];
    const mix = (from, to, t) => from.map((v, i) => Math.round(v + (to[i] - v) * t));
    const palette = [white];
    const ramp = (from, to, steps) => {
      for (let i = 1; i <= steps; i += 1) palette.push(mix(from, to, i / steps));
    };
    ramp(white, hexColor(INK), 64);
    ramp(white, hexColor(RED), 40);
    ramp(white, hexColor(GIF_COLORS.grid), 32);
    ramp(white, hexColor(GIF_COLORS.gridSoft), 16);
    ramp(white, hexColor(OUTLINE), 16);
    ramp(hexColor(OUTLINE), hexColor(INK), 32);
    ramp(hexColor(OUTLINE), hexColor(RED), 24);
    return palette; // 225 colours
  }

  /* Turns canvas pixels into palette indices, remembering each colour's nearest match. */
  function makeQuantizer(palette) {
    const memo = new Int16Array(1 << 15).fill(-1);
    return (rgba) => {
      const out = new Uint8Array(rgba.length / 4);
      for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
        const key = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
        let index = memo[key];
        if (index < 0) {
          const r = ((rgba[p] >> 3) << 3) + 4;
          const g = ((rgba[p + 1] >> 3) << 3) + 4;
          const b = ((rgba[p + 2] >> 3) << 3) + 4;
          let best = Infinity;
          palette.forEach(([pr, pg, pb], j) => {
            const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
            if (d < best) {
              best = d;
              index = j;
            }
          });
          memo[key] = index;
        }
        out[i] = index;
      }
      return out;
    };
  }

  /* One character's strokes, ready to draw the way Hanzi Writer does: each stroke is
     revealed along its median line by a thick pen, clipped to the stroke's outline. */
  function prepareStrokes(data) {
    const radical = new Set(data.radStrokes || []);
    return data.strokes.map((path, i) => {
      const points = data.medians[i].map(([x, y]) => ({ x, y }));
      let length = 0;
      for (let j = 1; j < points.length; j += 1) length += Math.hypot(points[j].x - points[j - 1].x, points[j].y - points[j - 1].y);
      // The median without its collinear points, its start pushed back by half the pen.
      let mask = points;
      if (mask.length >= 3) {
        mask = [points[0], points[1]];
        for (const point of points.slice(2)) {
          const [a, b] = mask.slice(-2);
          if ((point.y - b.y) * (b.x - a.x) - (point.x - b.x) * (b.y - a.y) === 0) mask.pop();
          mask.push(point);
        }
      }
      if (mask.length >= 2) {
        const [a, b] = mask;
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const reach = STROKE_WIDTH / 2;
        mask = [{ x: a.x + (reach * (a.x - b.x)) / d, y: a.y + (reach * (a.y - b.y)) / d }, ...mask.slice(1)];
      }
      return {
        outline: new Path2D(path),
        mask,
        dash: length + STROKE_WIDTH / 2,
        duration: (length + 600) / 3, // ms at 1×, as Hanzi Writer times a stroke
        inRadical: radical.has(i),
      };
    });
  }

  /* Where each square goes: words in reading order, at most GIF.columns squares a row, a
     new row for each new line of the text box and wherever a word would not fit. */
  function gifLayout(groups) {
    const { cell: S, staff: H, line: L, margin: M, wordGap, rowGap, columns } = GIF;
    const items = [];
    let row = 0;
    let used = 0;
    let x = M;
    let width = 0;
    let lastLine = null;
    for (const group of groups) {
      for (let start = 0; start < group.cells.length; start += columns) {
        const piece = group.cells.slice(start, start + columns);
        const newLine = lastLine !== null && group.line !== lastLine;
        if (used && (newLine || start > 0 || used + piece.length > columns)) {
          row += 1;
          used = 0;
          x = M;
        }
        lastLine = group.line;
        const y = M + row * (H + S + rowGap);
        piece.forEach((cell, i) => {
          items.push({
            char: cell.char,
            pinyin: cell.pinyin,
            strokes: cell.data ? prepareStrokes(cell.data) : null,
            x: x + i * (S - L),
            y,
          });
        });
        const pieceWidth = piece.length * S - (piece.length - 1) * L;
        width = Math.max(width, x + pieceWidth + M);
        x += pieceWidth + wordGap;
        used += piece.length;
      }
    }
    return { items, width, height: M + (row + 1) * (H + S) + row * rowGap + M };
  }

  const cssValue = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* The pinyin strip and the square's border: drawn once, they never change. */
  function drawGifFrame(ctx, item) {
    const { cell: S, staff: H, line: L } = GIF;
    const { x, y } = item;
    ctx.fillStyle = GIF_COLORS.grid;
    ctx.fillRect(x, y, S, L); // the strip: open at the bottom, where the square starts
    ctx.fillRect(x, y, L, H);
    ctx.fillRect(x + S - L, y, L, H);
    ctx.fillRect(x, y + H, S, L); // the square
    ctx.fillRect(x, y + H + S - L, S, L);
    ctx.fillRect(x, y + H, L, S);
    ctx.fillRect(x + S - L, y + H, L, S);

    ctx.fillStyle = GIF_COLORS.gridSoft; // the two dashed lines of the pinyin staff
    for (const at of [0.33, 0.68]) {
      for (let dx = 0; dx < S - 2 * L; dx += 8) ctx.fillRect(x + L + dx, y + Math.round(H * at), 4, 1);
    }
    if (item.pinyin) {
      ctx.fillStyle = INK;
      ctx.font = `16px ${cssValue('--ui')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.pinyin, x + S / 2, y + H / 2 + 1);
    }
  }

  /* The inside of a square: guide lines, outline, the first `done` strokes complete and
     stroke `done` written up to `portion` (0 to 1). */
  function drawGifSquare(ctx, item, done, portion) {
    const { cell: S, staff: H, line: L } = GIF;
    const size = S - 2 * L;
    const left = item.x + L;
    const top = item.y + H + L;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, size, size);
    ctx.clip();
    ctx.fillStyle = GIF_COLORS.paper;
    ctx.fillRect(left, top, size, size);

    ctx.strokeStyle = GIF_COLORS.gridSoft;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const middle = size / 2 + 0.5;
    ctx.beginPath();
    ctx.moveTo(left + middle, top);
    ctx.lineTo(left + middle, top + size);
    ctx.moveTo(left, top + middle);
    ctx.lineTo(left + size, top + middle);
    if (settings.layout === 'mi') {
      ctx.moveTo(left, top);
      ctx.lineTo(left + size, top + size);
      ctx.moveTo(left + size, top);
      ctx.lineTo(left, top + size);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (!item.strokes) {
      // No stroke data: the character as it is, like the page shows it.
      ctx.fillStyle = INK;
      ctx.font = `${Math.round(size * 0.66)}px ${cssValue('--han')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.char, left + size / 2, top + size / 2);
      ctx.restore();
      return;
    }

    // Hanzi Writer's placement: 8% padding, a 1024-unit box from y = -124 to 900, y up.
    const padding = Math.round(size * 0.08);
    const scale = (size - 2 * padding) / 1024;
    ctx.translate(left + padding, top + size - padding - 124 * scale);
    ctx.scale(scale, -scale);
    const colorOf = (stroke) => (settings.radical && stroke.inRadical ? RED : INK);
    if (settings.outline) {
      ctx.fillStyle = OUTLINE;
      for (const stroke of item.strokes) ctx.fill(stroke.outline);
    }
    item.strokes.forEach((stroke, i) => {
      if (i >= done) return;
      ctx.fillStyle = colorOf(stroke);
      ctx.fill(stroke.outline);
    });
    const stroke = item.strokes[done];
    if (stroke && portion > 0 && stroke.mask.length) {
      ctx.save();
      ctx.clip(stroke.outline);
      ctx.strokeStyle = colorOf(stroke);
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([stroke.dash, stroke.dash]);
      ctx.lineDashOffset = 0.999 * stroke.dash * (1 - portion);
      ctx.beginPath();
      stroke.mask.forEach((point, j) => (j ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  const ease = (t) => -Math.cos(t * Math.PI) / 2 + 0.5; // Hanzi Writer's easing

  async function makeGif(groups, onProgress) {
    await Promise.allSettled(groups.flatMap((group) => group.cells.map((cell) => cell.loading)));

    // At most GIF.maxChars squares.
    let room = GIF.maxChars;
    const kept = [];
    for (const group of groups) {
      if (room <= 0) break;
      kept.push({ ...group, cells: group.cells.slice(0, room) });
      room -= group.cells.length;
    }
    const truncated = groups.reduce((sum, group) => sum + group.cells.length, 0) > GIF.maxChars;

    const layout = gifLayout(kept);
    try {
      await document.fonts.load(`16px ${cssValue('--ui')}`, layout.items.map((item) => item.pinyin).join(''));
    } catch (error) {
      /* the pinyin is drawn in a fallback font */
    }

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const palette = gifPalette();
    const quantize = makeQuantizer(palette);
    const gif = new window.GifWriter(layout.width, layout.height, palette);
    const speed = settings.speed;

    // The first frame is the whole picture, every square still blank; after it, each
    // frame only covers the inside of the square being written.
    ctx.fillStyle = GIF_COLORS.paper;
    ctx.fillRect(0, 0, layout.width, layout.height);
    for (const item of layout.items) {
      drawGifFrame(ctx, item);
      drawGifSquare(ctx, item, 0, 0);
    }
    const screen = quantize(ctx.getImageData(0, 0, layout.width, layout.height).data); // what the GIF shows so far
    gif.addFrame(0, 0, layout.width, layout.height, screen, GIF.startMs);

    // Each later frame holds only the pixels that changed, the box around them inside
    // the square being written; a frame with no change just lengthens the one before.
    const inside = GIF.cell - 2 * GIF.line;
    const addSquare = (item, ms) => {
      const left = item.x + GIF.line;
      const top = item.y + GIF.staff + GIF.line;
      const pixels = quantize(ctx.getImageData(left, top, inside, inside).data);
      let [x0, y0, x1, y1] = [inside, inside, -1, -1];
      for (let y = 0; y < inside; y += 1) {
        const row = (top + y) * layout.width + left;
        for (let x = 0; x < inside; x += 1) {
          if (pixels[y * inside + x] === screen[row + x]) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
      if (x1 < 0) {
        gif.extendLastFrame(ms);
        return;
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const box = new Uint8Array(w * h);
      for (let y = 0; y < h; y += 1) {
        const from = (y0 + y) * inside + x0;
        box.set(pixels.subarray(from, from + w), y * w);
        screen.set(pixels.subarray(from, from + w), (top + y0 + y) * layout.width + left + x0);
      }
      gif.addFrame(left + x0, top + y0, w, h, box, ms);
    };

    const steps = (stroke) => Math.max(1, Math.round(stroke.duration / speed / GIF.frameMs));
    const drawn = layout.items.filter((item) => item.strokes);
    const total = drawn.reduce((sum, item) => sum + item.strokes.reduce((n, stroke) => n + steps(stroke), 0), 0);
    let made = 0;
    let lastBreath = performance.now();

    for (const item of drawn) {
      for (let i = 0; i < item.strokes.length; i += 1) {
        const stroke = item.strokes[i];
        const count = steps(stroke);
        for (let s = 1; s <= count; s += 1) {
          if (s === count) drawGifSquare(ctx, item, i + 1, 0);
          else drawGifSquare(ctx, item, i, ease(s / count));
          addSquare(item, stroke.duration / speed / count);
          made += 1;
          if (performance.now() - lastBreath > 30) {
            // Let the page breathe, and show how far along it is.
            onProgress(made / total);
            await new Promise((resolve) => setTimeout(resolve));
            lastBreath = performance.now();
          }
        }
        gif.extendLastFrame((i < item.strokes.length - 1 ? STROKE_GAP : CHAR_GAP) / speed);
      }
    }
    gif.extendLastFrame(GIF.endMs);
    onProgress(1);
    return { blob: gif.finish(), truncated };
  }

  let gifBusy = false; // one GIF at a time

  function showGifProgress(button, fraction) {
    if (!button.classList.contains('is-busy')) {
      button.dataset.title = button.title;
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = ICON.progress;
    }
    button.querySelector('.ring-fill').style.strokeDashoffset = String(1 - fraction);
    button.title = `Preparando o GIF… ${Math.round(fraction * 100)}%`;
  }

  function endGifProgress(button) {
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.innerHTML = ICON.download;
    button.title = button.dataset.title || button.title;
  }

  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadGif(groups, button) {
    if (gifBusy || !groups.length) return;
    gifBusy = true;
    showGifProgress(button, 0);
    try {
      const { blob, truncated } = await makeGif(groups, (fraction) => showGifProgress(button, fraction));
      const text = groups.flatMap((group) => group.cells.map((cell) => cell.char)).join('');
      saveFile(blob, `${chars(text).slice(0, 24).join('')}.gif`);
      if (truncated) setStatus(`O GIF mostra só os primeiros ${GIF.maxChars} caracteres.`);
    } catch (error) {
      setStatus('Não foi possível criar o GIF. Tente de novo.', true);
    } finally {
      gifBusy = false;
      endGifProgress(button);
    }
  }

  // ---------------------------------------------------------------- reading the text box

  let analyzeTimer = 0;
  let shownTokens = null; // JSON of what is on the sheet, to skip pointless redraws

  function scheduleAnalyze(delay = 300) {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyze, delay);
  }

  function analyze() {
    const text = input.value;
    settings.text = text;
    updateLink(text);
    saveSettings();
    if (!dictionary) return; // still downloading; loadDictionary calls this again

    const result = analyzeText(text, settings.split);
    const signature = JSON.stringify(result.tokens);
    const redraw = signature !== shownTokens || retryDownloads;
    retryDownloads = false;
    if (redraw) {
      shownTokens = signature;
      renderSheet(result.tokens);
    }

    const hasWords = result.tokens.some((token) => token.type === 'word');
    if (dictionaryNote) {
      setStatus(dictionaryNote, true);
    } else if (result.truncated) {
      setStatus(`Mostrando os primeiros ${MAX_HANZI} caracteres. Encurte o texto para ver o resto.`);
    } else if (text.trim() && !hasWords) {
      setStatus('Nenhum caractere chinês encontrado nesse texto.');
    } else {
      setStatus('');
    }
  }

  // ---------------------------------------------------------------- the mark in the header

  /* On load the two characters of 笔顺 ("stroke order") write themselves once. */
  let markWriters = [];

  async function writeMark() {
    if (reducedMotion.matches) return;
    const spans = [...document.querySelectorAll('.mark-cell')];
    try {
      const data = await Promise.all(spans.map((span) => loadStrokes(span.dataset.char)));
      if (data.some((entry) => !entry)) return;
      const writers = spans.map((span, i) => {
        const size = span.clientWidth;
        span.textContent = '';
        return HanziWriter.create(span, span.dataset.char, {
          width: size,
          height: size,
          padding: Math.round(size * 0.08),
          showCharacter: false,
          showOutline: false,
          strokeColor: INK,
          radicalColor: RED,
          strokeAnimationSpeed: 2.4,
          delayBetweenStrokes: 70,
          charDataLoader: () => data[i],
        });
      });
      markWriters = writers.map((writer, i) => ({ writer, span: spans[i] }));
      for (const writer of writers) await writer.animateCharacter();
    } catch (error) {
      /* no stroke data: the plain characters stay as they are */
    }
  }

  // ---------------------------------------------------------------- wiring

  function checkRadio(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function init() {
    if (!window.HanziWriter) {
      setStatus('A biblioteca de desenho não carregou. Verifique se lib/hanzi-writer.min.js foi enviado.', true);
      return;
    }
    restoreSettings();
    const linked = textFromLink(); // a shared link wins over the text remembered here
    if (linked) settings.text = linked;
    input.value = settings.text;
    checkRadio('split', settings.split);
    checkRadio('layout', settings.layout);
    document.body.dataset.layout = settings.layout;
    checkRadio('speed', settings.speed);
    repeatBox.checked = settings.repeat;
    outlineBox.checked = settings.outline;
    radicalBox.checked = settings.radical;
    refreshToolbar();

    // Typing. While an input method is still composing, the text is not final yet.
    input.addEventListener('input', (event) => {
      if (!event.isComposing) scheduleAnalyze();
    });
    input.addEventListener('compositionend', () => scheduleAnalyze());

    $('#clear').addEventListener('click', () => {
      input.value = '';
      scheduleAnalyze(0);
      input.focus();
    });

    $('#examples').addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      input.value = button.textContent;
      scheduleAnalyze(0);
    });

    $('#split').addEventListener('change', (event) => {
      settings.split = event.target.value;
      scheduleAnalyze(0);
    });

    $('#layout').addEventListener('change', (event) => {
      settings.layout = event.target.value;
      document.body.dataset.layout = settings.layout;
      saveSettings();
    });

    playButton.addEventListener('click', togglePlay);
    stepBackButton.addEventListener('click', () => player.step(-1));
    stepNextButton.addEventListener('click', () => player.step(1));
    gifButton.innerHTML = ICON.download;
    gifButton.addEventListener('click', () => downloadGif(words, gifButton));

    // Keyboard: Space pauses and plays, ← and → step one stroke. Not while typing in the
    // text box or using another control, which have their own use for these keys.
    document.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (event.target.closest('textarea, input, select, [contenteditable]')) return;
      if (event.key === ' ' && !event.target.closest('button, a')) {
        event.preventDefault(); // instead of scrolling the page
        if (!event.repeat) togglePlay();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        player.step(event.key === 'ArrowRight' ? 1 : -1);
      }
    });

    // The settings panel opens under its button and closes on a click elsewhere or Esc.
    const settingsButton = $('#settings-button');
    const settingsPanel = $('#settings-panel');
    const showSettings = (open) => {
      settingsPanel.hidden = !open;
      settingsButton.setAttribute('aria-expanded', String(open));
    };
    settingsButton.addEventListener('click', () => showSettings(settingsPanel.hidden));
    document.addEventListener('click', (event) => {
      if (!settingsPanel.hidden && !event.target.closest('.settings')) showSettings(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !settingsPanel.hidden) {
        showSettings(false);
        settingsButton.focus();
      }
    });

    $('#speed').addEventListener('change', (event) => {
      settings.speed = Number(event.target.value);
      saveSettings();
      // Hanzi Writer reads this option at the start of every stroke, so changing it here
      // takes effect from the next stroke without interrupting playback. (The bundled
      // library version is fixed, so reaching into its options is safe.)
      for (const cell of cells) if (cell.writer) cell.writer._options.strokeAnimationSpeed = settings.speed;
    });

    repeatBox.addEventListener('change', () => {
      settings.repeat = repeatBox.checked;
      saveSettings();
    });

    outlineBox.addEventListener('change', () => {
      settings.outline = outlineBox.checked;
      saveSettings();
      for (const cell of cells) {
        if (!cell.writer) continue;
        if (settings.outline) cell.writer.showOutline();
        else cell.writer.hideOutline();
      }
    });

    radicalBox.addEventListener('change', () => {
      settings.radical = radicalBox.checked;
      saveSettings();
      for (const cell of cells) if (cell.writer) cell.writer.updateColor('radicalColor', settings.radical ? RED : null);
    });

    // The squares change size at two widths (see style.css); keep the drawings in step.
    for (const query of ['(max-width: 760px)', '(max-width: 430px)']) {
      window.matchMedia(query).addEventListener('change', () => {
        for (const cell of cells) {
          if (!cell.writer) continue;
          const size = squareSize(cell);
          cell.writer.updateDimensions({ width: size, height: size, padding: Math.round(size * 0.08) });
        }
        for (const { writer, span } of markWriters) {
          const size = span.clientWidth;
          writer.updateDimensions({ width: size, height: size, padding: Math.round(size * 0.08) });
        }
        fitGlosses();
      });
    }

    loadDictionary(); // draws the sheet as soon as it arrives
    writeMark();
  }

  init();
})();
