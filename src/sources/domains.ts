import { Resolver } from 'node:dns/promises';
import type { Http } from '../http.js';
import { normalize } from '../matching.js';
import type { Hit } from '../types.js';
import type { Source } from './types.js';

export const TLDS = ['com', 'dev', 'io', 'app', 'ai'] as const;

const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
/** ccTLDs that run RDAP but are missing from the IANA bootstrap file. */
const RDAP_FALLBACK: Record<string, string> = { io: 'https://rdap.identitydigital.services/rdap/' };
/** Nameservers of domain parking / resale services. */
const PARKING_NAMESERVERS =
  /sedoparking|parkingcrew|bodis|above\.com|afternic|dan\.com|hugedomains|parklogic|uniregistrymarket|dsredirection|ztomy|namebrightdns|parking/i;

interface Bootstrap {
  services: [string[], string[]][];
}

interface RdapDomain {
  nameservers?: { ldhName?: string }[];
}

async function rdapBase(http: Http, tld: string, signal: AbortSignal): Promise<string | null> {
  const bootstrap = await http.getJson<Bootstrap>(BOOTSTRAP, { signal });
  const service = bootstrap?.services.find(([tlds]) => tlds.includes(tld));
  return service?.[1][0] ?? RDAP_FALLBACK[tld] ?? null;
}

async function resolves(domain: string): Promise<boolean> {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  try {
    return (await resolver.resolve4(domain)).length > 0;
  } catch {
    try {
      return (await resolver.resolve6(domain)).length > 0;
    } catch {
      return false;
    }
  }
}

/** Rank in the Tranco top-1M list, or null. The public API allows ~1 request/second, so this is best effort. */
async function trancoRank(http: Http, domain: string, signal: AbortSignal): Promise<number | null> {
  const result = await http
    .getJson<{ ranks: { rank: number }[] }>(`https://tranco-list.eu/api/ranks/domain/${domain}`, { signal })
    .catch(() => null);
  return result?.ranks[0]?.rank ?? null;
}

/** Turns a project name into a valid DNS label: `my_tool` -> `mytool`. */
export function domainLabel(name: string): string {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) ? name : normalize(name).replace(/[^a-z0-9-]/g, '');
}

export const domains: Source = {
  id: 'domains',
  weightKeys: ['domain_com', 'domain_other'],
  async check({ name, http, signal, prominence }) {
    const label = domainLabel(name);
    const availability: Record<string, boolean> = {};
    const hits: Hit[] = [];

    await Promise.all(
      TLDS.map(async (tld) => {
        const domain = `${label}.${tld}`;
        const base = await rdapBase(http, tld, signal);
        if (!base) return;
        const rdap = await http.getJson<RdapDomain>(`${base.replace(/\/?$/, '/')}domain/${domain}`, {
          signal,
          headers: { accept: 'application/rdap+json' },
        });
        availability[`domain_${tld}`] = !rdap;
        if (!rdap) return;

        const nameservers = (rdap.nameservers ?? []).map((ns) => ns.ldhName?.toLowerCase() ?? '');
        const parked = nameservers.some((ns) => PARKING_NAMESERVERS.test(ns));
        const live = !parked && (await resolves(domain));
        const rank = tld === 'com' && live ? await trancoRank(http, domain, signal) : null;
        hits.push({
          source: 'domains',
          weightKey: tld === 'com' ? 'domain_com' : 'domain_other',
          name: domain,
          url: `https://${domain}`,
          match: 'exact',
          prominence: rank ? prominence.domainRanked : live ? prominence.domainLive : prominence.domainParked,
          activity: 1,
          links: [domain],
          metrics: { parked, resolves: live, trancoRank: rank },
        });
      }),
    );

    return { hits, availability };
  },
};
