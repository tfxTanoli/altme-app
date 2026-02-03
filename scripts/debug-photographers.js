
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const { resolve } = require('path');

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') });

const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : null;

if (!serviceAccount) {
    console.error('Error: GOOGLE_APPLICATION_CREDENTIALS not found in .env or is invalid.');
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
    });
}

const rtdb = admin.database();

const run = async () => {
    try {
        console.log('Debugging Photographers Data...');

        // 1. Fetch Profiles
        console.log('Fetching photographerProfiles...');
        const profilesRef = rtdb.ref('photographerProfiles');
        const profilesSnap = await profilesRef.once('value');

        if (!profilesSnap.exists()) {
            console.log('❌ No photographerProfiles found in RTDB.');
            process.exit(0);
        }

        const profiles = profilesSnap.val();
        const profileCount = Object.keys(profiles).length;
        console.log(`✅ Found ${profileCount} profiles.`);

        // 2. Check isAcceptingRequests
        let acceptingCount = 0;
        const userIds = new Set();

        Object.entries(profiles).forEach(([id, data]) => {
            if (data.isAcceptingRequests === true) {
                acceptingCount++;
                userIds.add(data.userId);
            }
        });

        console.log(`ℹ️ Profiles with isAcceptingRequests=true: ${acceptingCount}`);

        if (acceptingCount === 0) {
            console.log('⚠️ No profiles are accepting requests. Check data migration or Firestore source.');
        }

        // 3. Check Users
        console.log('Fetching users...');
        const usersRef = rtdb.ref('users');
        const usersSnap = await usersRef.once('value');

        if (!usersSnap.exists()) {
            console.log('❌ No users found in RTDB.');
            process.exit(0);
        }

        const users = usersSnap.val();
        const userCount = Object.keys(users).length;
        console.log(`✅ Found ${userCount} users.`);

        // 4. Check Mapping
        let mappedCount = 0;
        let missingUserCount = 0;

        userIds.forEach(uid => {
            if (users[uid]) {
                mappedCount++;
            } else {
                missingUserCount++;
                console.log(`⚠️ Profile has userId ${uid} but user not found in 'users' collection.`);
            }
        });

        console.log(`ℹ️ Mapped Profiles (User exists): ${mappedCount}`);
        console.log(`ℹ️ Unmapped Profiles (User missing): ${missingUserCount}`);

        process.exit(0);
    } catch (error) {
        console.error('Debug failed:', error);
        process.exit(1);
    }
};

run();
