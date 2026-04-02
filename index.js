try { require('dotenv').config(); } catch(e) {}
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const API_KEY = process.env.API_KEY || 'beeblast-secret';

// Auth middleware
function auth(req, res, next) {
  const key = req.headers['authorization']?.replace('Bearer ', '');
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Beeblast API', version: '1.0.0' });
});

// ─── Tool 1: Scrape Company Details ─────────────────────────────────────────
app.post('/scrape-company', auth, async (req, res) => {
  const { linkedin_url } = req.body;
  if (!linkedin_url) return res.status(400).json({ error: 'linkedin_url required' });

  try {
    const run = await axios.post(
      `https://api.apify.com/v2/acts/harvestapi~linkedin-company/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60`,
      { companies: [linkedin_url] }
    );
    const data = run.data?.[0] || {};
    res.json({
      name: data.name || null,
      description: data.description || null,
      industry: data.industry || null,
      company_size: data.employeeCount || null,
      website: data.website || null,
      founded: data.founded || null,
      linkedin_url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tool 2: Score Lead (ICP) ────────────────────────────────────────────────
app.post('/score-lead', auth, async (req, res) => {
  const { name, industry, company_size, city, pain_points } = req.body;

  let score = 0;
  let reasons = [];

  // Industry fit
  const goodIndustries = ['real estate', 'makelaars', 'hospitality', 'restaurant', 'retail', 'spa', 'beauty'];
  if (industry && goodIndustries.some(i => industry.toLowerCase().includes(i))) {
    score += 30;
    reasons.push('Industry match');
  }

  // Size fit (sweet spot: 1-25)
  if (company_size) {
    const size = parseInt(company_size);
    if (size >= 1 && size <= 10) { score += 30; reasons.push('Perfect size (1-10)'); }
    else if (size <= 25) { score += 20; reasons.push('Good size (11-25)'); }
    else if (size <= 50) { score += 10; reasons.push('Acceptable size'); }
  }

  // City fit
  if (city && city.toLowerCase().includes('amsterdam')) {
    score += 20;
    reasons.push('Amsterdam (target market)');
  }

  // Pain points
  if (pain_points && pain_points.length > 0) {
    score += 20;
    reasons.push(`Pain points identified: ${pain_points.join(', ')}`);
  }

  const tier = score >= 70 ? 1 : score >= 40 ? 2 : 3;

  res.json({ score, tier, reasons });
});

// ─── Tool 3: Save Company to Supabase ───────────────────────────────────────
app.post('/save-company', auth, async (req, res) => {
  const { name, linkedin_url, website, industry, company_size, city, tier, pain_points, source, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const { data, error } = await supabase
    .from('companies')
    .upsert({
      name, linkedin_url, website, industry, company_size,
      city: city || 'Amsterdam', tier, pain_points, source, notes,
      scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'linkedin_url' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, company: data });
});

// ─── Tool 4: Save Contact to Supabase ───────────────────────────────────────
app.post('/save-contact', auth, async (req, res) => {
  const { company_id, full_name, role, linkedin_url, email, email_confidence, phone, notes } = req.body;

  const { data, error } = await supabase
    .from('contacts')
    .upsert({
      company_id, full_name, role, linkedin_url,
      email, email_confidence, phone, notes,
      updated_at: new Date().toISOString()
    }, { onConflict: 'linkedin_url' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, contact: data });
});

// ─── Tool 5: Get Pipeline (leads list) ──────────────────────────────────────
app.get('/pipeline', auth, async (req, res) => {
  const { tier, stage, limit = 50 } = req.query;

  let query = supabase.from('companies').select(`
    *,
    contacts (id, full_name, role, email, outreach_status, replied)
  `).order('tier', { ascending: true }).limit(parseInt(limit));

  if (tier) query = query.eq('tier', parseInt(tier));
  if (stage) query = query.eq('stage', stage);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ companies: data, total: data.length });
});

// ─── Tool 6: Update Outreach Status ─────────────────────────────────────────
app.patch('/contacts/:id/status', auth, async (req, res) => {
  const { id } = req.params;
  const { outreach_status, replied, notes } = req.body;

  const { data, error } = await supabase
    .from('contacts')
    .update({
      outreach_status,
      replied,
      notes,
      last_contact_date: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, contact: data });
});

// ─── Tool 7: Log Outreach ────────────────────────────────────────────────────
app.post('/outreach-log', auth, async (req, res) => {
  const { contact_id, channel, sequence_step, message_preview } = req.body;
  if (!contact_id) return res.status(400).json({ error: 'contact_id required' });

  const { data, error } = await supabase
    .from('outreach_log')
    .insert({ contact_id, channel, sequence_step, message_preview })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, log: data });
});

// ─── Tool 8: Get Leads Needing Follow-up ────────────────────────────────────
app.get('/followup-due', auth, async (req, res) => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('contacts')
    .select('*, companies(name, tier)')
    .eq('replied', false)
    .in('outreach_status', ['dm_sent', 'email_sent'])
    .lt('last_contact_date', threeDaysAgo);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ contacts: data, total: data.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Beeblast API running on port ${PORT}`));
