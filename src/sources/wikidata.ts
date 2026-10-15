import { bestMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { clamp, compact } from '../util.js';
import type { Source } from './types.js';

const API = 'https://www.wikidata.org/w/api.php';

/** "Instance of" (P31) classes that make an entity a software/company/product collision. */
const TECH_CLASSES = new Set([
  'Q7397', // software
  'Q341', // free software
  'Q1130645', // open-source software
  'Q9143', // programming language
  'Q188860', // software library
  'Q271680', // software framework
  'Q166142', // application
  'Q620615', // mobile app
  'Q189210', // web application
  'Q193424', // web service
  'Q35127', // website
  'Q9135', // operating system
  'Q8513', // database
  'Q7889', // video game
  'Q4830453', // business
  'Q6881511', // enterprise
  'Q783794', // company
  'Q891723', // public company
  'Q431289', // brand
  'Q2424752', // product
]);
const TECH_DESCRIPTION =
  /\b(software|library|framework|programming|application|app|company|startup|website|web service|operating system|database|video game|protocol|brand|platform|toolkit|editor|engine|cryptocurrency)\b/i;

interface SearchResponse {
  search: { id: string; label?: string; description?: string; match?: { text?: string } }[];
}

type Claim = { mainsnak: { datavalue?: { value: unknown } } };

interface EntitiesResponse {
  entities: Record<string, { sitelinks?: Record<string, unknown>; claims?: Record<string, Claim[]> }>;
}

const claimValues = (claims: Record<string, Claim[]> | undefined, property: string) =>
  (claims?.[property] ?? []).map((claim) => claim.mainsnak.datavalue?.value);

export const wikidata: Source = {
  id: 'wikidata',
  weightKeys: ['wikidata_tech', 'wikidata_other'],
  async check({ name, http, signal, prominence }) {
    const search = await http.getJson<SearchResponse>(
      `${API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=20&format=json`,
      { signal },
    );
    const matches = compact(
      (search?.search ?? []).map((item) => {
        const match = bestMatch(name, compact([item.label, item.match?.text]));
        return match && { ...item, match };
      }),
    );
    if (!matches.length) return { hits: [] };

    const details = await http.getJson<EntitiesResponse>(
      `${API}?action=wbgetentities&ids=${matches.map((item) => item.id).join('|')}&props=claims|sitelinks&format=json`,
      { signal },
    );

    const hits: Hit[] = matches.map((item) => {
      const entity = details?.entities[item.id];
      const classes = claimValues(entity?.claims, 'P31').map((value) => (value as { id?: string })?.id);
      const tech =
        classes.some((id) => id && TECH_CLASSES.has(id)) || TECH_DESCRIPTION.test(item.description ?? '');
      const sitelinks = Object.keys(entity?.sitelinks ?? {}).length;
      return {
        source: 'wikidata',
        weightKey: tech ? 'wikidata_tech' : 'wikidata_other',
        name: item.label ?? item.id,
        url: `https://www.wikidata.org/wiki/${item.id}`,
        match: item.match,
        prominence: clamp(prominence.wikidataBase + Math.log10(sitelinks + 1) / prominence.wikidataSitelinks),
        activity: 1,
        // P856 = official website, P1324 = source code repository.
        links: [...claimValues(entity?.claims, 'P856'), ...claimValues(entity?.claims, 'P1324')].filter(
          (value): value is string => typeof value === 'string',
        ),
        description: item.description,
        metrics: { sitelinks },
      };
    });
    return { hits };
  },
};
