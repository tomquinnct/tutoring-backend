const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const app = express();
app.use(express.json());

app.use(cors({
  origin: [
    "https://quinnmathtutor.com",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

// app.use(cors());



// MongoDB connection
const SessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  sessionsRemaining: { type: Number, default: 0 }
});

module.exports = mongoose.model("Session", SessionSchema);


// Model
const Session = require('./models/Session');

// test route
app.get('/', (req, res) => {
  res.send('Server is running');
});

// get sessions
app.get('/sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    let session = await Session.findOne({ userId });

    if (!session) {
      session = await Session.create({
        userId,
        sessionsRemaining: 0
      });
    }

    res.json({ sessions: session.sessionsRemaining });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// verify payment

const axios = require("axios");

app.post("/verify-payment", async (req, res) => {
  try {
    const { tx, userId, packageName } = req.body;

    console.log("VERIFY PAYMENT HIT:", req.body);

    // ⚠️ MVP MODE: trust PayPal redirect for now
    // (we will upgrade to full API verification later)

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




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
