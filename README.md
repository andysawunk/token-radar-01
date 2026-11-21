# Token Radar — token-radar-01 entry

A token launch radar for make.fun's token-radar-01 bounty. The program reads the sealed
DefiLlama protocol snapshot, ranks every protocol that records no token yet by an implied
launch value, and hands in a static dashboard: the ranked board, a detail view per protocol
with the model's own arithmetic, filters, and a concrete farm plan for every row.

## The model (radar-2)

One function scores every row; no protocol name is special-cased.

- **Eligibility**: a protocol records no token (no market cap, no CoinGecko id, no symbol) and
  is not a wrapped, staked or bridged product of a token that already trades, not an exchange
  and not a versioned pool — the watchlist rule's exclusions, read from the snapshot's fields
  at any TVL. Protocols whose token already trades are set aside as the live set.
- **Implied value** = TVL × category multiple × growth × maturity × reach, where the category
  multiple is the median market-cap-to-TVL ratio of the snapshot's own live-token protocols in
  that category, growth follows the 7-day TVL change (clamped), maturity follows the age since
  the protocol was first listed with no token, and reach follows its chain count. Every
  multiplier is rounded to 4 decimal places, so the dashboard recomputes each row's value and
  lands on the same number the board carries.
- **Farm plans** are derived per protocol: the category picks the actions, the first chain
  prices the gas, the TVL sizes the capital, and the age sets the hold — seven steps each,
  every step with its cost and its time.

## Run

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18 or later, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` into the output directory. Deterministic: two runs over the
same snapshot write the same bytes.

## Layout

- `main.ts` — the entry point: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the radar-2 model: eligibility, category multiples, implied value, farm plans.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored from the competition kit.
- `dashboard/` — the static page (index.html, app.css, app.js); renders with no network.
- `screenshots/` — the board, a protocol's detail view, and a filtered view.
- `.makefun/owner.json` — the claim file naming the entrant account's wallet.

MIT licensed; see LICENSE.
