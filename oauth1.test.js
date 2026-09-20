'use strict';
/** Verifies utils/oauth1.js against Twitter's official signing test vector.
 *  Run: node oauth1.test.js  */
const { oauth1Header } = require('./utils/oauth1');

// https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
const { header } = oauth1Header({
  method: 'POST',
  // NOTE: the documented example base string uses the /1/ path (not /1.1/)
  url: 'https://api.twitter.com/1/statuses/update.json',
  params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!', include_entities: 'true' },
  consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
  consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
  timestamp: '1318622958',
});

const expectedSig = 'tnnArxj06cWHq44gCs1OSKk%2FjLY%3D'; // official SHA-1 example
if (header.includes(expectedSig)) {
  console.log('✅ OAuth 1.0a signature matches the official Twitter test vector');
  // Also sanity-check SHA-256 mode produces a well-formed header
  const h256 = oauth1Header({
    method: 'POST',
    url: 'https://api.twitter.com/2/tweets',
    params: { text: 'x' },
    consumerKey: 'k', consumerSecret: 'cs', accessToken: 't', tokenSecret: 'ts',
    algorithm: 'HMAC-SHA256', nonce: 'n', timestamp: '1',
  });
  if (h256.header.includes('oauth_signature_method="HMAC-SHA256"')) {
    console.log('✅ HMAC-SHA256 mode OK');
    process.exit(0);
  }
  process.exit(1);
} else {
  console.error('❌ Signature mismatch\n  header:', header);
  process.exit(1);
}
