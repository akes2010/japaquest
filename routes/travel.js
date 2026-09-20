'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { Q } = require('../db');

// ── AFFILIATE LINK BUILDER ────────────────────────────────────────────────────
function buildAffiliateLinks({ destination, destName, checkIn, checkOut, budget, currency='USD', pax=1 }) {
  const bookingId = process.env.BOOKING_COM_AFFILIATE_ID || Q.getSetting('booking_affiliate_id') || 'jagaguru';
  const skyscanId = process.env.SKYSCANNER_AFFILIATE_ID || Q.getSetting('skyscanner_affiliate_id') || '';
  const carId     = process.env.RENTALCARS_AFFILIATE_ID || Q.getSetting('rentalcars_affiliate_id') || '';
  const gygId     = process.env.GETYOURGUIDE_PARTNER_ID || Q.getSetting('getyourguide_partner_id') || '';
  const hostelId  = process.env.HOSTELWORLD_AFFILIATE_ID || Q.getSetting('hostelworld_affiliate_id') || '';

  const ci = checkIn || '';
  const co = checkOut || '';
  const adults = pax || 1;

  return {
    flights: {
      skyscanner: skyscanId
        ? `https://www.skyscanner.net/transport/flights/anywhere/${destination}/${ci || ''}/?adultsv2=${adults}&ref=${skyscanId}`
        : `https://www.skyscanner.net/transport/flights/anywhere/${destination}/?adultsv2=${adults}`,
      googleFlights: `https://www.google.com/flights?hl=en#search;f=LOS;t=${destination};d=${ci};r=${co};px=${adults};c=e;s=1;sd=1`,
      kiwi: `https://www.kiwi.com/en/search/results/lagos-nigeria/${encodeURIComponent(destName || destination)}/${ci}/${co}?adults=${adults}`,
    },
    hotels: {
      booking: `https://www.booking.com/searchresults.html?aid=${bookingId}&dest_id=${destination}&checkin=${ci}&checkout=${co}&group_adults=${adults}&order=price${budget==='budget'?'&nflt=price%3D0-50':''}`,
      hostelworld: hostelId
        ? `https://www.hostelworld.com/findabed.php/ChosenCity.${encodeURIComponent(destName||destination)}?affiliate=${hostelId}`
        : `https://www.hostelworld.com/findabed.php/ChosenCity.${encodeURIComponent(destName||destination)}`,
      agoda: `https://www.agoda.com/search?city=${encodeURIComponent(destName||destination)}&checkIn=${ci}&checkOut=${co}&adults=${adults}&cid=1891670`,
    },
    cars: {
      rentalcars: carId
        ? `https://www.rentalcars.com/?affiliateCode=${carId}&country=${destination}&puDay=${ci}`
        : `https://www.rentalcars.com/?country=${destination}`,
      discovercars: `https://www.discovercars.com/?a_aid=jagaguru&location=${encodeURIComponent(destName||destination)}&from_date=${ci}&to_date=${co}`,
    },
    activities: {
      viator: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destName||destination)}&pid=P00068893`,
      getyourguide: gygId
        ? `https://www.getyourguide.com/s/?q=${encodeURIComponent(destName||destination)}&partner_id=${gygId}`
        : `https://www.getyourguide.com/s/?q=${encodeURIComponent(destName||destination)}`,
      klook: `https://www.klook.com/en-US/search/?query=${encodeURIComponent(destName||destination)}`,
    },
    insurance: {
      safaraInsurance: `https://www.safara.com/travel-insurance?destination=${encodeURIComponent(destName||destination)}`,
      worldNomads: `https://www.worldnomads.com/travel-insurance?affid=jagaguru&destination=${encodeURIComponent(destName||destination)}`,
    },
  };
}

// GET /api/travel/links — generate affiliate links for a destination
router.get('/links', requireAuth, (req, res) => {
  const { destination, destName, checkIn, checkOut, budget, pax } = req.query;
  if (!destination) return res.status(400).json({ error: 'destination code required' });
  const links = buildAffiliateLinks({ destination, destName, checkIn, checkOut, budget, pax: parseInt(pax)||1 });
  // Log click interest
  Q.logAffiliateClick(req.user.id, 'link-page', 'multi', destName||destination, '');
  res.json({ links, destination, destName });
});

// GET /api/travel/destinations — list all with visa status for user's passport
router.get('/destinations', requireAuth, (req, res) => {
  const user = Q.getUserById(req.user.id);
  const passport = req.query.passport || user?.passport_code || 'NG';
  const purpose  = req.query.purpose || 'Tourism';
  const rules    = Q.getVisaRulesForPassport(passport, purpose);

  const destinations = rules.map(r => ({
    code: r.destination_code,
    name: r.dest_name,
    flag: r.dest_flag,
    region: r.region,
    visaStatus: r.status,
    maxStay: r.max_stay,
    processingDays: r.processing_days,
    fees: JSON.parse(r.fees_json||'{}'),
    conditions: JSON.parse(r.conditions_json||'[]'),
    confidence: r.confidence,
    avgDailyBudget: r.avg_daily_budget_usd,
    bestMonths: r.best_months,
    links: buildAffiliateLinks({ destination: r.destination_code, destName: r.dest_name, budget: 'any' }),
  }));

  res.json({ passport, purpose, destinations });
});

// GET /api/travel/plan — AI-assisted trip plan for a destination
router.get('/plan', requireAuth, (req, res) => {
  const { destination, purpose, budget, days } = req.query;
  if (!destination) return res.status(400).json({ error: 'destination required' });

  const user = Q.getUserById(req.user.id);
  const passport = user?.passport_code || 'NG';
  const visaData = Q.getVisaRule(passport, destination.toUpperCase(), purpose || 'Tourism');
  const destInfo = Q.getDestination(destination);
  const profile  = Q.getTravelProfile(req.user.id);

  const dailyBudget = destInfo?.avg_daily_budget_usd || 80;
  const totalDays = parseInt(days) || 7;
  const estimatedTotal = dailyBudget * totalDays;

  const links = buildAffiliateLinks({
    destination: destination.toUpperCase(),
    destName: destInfo?.name || destination,
    budget: budget || 'mid',
  });

  res.json({
    destination: destInfo,
    passport,
    visa: visaData ? {
      status: visaData.ver?.status,
      maxStay: visaData.ver?.max_stay,
      fees: JSON.parse(visaData.ver?.fees_json || '{}'),
      conditions: JSON.parse(visaData.ver?.conditions_json || '[]'),
      processingDays: visaData.ver?.processing_days,
      confidence: visaData.ver?.confidence,
      source: visaData.ver?.source_authority,
    } : { status: 'needs_verification', conditions: [] },
    budget: {
      estimatedDailyUSD: dailyBudget,
      estimatedTotalUSD: estimatedTotal,
      days: totalDays,
      userBudgetRange: profile ? `$${profile.budget_min_usd}–$${profile.budget_max_usd}` : 'Not set',
    },
    links,
  });
});

// GET /api/travel/visa-free — all visa-free destinations for passport
router.get('/visa-free', requireAuth, (req, res) => {
  const user    = Q.getUserById(req.user.id);
  const passport= req.query.passport || user?.passport_code || 'NG';
  const rules   = Q.getVisaRulesForPassport(passport, 'Tourism');
  const free    = rules.filter(r => r.status === 'visa_free' || r.status === 'voa');
  res.json({ passport, count: free.length, destinations: free.map(r => ({
    code: r.destination_code, name: r.dest_name, flag: r.dest_flag,
    status: r.status, maxStay: r.max_stay,
    region: r.region, avgDailyBudget: r.avg_daily_budget_usd,
    links: buildAffiliateLinks({ destination: r.destination_code, destName: r.dest_name }),
  }))});
});

// GET /api/travel/profile — user travel profile
router.get('/profile', requireAuth, (req, res) => {
  const profile = Q.getTravelProfile(req.user.id);
  res.json({ profile });
});

// PUT /api/travel/profile — update travel profile
router.put('/profile', requireAuth, (req, res) => {
  Q.upsertTravelProfile(req.user.id, req.body);
  res.json({ message: 'Travel profile updated', profile: Q.getTravelProfile(req.user.id) });
});

// POST /api/travel/affiliate-click — log affiliate click
router.post('/affiliate-click', requireAuth, (req, res) => {
  const { partner, linkType, destination, url } = req.body;
  Q.logAffiliateClick(req.user.id, partner, linkType, destination, url);
  res.json({ message: 'Logged' });
});

// GET /api/travel/budget — budget calculator for a trip
router.get('/budget', requireAuth, (req, res) => {
  const { destination, days, style } = req.query;
  const destInfo = destination ? Q.getDestination(destination) : null;
  const base = destInfo?.avg_daily_budget_usd || 80;
  const d = parseInt(days) || 7;
  const multipliers = { backpacker:0.6, budget:0.75, midrange:1.0, comfort:1.5, luxury:2.5 };
  const m = multipliers[style || 'midrange'] || 1.0;

  res.json({
    destination: destInfo,
    days: d,
    style: style || 'midrange',
    breakdown: {
      accommodation: Math.round(base * m * 0.35 * d),
      food:          Math.round(base * m * 0.25 * d),
      transport:     Math.round(base * m * 0.20 * d),
      activities:    Math.round(base * m * 0.10 * d),
      misc:          Math.round(base * m * 0.10 * d),
      total:         Math.round(base * m * d),
    },
    currency: 'USD',
    note: 'Excludes international flights and visa fees',
  });
});

module.exports = router;
