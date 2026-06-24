const mongoose = require('mongoose');
const VoiceProfile = require('./VoiceProfile');

async function getVoiceInstructForUser(user, voiceName) {
  if (!user) {
    return null;
  }

  const profile = await VoiceProfile.findOne({ name: voiceName });
  if (!profile) {
    return null;
  }

  const hasRoleAccess = profile.authorizedUseRoles.includes(user.role);
  
  let hasGroupAccess = false;
  if (profile.authorizedUseGroups && profile.authorizedUseGroups.length > 0) {
    const Group = mongoose.model('Group');
    const userGroups = await Group.find({ memberIds: user.id });
    const userGroupNames = userGroups.map(g => g.name);
    const userGroupIds = userGroups.map(g => g._id.toString());
    
    hasGroupAccess = profile.authorizedUseGroups.some(group => 
      userGroupNames.includes(group) || userGroupIds.includes(group)
    );
  } else {
    hasGroupAccess = true;
  }

  if (hasRoleAccess && hasGroupAccess) {
    return profile.instruct;
  }

  throw new Error(`You do not have access to the voice profile: ${voiceName}`);
}

async function canUserConfigureVoice(user, voiceName) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  const profile = await VoiceProfile.findOne({ name: voiceName });
  if (!profile) {
    return false;
  }

  const hasRoleAccess = profile.authorizedConfigRoles.includes(user.role);
  let hasGroupAccess = false;

  if (profile.authorizedConfigGroups && profile.authorizedConfigGroups.length > 0) {
    const Group = mongoose.model('Group');
    const userGroups = await Group.find({ memberIds: user.id });
    const userGroupNames = userGroups.map(g => g.name);
    const userGroupIds = userGroups.map(g => g._id.toString());

    hasGroupAccess = profile.authorizedConfigGroups.some(group => 
      userGroupNames.includes(group) || userGroupIds.includes(group)
    );
  } else {
    hasGroupAccess = true;
  }

  return hasRoleAccess && hasGroupAccess;
}

module.exports = {
  getVoiceInstructForUser,
  canUserConfigureVoice
};
