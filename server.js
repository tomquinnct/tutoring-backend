 // =======================
// IMPORTS
// =======================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const session = require('express-session');
const axios = require('axios');
const Payment = require('./models/Payment');
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


// =======================
// CREATE PACHAGES 
// =======================

const PACKAGES = {
  test: {
    name: "2 Half Hour TEST Session",
    amount: "2.00",
    sessions: 2
  },
  two: {
    name: "2 Half Hour Sessions",
    amount: "75.00",
    sessions: 2
  },
  ten: {
    name: "10 Half Hour Sessions",
    amount: "350.00",
    sessions: 10
  },
  twenty: {
    name: "20 Half Hour Sessions",
    amount: "650.00",
    sessions: 20
  }
};


// =======================
// CREATE ORDER 
// =======================

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { packageId } = req.body;
    const selectedPackage = PACKAGES[packageId];

    if (!selectedPackage) {
      return res.status(400).json({ error: "Invalid package" });
    }

    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();

    request.prefer("return=representation");

    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: req.session.userId,
          description: selectedPackage.name,
          amount: {
            currency_code: "USD",
            value: selectedPackage.amount
          }
        }
      ]
    });

    const order = await client().execute(request);

    res.json({ orderId: order.result.id });

  } catch (err) {
    console.error("CREATE ORDER ERROR:", err);
    res.status(500).json({ error: "Could not create PayPal order" });
  }
});


// =======================
// CAPTURE ORDER 
// =======================

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await client().execute(request);
    const result = capture.result;

    if (result.status !== "COMPLETED") {
      return res.status(400).json({ error: "Payment not completed" });
    }

    const purchaseUnit = result.purchase_units?.[0];
    const capturedPayment = purchaseUnit?.payments?.captures?.[0];

    const userId = purchaseUnit?.custom_id;
    const amount = capturedPayment?.amount?.value;
    const captureId = capturedPayment?.id;

    const existingPayment = await Payment.findOne({
  $or: [
    { paypalOrderId: orderId },
    { paypalCaptureId: captureId }
  ]
});

if (existingPayment) {
  const existingUser = await Session.findOne({ userId });

  return res.json({
    success: true,
    duplicate: true,
    sessions: existingUser ? existingUser.sessionsRemaining : 0,
    message: "Payment was already processed."
  });
}


    if (!userId || userId !== req.session.userId) {
      return res.status(400).json({ error: "User mismatch" });
    }

    let sessionsToAdd = 0;

    for (const pkg of Object.values(PACKAGES)) {
      if (pkg.amount === amount) {
        sessionsToAdd = pkg.sessions;
        break;
      }
    }

    if (!sessionsToAdd) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

     await Payment.create({
       userId,
       paypalOrderId: orderId,
       paypalCaptureId: captureId,
       amount,
       sessionsAdded: sessionsToAdd,
       status: result.status
     });

     const updatedUser = await Session.findOneAndUpdate(
       { userId },
       { $inc: { sessionsRemaining: sessionsToAdd } },
       { upsert: true, new: true }
     );
     
    res.json({
      success: true,
      sessions: updatedUser.sessionsRemaining,
      captureId
    });

  } catch (err) {
    console.error("CAPTURE ORDER ERROR:", err);
    res.status(500).json({ error: "Could not capture PayPal order" });
  }
});



// =======================
// START SERVER
// =======================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));