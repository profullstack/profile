import {
  accounts,
  identityMap,
  parseOpenProfile,
  sectionKeys,
  sections,
} from '@profullstack/openprofile';
import { NORMALIZERS, domainFromEmail, splitFullName } from './normalize.js';
import { readBoundedText, safeFetchPublicUrl } from './safe-fetch.js';

export class OpenProfileImportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'OpenProfileImportError';
    this.status = status;
  }
}

function keyOf(key) {
  return key.toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function markdownTarget(value) {
  const link = value.trim().match(/^\[[^\]]*\]\((https?:\/\/[^)]+|mailto:[^)]+)\)$/i);
  return link?.[1] ?? value.trim();
}

function markdownText(value) {
  const link = value.trim().match(/^\[([^\]]*)\]\([^)]+\)$/);
  return (link?.[1] ?? value).replace(/\*\*/g, '').trim();
}

function emailAddress(value) {
  const target = markdownTarget(value);
  return target.toLowerCase().startsWith('mailto:') ? target.slice(7).split('?')[0] ?? '' : target;
}

function contactValues(doc) {
  const identity = Object.fromEntries(Object.entries(identityMap(doc)).map(([key, value]) => [keyOf(key), value]));
  const contact = Object.assign(
    {},
    ...sections(doc, 'contact').map((section) =>
      Object.fromEntries(Object.entries(sectionKeys(section.body)).map(([key, value]) => [keyOf(key), value])),
    ),
  );
  const all = { ...contact, ...identity };
  const value = (...keys) => {
    for (const key of keys) {
      const found = all[keyOf(key)]?.trim();
      if (found) return found;
    }
    return '';
  };
  return {
    email: value('email', 'contact email'),
    first_name: value('first name', 'given name', 'given'),
    last_name: value('last name', 'family name', 'surname'),
    company_domain: value(
      'company domain',
      'company_domain',
      'organization domain',
      'organisation domain',
      'company website',
      'organization website',
      'organisation website',
      'employer website',
      'company',
      'organization',
      'organisation',
    ),
    job_title: value('job title', 'job_title', 'title', 'position', 'role'),
    linkedin_url: value('linkedin', 'linkedin url', 'linkedin profile'),
    name: doc.name ?? '',
  };
}

/** Parse OpenProfile.md into the shared, validated profile fields. */
export function contactFromOpenProfile(markdown) {
  const doc = parseOpenProfile(markdown);
  const source = contactValues(doc);
  const profile = {};
  const put = (field, raw, mode = 'text') => {
    if (!raw) return;
    const candidate = mode === 'target' ? markdownTarget(raw) : mode === 'email' ? emailAddress(raw) : markdownText(raw);
    try {
      const normalized = NORMALIZERS[field](candidate);
      if (normalized) profile[field] = normalized;
    } catch {
      // Skip an unfamiliar value while keeping other usable fields.
    }
  };

  put('email', source.email, 'email');
  put('first_name', source.first_name);
  put('last_name', source.last_name);

  const name = splitFullName(markdownText(source.name));
  if (!profile.first_name && name.first_name) put('first_name', name.first_name);
  if (!profile.last_name && name.last_name) put('last_name', name.last_name);

  put('company_domain', source.company_domain, 'target');
  if (!profile.company_domain && profile.email) {
    const inferred = domainFromEmail(profile.email);
    if (inferred) profile.company_domain = inferred;
  }

  put('job_title', source.job_title);
  put('linkedin_url', source.linkedin_url, 'target');
  if (!profile.linkedin_url) {
    for (const account of accounts(doc)) {
      let linkedin = /linkedin/i.test(account.label ?? '');
      if (!linkedin) {
        try {
          linkedin = /(^|\.)linkedin\.com$/i.test(new URL(account.url).hostname);
        } catch {
          linkedin = false;
        }
      }
      if (!linkedin) continue;
      put('linkedin_url', account.url, 'target');
      if (profile.linkedin_url) break;
    }
  }

  return profile;
}

/** Fetch a bounded public OpenProfile and return only normalized contact fields. */
export async function fetchOpenProfileContact(url, { fetcher, lookup } = {}) {
  if (typeof url !== 'string' || !url.trim() || url.length > 2_048) {
    throw new OpenProfileImportError('Enter a valid OpenProfile.md URL.', 400);
  }
  const fetched = await safeFetchPublicUrl(url, { ...(fetcher ? { fetcher } : {}), ...(lookup ? { lookup } : {}) });
  if (!fetched.ok) {
    if (fetched.kind === 'blocked') {
      throw new OpenProfileImportError('Use a public HTTPS URL for an OpenProfile.md file.', 400);
    }
    throw new OpenProfileImportError('Could not fetch that OpenProfile.md URL.', 422);
  }
  if (!fetched.response.ok) {
    void fetched.response.body?.cancel().catch(() => {});
    throw new OpenProfileImportError('Could not fetch that OpenProfile.md URL.', 422);
  }
  const read = await readBoundedText(fetched.response);
  if (!read.ok && read.reason === 'too-large') {
    throw new OpenProfileImportError('That OpenProfile.md is larger than 256 KB.', 413);
  }
  if (!read.ok) throw new OpenProfileImportError('Could not read that OpenProfile.md file.', 422);
  const profile = contactFromOpenProfile(read.text);
  if (Object.keys(profile).length === 0) {
    throw new OpenProfileImportError('No contact details were found in that OpenProfile.md.', 422);
  }
  return profile;
}
