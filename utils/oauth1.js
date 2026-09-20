'use strict';
/**
 * Minimal OAuth 1.0a request signer for the X (Twitter) API.
 * Default HMAC-SHA1, verified against Twitter's official signing example
 * (POST https://api.twitter.com/1.1/statuses/update.json →
 *  tnnArxj06cWHq44gCs1OSKk/jLY=) — see oauth1.test.js. HMAC-SHA256 is
 *  also supported via the `algorithm` option (X accepts both).
 */
const crypto = require('crypto');

function rfc3986(str) {
  return encodeURIComponent(String(str)).replace(
    /[!'()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Build the Authorization header for an OAuth 1.0a signed request.
 * @param {object} opts
 * @param {string} opts.method        HTTP method (POST, GET…)
 * @param {string} opts.url           Absolute URL, WITHOUT query string
 * @param {object} [opts.params]      Query + body form parameters (optional)
 * @param {string} opts.consumerKey
 * @param {string} opts.consumerSecret
 * @param {string} opts.accessToken
 * @param {string} opts.tokenSecret
 * @param {string} [nonce]
 * @param {number|string} [timestamp]
 * @param {string} [algorithm] 'HMAC-SHA1' (default) or 'HMAC-SHA256'
 * @returns {{header: string, nonce: string, timestamp: string}}
 */
function oauth1Header(opts) {
  const {
    method, url, params = {},
    consumerKey, consumerSecret, accessToken, tokenSecret,
    nonce = crypto.randomBytes(16).toString('hex'),
    timestamp = Math.floor(Date.now() / 1000).toString(),
    algorithm = 'HMAC-SHA1',
  } = opts;

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: algorithm,
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // Signature base = ALL params (oauth + query + body-form), sorted, encoded
  const all = { ...params, ...oauthParams };
  const baseStr = [
    method.toUpperCase(),
    rfc3986(url),
    rfc3986(
      Object.keys(all).sort()
        .map(k => `${rfc3986(k)}=${rfc3986(all[k])}`)
        .join('&')
    ),
  ].join('&');

  const signingKey = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`;
  const hmacAlgo = algorithm === 'HMAC-SHA256' ? 'sha256' : 'sha1';
  const sig = crypto.createHmac(hmacAlgo, signingKey).update(baseStr).digest('base64');
  oauthParams.oauth_signature = sig;

  const header = 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${rfc3986(k)}="${rfc3986(oauthParams[k])}"`)
    .join(', ');

  return { header, nonce, timestamp };
}

module.exports = { oauth1Header, rfc3986 };
