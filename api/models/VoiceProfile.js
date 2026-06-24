const mongoose = require('mongoose');

const voiceProfileSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  instruct: { type: String, required: true },
  authorizedConfigRoles: { type: [String], default: ['ADMIN'] },
  authorizedConfigGroups: { type: [String], default: [] },
  authorizedUseRoles: { type: [String], default: ['ADMIN', 'USER'] },
  authorizedUseGroups: { type: [String], default: [] }
}, { timestamps: true });

const VoiceProfile = mongoose.models.VoiceProfile || mongoose.model('VoiceProfile', voiceProfileSchema);

module.exports = VoiceProfile;
