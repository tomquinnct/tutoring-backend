 // =======================
// IMPORTS
// =======================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const session = require('express-session');
const axios = require('axios');

const Session = require('./models/Session');

const app = express();

const { client } = require('./paypalClient');
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

async function verifyPayPalOrder(orderId) {

  const request = new checkoutNodeJssdk.orders.OrdersGetRequest(orderId);

  const response = await client().execute(request);

  return response.result;
}


// =======================
// MIDDLEWARE
// =======================
app.use(express.json());
app.set('trust proxy', 1);

app.use(cors({
  origin: [
    "https://quinnmathtutor.com",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

// =======================
// ROUTES
// =======================

app.get('/', (req, res) => {
  res.send('Server is running');
});

// SESSION BOOTSTRAP
app.get('/api/session', (req, res) => {
  if (!req.session.userId) {
    req.session.userId = crypto.randomUUID();
  }
  res.json({ success: true });
});

// GET SESSIONS (SECURE)
app.get('/sessions', async (req, res) => {
  try {

    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.session.userId;

    let record = await Session.findOne({ userId });

    if (!record) {
      record = await Session.create({
        userId,
        sessionsRemaining: 0
      });
    }

    res.json({ sessions: record.sessionsRemaining });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// VERIFY PAYMENT (PayPal MVP)

app.post('/paypal-webhook', async (req, res) => {

  try {

    const event = req.body;

    console.log("Webhook received:", event.event_type);

    if (event.event_type !== "CHECKOUT.ORDER.APPROVED") {
      return res.sendStatus(200);
    }

    const orderId = event.resource.id;

    // STEP 1: verify with PayPal API
    const order = await verifyPayPalOrder(orderId);

    // STEP 2: extract metadata
    const userId = order.purchase_units?.[0]?.custom_id;
    const amount = order.purchase_units?.[0]?.amount?.value;

    if (!userId) return res.sendStatus(200);

    // STEP 3: compute sessions safely
    let sessionsToAdd = 0;

    if (amount === "2.00") sessionsToAdd = 1;
    if (amount === "75.00") sessionsToAdd = 2;
    if (amount === "350.00") sessionsToAdd = 10;
    if (amount === "650.00") sessionsToAdd = 20;

    // STEP 4: update DB
    let user = await Session.findOne({ userId });

    if (!user) {
      user = new Session({
        userId,
        sessionsRemaining: sessionsToAdd
      });
    } else {
      user.sessionsRemaining += sessionsToAdd;
    }

    await user.save();

    console.log("Sessions credited:", userId);

    res.sendStatus(200);

  } catch (err) {

    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});


app.post("/verify-payment", async (req, res) => {

  try {

    const { tx, packageName } = req.body;

    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let sessionsToAdd =
      packageName.includes("20") ? 20 :
      packageName.includes("10") ? 10 :
      packageName.includes("2") ? 2 : 0;

    let user = await Session.findOne({ userId });

    if (!user) {
      user = new Session({
        userId,
        sessionsRemaining: sessionsToAdd
      });
    } else {
      user.sessionsRemaining += sessionsToAdd;
    }

    await user.save();

    return res.json({
      success: true,
      sessions: user.sessionsRemaining
    });

  } catch (err) {
    console.error("VERIFY ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =======================
// START SERVER
// =======================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));