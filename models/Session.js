const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },

  sessions: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Session', sessionSchema);