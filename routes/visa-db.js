'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { Q } = require('../db');

// GET /api/visa/check?passport=NG&destination=GB&purpose=Tourism
router.get('/check', requireAuth, (req, res) => {
  const { passport, destination, purpose='Tourism' } = req.query;
  if (!passport||!destination) return res.status(400).json({error:'passport and destination required'});
  const data = Q.getVisaRule(passport.toUpperCase(), destination.toUpperCase(), purpose);
  if (!data) return res.json({
    passport, destination, purpose,
    status:'needs_verification', confidence:'unverified',
    note:'No verified record yet. Always confirm with official embassy.',
  });
  const {rule,ver} = data;
  if (!ver) return res.json({
    passport: rule.passport_code, destination: rule.destination_code, purpose: rule.purpose,
    status:'needs_verification', confidence:'unverified',
    note:'Rule exists but has no verified version yet. Always confirm with official embassy.',
  });
  res.json({
    passport: rule.passport_code, destination: rule.destination_code, purpose: rule.purpose,
    status: ver.status, maxStay: ver.max_stay,
    conditions: JSON.parse(ver.conditions_json||'[]'),
    fees: JSON.parse(ver.fees_json||'{}'),
    processingDays: ver.processing_days,
    applicationMethod: ver.application_method,
    officialUrl: ver.official_url,
    source: { authority:ver.source_authority, tier:ver.source_tier },
    confidence: ver.confidence, lastVerified: ver.verified_at,
    effectiveFrom: ver.effective_from,
  });
});

// GET /api/visa/destinations?passport=NG&purpose=Tourism — public (landing page preview)
router.get('/destinations', (req,res) => {
  const user = req.user ? Q.getUserById(req.user.id) : null;
  const passport = (req.query.passport || user?.passport_code || 'NG').toUpperCase();
  const purpose  = req.query.purpose || 'Tourism';
  const rules = Q.getVisaRulesForPassport(passport, purpose);
  res.json({ passport, purpose, count:rules.length, destinations: rules.map(r=>({
    code:r.destination_code, name:r.dest_name, flag:r.dest_flag, region:r.region,
    status:r.status, maxStay:r.max_stay, processingDays:r.processing_days,
    fees:JSON.parse(r.fees_json||'{}'), confidence:r.confidence,
    avgDailyBudgetUSD:r.avg_daily_budget_usd, bestMonths:r.best_months,
  }))});
});

// GET /api/visa/passports
router.get('/passports', (req,res) => res.json({passports:Q.getPassports()}));

// GET /api/visa/all-destinations
router.get('/all-destinations', (req,res) => res.json({destinations:Q.getDestinations()}));

module.exports = router;
