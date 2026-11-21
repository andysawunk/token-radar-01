// Token Radar's value model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token yet and is rankable (not an exchange, not a
// versioned pool, and not a wrapped, staked or bridged product of a token that already trades:
// WBTC and the exchange bridges record no token of their own, and the board still leaves them out).
// Every slug on the snapshot's watchlist is on the board; the
// watchlist is the floor, never the ceiling, so the board also carries every rankable pre-token
// protocol below the floor and every one the watchlist rule left out. Protocols whose token already
// trades are never ranked: they are set aside as the live set, with the market's own capitalisation.
//
// Implied value is derived from the snapshot's own figures alone. No protocol name is ever
// special-cased; one function scores every row:
//
//   multiple   the category's own multiple: the median market-cap-to-TVL ratio of the snapshot's
//              live-token protocols in the same category (ratios winsorised, thin categories fall
//              back to the whole market's median), clamped to [0.05, 2.5]
//   base       = tvl_usd x multiple
//   growth     = 1 + clamp(change_7d, -50, 100) / 100 x 0.6      (unreported growth counts as 0)
//   maturity   = 0.7 + 0.5 x min(age_days, 1460) / 1460          (age since DefiLlama first listed
//              the protocol; an unlisted age uses the snapshot's own median listed age)
//   reach      = 1 + 0.03 x min(chains - 1, 7)                    (distribution across chains)
//   implied    = max(1, round(base x growth x maturity x reach))
//
// Every multiplier is rounded to 4 decimal places before it is used, so the dashboard recomputes
// each row's implied value from the row's own figures and lands on the same number board.json
// carries. The model is deterministic: it reads no clock and no network, only the snapshot.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  ratio_floor: number;
  ratio_cap: number;
  min_comps: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  reach_per_chain: number;
  reach_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  ratio_floor: 0.02,
  ratio_cap: 8,
  min_comps: 3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  reach_per_chain: 0.03,
  reach_max_extra_chains: 7,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Already trading view carries, by market cap. */
export const LIVE_ROWS = 36;

/** One row of board.json: a ranked pre-token protocol with its model breakdown and farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  in_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row itself, farm plan included. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's multiple and the live comparables it came from. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  comps: number;
  fallback: boolean;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  median_age_days: number;
  global_multiple: number;
  categories: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The categories that are a wrapped, staked or bridged product of a token that already trades, or
 * an exchange: the watchlist rule's own set, with Cross Chain Bridge read as the bridged product
 * its name says it is. A product of a traded token is not a launch still to come, whatever its
 * record's token fields say, so the board never ranks one.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying the whole word wrapped, staked or staking, in any case. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a wrapped,
 * staked or bridged product of one that trades, not an exchange and not a versioned pool. The
 * same exclusions the watchlist rule states, read from the snapshot's own fields at any TVL.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !(p.category !== null && PRODUCT_CATEGORIES.has(p.category)) &&
    !PRODUCT_WORD.test(p.name) &&
    !EXCHANGE_START.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

/**
 * The category multiples, derived from the snapshot itself: for every category, the median
 * market-cap-to-TVL ratio of its live-token protocols, each ratio winsorised to the model's band.
 * A category with fewer live comparables than the model's minimum falls back to the whole
 * market's median multiple, and every multiple is clamped to the model's band and rounded to
 * 4 decimal places, the precision the board and the page both use.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, model.ratio_floor, model.ratio_cap);
    all.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = round4(clamp(all.length > 0 ? median(all) : 1, model.multiple_floor, model.multiple_cap));
  const byCategory = new Map<string, CategoryMultiple>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '';
    if (byCategory.has(key)) continue;
    const list = ratiosByCategory.get(key) ?? [];
    const own = list.length >= model.min_comps;
    byCategory.set(key, {
      category: p.category ?? 'Uncategorised',
      multiple: own ? round4(clamp(median(list), model.multiple_floor, model.multiple_cap)) : global,
      comps: list.length,
      fallback: !own,
    });
  }
  return { byCategory, global };
}

/** The snapshot's median listed age in days: the age an unlisted protocol is scored with. */
export function medianAgeDays(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return ages.length > 0 ? Math.round(median(ages)) : 365;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, CategoryMultiple>,
  medianAge: number,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; comps: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const entry = multiples.get(protocol.category ?? '');
  const multiple = entry?.multiple ?? 1;
  const comps = entry?.comps ?? 0;
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? medianAge;
  const maturityMult = round4(model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range);
  const reachMult = round4(1 + model.reach_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_extra_chains));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * reachMult));
  return { implied, multiple, comps, growthPct, growthMult, maturityMult, reachMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n and a farm plan each. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory } = categoryMultiples(snapshot, model);
  const medianAge = medianAgeDays(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, byCategory, medianAge, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    in_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      category_comps: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      reach_multiplier: s.reachMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

// ---------------------------------------------------------------- the farm plan

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the plan monthly.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs in gas on a chain, by the chain's own fee class. */
function gasFor(chain: string): { label: string; usd: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { label: '$12 of ETH for gas', usd: 12 };
  if (c === 'solana') return { label: 'about $0.30 of SOL for fees', usd: 0.3 };
  if (c === 'bsc' || c === 'bnb chain') return { label: 'about $0.60 of BNB for gas', usd: 0.6 };
  if (c === 'avalanche') return { label: 'about $0.80 of AVAX for gas', usd: 0.8 };
  if (['arbitrum', 'base', 'optimism', 'polygon', 'zksync era', 'linea', 'scroll', 'mantle', 'blast', 'mode', 'taiko'].includes(c)) {
    return { label: 'about $1.20 of ETH for gas', usd: 1.2 };
  }
  return { label: 'about $2 of the native token for gas', usd: 2 };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The core position's action, in the words a farmer can follow, from the protocol's category. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${n} on ${chain}, then borrow $${Math.round(capital / 2)} against it and re-supply the borrowed half.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${n}'s busiest pool on ${chain}, split evenly between the pool's two assets.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then deposit the bridged funds in a ${chain} app the same day.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the same wallet.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position, long and short the same asset in equal size.`;
  if (c.includes('prediction')) return `Fund ${n} with $${capital} and take one position in its most liquid market on ${chain}.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('allocator') || c.includes('curator')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the vault shares untouched in the farming wallet.`;
  if (c.includes('stable') || c.includes('algo')) return `Mint or buy $${capital} of ${n}'s stable asset on ${chain} and hold it, or pair it in the protocol's own stability pool.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for the longest term it offers and keep the policy active.`;
  if (c.includes('launchpad')) return `Register the wallet with ${n} on ${chain} and commit $${capital} to the next sale or staking round it opens.`;
  if (c.includes('payment') || c.includes('card')) return `Open a ${n} account, fund it with $${capital} and route one real payment or card purchase through it on ${chain}.`;
  if (c.includes('nft')) return `List or buy one item on ${n} on ${chain} with $${capital} of budget and keep the wallet's trade history active.`;
  if (c.includes('governance')) return `Stake $${capital} in ${n}'s governance contract on ${chain} so the wallet can vote on the next proposal.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${n} on ${chain} and make one shielded transfer to your own second wallet.`;
  if (c.includes('ai')) return `Use ${n}'s agent service on ${chain} with $${capital} of credits and keep the wallet that pays for it active.`;
  if (c.includes('index')) return `Mint $${capital} of a ${n} index token on ${chain} and hold it in the farming wallet.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and make ${n}'s own app the wallet's first transaction on the chain.`;
  if (c.includes('locker')) return `Lock $${capital} of a liquid token in ${n} on ${chain} for the longest lock it offers.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open in the farming wallet.`;
}

/** The second leg of the plan, from the protocol's category: what deepens the position. */
function secondLeg(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay and re-borrow once so the wallet shows a full lending cycle on ${n}, keeping the loan-to-value under 50 per cent.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Stake the pool receipt in ${n}'s own farm on ${chain} if it offers one, so the position earns and is counted in two places.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge a second, smaller amount back the other way a week later, so the wallet shows two-way use of ${n}.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate or restake a second $${Math.round(capital / 2)} tranche two weeks later, so the wallet's stake grows in steps, not one lump.`;
  if (p.chains.length > 1) return `Repeat a $${Math.round(capital / 2)} position on ${p.chains[1]}, the protocol's second chain, from the same wallet.`;
  return `Add a second $${Math.round(capital / 2)} tranche to the same ${n} position two weeks later, so the activity spans more than one week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names: the category picks the actions, the first chain prices the gas, the TVL sizes the
 * capital and the age sets the hold.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.round(hold / 7));
  return [
    stepText(
      `Create a fresh wallet for ${p.name} alone, fund it from your main wallet, and keep its seed phrase offline on paper.`,
      'no fee to create; the funding transfer costs ' + gas.label,
      '10 minutes',
    ),
    stepText(coreAction(p, capital, chain), `$${capital} of capital plus ${gas.label}`, '20 minutes to set up'),
    stepText(secondLeg(p, capital, chain), `about $${Math.round(capital / 2)} more capital plus ${gas.label}`, '15 minutes'),
    stepText(
      `Make one qualifying action on ${p.name} every week for ${weeks} weeks: a deposit, a swap, a vote or a claim, always from the same wallet.`,
      `about ${gas.label} a week`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the full position for at least ${hold} days so the activity is counted in more than one weekly snapshot of the protocol.`,
      `the $${capital} stays locked in the position`,
      `${hold} days`,
    ),
    stepText(
      `Check ${p.name}'s own points or rewards page from the link on its official site, and claim only there; a claim never asks for a fee or a seed phrase.`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      `Log the wallet, the dates and every transaction hash in a farm log, then unwind in one session: withdraw, unbridge and sweep the wallet.`,
      `${gas.label} to withdraw and close`,
      '15 minutes, at the end of the hold',
    ),
  ];
}

// ---------------------------------------------------------------- the dashboard data

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { byCategory, global } = categoryMultiples(snapshot, model);
  const categories = [...byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    median_age_days: medianAgeDays(snapshot),
    global_multiple: global,
    categories,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.in_watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board more than once';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
