// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked pre-token board, a filterable and sortable table, a per-protocol detail panel with
// the model's own arithmetic and the protocol's farm plan, and the set-aside live-token view.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'rank', dir: 1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unlisted';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  // The model, recomputed in the page from the row's own figures: the detail panel shows this
  // number beside board.json's, so a reader can see the page and the board run the same arithmetic.
  function impliedOf(row) {
    var growthPct = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    var growth = round4(1 + (growthPct / 100) * M.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var maturity = round4(M.maturity_floor + (clamp(age, 0, M.maturity_days) / M.maturity_days) * M.maturity_range);
    var reach = round4(1 + M.reach_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), M.reach_max_extra_chains));
    return Math.max(1, Math.round(row.tvl_usd * row.model.category_multiple * growth * maturity * reach));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.in_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'mult') { av = a.model.category_multiple; bv = b.model.category_multiple; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function selectedRow() {
    var found = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    return found || DATA.rows[0];
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'scope', 'aria-hidden': 'true' }),
      el('div', null,
        el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
        el('div', { class: 'brand-sub', text: 'Pre-token protocols ranked by implied value, each with its farm plan' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip' }, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { class: 'chip' }, 'Model ', el('b', { text: DATA.model_version })),
        el('span', { class: 'chip' }, 'Source ', el('b', { text: 'DefiLlama protocol index' }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols that record no token yet, ranked by what a launch would be worth' }),
        el('p', { text: 'The watchlist of ' + DATA.watchlist_size + ' protocols at or above ' + fmtUsd(DATA.floor_usd) + ' of TVL is the floor, never the ceiling: the radar also carries ' + DATA.early_size + ' more pre-token protocols below it or outside its rule. Wrapped, staked and bridged products of tokens that already trade are left out, and the live-token protocols are set aside with the market\u2019s own values. Implied value is this model\u2019s claim, not a price and not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Beyond the list' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live, set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Name, slug, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { var o = el('option', { value: c, text: c }); if (c === state.category) o.setAttribute('selected', 'selected'); return o; })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { var o = el('option', { value: c, text: c }); if (c === state.chain) o.setAttribute('selected', 'selected'); return o; })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', 'aria-label': 'Watchlist only' });
    if (state.watch) watchBox.setAttribute('checked', 'checked');
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('label', { class: 'field check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
      el('span', { class: 'count', text: state.tab === 'board' ? visibleRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; }
        render();
      } }, label + (state.sort === key ? (state.dir < 0 ? ' \u25bc' : ' \u25b2') : ''))
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category and chain filters to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': selectedRow() && selectedRow().slug === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { state.selected = r.slug; writeHash(); render(); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selected = r.slug; writeHash(); render(); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'pname' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: 'x' + r.model.category_multiple.toFixed(2) }),
        el('td', null,
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / (max || 1)) * 100)) + '%' }))
        ),
        el('td', null, el('span', { class: 'badge ' + (r.in_watchlist ? 'watch' : 'early'), text: r.in_watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols by implied value. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('mult', 'Cat. x'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Radar' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: r.symbol || 'live' })),
        el('td', null, el('div', { class: 'pname' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are never ranked on the pre-token board; their category ratios are what the model\u2019s multiples are made of.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Token' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' })
          )),
          tbody
        )
      )
    );
  }

  function detailPanel() {
    var row = selectedRow();
    if (!row) return el('aside', { class: 'detail' }, el('p', { class: 'sub', text: 'Select a protocol on the board.' }));
    var check = impliedOf(row);
    var steps = row.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, action, tail ? el('span', { class: 'cost', text: tail }) : null);
    });
    return el('aside', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + (row.in_watchlist ? 'Watchlist' : 'Early radar') }),
      el('h2', { text: row.name }),
      el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' \u00b7 records no token \u00b7 listed ' + (row.listed_at || 'date unlisted') }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', { class: 'stat' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'stat' }, el('span', { text: '7d TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', { class: 'stat' }, el('span', { text: 'Age, no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', { class: 'stat' }, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) })),
        el('div', { class: 'stat' }, el('span', { text: 'Category comps' }), el('b', { text: String(row.model.category_comps) }))
      ),
      el('h3', { text: 'How this value is derived' }),
      el('table', { class: 'eq' },
        el('tr', null, el('td', { text: 'TVL x category multiple (x' + row.model.category_multiple.toFixed(4) + ')' }), el('td', { text: fmtUsd(Math.round(row.tvl_usd * row.model.category_multiple)) })),
        el('tr', null, el('td', { text: 'x growth (' + fmtPct(row.model.growth_pct) + ' clamped, 7d)' }), el('td', { text: 'x' + row.model.growth_multiplier.toFixed(4) })),
        el('tr', null, el('td', { text: 'x maturity (age with no token)' }), el('td', { text: 'x' + row.model.maturity_multiplier.toFixed(4) })),
        el('tr', null, el('td', { text: 'x reach (' + (row.chains || []).length + ' chains)' }), el('td', { text: 'x' + row.model.reach_multiplier.toFixed(4) })),
        el('tr', { class: 'total' }, el('td', { text: 'Implied value' }), el('td', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check-line' }, 'Page check: recomputed here as ', el('b', { text: fmtUsd(check) }), check === row.implied_value_usd ? ' \u2014 the same number the board carries.' : ' \u2014 differs from the board, so the data would be stale.'),
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps)
    );
  }

  function modelPanel() {
    var grid = DATA.categories.map(function (c) {
      return el('div', null,
        el('span', { text: c.category + (c.fallback ? ' (market median)' : '') }),
        el('b', { text: 'x' + c.multiple.toFixed(2) + ' \u00b7 ' + c.comps })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The ' + DATA.model_version + ' model, stated in full' }),
      el('p', { text: 'One function scores every row; no protocol name is special-cased. The category multiple is the median market-cap-to-TVL ratio of this snapshot\u2019s own live-token protocols in that category, so the model prices a launch the way the snapshot\u2019s market already prices its peers. A category with fewer than ' + M.min_comps + ' live peers uses the whole market\u2019s median, x' + DATA.global_multiple.toFixed(2) + '. An unlisted age is scored with the snapshot\u2019s median listed age, ' + DATA.median_age_days + ' days.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl x category_multiple x (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ')/100 x ' + M.growth_weight + ') x (' + M.maturity_floor + ' + min(age, ' + M.maturity_days + ')/' + M.maturity_days + ' x ' + M.maturity_range + ') x (1 + ' + M.reach_per_chain + ' x min(chains-1, ' + M.reach_max_extra_chains + ')) )' }),
      el('div', { class: 'mult-grid' }, grid)
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') {
      var work = el('div', { class: 'work' });
      work.appendChild(boardTable());
      work.appendChild(detailPanel());
      shell.appendChild(work);
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(liveTable());
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Data: the sealed DefiLlama protocol snapshot of ' + DATA.as_of + ', read once and never updated. A protocol here records no token in that snapshot; that is DefiLlama\u2019s record, not proof none exists. Implied values are this entry\u2019s model output, not make.fun\u2019s claim and not a prediction that a token will be issued.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  if (!state.selected && DATA.rows.length > 0) state.selected = DATA.rows[0].slug;
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
