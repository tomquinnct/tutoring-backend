const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

const sessionsDB = {};

// test route
app.get('/', (req, res) => {
  res.send('Server is running');
});

// get sessions
app.get('/sessions/:userId', (req, res) => {
  const { userId } = req.params;

  res.json({
    sessions: sessionsDB[userId] || 0
  });
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

