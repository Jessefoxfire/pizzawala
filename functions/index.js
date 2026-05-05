const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

const REGION = 'us-central1';

/** @param {Record<string, unknown>} obj */
function stringifyData(obj) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * @param {string | undefined} token
 * @param {string} title
 * @param {string} body
 * @param {Record<string, unknown>} data
 * @param {string} androidChannelId
 */
async function sendToToken(token, title, body, data, androidChannelId) {
  if (!token || typeof token !== 'string') return;
  await admin.messaging().send({
    token,
    notification: { title, body },
    data: stringifyData(data),
    android: {
      priority: 'high',
      notification: {
        channelId: androidChannelId,
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  });
}

exports.notifyUserInbox = onDocumentCreated(
  {
    region: REGION,
    document: 'users/{userId}/notifications/{notificationId}',
  },
  async event => {
    const snap = event.data;
    if (!snap) return;
    const userId = event.params.userId;
    const payload = snap.data();
    const userDoc = await admin.firestore().doc(`users/${userId}`).get();
    const token = userDoc.get('fcmToken');
    const title = typeof payload.title === 'string' ? payload.title : 'PizzaWala';
    const body = typeof payload.body === 'string' ? payload.body : '';
    const nav = payload.nav && typeof payload.nav === 'object' ? payload.nav : {};
    const screen = typeof nav.screen === 'string' ? nav.screen : '';
    await sendToToken(token, title, body, { type: 'personal_notification', screen }, 'personal_alerts');
  }
);

exports.notifyTeamChatMessage = onDocumentCreated(
  {
    region: REGION,
    document: 'chats/team-1/messages/{messageId}',
  },
  async event => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data();
    const senderId = typeof msg.senderId === 'string' ? msg.senderId : '';
    const isBroadcast = !!msg.isBroadcast;

    const usersSnap = await admin.firestore().collection('users').get();

    const title = isBroadcast ? 'Admin Broadcast' : (typeof msg.senderName === 'string' ? msg.senderName : 'Team Message');
    const body =
      typeof msg.text === 'string'
        ? msg.text
        : msg.photoUrl
          ? '📷 Sent a photo'
          : 'New message';

    const type = isBroadcast ? 'broadcast' : 'chat_message';

    await Promise.all(
      usersSnap.docs.map(async doc => {
        if (doc.id === senderId) return;
        const teamId = doc.get('teamId') || 'team-1';
        if (teamId !== 'team-1') return;
        const token = doc.get('fcmToken');
        await sendToToken(token, title, body, { type }, 'chat_messages');
      })
    );
  }
);

exports.notifyAwardRecipient = onDocumentCreated(
  {
    region: REGION,
    document: 'awards/{awardId}',
  },
  async event => {
    const snap = event.data;
    if (!snap) return;
    const a = snap.data();
    const toUserId = typeof a.toUserId === 'string' ? a.toUserId : '';
    const fromUserId = typeof a.fromUserId === 'string' ? a.fromUserId : '';
    if (!toUserId || toUserId === fromUserId) return;

    const userDoc = await admin.firestore().doc(`users/${toUserId}`).get();
    const token = userDoc.get('fcmToken');
    const fromName = typeof a.fromUserName === 'string' ? a.fromUserName : 'Someone';
    const toName = typeof a.toUserName === 'string' ? a.toUserName : 'you';
    const title = 'New Award! 🏆';
    const body = `${fromName} gave ${toName} recognition. Tap to view Hall of Fame.`;
    await sendToToken(
      token,
      title,
      body,
      { type: 'award_received', toUserId },
      'awards'
    );
  }
);
