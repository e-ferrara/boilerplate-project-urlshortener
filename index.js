// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dns = require('dns');
const { URL } = require('url');

require('dotenv').config();

const app = express();

// Basic middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// CORS/headers for FCC testing environment (optional)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Connect to MongoDB
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/urlshortener';
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schemas
const urlSchema = new mongoose.Schema({
  original_url: { type: String, required: true },
  short_url: { type: Number, required: true, unique: true }
});

const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 }
});

const URLModel = mongoose.model('URL', urlSchema);
const Counter = mongoose.model('Counter', counterSchema);

// Helper to get next sequence number (atomic)
async function getNextSequence(name) {
  const ret = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return ret.seq;
}

// Routes
app.get('/', (req, res) => {
  res.send('URL Shortener Microservice - POST /api/shorturl');
});

// POST to create a short url
app.post('/api/shorturl', async (req, res) => {
  const originalUrl = req.body.url || req.body.original_url;
  if (!originalUrl) return res.json({ error: 'invalid url' });

  // Validate format using URL constructor
  let parsed;
  try {
    parsed = new URL(originalUrl);
  } catch (err) {
    return res.json({ error: 'invalid url' });
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.json({ error: 'invalid url' });
  }

  // DNS lookup to ensure hostname resolves
  dns.lookup(parsed.hostname, async (dnsErr) => {
    if (dnsErr) return res.json({ error: 'invalid url' });

    try {
      // If URL already saved, return it
      const existing = await URLModel.findOne({ original_url: originalUrl }).exec();
      if (existing) {
        return res.json({
          original_url: existing.original_url,
          short_url: existing.short_url
        });
      }

      // Get next short number
      const next = await getNextSequence('url_count');

      const doc = new URLModel({
        original_url: originalUrl,
        short_url: next
      });

      await doc.save();

      return res.json({
        original_url: doc.original_url,
        short_url: doc.short_url
      });
    } catch (e) {
      console.error('DB save error:', e);
      return res.status(500).json({ error: 'server error' });
    }
  });
});

// GET to redirect
app.get('/api/shorturl/:short', async (req, res) => {
  const short = Number(req.params.short);
  if (Number.isNaN(short)) return res.json({ error: 'No short URL found for the given input' });

  try {
    const doc = await URLModel.findOne({ short_url: short }).exec();
    if (!doc) return res.json({ error: 'No short URL found for the given input' });

    // Redirect to original URL
    return res.redirect(doc.original_url);
  } catch (e) {
    console.error('DB lookup error:', e);
    return res.status(500).json({ error: 'server error' });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
