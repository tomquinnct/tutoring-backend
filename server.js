// =======================
// IMPORTS
// =======================
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const session = require('express-session');

const MongoStore = require('connect-mongo').default;
const axios = require('axios');

// YOUR MODELS
const Payment = require('./models/Payment');
const SessionModel = require('./models/Session');

// =======================
// TEST ONLY
// =======================
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('🔥 UNHANDLED REJECTION:', err);
});
console.log("MONGO:", process.env.MONGODB_URI ? "exists" : "MISSING");
console.log("SESSION:", process.env.SESSION_SECRET ? "exists" : "MISSING");
// =======================
// =======================



// =======================
// EXPRESS APP
// =======================
const app = express();

// =======================
// TRUST PROXY (IMPORTANT FOR RENDER)
// =======================
app.set('trust proxy', 1);

// =======================
// MIDDLEWARE
// =======================
app.use(express.json());

// =======================
// CORS
// =======================
app.use(cors({
  origin: [
    'https://quinnmathtutor.com',
    'https://www.quinnmathtutor.com'
  ],
  credentials: true
}));

// =======================
// ROOT ROUTE
// =======================
app.get('/', (req, res) => {
  res.send('Server is running');
});

// =======================
// SESSION BOOTSTRAP ROUTE
// =======================
app.get('/api/session', (req, res) => {

  // FIXED:
  // Stable identity tied to session cookie
  // (NOT random UUID)
  if (!req.session.userId) {
    req.session.userId = req.session.id;
  }

  console.log('SESSION INITIALIZED:', req.session.userId);

  res.json({
    success: true,
    userId: req.session.userId
  });
});

// =======================
// AUTH MIDDLEWARE
// =======================
function requireAuth(req, res, next) {

  console.log('SESSION:', req.session);
  console.log('USER ID:', req.session?.userId);

  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  next();
}

// =======================
// PAYPAL ACCESS TOKEN
// =======================
async function generateAccessToken() {

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');

  const response = await axios({
    url: 'https://api-m.paypal.com/v1/oauth2/token',
    method: 'post',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en_US',
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: 'grant_type=client_credentials'
  });

  return response.data.access_token;
}

// =======================
// PACKAGE CONFIG
// =======================
const packages = {
  test: {
    value: '2.00',
    sessions: 2
  },
  two: {
    value: '75.00',
    sessions: 2
  },
  ten: {
    value: '350.00',
    sessions: 10
  },
  twenty: {
    value: '650.00',
    sessions: 20
  }
};

// =======================
// CREATE PAYPAL ORDER
// =======================
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {

  try {

    const { packageId } = req.body;

    const selectedPackage = packages[packageId];

    if (!selectedPackage) {
      return res.status(400).json({
        error: 'Invalid package selected'
      });
    }

    const accessToken = await generateAccessToken();

    const response = await axios({
      url: 'https://api-m.paypal.com/v2/checkout/orders',
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      data: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: 'USD',
              value: selectedPackage.value
            }
          }
        ]
      }
    });

    console.log('PAYPAL ORDER CREATED:', response.data.id);

    res.json({
      orderId: response.data.id
    });

  } catch (err) {

    console.error('CREATE ORDER ERROR:', err.response?.data || err.message);

    res.status(500).json({
      error: 'Failed to create PayPal order'
    });
  }
});

// =======================
// CAPTURE PAYPAL ORDER
// =======================
app.post('/api/paypal/capture-order', requireAuth, async (req, res) => {

  try {

    const { orderId } = req.body;

    // =======================
    // DUPLICATE PAYMENT PROTECTION
    // =======================
    const existingPayment = await Payment.findOne({
      orderId
    });

    if (existingPayment) {

      console.log('Duplicate payment prevented:', orderId);

      return res.json({
        success: true,
        duplicate: true,
        message: 'Payment already processed'
      });
    }

    // =======================
    // PAYPAL CAPTURE
    // =======================
    const accessToken = await generateAccessToken();

    const response = await axios({
      url: `https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`,
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });

    const captureData = response.data;

    console.log('CAPTURE SUCCESS:', captureData.id);

    // =======================
    // DETERMINE PACKAGE VALUE
    // =======================
    const amountPaid = captureData.purchase_units[0].payments
      .captures[0].amount.value;

    let sessionsToAdd = 0;

    if (amountPaid === '2.00') sessionsToAdd = 2;
    if (amountPaid === '75.00') sessionsToAdd = 2;
    if (amountPaid === '350.00') sessionsToAdd = 10;
    if (amountPaid === '650.00') sessionsToAdd = 20;

    // =======================
    // SAVE PAYMENT RECORD
    // =======================
    await Payment.create({
      userId: req.session.userId,
      orderId,
      amount: amountPaid,
      sessionsAdded: sessionsToAdd,
      paypalData: captureData
    });

    // =======================
    // UPDATE USER SESSION COUNT
    // =======================
    let sessionRecord = await SessionModel.findOne({
      userId: req.session.userId
    });

    if (!sessionRecord) {
      sessionRecord = new SessionModel({
        userId: req.session.userId,
        sessions: 0
      });
    }

    sessionRecord.sessions += sessionsToAdd;

    await sessionRecord.save();

    console.log('Sessions updated:', sessionRecord.sessions);

    res.json({
      success: true,
      sessions: sessionRecord.sessions
    });

  } catch (err) {

    console.error('CAPTURE ERROR:', err.response?.data || err.message);

    res.status(500).json({
      error: 'Payment capture failed'
    });
  }
});

// =======================
// GET REMAINING SESSIONS
// =======================
app.get('/sessions', requireAuth, async (req, res) => {

  try {

    let sessionRecord = await SessionModel.findOne({
      userId: req.session.userId
    });

    if (!sessionRecord) {
      sessionRecord = {
        sessions: 0
      };
    }

    res.json({
      sessions: sessionRecord.sessions
    });

  } catch (err) {

    console.error('SESSION FETCH ERROR:', err);

    res.status(500).json({
      error: 'Failed to load sessions'
    });
  }
});

// =======================
// MONGODB + SERVER START
// =======================

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");

    // =======================
    // SESSION STORE (SAFE PLACE)
    // =======================
    app.use(session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI
      }),
      cookie: {
        secure: true,
        httpOnly: true,
        sameSite: 'none'
      }
    }));

    // =======================
    // START SERVER (CRITICAL)
    // =======================
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });
  
  