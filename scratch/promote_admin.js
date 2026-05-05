const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, updateDoc, doc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyBH_1AjRVmmxonxz15PxquCypKmKMZneaM',
  authDomain: 'pizza-wala-team.firebaseapp.com',
  projectId: 'pizza-wala-team',
  storageBucket: 'pizza-wala-team.firebasestorage.app',
  messagingSenderId: '959171239075',
  appId: '1:959171239075:web:5980e00c311d626b0b3316',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function promote(email) {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('emailLower', '==', email.toLowerCase()));
  const snap = await getDocs(q);
  
  if (snap.empty) {
    console.log('User not found with email:', email);
    return;
  }

  const userDoc = snap.docs[0];
  const userData = userDoc.data();
  const roles = Array.isArray(userData.roles) ? userData.roles : [];
  
  if (roles.includes('admin') && userData.teamId === 'team-1') {
    console.log('User is already an admin in team-1:', email);
    return;
  }

  const nextRoles = Array.from(new Set([...roles, 'admin']));
  await updateDoc(doc(db, 'users', userDoc.id), {
    roles: nextRoles,
    teamId: 'team-1'
  });
  
  console.log('Successfully promoted to admin and assigned to team-1:', email);
}

promote('dylanmarkusimhoff@gmail.com').catch(console.error);
