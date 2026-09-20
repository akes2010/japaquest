'use strict';
/**
 * Grounds AI answers in the actual verified visa_rules database.
 * Deterministic text matching — no extra AI call for entity extraction.
 */
const { Q } = require('../db');

const DEMONYMS = {
  NG:['nigerian','nigerians'],GH:['ghanaian','ghanaians'],
  KE:['kenyan','kenyans'],ZA:['south african','south africans'],
  ET:['ethiopian'],CM:['cameroonian'],TZ:['tanzanian'],
  UG:['ugandan'],SN:['senegalese'],
};
const PURPOSE_PATTERNS = [
  [/\btransit(ing)?\b/i,'Transit'],
  [/\bstud(y|ies|ent|ying)\b/i,'Study'],
  [/\bwork(ing)?\s*(visa|permit)?|\bjob\b|\bemploy/i,'Work'],
  [/\bbusiness\b/i,'Business'],
  [/\bfamily\b|\brelative\b/i,'Family Visit'],
];

function containsWord(hay,needle){
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(hay);
}

function extractIntent(text) {
  const low = text.toLowerCase();
  const passports = Q.getPassports();
  const destinations = Q.getDestinations();

  // Find passport from demonym
  let passportCode = null;
  for (const [code,demonyms] of Object.entries(DEMONYMS)) {
    if (demonyms.some(d => containsWord(low,d))) { passportCode = code; break; }
  }

  // Find destination from country name (word-boundary match)
  const destCandidates = destinations.filter(d =>
    containsWord(low, d.name.toLowerCase()) &&
    d.code !== passportCode
  );
  const destinationCode = destCandidates.length === 1 ? destCandidates[0].code : null;

  // Purpose detection
  let purpose = 'Tourism';
  for (const [pattern,label] of PURPOSE_PATTERNS) {
    if (pattern.test(text)) { purpose = label; break; }
  }

  return { passportCode, destinationCode, purpose };
}

function lookupGroundingFacts(passportCode, destinationCode, purpose) {
  if (!passportCode || !destinationCode) return null;
  return Q.getVisaRule(passportCode, destinationCode, purpose);
}

function buildGroundedSystemPrompt(baseSystem, groundingData, travelProfile) {
  let extra = '';

  if (groundingData && groundingData.ver) {
    const { rule, ver } = groundingData;
    const conditions = JSON.parse(ver.conditions_json || '[]');
    const fees = JSON.parse(ver.fees_json || '{}');
    extra += `\n\n══ VERIFIED VISA DATABASE RECORD ══
Passport: ${rule.passport_code} → Destination: ${rule.destination_code} (${rule.purpose})
Status: ${ver.status.toUpperCase().replace(/_/g,' ')}
Max Stay: ${ver.max_stay || 'Not specified'}
Processing: ${ver.processing_days || 'Varies'}
Fees: ${fees.amount || 'Varies'}
Requirements: ${conditions.map((c,i)=>`${i+1}. ${c}`).join(' | ')}
Source: ${ver.source_authority} (Tier ${ver.source_tier} — ${ver.confidence})
Last verified: ${ver.verified_at}
Official URL: ${ver.official_url || 'See embassy website'}
══ END DATABASE RECORD ══

CRITICAL: Base your answer PRIMARILY on the database record above. Do not contradict it.
If the record says "needs_verification", say so honestly — never invent requirements.`;
  }

  if (travelProfile) {
    extra += `\n\nUSER TRAVEL PROFILE:
Budget: $${travelProfile.budget_min_usd}–$${travelProfile.budget_max_usd}/trip (${travelProfile.budget_label})
Travel style: ${travelProfile.travel_style}
Departure: ${travelProfile.departure_country}
Interests: ${travelProfile.interests ? JSON.parse(travelProfile.interests).join(', ') : 'General travel'}`;
  }

  return baseSystem + extra;
}

module.exports = { extractIntent, lookupGroundingFacts, buildGroundedSystemPrompt };
