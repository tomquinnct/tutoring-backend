const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');

app.use(cors({
  origin: [
    "https://quinnmathtutor.com",
    "http://localhost:3000"
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
app.post('/verify-payment', async (req, res) => {
  const { tx, userId } = req.body;

  if (!tx || !userId) {
    return res.status(400).json({ success: false });
  }

  try {
    let session = await Session.findOne({ userId });

    if (!session) {
      session = new Session({ userId, sessionsRemaining: 0 });
    }

    session.sessionsRemaining += 5;
    await session.save();

    res.json({
      success: true,
      sessions: session.sessionsRemaining
    });

  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
