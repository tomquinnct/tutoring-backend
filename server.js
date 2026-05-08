// =======================
// SERVER.JS (UPDATED)
// FIXED: stable session identity + PayPal auth flow
// =======================

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// =======================
// SESSION MIDDLEWARE
// =======================
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI
  }),
  cookie: {
    secure: true,
    sameSite: "none",
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

// =======================
// SESSION BOOTSTRAP (FIXED)
// =======================
app.get('/api/session', (req, res) => {
  // FIX: stable identity per session (NOT random UUID)
  if (!req.session.userId) {
    req.session.userId = req.session.id;
  }

  res.json({
    success: true,
    userId: req.session.userId
  });
});

// =======================
// AUTH GUARD
// =======================
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    console.log("Unauthorized session:", req.session);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// =======================
// PAYPAL CREATE ORDER
// =======================
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {
  try {
    const { packageId } = req.body;

    console.log("User session:", req.session.userId);

    // TODO: create PayPal order here
    const orderId = "MOCK_ORDER_ID";

    res.json({ orderId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// PAYPAL CAPTURE ORDER
// =======================
app.post('/api/paypal/capture-order', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.body;

    // TODO: verify PayPal capture

    // Example: increment sessions
    // await User.updateOne(...)

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = app;
