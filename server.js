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

// MODELS
const Payment = require('./models/Payment');
const SessionModel = require('./models/Session');

// =======================
// PROCESS ERROR HANDLERS
// =======================
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('🔥 UNHANDLED REJECTION:', err);
});

// =======================
// EXPRESS APP
// =======================
const app = express();

app.set('trust proxy', 1);

// =======================
// MIDDLEWARE
// =======================
app.use(express.json());

app.use(cors({
  origin: [
    'https://quinnmathtutor.com',
    'https://www.quinnmathtutor.com'
  ],
  credentials: true
}));

// =======================
// SESSION MIDDLEWARE (CRITICAL FIX)
// MUST BE BEFORE ROUTES
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
    httpOnly: true,
    sameSite: 'none',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

// =======================
// DEBUG ENV
// =======================
console.log("MONGO:", process.env.MONGO_URI ? "exists" : "MISSING");
console.log("SESSION:", process.env.SESSION_SECRET ? "exists" : "MISSING");

// =======================
// ROOT ROUTE
// =======================
app.get('/', (req, res) => {
  res.send('Server is running');
});

// =======================
// SESSION ROUTE (FIXED)
// =======================

app.get('/api/session', (req, res) => {

  if (!req.session.userId) {
    req.session.userId = crypto.randomUUID();
  }

  req.session.save(() => {
    console.log('SESSION INITIALIZED:', req.session.userId);

    res.json({
      success: true,
      userId: req.session.userId
    });
  });
});

// =======================
// PREPARE BOOKING
// =======================

app.post('/api/prepare-booking', requireAuth, async (req, res) => {

  try {

    const sessionRecord = await SessionModel.findOne({
      userId: req.session.userId
    });

    if (!sessionRecord) {
      return res.status(404).json({ error: "No session record" });
    }

    // check available balance
    const available = sessionRecord.sessions - sessionRecord.heldSessions;

    if (available <= 0) {
      return res.status(400).json({
        error: "No available sessions to book"
      });
    }

    // OPTIONAL: prevent rapid double-click spam (short lock)
    sessionRecord.bookingLock = {
      active: true,
      expiresAt: new Date(Date.now() + 60 * 1000) // 1 min lock
    };

    sessionRecord.heldSessions += 1;

    await sessionRecord.save();

    console.log("BOOKING HELD:", sessionRecord.userId);

    res.json({
      success: true,
      redirectUrl: "https://calendly.com/mathtutor-tomquinn/30min"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Booking failed" });
  }
});



// =======================
// AUTH MIDDLEWARE
// =======================
function requireAuth(req, res, next) {

  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// =======================
// PAYPAL ACCESS TOKEN
// =======================
async function generateAccessToken() {

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
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
// PACKAGES
// =======================
const packages = {
  test: { value: '2.00', sessions: 2 },
  two: { value: '75.00', sessions: 2 },
  ten: { value: '350.00', sessions: 10 },
  twenty: { value: '650.00', sessions: 20 }
};

// =======================
// CREATE ORDER
// =======================
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {

  try {

    const { packageId } = req.body;
    const selectedPackage = packages[packageId];

    if (!selectedPackage) {
      return res.status(400).json({ error: 'Invalid package selected' });
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

    res.json({ orderId: response.data.id });

  } catch (err) {
    console.error('CREATE ORDER ERROR:', err.response?.data || err.message);

    res.status(500).json({
      error: 'Failed to create PayPal order'
    });
  }
});

// =======================
// CAPTURE ORDER
// =======================
app.post('/api/paypal/capture-order', requireAuth, async (req, res) => {

  try {

    const { orderId } = req.body;

    const existingPayment = await Payment.findOne({ orderId });

    if (existingPayment) {
      return res.json({
        success: true,
        duplicate: true,
        message: 'Payment already processed'
      });
    }

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

    const amountPaid =
      captureData.purchase_units[0].payments.captures[0].amount.value;

    const amountNumber = Number(amountPaid);

    let sessionsToAdd = 0;

    if (amountNumber === 2) sessionsToAdd = 2;
    if (amountNumber === 75) sessionsToAdd = 2;
    if (amountNumber === 350) sessionsToAdd = 10;
    if (amountNumber === 650) sessionsToAdd = 20;

    console.log("AMOUNT PAID:", amountPaid);
    console.log("SESSIONS TO ADD:", sessionsToAdd);

await Payment.create({
  userId: req.session.userId,
  paypalOrderId: orderId,
  paypalCaptureId: captureData.id,
  status: captureData.status,
  amount: amountPaid,
  sessionsAdded: sessionsToAdd,
  paypalData: captureData
});

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

    console.log("BEFORE SAVE:", sessionRecord);

    await sessionRecord.save();
    
    console.log("AFTER SAVE:", sessionRecord);

  req.session.save(() => {
   res.json({
    success: true,
    sessions: sessionRecord.sessions,
    sessionsAdded: sessionsToAdd,
    status: captureData.status
   });
 });  

} catch (err) {

  console.error("🔥 PAYPAL CREATE ORDER FAILED FULL ERROR:");
  console.error("STATUS:", err.response?.status);
  console.error("DATA:", err.response?.data);
  console.error("MESSAGE:", err.message);

  return res.status(500).json({
    error: err.response?.data || err.message
    });
  } 
});

// =======================
// GET SESSIONS
// =======================

app.get('/sessions', requireAuth, async (req, res) => {

  try {

    const sessionRecord = await SessionModel.findOne({
      userId: req.session.userId
    });

    const sessions = sessionRecord?.sessions ?? 0;
    const held = sessionRecord?.heldSessions ?? 0;

    res.json({
      sessions,
      heldSessions: held,
      available: sessions - held
    });

  } catch (err) {
    res.status(500).json({
      error: "Failed to load sessions"
    });
  }
});

// =======================
// CONFIRM BOOKING (FINALIZE HELD SESSION)
// =======================

app.post('/api/confirm-booking', requireAuth, async (req, res) => {

  try {

    const sessionRecord = await SessionModel.findOne({
      userId: req.session.userId
    });

    if (!sessionRecord) {
      return res.status(404).json({ error: "Not found" });
    }

    // remove held session
    if (sessionRecord.heldSessions > 0) {
      sessionRecord.heldSessions -= 1;
      sessionRecord.sessions -= 1;
    }

    // clear lock
    sessionRecord.bookingLock = {
      active: false,
      expiresAt: null
    };

    await sessionRecord.save();

    console.log("BOOKING CONFIRMED:", sessionRecord.userId);

    res.json({
      success: true,
      remaining: sessionRecord.sessions - sessionRecord.heldSessions
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Confirm failed" });
  }
});

// =======================
// PREPARE BOOKING
// =======================

app.post('/api/prepare-booking', requireAuth, async (req, res) => {
  try {

    const updated = await SessionModel.findOneAndUpdate(
      {
        userId: req.session.userId,
        sessions: { $gt: 0 }
      },
      {
        $inc: { sessions: -1 }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(403).json({
        error: "No sessions remaining"
      });
    }

    return res.json({
      success: true,
      sessionsRemaining: updated.sessions,
      redirectUrl: "https://calendly.com/mathtutor-tomquinn/30min"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Booking failed" });
  }
});

// =======================
// CLEANUP TIMER (STEP 4)
// =======================

setInterval(async () => {
  try {

    const expiryTime = new Date(Date.now() - 10 * 60 * 1000);

    const expired = await SessionModel.find({
      heldSessions: { $gt: 0 },
      updatedAt: { $lt: expiryTime }
    });

    for (const record of expired) {

      record.sessions += record.heldSessions;
      record.heldSessions = 0;

      await record.save();

      console.log("AUTO-REFUND SESSION:", record.userId);
    }

  } catch (err) {
    console.error("CLEANUP ERROR:", err);
  }

}, 60 * 1000); // runs every 1 minute


// =======================
// DATABASE CONNECTION
// =======================

mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("MongoDB connected");
    // =======================
    // START SERVER
    // =======================
    const PORT = process.env.PORT || 3000;
     
    app.listen(PORT, () => {
      console.log("🚀 Server running on port", PORT);
    });

  })
  .catch(err => console.error("MongoDB connection error:", err));
  
  



  