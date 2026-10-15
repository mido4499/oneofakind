import { crates } from './crates.js';
import { dockerhub } from './dockerhub.js';
import { domains } from './domains.js';
import { github } from './github.js';
import { hackernews } from './hackernews.js';
import { homebrew } from './homebrew.js';
import { maven } from './maven.js';
import { npm } from './npm.js';
import { nuget } from './nuget.js';
import { packagist } from './packagist.js';
import { pypi } from './pypi.js';
import { rubygems } from './rubygems.js';
import type { Source } from './types.js';
import { wikidata } from './wikidata.js';

export const allSources: Source[] = [
  domains,
  github,
  npm,
  pypi,
  crates,
  rubygems,
  packagist,
  nuget,
  maven,
  homebrew,
  dockerhub,
  wikidata,
  hackernews,
];
