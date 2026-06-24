const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { requireJwtAuth } = require('~/server/middleware');
const VoiceProfile = require('~/models/VoiceProfile');
const { canUserConfigureVoice, getVoiceInstructForUser } = require('~/models/VoiceProfileHelper');

const router = express.Router();
router.use(requireJwtAuth);

// Voices directory (shared volume with TTS container)
const VOICES_DIR = path.resolve(__dirname, '../../../tts_server/voices');

// Ensure voices dir exists
if (!fs.existsSync(VOICES_DIR)) {
  fs.mkdirSync(VOICES_DIR, { recursive: true });
}

// Multer — accept .wav / .mp3 / .m4a audio uploads in memory, max 50MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(wav|mp3|m4a|ogg|flac)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed (wav, mp3, m4a, ogg, flac)'));
    }
  },
});

/** Helper: determine if a voice has reference audio on disk */
function getVoiceDiskStatus(voiceName) {
  const wavPath = path.join(VOICES_DIR, `${voiceName}.wav`);
  const txtPath = path.join(VOICES_DIR, `${voiceName}.txt`);
  const hasAudio = fs.existsSync(wavPath);
  const hasTxt = fs.existsSync(txtPath);
  let refText = null;
  if (hasTxt) {
    try { refText = fs.readFileSync(txtPath, 'utf-8').trim(); } catch {}
  }
  return { hasAudio, hasTxt, refText, wavPath, txtPath };
}

// ──────────────────────────────────────────────
// GET /api/voices — voices user can USE
// ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Collect all known voices: DB entries + voices on disk
    const dbProfiles = await VoiceProfile.find({});
    const dbNames = dbProfiles.map((p) => p.name);

    // Scan disk for voices
    let diskVoices = [];
    if (fs.existsSync(VOICES_DIR)) {
      diskVoices = fs
        .readdirSync(VOICES_DIR)
        .filter((f) => f.endsWith('.wav'))
        .map((f) => path.basename(f, '.wav'));
    }

    // Union of DB + disk voices
    const allNames = [...new Set([...dbNames, ...diskVoices])];
    const accessibleProfiles = [];

    for (const voiceName of allNames) {
      const profile = dbProfiles.find((p) => p.name === voiceName);
      const { hasAudio, refText } = getVoiceDiskStatus(voiceName);

      if (!profile) {
        // Not in DB → accessible by everyone by default
        accessibleProfiles.push({
          name: voiceName,
          instruct: '',
          authorizedUseRoles: ['ADMIN', 'USER'],
          authorizedUseGroups: [],
          hasAudio,
          refText,
        });
        continue;
      }

      try {
        await getVoiceInstructForUser(req.user, voiceName);
        accessibleProfiles.push({
          name: profile.name,
          instruct: profile.instruct,
          authorizedUseRoles: profile.authorizedUseRoles,
          authorizedUseGroups: profile.authorizedUseGroups,
          hasAudio,
          refText,
        });
      } catch {
        // User doesn't have access — skip
      }
    }

    res.status(200).json(accessibleProfiles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch voice profiles' });
  }
});

// ──────────────────────────────────────────────
// GET /api/voices/config — voices user can CONFIGURE
// ──────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    // Scan disk for all voices
    let diskVoices = [];
    if (fs.existsSync(VOICES_DIR)) {
      diskVoices = fs
        .readdirSync(VOICES_DIR)
        .filter((f) => f.endsWith('.wav'))
        .map((f) => path.basename(f, '.wav'));
    }

    const dbProfiles = await VoiceProfile.find({});
    const dbNames = dbProfiles.map((p) => p.name);
    const allNames = [...new Set([...dbNames, ...diskVoices])];

    const result = [];
    const isAdmin = req.user.role === 'ADMIN';

    for (const voiceName of allNames) {
      const profile = dbProfiles.find((p) => p.name === voiceName);
      const { hasAudio, hasTxt, refText } = getVoiceDiskStatus(voiceName);
      const diskStatus = { hasAudio, hasTxt, refText };

      if (!profile) {
        // No DB entry → only admins can configure
        if (isAdmin) {
          result.push({
            _id: null,
            name: voiceName,
            instruct: '',
            authorizedConfigRoles: ['ADMIN'],
            authorizedConfigGroups: [],
            authorizedUseRoles: ['ADMIN', 'USER'],
            authorizedUseGroups: [],
            ...diskStatus,
          });
        }
        continue;
      }

      const canConfig = await canUserConfigureVoice(req.user, voiceName);
      if (canConfig) {
        result.push({ ...profile.toObject(), ...diskStatus });
      }
    }

    // Also include DB-only voices (no disk audio) that user can configure
    for (const profile of dbProfiles) {
      if (!result.find((r) => r.name === profile.name)) {
        const canConfig = await canUserConfigureVoice(req.user, profile.name);
        if (canConfig) {
          const { hasAudio, hasTxt, refText } = getVoiceDiskStatus(profile.name);
          result.push({ ...profile.toObject(), hasAudio, hasTxt, refText });
        }
      }
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('Error fetching configurable voices:', err);
    res.status(500).json({ error: 'Failed to fetch configurable voice profiles' });
  }
});

// ──────────────────────────────────────────────
// POST /api/voices — Create a new voice profile
// ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only administrators can create new voice profiles' });
    }

    const { name, instruct, authorizedConfigRoles, authorizedConfigGroups, authorizedUseRoles, authorizedUseGroups } =
      req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const existing = await VoiceProfile.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: `Voice profile ${name} already exists` });
    }

    const newProfile = new VoiceProfile({
      name,
      instruct: instruct || '',
      authorizedConfigRoles: authorizedConfigRoles || ['ADMIN'],
      authorizedConfigGroups: authorizedConfigGroups || [],
      authorizedUseRoles: authorizedUseRoles || ['ADMIN', 'USER'],
      authorizedUseGroups: authorizedUseGroups || [],
    });

    await newProfile.save();
    const { hasAudio, hasTxt, refText } = getVoiceDiskStatus(name);
    res.status(201).json({ ...newProfile.toObject(), hasAudio, hasTxt, refText });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create voice profile' });
  }
});

// ──────────────────────────────────────────────
// PUT /api/voices/:name — Update a voice profile
// ──────────────────────────────────────────────
router.put('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const canConfig = await canUserConfigureVoice(req.user, name);
    if (!canConfig) {
      return res.status(403).json({ error: `You do not have permission to configure voice profile: ${name}` });
    }

    const { instruct, authorizedConfigRoles, authorizedConfigGroups, authorizedUseRoles, authorizedUseGroups } =
      req.body;

    let profile = await VoiceProfile.findOne({ name });
    if (!profile) {
      // Auto-create if it doesn't exist (disk-only voice being customized for the first time)
      profile = new VoiceProfile({ name });
    }

    if (instruct !== undefined) profile.instruct = instruct;
    if (authorizedConfigRoles !== undefined) profile.authorizedConfigRoles = authorizedConfigRoles;
    if (authorizedConfigGroups !== undefined) profile.authorizedConfigGroups = authorizedConfigGroups;
    if (authorizedUseRoles !== undefined) profile.authorizedUseRoles = authorizedUseRoles;
    if (authorizedUseGroups !== undefined) profile.authorizedUseGroups = authorizedUseGroups;

    await profile.save();
    const { hasAudio, hasTxt, refText } = getVoiceDiskStatus(name);
    res.status(200).json({ ...profile.toObject(), hasAudio, hasTxt, refText });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update voice profile' });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/voices/:name — Delete a voice profile (DB entry only)
// ──────────────────────────────────────────────
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const canConfig = await canUserConfigureVoice(req.user, name);
    if (!canConfig) {
      return res.status(403).json({ error: `You do not have permission to delete voice profile: ${name}` });
    }

    await VoiceProfile.deleteOne({ name });
    res.status(200).json({ message: 'Voice profile reset to default' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete voice profile' });
  }
});

// ──────────────────────────────────────────────
// GET /api/voices/:name/audio — Serve reference audio
// ──────────────────────────────────────────────
router.get('/:name/audio', async (req, res) => {
  try {
    const { name } = req.params;
    const wavPath = path.join(VOICES_DIR, `${name}.wav`);
    if (!fs.existsSync(wavPath)) {
      return res.status(404).json({ error: 'No reference audio found for this voice' });
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${name}.wav"`);
    fs.createReadStream(wavPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Failed to serve audio file' });
  }
});

// ──────────────────────────────────────────────
// POST /api/voices/:name/audio — Upload reference audio + transcript
// ──────────────────────────────────────────────
router.post('/:name/audio', upload.single('audio'), async (req, res) => {
  try {
    const { name } = req.params;

    // Must be admin or have config permission
    const isAdmin = req.user.role === 'ADMIN';
    const hasDbEntry = !!(await VoiceProfile.findOne({ name }));
    if (!isAdmin && !hasDbEntry) {
      return res.status(403).json({ error: 'Only administrators can upload audio for new voices' });
    }
    if (hasDbEntry) {
      const canConfig = await canUserConfigureVoice(req.user, name);
      if (!canConfig) {
        return res.status(403).json({ error: `You do not have permission to upload audio for: ${name}` });
      }
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const { refText } = req.body;
    if (!refText || !refText.trim()) {
      return res.status(400).json({ error: 'Reference transcript (refText) is required' });
    }

    // Write WAV file
    const wavPath = path.join(VOICES_DIR, `${name}.wav`);
    fs.writeFileSync(wavPath, req.file.buffer);

    // Write transcript
    const txtPath = path.join(VOICES_DIR, `${name}.txt`);
    fs.writeFileSync(txtPath, refText.trim(), 'utf-8');

    res.status(200).json({
      message: `Reference audio and transcript saved for ${name}`,
      hasAudio: true,
      hasTxt: true,
      refText: refText.trim(),
    });
  } catch (err) {
    console.error('Error uploading voice audio:', err);
    res.status(500).json({ error: err.message || 'Failed to upload audio' });
  }
});

// ──────────────────────────────────────────────
// DELETE /api/voices/:name/audio — Remove reference audio files from disk
// ──────────────────────────────────────────────
router.delete('/:name/audio', async (req, res) => {
  try {
    const { name } = req.params;
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only administrators can remove reference audio' });
    }

    const wavPath = path.join(VOICES_DIR, `${name}.wav`);
    const txtPath = path.join(VOICES_DIR, `${name}.txt`);

    let removed = 0;
    if (fs.existsSync(wavPath)) { fs.unlinkSync(wavPath); removed++; }
    if (fs.existsSync(txtPath)) { fs.unlinkSync(txtPath); removed++; }

    if (removed === 0) {
      return res.status(404).json({ error: 'No audio files found to remove' });
    }

    res.status(200).json({ message: `Reference audio removed for ${name}` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to remove audio files' });
  }
});

module.exports = router;
