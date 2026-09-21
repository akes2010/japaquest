'use strict';
/**
 * Crypto / stablecoin gateway — manual confirmation flow.
 *
 * Operator stores receiving addresses (USDT/USDC/BTC/ETH) in Admin → Payment
 * Gateways. Traveller picks a coin, sees the address + amount, sends, then
 * submits the tx hash; an admin (or a future API integration) confirms it in
 * Admin → Payments. Kept manual deliberately: no third-party processor sees
 * the funds and there is no key to leak.
 */
const { cfg } = require('../base');

const COINS = [
  { id: 'usdt_trc20', label: 'USDT (TRC-20)', addrField: 'addr_usdt_trc20', confirmations: 19 },
  { id: 'usdt_erc20', label: 'USDT (ERC-20)', addrField: 'addr_usdt_erc20', confirmations: 12 },
  { id: 'usdc', label: 'USDC (ERC-20)', addrField: 'addr_usdc', confirmations: 12 },
  { id: 'btc', label: 'Bitcoin', addrField: 'addr_btc', confirmations: 2 },
  { id: 'eth', label: 'Ethereum', addrField: 'addr_eth', confirmations: 12 },
];

module.exports = {
  key: 'crypto',
  displayName: 'Crypto (USDT/USDC/BTC/ETH)',
  docsUrl: '',
  manual: true,
  fields: [
    ['addr_usdt_trc20', 'USDT TRC-20 receiving address', false],
    ['addr_usdt_erc20', 'USDT ERC-20 receiving address', false],
    ['addr_usdc', 'USDC receiving address', false],
    ['addr_btc', 'BTC receiving address', false],
    ['addr_eth', 'ETH receiving address', false],
  ],
  envMap: {},
  isConfigured() { return COINS.some(c => cfg('crypto', c.addrField)); },
  coins: COINS,
  currencies: ['USD'],

  // Returns payment instructions instead of a redirect URL.
  async createCheckout({ coinId, amountUsd, reference }) {
    const coin = COINS.find(c => c.id === coinId) || COINS[0];
    const addr = cfg('crypto', coin.addrField);
    if (!addr) throw new Error(`${coin.label} address not configured`);
    return {
      instructions: {
        coin: coin.id, coinLabel: coin.label,
        address: addr,
        amountUsd,
        reference,
        note: `Send ≈ $${amountUsd} in ${coin.label} to this address, then submit the transaction hash. Confirmation usually takes ${coin.confirmations} network confirmations.`,
      },
    };
  },
  verifyWebhook() { return false; }, // no webhooks — admin confirms manually
  parseWebhook() { return null; },
};
