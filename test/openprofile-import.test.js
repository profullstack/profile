import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveOpenProfileContact } from '../src/index.js';
import { contactFromOpenProfile, fetchOpenProfileContact } from '../src/openprofile-import.js';
import { checkPublicUrl, safeFetchPublicUrl } from '../src/safe-fetch.js';

const profile = `# Ada Lovelace

- **Kind**: person
- **Email**: ADA@ACME.COM
- **Title**: CTO
- **Organization**: [Acme](https://www.acme.com/about)

## Accounts

- [LinkedIn](https://www.linkedin.com/in/ada-lovelace?trk=profile)
`;

test('OpenProfile fields normalize into the shared profile contract', () => {
  assert.deepEqual(contactFromOpenProfile(profile), {
    email: 'ada@acme.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    company_domain: 'acme.com',
    job_title: 'CTO',
    linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
  });
});

test('OpenProfile Contact section keys and underscore names are recognized', () => {
  const markdown = `# Grace Hopper\n\n## Contact\n\n- **first_name**: Grace\n- **last_name**: Hopper\n- **job_title**: Admiral\n- **linkedin_url**: https://www.linkedin.com/in/grace-hopper`;
  assert.deepEqual(contactFromOpenProfile(markdown), {
    first_name: 'Grace',
    last_name: 'Hopper',
    job_title: 'Admiral',
    linkedin_url: 'https://www.linkedin.com/in/grace-hopper',
  });
});

test('refuses local and DNS-private destinations', async () => {
  assert.equal(await checkPublicUrl('https://127.0.0.1/openprofile.md'), null);
  assert.equal(await checkPublicUrl('https://metadata.google.internal/openprofile.md'), null);
  assert.equal(
    await checkPublicUrl('https://private.example/openprofile.md', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]),
    null,
  );
});

test('revalidates redirects before making the next request', async () => {
  let calls = 0;
  const result = await safeFetchPublicUrl('https://public.example/openprofile.md', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    },
  });
  assert.deepEqual(result, { ok: false, kind: 'blocked' });
  assert.equal(calls, 1);
});

test('fetches a bounded document and returns only mapped fields', async () => {
  const result = await fetchOpenProfileContact('https://profile.example/openprofile.md', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async () => new Response(profile, { headers: { 'content-type': 'text/markdown' } }),
  });
  assert.equal(result.email, 'ada@acme.com');
  assert.equal(result.first_name, 'Ada');
  assert.equal(result.linkedin_url, 'https://www.linkedin.com/in/ada-lovelace');
  assert.equal(Object.hasOwn(result, 'body'), false);
});

test('connection-time import fills blanks and preserves existing profile values', async () => {
  let saved;
  const store = {
    async fillBlanks(userId, values) {
      assert.equal(userId, 'user-1');
      saved = {
        email: 'existing@example.net',
        first_name: values.first_name,
        last_name: values.last_name,
      };
      return saved;
    },
  };
  const result = await saveOpenProfileContact(store, 'user-1', 'https://profile.example/openprofile.md', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async () => new Response(profile, { headers: { 'content-type': 'text/markdown' } }),
  });
  assert.equal(result.email, 'existing@example.net');
  assert.equal(result.first_name, 'Ada');
  assert.equal(result.last_name, 'Lovelace');
});
