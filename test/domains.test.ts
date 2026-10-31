import { describe, expect, it, vi } from 'vitest';
import { domainLabel, domains } from '../src/sources/domains.js';
import { context, fakeHttp } from './helpers.js';

// DNS lookups go to the real network, so fake them: only domains in `live` resolve.
const dns = vi.hoisted(() => ({ live: new Set<string>() }));
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    async resolve4(domain: string) {
      if (dns.live.has(domain)) return ['192.0.2.1'];
      throw new Error('ENOTFOUND');
    }
    async resolve6() {
      throw new Error('ENOTFOUND');
    }
  },
}));

describe('domains source', () => {
  it('reports availability per TLD and rates registered domains by parking, DNS and Tranco rank', async () => {
    dns.live = new Set(['quillo.com']);
    const http = fakeHttp({
      'https://data.iana.org/rdap/dns.json': {
        services: [
          [['com'], ['https://rdap.verisign.com/com/v1/']],
          [['dev', 'app'], ['https://pubapi.registry.google/rdap/']],
          [['ai'], ['https://rdap.identitydigital.services/rdap/']],
        ],
      },
      'https://rdap.verisign.com/com/v1/domain/quillo.com': { nameservers: [{ ldhName: 'NS1.EXAMPLE.NET' }] },
      'https://pubapi.registry.google/rdap/domain/quillo.dev': { nameservers: [{ ldhName: 'ns1.sedoparking.com' }] },
      // .io is missing from the bootstrap file, so the source must use its fallback RDAP server.
      'https://rdap.identitydigital.services/rdap/domain/quillo.io': { nameservers: [] },
      'https://tranco-list.eu/api/ranks/domain/quillo.com': { ranks: [{ rank: 1234 }] },
    });

    const result = await domains.check(context(http));
    expect(result.availability).toEqual({
      domain_com: false,
      domain_dev: false,
      domain_io: false,
      domain_app: true,
      domain_ai: true,
    });
    const byName = Object.fromEntries(result.hits.map((hit) => [hit.name, hit]));
    expect(Object.keys(byName).sort()).toEqual(['quillo.com', 'quillo.dev', 'quillo.io']);
    expect(byName['quillo.com']).toMatchObject({
      weightKey: 'domain_com',
      prominence: 1,
      metrics: { parked: false, resolves: true, trancoRank: 1234 },
    });
    expect(byName['quillo.dev']).toMatchObject({
      weightKey: 'domain_other',
      prominence: 0.3,
      metrics: { parked: true, resolves: false, trancoRank: null },
    });
    expect(byName['quillo.io']).toMatchObject({ prominence: 0.3, metrics: { parked: false, resolves: false } });
  });

  it('checks a live non-.com domain without asking Tranco', async () => {
    dns.live = new Set(['quillo.dev']);
    const http = fakeHttp({
      'https://data.iana.org/rdap/dns.json': { services: [[['dev'], ['https://pubapi.registry.google/rdap/']]] },
      'https://pubapi.registry.google/rdap/domain/quillo.dev': { nameservers: [{ ldhName: 'ns1.example.net' }] },
    });
    const result = await domains.check(context(http));
    expect(result.hits.find((hit) => hit.name === 'quillo.dev')?.prominence).toBe(0.7);
    expect(http.calls.some((call) => call.url.includes('tranco-list.eu'))).toBe(false);
  });
});

describe('domainLabel', () => {
  it.each([
    ['quillo', 'quillo'],
    ['my-tool', 'my-tool'],
    ['my_tool', 'mytool'],
    ['my.tool', 'mytool'],
  ])('turns %j into the DNS label %j', (name, label) => {
    expect(domainLabel(name)).toBe(label);
  });
});
