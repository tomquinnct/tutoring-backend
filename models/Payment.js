 const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },

  sessions: {
    type: Number,
    default: 0
  },

  heldSessions: {
    type: Number,
    default: 0
  },

  bookingLock: {
    active: {
      type: Boolean,
      default: false
    },
    expiresAt: Date
  }
});

module.exports = mongoose.model('Session', sessionSchema);