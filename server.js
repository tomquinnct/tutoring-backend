
const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://tomquinnmathtutor_db_user:PSW35MayAve@cluster0.8xouaex.mongodb.net/tutoring?retryWrites=true&w=majority')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

const sessionsDB = {};
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
    console.log('Found session:', session);

    if (!session) {
      console.log('Creating new session...');
      session = new Session({ userId, sessionsRemaining: 0 });
      await session.save();
      console.log('Saved to MongoDB');
    }

    res.json({ sessions: session.sessionsRemaining });

  } catch (err) {
    console.error('ERROR:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// verify payment (we’ll improve this later)
app.post('/verify-payment', async (req, res) => {
  const { tx, userId } = req.body;

  if (!tx || !userId) {
    return res.status(400).json({ success: false });
  }

  // TEMPORARY (for testing only)
  sessionsDB[userId] = (sessionsDB[userId] || 0) + 5;

  res.json({
    success: true,
    sessions: sessionsDB[userId]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

