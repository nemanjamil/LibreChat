// models/assistantHistory.js
const mongoose = require('mongoose');

const assistantHistorySchema = mongoose.Schema(
  {
    assistant_id: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    instructions: {
      type: String,
      required: true,
    },
    assistantName: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt timestamps
  }
);

// Create TTL index on createdAt with a 6-month expiration
assistantHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

const AssistantHistory = mongoose.model('assistantHistory', assistantHistorySchema);
module.exports = AssistantHistory;
