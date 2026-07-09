const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret';
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL || 'ws://localhost:7880';

/**
 * GET /api/livekit/config
 * Returns LiveKit server URL for the client SDK.
 * Public — client needs this before it has a token.
 */
router.get('/config', (_req, res) => {
  res.json({ wsUrl: LIVEKIT_WS_URL });
});

/**
 * POST /api/livekit/token
 * Generates a LiveKit room access token for the authenticated user.
 * The agent joins the same room using its service token.
 */
router.post('/token', requireJwtAuth, async (req, res) => {
  try {
    const user = req.user;
    const roomName = `hstai-${user.id}-${Date.now()}`;

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: user.name || user.username || 'User',
      // Pass user info as metadata so agent can associate conversation history
      metadata: JSON.stringify({
        userId: user.id,
        conversationId: req.body.conversationId || null,
      }),
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,      // user publishes audio + video
      canSubscribe: true,    // user receives agent audio
      canPublishData: false,
    });

    res.json({
      token: await token.toJwt(),
      roomName,
      wsUrl: LIVEKIT_WS_URL,
    });
  } catch (err) {
    console.error('[LiveKit] Token generation error:', err);
    res.status(500).json({ error: 'Failed to generate LiveKit token' });
  }
});

module.exports = router;
