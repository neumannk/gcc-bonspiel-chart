// ==UserScript==
// @name         GCC Bonspiel Team Page
// @namespace    https://curlingseattle.org/
// @license      0BSD
// @homepageURL  https://github.com/neumannk/gcc-bonspiel-chart
// @updateURL    https://raw.githubusercontent.com/neumannk/gcc-bonspiel-chart/main/gcc-bonspiel-team-view.user.js
// @downloadURL  https://raw.githubusercontent.com/neumannk/gcc-bonspiel-chart/main/gcc-bonspiel-team-view.user.js
// @version      0.1.1
// @description  Adds a clean team view (status, games with scores, road graph) below the existing info on Granite Curling Club bonspiel team pages. Works for any event with a schedule.
// @match        https://curlingseattle.org/*
// @match        https://www.curlingseattle.org/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Only run on team pages: ...bonspiels?event=XXXX&disp=team&teamid=N
  // ---------------------------------------------------------------------------
  const params = new URLSearchParams(location.search);
  if (params.get('disp') !== 'team' || !params.get('event') || !params.get('teamid')) return;
  if (document.getElementById('gcc-tv')) return;

  const EVENT = params.get('event');
  const TEAM_ID = params.get('teamid');
  const ORIGIN = location.origin;
  const evQ = encodeURIComponent(EVENT);
  const TABLE_URL = `${ORIGIN}/bonspiels?event=${evQ}&disp=table`;
  const teamHref = (id) => `${ORIGIN}/bonspiels?event=${evQ}&disp=team&teamid=${encodeURIComponent(id)}`;

  const GAME_RE = /\bGame\s+[A-Z]+\d+\b/;
  // First game line often starts with a separate "Friday 4:30 pm" text node
  const DAYTIME_RE = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+\d{1,2}:\d{2}\s*[ap]m\b/i;
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  const txt = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------------------
  // 1. Read the existing team page: team name, game results, and where its content ends
  //    (nothing on the page is modified or hidden; our view is added after it)
  // ---------------------------------------------------------------------------
  function scrapeOriginal() {
    const heading = [...document.querySelectorAll('h1,h2,h3')].find((h) => /^team information$/i.test(txt(h)));
    if (!heading) return null;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      if (heading.contains(n)) continue;
      if (!(heading.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const p = n.parentElement;
      if (p && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
      nodes.push(n);
    }

    const info = [];
    let lastNode = null;
    let inGames = false;
    for (const node of nodes) {
      const t = node.nodeValue.trim();
      const isHeading = node.parentElement && node.parentElement.closest('h1,h2,h3,h4');
      if (!inGames) {
        if (GAME_RE.test(t) || DAYTIME_RE.test(t) || /^(win|lose)\s*:?$/i.test(t)) { inGames = true; }
        else if (isHeading) break; // footer headings, no game lines
        else { info.push(t); lastNode = node; continue; }
      }
      if (inGames) {
        if (isHeading) break;
        lastNode = node;
      }
    }
    if (!info.length || !lastNode) return null;

    // Finished games are printed as "Won Thursday 10:00 pm - Game A12 - vs. ..." (or "Lost ..."):
    // that is the authoritative result. "Win:" / "Lose:" lines are only what-ifs and never match.
    const full = nodes.slice(0, nodes.indexOf(lastNode) + 1).map((x) => x.nodeValue.trim()).join(' ');
    const results = {};
    let prevEnd = 0;
    for (const m of full.matchAll(/Game\s+([A-Z]+\d+)/g)) {
      const seg = full.slice(Math.max(prevEnd, m.index - 70), m.index);
      // Require a weekday right after Won/Lost so a team name like "Lost Boys" can't be mistaken for a result
      const hit = [...seg.matchAll(/\b(Won|Lost)\b\s*[:\-–]?\s*(?:mon|tue|wed|thu|fri|sat|sun)/gi)].pop();
      if (hit) results[m[1]] = /^w/i.test(hit[1]) ? 'W' : 'L';
      prevEnd = m.index + m[0].length;
    }

    return { heading, lastNode, name: info[0], results };
  }

  // ---------------------------------------------------------------------------
  // 2. Parse the schedule table (disp=table) into games
  // ---------------------------------------------------------------------------
  function parseMins(time) {
    const m = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (!m) return 0;
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + parseInt(m[2], 10);
  }

  function findEventStart(docs) {
    const re = /^([A-Za-z]+)\s+(\d{1,2})(?:\s*[-\u2013\u2014]\s*(?:[A-Za-z]+\s+)?\d{1,2})?,\s*(\d{4})/;
    for (const d of docs) {
      for (const h of d.querySelectorAll('h1,h2,h3,h4')) {
        const m = txt(h).match(re);
        if (m) {
          const dt = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
          if (!isNaN(dt)) return dt;
        }
      }
    }
    return null;
  }

  function parseGameCell(cell, sheet, dayIdx, time, lineHref, teams) {
    const clone = cell.cloneNode(true);
    let w = null, l = null;
    const em = clone.querySelector('em, i');
    if (em) {
      const t = txt(em);
      w = (t.match(/W:\s*([A-Z]+\d+)/) || [])[1] || null;
      l = (t.match(/L:\s*([A-Z]+\d+)/) || [])[1] || null;
      em.remove();
    }
    const m = txt(clone).match(/^([A-Z]+\d+)\.\s*(.*)$/);
    if (!m) return null;
    const parts = m[2].split(/\s+vs\.?\s+/i);
    if (parts.length !== 2) return null;

    const anchors = [...cell.querySelectorAll('a')]
      .map((a) => {
        let id = null;
        try { id = new URL(a.getAttribute('href'), TABLE_URL).searchParams.get('teamid'); } catch (e) { /* ignore */ }
        return { id, name: txt(a) };
      })
      .filter((a) => a.id);

    anchors.forEach((a) => { if (!teams.has(a.id)) teams.set(a.id, { name: a.name }); });

    const sides = parts.map((p) => {
      const cands = anchors.filter((a) => p.includes(a.name)).sort((a, b) => b.name.length - a.name.length);
      if (cands.length) return { teamId: cands[0].id, name: cands[0].name, ref: null };
      const r = p.match(/^(Winner|Loser)\s+([A-Z]+\d+)$/i);
      return {
        teamId: null,
        name: p.trim(),
        ref: r ? { type: /^w/i.test(r[1]) ? 'W' : 'L', game: r[2] } : null,
      };
    });

    return { id: m[1], dayIdx, time, mins: parseMins(time), sheet, sides, w, l, lineHref, score: null };
  }

  function parseSchedule(doc) {
    let table = null, headerRow = null, sheetNames = [];
    for (const t of doc.querySelectorAll('table')) {
      for (const tr of t.querySelectorAll('tr')) {
        const names = [...tr.children].map(txt).filter((s) => /^sheet\b/i.test(s));
        if (names.length) { table = t; headerRow = tr; sheetNames = names; break; }
      }
      if (table) break;
    }
    if (!table) return null;

    const N = sheetNames.length;
    const trs = [...table.querySelectorAll('tr')];
    const rows = trs.slice(trs.indexOf(headerRow) + 1);

    const days = [];
    let cur = -1;
    const games = new Map();
    const teams = new Map();

    for (const tr of rows) {
      const cells = [...tr.children];
      if (cells.length < N + 1) continue;
      const sheetCells = cells.slice(cells.length - N);
      const timeCell = cells[cells.length - N - 1];
      const dayCell = cells.length > N + 1 ? cells[cells.length - N - 2] : null;

      const dm = txt(dayCell).match(/^(sun|mon|tue|wed|thu|fri|sat)/i);
      // A day label repeated on the next row (same weekday) is the same day, not a new week
      if (dm && !(cur >= 0 && days[cur].label.toLowerCase() === dm[1].toLowerCase())) {
        days.push({ label: dm[1], date: null }); cur = days.length - 1;
      }
      const time = txt(timeCell);
      if (!time) continue;
      if (cur < 0) { days.push({ label: '', date: null }); cur = 0; }

      let lineHref = null;
      const ta = timeCell.querySelector('a');
      if (ta) { try { lineHref = new URL(ta.getAttribute('href'), TABLE_URL).href; } catch (e) { /* ignore */ } }

      sheetCells.forEach((cell, i) => {
        if (!txt(cell)) return;
        const g = parseGameCell(cell, sheetNames[i], cur, time, lineHref, teams);
        if (g) games.set(g.id, g);
      });
    }
    if (!games.size) return null;

    // Assign calendar dates to day labels (Fri/Sat/Sun...) from the event's date range
    const start = findEventStart([document, doc]);
    if (start) {
      let prev = null;
      for (const d of days) {
        const target = DAYS.indexOf(d.label.toLowerCase());
        if (target < 0) continue;
        const dt = new Date(prev ? prev.getTime() + 86400000 : start.getTime());
        for (let i = 0; i < 14 && dt.getDay() !== target; i++) dt.setDate(dt.getDate() + 1);
        if (dt.getDay() === target) { d.date = dt; prev = dt; }
      }
    }

    const upd = txt(doc.body).match(/Last Update:\s*(\d{4}\s+\w{3}\s+\d{1,2}\s+[\d:]+\s*[ap]m\s*\w*)/i);
    return { games, teams, days, updated: upd ? upd[1] : '' };
  }

  // ---------------------------------------------------------------------------
  // 3. Line scores (the schedule's time links, ...&draw=N): real results
  //    Each game block: "Sheet 1 - Game RR12 - Complete", then a table with
  //    one row per team: team link, end-by-end scores, Total.
  // ---------------------------------------------------------------------------
  function parseLineScores(doc) {
    const out = new Map();
    let cur = null, inLine = false;
    doc.querySelectorAll('tr').forEach((tr) => {
      const t = txt(tr);
      const h = t.match(/Sheet\s*\S+\s*[-\u2013\u2014]\s*Game\s+([A-Z]+\d+)\s*[-\u2013\u2014]\s*([A-Za-z ]+)$/i);
      if (h && !tr.querySelector('a[href*="teamid"]')) {
        cur = { status: h[2].trim(), rows: [] };
        out.set(h[1], cur);
        inLine = false;
        return;
      }
      if (!cur) return;
      const cells = [...tr.children];
      if (cells.some((c) => /^total$/i.test(txt(c)))) { inLine = true; return; }
      if (!inLine || cur.rows.length >= 2) return;
      const a = tr.querySelector('a[href*="teamid"]');
      if (!a || cells.length < 2) return;
      const total = txt(cells[cells.length - 1]);
      if (!/^\d+$/.test(total)) return;
      let id = null;
      try { id = new URL(a.getAttribute('href'), ORIGIN).searchParams.get('teamid'); } catch (e) { /* ignore */ }
      cur.rows.push({ teamId: id, name: txt(a), total: parseInt(total, 10) });
    });
    return out;
  }

  async function loadScores(sched) {
    const urls = new Set();
    for (const g of sched.games.values()) {
      if (g.lineHref && g.sides.some((s) => s.teamId === TEAM_ID)) urls.add(g.lineHref);
    }
    const byGame = new Map();
    await Promise.all([...urls].map(async (u) => {
      try {
        const r = await fetch(u, { credentials: 'same-origin' });
        if (!r.ok) return;
        const d = new DOMParser().parseFromString(await r.text(), 'text/html');
        parseLineScores(d).forEach((v, k) => byGame.set(k, v));
      } catch (e) { console.warn('[GCC team view] line score fetch failed', u, e); }
    }));
    for (const g of sched.games.values()) {
      const e = byGame.get(g.id);
      if (!e || !/complete|final/i.test(e.status) || e.rows.length < 2) continue;
      const a = e.rows.find((r) => r.teamId === TEAM_ID);
      const b = e.rows.find((r) => r !== a);
      if (a && b) g.score = { me: a.total, opp: b.total };
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Rendering helpers
  // ---------------------------------------------------------------------------
  const fmtTime = (t) => t.replace(/\s*(am|pm)/i, (_, x) => ' ' + x.toUpperCase());
  const prefixOf = (id) => (id.match(/^[A-Z]+/) || [''])[0];
  const eventName = (id) => {
    const p = prefixOf(id);
    return p.length === 1 ? `${p} Event` : p;
  };

  function main() {
    const scraped = scrapeOriginal();
    if (!scraped) return;

    fetch(TABLE_URL, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(async (html) => {
        const sched = parseSchedule(new DOMParser().parseFromString(html, 'text/html'));
        if (!sched) return; // event has no schedule: leave the page alone
        await loadScores(sched);
        render(scraped, sched);
      })
      .catch((e) => console.warn('[GCC team view] not added:', e));
  }

  function render(scraped, sched) {
    const { games, teams, days, updated } = sched;
    const list = [...games.values()];
    const cmp = (a, b) => a.dayIdx - b.dayIdx || a.mins - b.mins;
    const whenStr = (g) => {
      const d = days[g.dayIdx];
      const day = d && d.date
        ? d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : d && d.label;
      return [day, fmtTime(g.time)].filter(Boolean).join(', ');
    };
    const shortTime = (g) => {
      const d = days[g.dayIdx];
      return `${(d && d.label) || ''} ${fmtTime(g.time).replace(':00', '')}`.trim();
    };
    const sheetNum = (g) => String((String(g.sheet).match(/\d+/) || [g.sheet])[0]);

    const isMine = (g) => g.sides.some((s) => s.teamId === TEAM_ID);
    const mine = list.filter(isMine).sort(cmp);

    // Result, best source first: the team page's own Won/Lost, then the line score, then advancement
    const resultFor = (g) => {
      if (scraped.results && scraped.results[g.id]) return scraped.results[g.id];
      if (g.score) return g.score.me > g.score.opp ? 'W' : g.score.me < g.score.opp ? 'L' : null;
      const inGame = (x) => x && x.sides.some((s) => s.teamId === TEAM_ID);
      if (g.w && inGame(games.get(g.w))) return 'W';
      if (g.l && inGame(games.get(g.l))) return 'L';
      return null;
    };
    const scoreStr = (g) => (g.score ? `${g.score.me}\u2013${g.score.opp}` : '');

    const known = teams.get(TEAM_ID) || {};
    const teamName = scraped.name || known.name || 'Team';

    const title = document.title.split('|')[0].trim();
    const dateLine = (() => {
      const re = /^[A-Za-z]+\s+\d{1,2}(?:\s*[-\u2013\u2014]\s*(?:[A-Za-z]+\s+)?\d{1,2})?,\s*\d{4}/;
      const h = [...document.querySelectorAll('h2,h3')].find((x) => re.test(txt(x)));
      return h ? txt(h).replace(/\s*-\s*(Upcoming|Current|Past|Completed|In Progress).*$/i, '') : '';
    })();

    const results = mine.map(resultFor);
    const nextIdx = results.findIndex((r) => !r);
    const current = nextIdx >= 0 ? mine[nextIdx] : null;
    const wins = results.filter((r) => r === 'W').length;
    const losses = results.filter((r) => r === 'L').length;

    const oppOf = (g) => g.sides.find((s) => s.teamId !== TEAM_ID) || g.sides[0];

    // Bracket tree grows from the team's last confirmed game, if it is unplayed and has W/L targets
    const lastIdx = mine.length - 1;
    const treeRoot = lastIdx >= 0 && !results[lastIdx] && (mine[lastIdx].w || mine[lastIdx].l) ? mine[lastIdx] : null;

    // ---- Road list (collapsible) + events still in reach ----
    const letters = new Set();
    mine.forEach((g, i) => { if (!results[i]) letters.add(prefixOf(g.id)); });
    let budget = 600;
    const terminal = (kind, from) => {
      if (kind === 'W') return from.l ? 'Advances' : `Wins the ${eventName(from.id)}`;
      return from.w ? 'Eliminated' : `Runner-up, ${eventName(from.id)}`;
    };
    const branch = (kind, targetId, from, depth) => {
      const tag = `<span class="tv-tag ${kind === 'W' ? 'tv-w' : 'tv-l'}">${kind === 'W' ? 'Win' : 'Lose'}</span>`;
      const t = targetId ? games.get(targetId) : null;
      if (!t || depth > 14 || budget-- <= 0) return `<li>${tag} <span class="tv-end">${esc(terminal(kind, from))}</span></li>`;
      letters.add(prefixOf(t.id));
      const me = t.sides.find((s) => s.ref && s.ref.game === from.id);
      const opp = me ? t.sides.find((s) => s !== me) : t.sides[1];
      const oppName = opp
        ? (opp.teamId ? `<a href="${esc(teamHref(opp.teamId))}">${esc(opp.name)}</a>` : esc(opp.name))
        : '';
      const kids = branch('W', t.w, t, depth + 1) + branch('L', t.l, t, depth + 1);
      return `<li>${tag} ${esc(whenStr(t))} \u00b7 ${esc(t.sheet)} \u00b7 Game ${esc(t.id)} \u00b7 v ${oppName}<ul>${kids}</ul></li>`;
    };
    let roadHtml = '';
    if (treeRoot) {
      roadHtml = `<ul class="tv-road">${branch('W', treeRoot.w, treeRoot, 0)}${branch('L', treeRoot.l, treeRoot, 0)}</ul>`;
    }
    const roadsSection = roadHtml
      ? `<details class="tv-details"><summary>Prefer a list? Every road, line by line</summary>${roadHtml}</details>` : '';

    // ---- Page sections ----
    const bracketLabel = (p) => (p.length === 1 ? `${p} bracket` : `${p} play`);
    const status = (() => {
      if (!mine.length) return 'Not on the schedule yet';
      if (current) return `In the ${bracketLabel(prefixOf(current.id))}`;
      const last = mine[mine.length - 1], res = results[mine.length - 1];
      const p = prefixOf(last.id);
      if (res === 'W') {
        if (last.w) return `In the ${bracketLabel(prefixOf(last.w))}`;
        return p.length === 1 ? `Won the ${p} bracket` : 'Finished play';
      }
      if (last.l) return `In the ${bracketLabel(prefixOf(last.l))}`;
      if (!last.w) return p.length === 1 ? `Runner-up, ${p} bracket` : 'Finished play';
      return 'Out';
    })();

    const gamesHtml = mine.length
      ? `<div class="tv-tablewrap"><table class="tv-gt">
          <thead><tr><th>Game</th><th>When</th><th>Sheet</th><th>Opponent</th><th>Result</th></tr></thead>
          <tbody>${mine.map((g, i) => {
            const res = results[i];
            const sc = scoreStr(g);
            const o = oppOf(g);
            const opp = o.teamId ? `<a href="${esc(teamHref(o.teamId))}">${esc(o.name)}</a>` : `<span class="tv-tbd">${esc(o.name)}</span>`;
            const line = g.lineHref ? ` \u00b7 <a href="${esc(g.lineHref)}">line score</a>` : '';
            const resHtml = res
              ? `<span class="${res === 'W' ? 'tv-rw' : 'tv-rl'}">${res}${sc ? ' ' + esc(sc) : ''}</span>`
              : '\u2014';
            return `<tr><td><b>${esc(g.id)}</b><small>${esc(eventName(g.id))}${line}</small></td>`
              + `<td>${esc(whenStr(g))}</td><td>${esc(sheetNum(g))}</td><td>${opp}</td><td>${resHtml}</td></tr>`;
          }).join('')}</tbody></table></div>`
      : '<p class="tv-muted">No games have been assigned yet. Check back once the draw is posted.</p>';

    // ---- Road graph: played games, the next one, later confirmed ones, then the bracket tree ----
    let panelHtml = '';
    let focusX = 0;
    let treeAll = [];
    if (mine.length) {
      const trunc = (str, n) => (str.length > n ? str.slice(0, n - 1) + '\u2026' : str);
      const oppLabel = (name) => {
        const m = String(name).match(/^(Winner|Loser)\s+(\S+)$/i);
        return m ? `${m[1].toLowerCase()} of ${m[2]}` : name;
      };

      const minWins = {};
      let nid = 0, nodeBudget = 500;
      const mkNode = (kind, targetId, from, parent, depth, w) => {
        const n = { id: ++nid, kind, parent, depth, kids: [], game: null, term: null, opp: '' };
        const t = targetId ? games.get(targetId) : null;
        if (!t || depth > 14 || nodeBudget-- <= 0) {
          // A win with nowhere to go is the title: counted for the tile, but not drawn as a game.
          if (kind === 'W') {
            if (!from.w) {
              const L = prefixOf(from.id);
              minWins[L] = Math.min(minWins[L] || 1e9, w + 1);
            }
            return null;
          }
          if (!from.w) return null; // lost the final: nothing further to draw
          n.term = 'Out';
          return n;
        }
        n.game = t;
        const me = t.sides.find((s) => s.ref && s.ref.game === from.id);
        const opp = me ? t.sides.find((s) => s !== me) : t.sides[1];
        n.opp = opp ? opp.name : '';
        const w2 = w + (kind === 'W' ? 1 : 0);
        n.kids = [mkNode('W', t.w, t, n, depth + 1, w2), mkNode('L', t.l, t, n, depth + 1, w2)].filter(Boolean);
        return n;
      };

      const ROW = 36, COLW = 225, HSTEP = 72, PADL = 28, D = 56;
      const rootX = PADL + (mine.length - 1) * HSTEP;

      let root0 = null, all = [], row = 0, maxDepth = 0;
      if (treeRoot) {
        root0 = { id: 0, kind: 'R', parent: null, depth: 0, kids: [], game: treeRoot, term: null, opp: oppOf(treeRoot).name };
        root0.kids = [mkNode('W', treeRoot.w, treeRoot, root0, 1, 0), mkNode('L', treeRoot.l, treeRoot, root0, 1, 0)].filter(Boolean);
        const layout = (n) => {
          all.push(n);
          if (n.depth > maxDepth) maxDepth = n.depth;
          if (!n.kids.length) n.row = row++;
          else { n.kids.forEach(layout); n.row = (n.kids[0].row + n.kids[n.kids.length - 1].row) / 2; }
        };
        layout(root0);
      }
      // Leave just enough headroom above the history line for the tilted "Won 7-5" labels
      const TOP = root0 ? Math.max(18, 66 - root0.row * ROW) : 66;
      const X = (n) => rootX + n.depth * COLW;
      const Y = (n) => TOP + n.row * ROW;
      const hy = root0 ? Y(root0) : TOP;
      const SW = root0 ? rootX + maxDepth * COLW + 230 : PADL + mine.length * HSTEP + 40;
      const SH = root0 ? TOP + Math.max(row - 1, 0) * ROW + 28 : TOP + 28;
      focusX = root0 ? rootX : PADL + Math.max(nextIdx, 0) * HSTEP;

      const badge = (x, y, label) => {
        const w = 8 * label.length + 8;
        return { w, svg: `<rect class="tv-bs" x="${x}" y="${y - 11}" width="${w}" height="15" rx="3"/><text class="tv-bst" x="${x + w / 2}" y="${y}" text-anchor="middle">${esc(label)}</text>` };
      };

      // Time, sheet badge, event circle and opponent for a game, starting at text x `tx`
      const gameInfo = (n, tx, y) => {
        const g = n.game, t1 = shortTime(g), tw = t1.length * 8.3;
        const bx = tx + tw + 6;
        const b = badge(bx, y - 3, sheetNum(g));
        const L = prefixOf(g.id), er = 8 + (L.length - 1) * 4, ex = bx + b.w + 6 + er;
        const opp = `v ${trunc(oppLabel(n.opp), 24)}`;
        return {
          endX: Math.max(ex + er, tx + opp.length * 6.4) + 8,
          svg: `<text class="tv-nt" x="${tx}" y="${y - 2}">${esc(t1)}</text>${b.svg}`
            + `<circle class="tv-ev" cx="${ex}" cy="${y - 6.5}" r="${er}"/><text class="tv-evt" x="${ex}" y="${y - 3}" text-anchor="middle">${esc(L)}</text>`
            + `<text class="tv-ns" x="${tx}" y="${y + 13}">${esc(opp)}</text>`,
        };
      };

      // Connectors: a flat run out of the parent's label (or the root circle), then a gentle S-curve into
      // each child. When a game has both a win and a loss branch, the shared run is drawn once, solid;
      // only the curves after the split are solid (win) or dotted (loss).
      let edgesSvg = '', nodesSvg = '';
      all.forEach((n) => {
        if (n.parent) {
          const p = n.parent, sx = p.endX, y1 = Y(p), x2 = X(n), y2 = Y(n);
          const xs = Math.max(sx, x2 - D);
          const cls = n.kind === 'W' ? 'tv-ew' : 'tv-el';
          const cx = (xs + x2) / 2;
          const curve = Math.abs(y2 - y1) < 1 ? `H${x2}` : `C${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
          if (p.kids.length > 1) {
            if (n === p.kids[0]) edgesSvg += `<path class="tv-e tv-ew" data-stub="${p.id}" d="M${sx} ${y1}H${xs}"/>`;
            edgesSvg += `<path class="tv-e ${cls}" data-to="${n.id}" d="M${xs} ${y1}${curve}"/>`;
          } else {
            edgesSvg += `<path class="tv-e ${cls}" data-to="${n.id}" d="M${sx} ${y1}H${xs}${curve}"/>`;
          }
        }
        const x = X(n), y = Y(n);
        if (n.id === 0) {
          // The team's next game sits on the history line; show its details like every other game
          const info = gameInfo(n, x + 18, y);
          n.endX = info.endX;
          nodesSvg += `<g>${info.svg}</g>`;
          return;
        }
        if (n.term) {
          nodesSvg += `<g class="tv-n" data-id="${n.id}"><circle class="tv-dot" cx="${x}" cy="${y}" r="2.5"/><text class="tv-tt" x="${x + 10}" y="${y + 4}">${esc(n.term)}</text></g>`;
          return;
        }
        const info = gameInfo(n, x + 10, y);
        n.endX = info.endX;
        nodesSvg += `<g class="tv-n" data-id="${n.id}"><rect class="tv-hit" x="${x - 4}" y="${y - 20}" width="${COLW - 20}" height="40"/>`
          + `<circle class="tv-dot" cx="${x}" cy="${y}" r="3.5"/>${info.svg}</g>`;
      });

      // History path on the left: every confirmed game, in order
      let hsvg = '';
      mine.forEach((g, i) => {
        const x = PADL + i * HSTEP, res = results[i], isCur = i === nextIdx;
        if (i > 0) {
          const px = PADL + (i - 1) * HSTEP, pr = results[i - 1];
          hsvg += `<line class="tv-he${pr ? '' : ' tv-hdot'}" x1="${px + 10}" y1="${hy}" x2="${x - 10}" y2="${hy}"/>`
            + (pr ? `<text class="tv-hl" x="${(px + x) / 2}" y="${hy + 17}" text-anchor="middle">${pr}</text>` : '');
        }
        const L = prefixOf(g.id);
        const cls = isCur ? 'tv-hn tv-hcur' : res === 'W' ? 'tv-hn tv-hw' : res === 'L' ? 'tv-hn' : 'tv-hn tv-hlater';
        const small = L.length > 1;
        hsvg += `<circle class="${cls}" cx="${x}" cy="${hy}" r="10"/><text class="tv-hnt${res === 'W' ? ' tv-hwt' : ''}${small ? ' tv-hsm' : ''}" x="${x}" y="${hy + 4}" text-anchor="middle">${esc(L)}</text>`;
        const sc = scoreStr(g);
        const lab = isCur ? 'Next' : res === 'W' ? `Won${sc ? ' ' + sc : ''}` : res === 'L' ? `Lost${sc ? ' ' + sc : ''}` : '';
        const lw = lab ? lab.length * 6.6 + 6 : 0;
        const hb = root0 && i === mine.length - 1 ? { svg: '' } : badge(lw, 0, sheetNum(g));
        hsvg += `<g transform="translate(${x + 3} ${hy - 17}) rotate(-35)">${lab ? `<text class="tv-hlab${isCur ? ' tv-gold' : ''}" x="0" y="0">${esc(lab)}</text>` : ''}${hb.svg}</g>`;
      });

      const reach = [...letters].filter(Boolean).sort();
      let tile1, tile2;
      if (root0) {
        const best = Object.keys(minWins).sort()[0];
        tile1 = '';
        tile2 = `<div class="tv-pcard"><div class="tv-plbl">Wins to a title</div><b>${best ? minWins[best] : '\u2014'}</b><small>${best ? 'the ' + esc(eventName(best)) : ''}</small></div>`;
      } else {
        const left = results.filter((r) => !r).length;
        tile1 = `<div class="tv-pcard"><div class="tv-plbl">Record</div><b>${wins}\u2013${losses}</b><small>wins\u2013losses so far</small></div>`;
        tile2 = `<div class="tv-pcard"><div class="tv-plbl">Games left</div><b>${left}</b><small>confirmed on the schedule</small></div>`;
      }

      const nextOpp = current ? oppOf(current) : null;
      const nextOppHtml = nextOpp && nextOpp.teamId
        ? `<a href="${esc(teamHref(nextOpp.teamId))}">${esc(nextOpp.name)}</a>`
        : nextOpp ? esc(nextOpp.name) : '';
      const nextCard = current
        ? `<div class="tv-pcard"><div class="tv-plbl"><span class="tv-ring"></span>Next game</div>
            <div class="tv-pbig"><b>${esc(shortTime(current))}</b><span>v ${nextOppHtml}</span></div>
            <div class="tv-psub">Game ${esc(current.id)} \u00b7 ${esc(current.sheet.toLowerCase())} \u00b7 ${esc(eventName(current.id))}</div></div>`
        : `<div class="tv-pcard"><div class="tv-plbl">Next game</div><div class="tv-psub">No more confirmed games on the schedule.</div></div>`;

      panelHtml = `<section class="tv-panel">
        ${nextCard}
        <div class="tv-ptiles">${tile1}${tile2}
          <div class="tv-pcard"><div class="tv-plbl">Still in reach</div><div class="tv-preach">${reach.map((l) => `<span class="tv-ev2">${esc(l)}</span>`).join('') || '\u2014'}</div></div>
        </div>
        <div class="tv-scroll"><svg class="tv-svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" role="img" aria-label="Games played and possible roads through the draw">${edgesSvg}${hsvg}${nodesSvg}</svg></div>
        <p class="tv-legend">${root0 ? 'Tap a game to follow that road \u00b7 ' : ''}solid lines are wins, dotted are losses \u00b7 <span class="tv-bs2">4</span> sheet \u00b7 <span class="tv-ev2">B</span> event</p>
        ${roadsSection}
      </section>`;
      treeAll = all;
    }

    const root = document.createElement('div');
    root.id = 'gcc-tv';
    root.innerHTML = `
      <div class="tv-kicker">${esc(title)}${dateLine ? ' \u00b7 ' + esc(dateLine) : ''}</div>
      <h1 class="tv-title">${esc(teamName)}</h1>
      <dl class="tv-meta">
        <div><dt>Status</dt><dd>${esc(status)}</dd></div>
      </dl>
      <h2>Games</h2>${gamesHtml}
      ${panelHtml}
      <p class="tv-foot">${updated ? `Schedule updated ${esc(updated)}. ` : ''}All times as listed on the schedule.</p>`;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Add (never replace) our view right after the existing team information
    const { heading, lastNode } = scraped;
    let C = heading.parentElement;
    while (C && !C.contains(lastNode)) C = C.parentElement;
    let endN = lastNode;
    while (endN.parentNode !== C) endN = endN.parentNode;
    C.insertBefore(root, endN.nextSibling);

    // Tap a game on the graph to follow that road
    const svg = root.querySelector('.tv-svg');
    if (svg) {
      const scroll = root.querySelector('.tv-scroll');
      scroll.scrollLeft = Math.max(0, focusX - 140);
      const byId = new Map(treeAll.map((n) => [String(n.id), n]));
      let sel = null;
      const clear = () => {
        svg.classList.remove('tv-focus');
        svg.querySelectorAll('.tv-on').forEach((e) => e.classList.remove('tv-on'));
        sel = null;
      };
      svg.addEventListener('click', (ev) => {
        const g = ev.target.closest ? ev.target.closest('.tv-n') : null;
        const id = g && g.getAttribute('data-id');
        if (!id || id === sel) { clear(); return; }
        clear();
        sel = id;
        for (let n = byId.get(id); n; n = n.parent) {
          const targets = [`[data-id="${n.id}"]`, `[data-to="${n.id}"]`];
          if (n.parent) targets.push(`[data-stub="${n.parent.id}"]`);
          svg.querySelectorAll(targets.join(',')).forEach((e) => e.classList.add('tv-on'));
        }
        svg.classList.add('tv-focus');
      });
    }
  }

  const CSS = `
  #gcc-tv{--fg:#202124;--muted:#666;--line:#ddd;--brand:#0062A0;--card:#f4f7fa;--amber:#d99200;
    max-width:860px;margin:24px 0;padding:0;color:var(--fg);text-align:left;
    font:13px/1.5 Verdana,Helvetica,Arial,sans-serif}
  #gcc-tv *{box-sizing:border-box}
  #gcc-tv h1,#gcc-tv h2,#gcc-tv dl,#gcc-tv dt,#gcc-tv dd,#gcc-tv ul,#gcc-tv li,#gcc-tv p,#gcc-tv table,#gcc-tv th,#gcc-tv td,#gcc-tv small,#gcc-tv b,#gcc-tv span,#gcc-tv summary,#gcc-tv details{font-family:inherit !important;font-style:normal !important;font-variant:normal !important;text-indent:0 !important;text-shadow:none !important}
  #gcc-tv h1,#gcc-tv h2{font-family:Georgia,"Times New Roman",serif !important;letter-spacing:-0.03em}
  #gcc-tv dd{margin:0 !important;padding:0 !important}
  #gcc-tv dl{margin:0;padding:0}
  #gcc-tv a{color:var(--brand);text-decoration:underline}
  #gcc-tv a:hover{color:var(--fg);text-decoration:none}
  #gcc-tv .tv-kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  #gcc-tv .tv-title{margin:2px 0 8px;font-size:28px;line-height:1.15;font-weight:700;color:var(--fg);border:0;padding:0;background:none}
  #gcc-tv h2{margin:20px 0 8px;font-size:21px;line-height:1.2;text-transform:none;color:var(--fg);font-weight:700;border:0;border-bottom:1px solid var(--line);padding:0 0 4px;background:none}
  #gcc-tv .tv-meta{display:flex;flex-wrap:wrap;gap:10px 36px;margin:0}
  #gcc-tv .tv-meta dt{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  #gcc-tv .tv-meta dd{margin:0;font-weight:700;color:var(--fg)}
  #gcc-tv .tv-road,#gcc-tv .tv-road ul{list-style:none;margin:0;padding:0}
  #gcc-tv .tv-tablewrap{overflow-x:auto}
  #gcc-tv .tv-gt{width:100%;border-collapse:collapse;margin:0;background:none;border:0}
  #gcc-tv .tv-gt th{padding:5px 10px 6px 0;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;text-align:left;border:0;border-bottom:2px solid var(--line);background:none}
  #gcc-tv .tv-gt td{padding:6px 10px 6px 0;vertical-align:top;border:0;border-bottom:1px solid var(--line);background:none;color:var(--fg);font-size:13px}
  #gcc-tv .tv-gt td b{display:block;font-size:13px;font-weight:700}
  #gcc-tv .tv-gt td small{display:block;font-size:11px;color:var(--muted)}
  #gcc-tv .tv-gt td small a{color:var(--muted)}
  #gcc-tv .tv-rw{font-weight:700;color:var(--fg)}
  #gcc-tv .tv-rl{color:var(--muted)}
  #gcc-tv .tv-tbd{color:var(--muted);font-style:italic}
  #gcc-tv .tv-tag{display:inline-block;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:700;background:#e8e8f1;color:var(--fg)}
  #gcc-tv .tv-tag.tv-w{background:var(--brand);color:#fff}
  #gcc-tv .tv-tag.tv-l{background:#e1e1e1;color:#555}
  #gcc-tv .tv-end{color:var(--muted);font-style:italic}
  #gcc-tv .tv-muted{color:var(--muted)}
  #gcc-tv .tv-panel{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:4px;padding:10px}
  #gcc-tv .tv-pcard{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:8px 12px}
  #gcc-tv .tv-plbl{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  #gcc-tv .tv-ring{display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid var(--amber)}
  #gcc-tv .tv-pbig{margin-top:4px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
  #gcc-tv .tv-pbig b{font-size:20px;font-weight:700;color:var(--fg)}
  #gcc-tv .tv-pbig span{font-size:14px}
  #gcc-tv .tv-psub{margin-top:2px;font-size:12px;color:var(--muted)}
  #gcc-tv .tv-ptiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:8px}
  #gcc-tv .tv-ptiles .tv-pcard{text-align:center}
  #gcc-tv .tv-ptiles .tv-plbl{justify-content:center}
  #gcc-tv .tv-ptiles b{display:block;margin-top:2px;font-size:18px;color:var(--fg)}
  #gcc-tv .tv-ptiles small{display:block;margin-top:2px;font-size:11px;color:var(--muted)}
  #gcc-tv .tv-preach{display:flex;justify-content:center;gap:6px;margin-top:4px}
  #gcc-tv .tv-ev2{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 4px;border-radius:11px;background:var(--brand);color:#fff;font-size:11px;font-weight:700}
  #gcc-tv .tv-bs2{display:inline-block;padding:0 6px;border-radius:3px;background:#e8e8f1;color:var(--fg);font-size:11px;font-weight:700}
  #gcc-tv .tv-scroll{overflow-x:auto;margin-top:2px;-webkit-overflow-scrolling:touch}
  #gcc-tv .tv-svg{display:block;max-width:none;font-family:inherit}
  #gcc-tv .tv-legend{margin:6px 0 0;font-size:12px;color:var(--muted)}
  #gcc-tv .tv-details{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
  #gcc-tv .tv-details summary{text-align:right;color:var(--brand);text-decoration:underline;font-size:12px;cursor:pointer}
  #gcc-tv .tv-road{margin-top:10px;font-size:12px}
  #gcc-tv .tv-road li{margin:6px 0}
  #gcc-tv .tv-road ul{margin-left:6px;padding-left:16px;border-left:2px solid var(--line)}
  #gcc-tv .tv-svg .tv-e{fill:none;stroke:#999;stroke-width:1.5}
  #gcc-tv .tv-svg .tv-el{stroke-dasharray:1 5;stroke-linecap:round;stroke-width:2}
  #gcc-tv .tv-svg .tv-he{stroke:#999;stroke-width:1.5}
  #gcc-tv .tv-svg .tv-hdot{stroke-dasharray:1 5;stroke-linecap:round;stroke-width:2}
  #gcc-tv .tv-svg .tv-dot{fill:#999}
  #gcc-tv .tv-svg .tv-nt{fill:var(--fg);font-size:12px}
  #gcc-tv .tv-svg .tv-ns{fill:var(--muted);font-size:10.5px}
  #gcc-tv .tv-svg .tv-tt{fill:var(--muted);font-size:11px}
  #gcc-tv .tv-svg .tv-gold{fill:var(--amber)}
  #gcc-tv .tv-svg .tv-bs{fill:#e8e8f1}
  #gcc-tv .tv-svg .tv-bst{fill:var(--fg);font-size:10px;font-weight:700}
  #gcc-tv .tv-svg .tv-ev{fill:var(--brand)}
  #gcc-tv .tv-svg .tv-evt{fill:#fff;font-size:10px;font-weight:700}
  #gcc-tv .tv-svg .tv-hit{fill:transparent}
  #gcc-tv .tv-svg .tv-n{cursor:pointer}
  #gcc-tv .tv-svg .tv-hn{fill:#fff;stroke:var(--brand);stroke-width:1.5}
  #gcc-tv .tv-svg .tv-hw{fill:var(--brand)}
  #gcc-tv .tv-svg .tv-hcur{stroke:var(--amber);stroke-width:2}
  #gcc-tv .tv-svg .tv-hlater{stroke:#999;stroke-dasharray:3 3}
  #gcc-tv .tv-svg .tv-hnt{fill:var(--brand);font-size:10.5px;font-weight:700}
  #gcc-tv .tv-svg .tv-hsm{font-size:8.5px}
  #gcc-tv .tv-svg .tv-hwt{fill:#fff}
  #gcc-tv .tv-svg .tv-hl{fill:var(--fg);font-size:10.5px;font-weight:700}
  #gcc-tv .tv-svg .tv-hlab{fill:var(--fg);font-size:11px}
  #gcc-tv .tv-svg.tv-focus .tv-n:not(.tv-on),#gcc-tv .tv-svg.tv-focus .tv-e:not(.tv-on){opacity:.22}
  #gcc-tv .tv-svg .tv-e.tv-on{stroke:var(--fg)}
  #gcc-tv .tv-foot{margin:16px 0 0;font-size:11px;color:var(--muted)}
  @media (max-width:520px){#gcc-tv .tv-title{font-size:24px}}
  `;

  main();
})();
