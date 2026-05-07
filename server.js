 // =======================
// IMPORTS
// =======================

require("dotenv").config(); // 👈 MUST be first

if (!process.env.MONGO_URI) {
  throw new Error("MONGO_URI is missing");
}

console.log("🔥 SERVER FILE IS RUNNING");
console.log("ENV TEST:", process.env.MONGO_URI);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const session = require('express-session');
const axios = require('axios');
const Payment = require('./models/Payment');
const Session = require('./models/Session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');

const app = express();

const { client } = require('./paypalClient');

const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

// =======================
// MIDDLEWARE
// =======================
app.use(express.json());

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

app.set('trust proxy', 1);

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
// console.log("MONGO_URI:", process.env.MONGO_URI);
// console.log("SESSION_SECRET:", process.env.SESSION_SECRET);
// =======================

 if (!process.env.MONGO_URI) {
  throw new Error("MONGO_URI is missing in .env");
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is missing");
}

// =========================
// Create a limiter (Global)
// =========================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes

  max: 100, // limit each IP to 100 requests per window

  message: {
    error: "Too many requests. Please try again later."
  },

  standardHeaders: true,
  legacyHeaders: false
});

   app.use(limiter);
   
// ===========================
// Create a limiter (Payments)
// ===========================
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many payment attempts"
  }
});

app.use('/api/paypal', paymentLimiter);


// =======================
// SPIN UP MONGO 
// =======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("Mongo connected");

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

  })
  .catch(err => {
    console.error("Mongo connection error:", err);
    process.exit(1);
  });
 
// =======================
// ROUTES
// =======================

console.log("CREATE ORDER HIT");

app.get('/', (req, res) => {
  res.send('Server is running');
});

// =======================
// DB TEST ROUTE 
// =======================
app.get("/db-test", async (req, res) => {
  try {
    const result = await mongoose.connection.db.admin().ping();
    res.json({
      success: true,
      message: "Mongo is connected and responding",
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Mongo is NOT responding",
      error: error.message
    });
  }
});
// =======================
// END OF DB TEST ROUTE 
// =======================

// =======================
// SESSION BOOTSTRAP
// =======================

app.get('/api/session', (req, res) => {
  if (!req.session.userId) {
    req.session.userId = crypto.randomUUID();
  }
  res.json({ success: true });
});



// =======================
// GET SESSIONS (SECURE)
// =======================

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
// CREATE PACKAGES 
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
          custom_id: req.session.userId, // 👈 critical
          description: selectedPackage.name,
          amount: {
            currency_code: "USD",
            value: selectedPackage.amount
          }
        }
      ]
    });

    const order = await client().execute(request);

    return res.json({ id: order.result.id });

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

    // =======================
    // VALIDATE INPUT
    // =======================

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        error: "Missing orderId"
      });
    }

    // =======================
    // CAPTURE PAYPAL ORDER
    // =======================

    const request =
      new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderId);

    request.requestBody({});

    const capture = await client().execute(request);

    const result = capture.result;

    // =======================
    // VERIFY PAYPAL RESPONSE
    // =======================

    if (!result || result.status !== "COMPLETED") {
      return res.status(400).json({
        error: "Payment not completed"
      });
    }

    // =======================
    // EXTRACT PAYPAL DATA
    // =======================

    const purchaseUnit = result.purchase_units?.[0];

    if (!purchaseUnit) {
      return res.status(400).json({
        error: "Missing purchase unit"
      });
    }

    const capturedPayment =
      purchaseUnit.payments?.captures?.[0];

    if (!capturedPayment) {
      return res.status(400).json({
        error: "Missing capture details"
      });
    }

    // =======================
    // PAYPAL SOURCE OF TRUTH
    // =======================

    const paypalUserId = purchaseUnit.custom_id;

    if (!paypalUserId) {
      return res.status(400).json({
        error: "Missing PayPal custom_id"
      });
    }

    // =======================
    // SESSION FALLBACK
    // =======================

    const sessionUserId = req.session?.userId;

    // If session exists, verify it matches PayPal
    if (
      sessionUserId &&
      sessionUserId !== paypalUserId
    ) {
      return res.status(400).json({
        error: "Session mismatch"
      });
    }

    // Use session if available, otherwise PayPal
    const userId = sessionUserId || paypalUserId;

    // =======================
    // PAYMENT DETAILS
    // =======================

    const amount = capturedPayment.amount?.value;

    const captureId = capturedPayment.id;

    if (!amount || !captureId) {
      return res.status(400).json({
        error: "Invalid PayPal payment data"
      });
    }

    // =======================
    // DUPLICATE PAYMENT CHECK
    // =======================

    const existingPayment = await Payment.findOne({
      $or: [
        { paypalOrderId: orderId },
        { paypalCaptureId: captureId }
      ]
    });

    if (existingPayment) {

      const existingUser =
        await Session.findOne({ userId });

      return res.json({
        success: true,
        duplicate: true,
        sessions: existingUser
          ? existingUser.sessionsRemaining
          : 0,
        message: "Payment already processed"
      });
    }

    // =======================
    // DETERMINE SESSION COUNT
    // =======================

    let sessionsToAdd = 0;

    for (const pkg of Object.values(PACKAGES)) {

      if (pkg.amount === amount) {
        sessionsToAdd = pkg.sessions;
        break;
      }
    }

    if (!sessionsToAdd) {
      return res.status(400).json({
        error: "Invalid payment amount"
      });
    }

    // =======================
    // STORE PAYMENT RECORD
    // =======================

    await Payment.create({
      userId,
      paypalOrderId: orderId,
      paypalCaptureId: captureId,
      amount,
      sessionsAdded: sessionsToAdd,
      status: result.status
    });

    // =======================
    // UPDATE USER SESSIONS
    // =======================

    const updatedUser =
      await Session.findOneAndUpdate(
        { userId },
        {
          $inc: {
            sessionsRemaining: sessionsToAdd
          }
        },
        {
          upsert: true,
          new: true
        }
      );

    // =======================
    // SUCCESS RESPONSE
    // =======================

    return res.json({
      success: true,
      sessions: updatedUser.sessionsRemaining,
      captureId
    });

  } catch (err) {

    console.error(
      "CAPTURE ORDER ERROR:",
      err
    );

    return res.status(500).json({
      error: "Could not capture PayPal order"
    });
  }
});
