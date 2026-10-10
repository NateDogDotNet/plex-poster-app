// Content ratings: the US ladder, the country-prefix table (R-FILT-1, D5, Q19) and the one rule that
// decides whether a rating may be shown under a limit. `allows()` is the child-safety guarantee: the
// engine and the poster cache both call it, and the Plex request filter is only an optimisation.
//
//   G = TV-Y = TV-G  <  PG = TV-Y7 = TV-PG  <  PG-13 = TV-14  <  R = TV-MA  <  NC-17
//
// A rating on the same rung as the limit is allowed. While a limit is set, a rating that is empty,
// missing or not in these tables is NOT allowed. With no limit ('') everything is allowed.

/** The choices for `maxContentRating`, lowest first: the index is the rung. */
export const LIMITS = ['G', 'PG', 'PG-13', 'R', 'NC-17'];

const [G, PG, PG13, R, NC17] = LIMITS.map((_, rung) => rung);

/** Plain US and TV Parental Guidelines values (upper case) and their rung. */
const US = new Map([
  ['G', G], ['TV-Y', G], ['TV-G', G],
  ['PG', PG], ['TV-Y7', PG], ['TV-PG', PG],
  ['PG-13', PG13], ['TV-14', PG13],
  ['R', R], ['TV-MA', R],
  ['NC-17', NC17],
]);

/** Country-prefixed values as Plex stores them (`gb/12A`); the code is upper case here. Ruled in Q19. */
export const COUNTRY_TABLE = {
  'gb/': new Map([['U', G], ['PG', PG], ['12', PG13], ['12A', PG13], ['15', R], ['18', NC17]]),
  'de/': new Map([['0', G], ['6', PG], ['12', PG13], ['16', R], ['18', NC17]]),
  'au/': new Map([['G', G], ['PG', PG], ['M', PG13], ['MA15+', R], ['R18+', NC17]]),
  'ca/': new Map([['G', G], ['PG', PG], ['14A', PG13], ['18A', R], ['R', NC17]]),
  'fr/': new Map([['U', G], ['10', PG], ['12', PG13], ['16', R], ['18', NC17]]),
  'nl/': new Map([['AL', G], ['6', PG], ['9', PG], ['12', PG13], ['14', PG13], ['16', R], ['18', NC17]]),
};

/** The rung (0 = G ... 4 = NC-17) of a rating string, or null when it is empty, missing or unmapped. */
export function ratingRank(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const slash = v.indexOf('/');
  if (slash < 0) return US.get(v.toUpperCase()) ?? null;
  const table = Object.hasOwn(COUNTRY_TABLE, v.slice(0, slash + 1).toLowerCase()) ? COUNTRY_TABLE[v.slice(0, slash + 1).toLowerCase()] : null;
  return table?.get(v.slice(slash + 1).toUpperCase()) ?? null;
}

/**
 * May a title with this rating be shown under `limit`? `''` (or no limit) allows everything, unrated
 * included. A limit that is not one of LIMITS allows nothing: a corrupt setting fails closed.
 */
export function allows(limit, rating) {
  if (limit === '' || limit === undefined || limit === null) return true;
  const max = LIMITS.indexOf(limit);
  if (max < 0) return false;
  const rank = ratingRank(rating);
  return rank !== null && rank <= max;
}

/**
 * The `contentRating` values to ask Plex for: every ladder value and every mapped country-prefixed
 * value at or below the limit. Empty for no limit. The server filter is a convenience; allows() decides.
 */
export function allowedValues(limit) {
  if (limit === '' || limit === undefined || limit === null) return [];
  const max = LIMITS.indexOf(limit);
  if (max < 0) return [];
  const out = [...US].filter(([, rung]) => rung <= max).map(([value]) => value);
  for (const [prefix, table] of Object.entries(COUNTRY_TABLE)) {
    for (const [code, rung] of table) if (rung <= max) out.push(prefix + code);
  }
  return out;
}
