const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  // Link back to the parent Chat conversation
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  // Who sent this?
  senderType: {
    type: String,
    enum: ['user', 'ai', 'human_agent'],
    required: true
  },
  // Display name for UI
  senderName: {
    type: String,
    required: true
  },
  // The Firebase UID if senderType is 'user', otherwise null
  senderUid: {
    type: String,
    default: null
  }
}, { timestamps: true }); // IMPORTANT: This gives us the creation time for ordering

module.exports = mongoose.model('Message', MessageSchema);