const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const admin = require('firebase-admin');
const sharp = require('sharp');

admin.initializeApp();

const REGION = 'us-central1';
const STORAGE_BUCKET = 'pizza-wala-team.firebasestorage.app';
const ADMIN_BOOTSTRAP_EMAILS = new Set([
  'indispirit@gmail.com',
  'goddessjyotis@gmail.com',
  'maromabeauty@gmail.com',
]);

async function assertAdmin(decoded) {
  const email = String(decoded.email || '')
    .trim()
    .toLowerCase();
  if (ADMIN_BOOTSTRAP_EMAILS.has(email)) return;

  const userDoc = await admin.firestore().doc(`users/${decoded.uid}`).get();
  const roles = userDoc.data()?.roles;
  if (!Array.isArray(roles) || !roles.includes('admin')) {
    throw new Error('Admin access required.');
  }
}

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

function dateKey(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function createUserNotification(userId, payload) {
  return admin.firestore().collection('users').doc(userId).collection('notifications').add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
    const view = typeof nav.view === 'string' ? nav.view : '';
    await sendToToken(
      token,
      title,
      body,
      { type: 'personal_notification', screen, view },
      'personal_alerts'
    );
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

exports.hygieneEducationReminderSweep = onSchedule(
  {
    region: REGION,
    schedule: '0 9 * * *',
    timeZone: 'UTC',
  },
  async () => {
    const fs = admin.firestore();
    const todayKey = dateKey(new Date());
    const [credentialsSnap, adminsSnap] = await Promise.all([
      fs.collection('hygieneCredentials').where('status', '==', 'active').get(),
      fs.collection('users').where('roles', 'array-contains', 'admin').get(),
    ]);

    for (const credentialDoc of credentialsSnap.docs) {
      const credential = credentialDoc.data();
      const dueKey = typeof credential.nextEducationDueDateKey === 'string' ? credential.nextEducationDueDateKey : '';
      const employeeUid = typeof credential.employeeUid === 'string' ? credential.employeeUid : '';
      const employeeName =
        typeof credential.employeeName === 'string' && credential.employeeName.trim()
          ? credential.employeeName.trim()
          : 'A team member';

      if (!employeeUid || !dueKey || dueKey > todayKey || credential.reminderSentForDateKey === dueKey) {
        continue;
      }

      await createUserNotification(employeeUid, {
        title: 'Hygiene education due',
        body: 'Your hygiene card has reached its two-year education reminder date.',
        nav: { screen: 'Hygiene' },
      });

      await Promise.all(
        adminsSnap.docs.map(adminDoc =>
          createUserNotification(adminDoc.id, {
            title: 'Employee hygiene reminder due',
            body: `${employeeName} needs recurring hygiene education follow-up.`,
            nav: { screen: 'AdminHygiene' },
          })
        )
      );

      await credentialDoc.ref.update({
        reminderSentForDateKey: dueKey,
        reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

/** Mobile schedule PDF upload — Admin SDK avoids client Storage getDownloadURL issues. */
exports.uploadScheduleExport = onRequest(
  {
    region: REGION,
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) {
        res.status(401).json({ error: 'Missing auth token' });
        return;
      }

      const decoded = await admin.auth().verifyIdToken(token);
      await assertAdmin(decoded);

      const { base64, storagePath, contentType } = req.body || {};
      if (typeof base64 !== 'string' || !base64.trim()) {
        res.status(400).json({ error: 'Missing PDF data' });
        return;
      }
      if (typeof storagePath !== 'string' || !storagePath.startsWith('schedules/exports/')) {
        res.status(400).json({ error: 'Invalid storage path' });
        return;
      }

      const buffer = Buffer.from(base64, 'base64');
      if (!buffer.length) {
        res.status(400).json({ error: 'PDF data is empty' });
        return;
      }

      const bucket = admin.storage().bucket(STORAGE_BUCKET);
      const file = bucket.file(storagePath);
      const downloadToken = crypto.randomUUID();
      await file.save(buffer, {
        metadata: {
          contentType: typeof contentType === 'string' ? contentType : 'application/pdf',
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });

      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

      res.status(200).json({ downloadUrl, storagePath });
    } catch (err) {
      console.error('uploadScheduleExport failed', err);
      const message = err instanceof Error ? err.message : 'Upload failed';
      const status = message.includes('Admin access') ? 403 : 500;
      res.status(status).json({ error: message });
    }
  }
);

exports.enhanceDocumentImage = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const imageBase64 = request.data?.imageBase64;
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw new HttpsError('invalid-argument', 'imageBase64 is required.');
  }

  let input;
  try {
    input = Buffer.from(imageBase64, 'base64');
  } catch (_err) {
    throw new HttpsError('invalid-argument', 'Invalid image data.');
  }

  if (!input.length || input.length > 12 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'Image is empty or too large.');
  }

  try {
    const output = await sharp(input)
      .rotate()
      .normalize()
      .modulate({ brightness: 1.04, saturation: 0.96 })
      .trim({ threshold: 18 })
      .sharpen({ sigma: 0.8 })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    return {
      imageBase64: output.toString('base64'),
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    console.error('enhanceDocumentImage failed', err);
    throw new HttpsError('internal', 'Could not enhance document image.');
  }
});
