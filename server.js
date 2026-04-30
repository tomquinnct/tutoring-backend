const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');

app.use(cors({
  origin: [
    "https://quinnmathtutor.com",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());

const app = express();
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Model
const Session = require('./models/Session');

// test route
app.get('/', (req, res) => {
  res.send('Server is running');
});

// get sessions
app.get('/sessions/:userId', async (req, res) => {
  const { userId } = req.params;

  console.log('--- ROUTE HIT ---');
  console.log('User ID:', userId);

  try {
    let session = await Session.findOne({ userId });

    if (!session) {
      session = new Session({ userId, sessionsRemaining: 0 });
      await session.save();
    }

    res.json({ sessions: session.sessionsRemaining });

  } catch (err) {
    console.error('ERROR:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// verify payment
app.post("/verify-payment", async (req, res) => {
  try {
    const { tx, userId, packageName } = req.body;

    console.log("VERIFY PAYMENT HIT:", req.body);

    // Example logic (adjust to your DB)
    let sessionsToAdd = 0;

    if (packageName.includes("10")) sessionsToAdd = 10;
    if (packageName.includes("2")) sessionsToAdd = 2;

    // TODO: update your database here
    // await db.users.update(...)

    return res.json({
      success: true,
      sessions: sessionsToAdd
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
