
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

const db = admin.firestore();
const rtdb = admin.database();

const convertTimestamp = (data) => {
    if (!data) return data;

    if (typeof data === 'object') {
        // Check if it's a Firestore Timestamp
        if (data.constructor && data.constructor.name === 'Timestamp' && typeof data.toMillis === 'function') {
            return data.toMillis();
        }
        // Specific check for { seconds, nanoseconds } object if constructor check fails
        if ('seconds' in data && 'nanoseconds' in data && Object.keys(data).length === 2) {
            return data.seconds * 1000 + data.nanoseconds / 1000000;
        }

        // Recursively convert objects and arrays
        if (Array.isArray(data)) {
            return data.map(item => convertTimestamp(item));
        }

        const newData = {};
        for (const key in data) {
            newData[key] = convertTimestamp(data[key]);
        }
        return newData;
    }

    return data;
};

const migrateCollection = async (collectionName, rtdbPath, existingKeysOverride = null) => {
    console.log(`Migrating collection: ${collectionName} -> ${rtdbPath || collectionName}...`);
    const snapshot = await db.collection(collectionName).get();

    if (snapshot.empty) {
        console.log(`No documents found in ${collectionName}.`);
        return;
    }

    let count = 0;
    let skipped = 0;
    const updates = {};

    for (const doc of snapshot.docs) {
        // Skip if this specific ID already exists in RTDB (for users)
        if (existingKeysOverride && existingKeysOverride.has(doc.id)) {
            skipped++;
            continue;
        }

        const data = doc.data();
        const convertedData = convertTimestamp(data);

        // Ensure ID is included if needed, usually keyed by ID in RTDB
        updates[`${rtdbPath || collectionName}/${doc.id}`] = convertedData;
        count++;

        // Special handling for nested collections
        if (collectionName === 'chatRooms') {
            await migrateSubcollection(doc.ref, 'messages', `chatMessages/${doc.id}`);
        }
    }

    if (Object.keys(updates).length > 0) {
        await rtdb.ref().update(updates);
        console.log(`Migrated ${count} documents from ${collectionName}.`);
    }
};

const migrateSubcollection = async (parentDocRef, subCollectionName, rtdbPath) => {
    console.log(`  Migrating subcollection: ${subCollectionName} for ${parentDocRef.id}...`);
    const snapshot = await parentDocRef.collection(subCollectionName).get();

    if (snapshot.empty) return;

    const updates = {};
    let count = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const convertedData = convertTimestamp(data);
        updates[`${rtdbPath}/${doc.id}`] = convertedData;
        count++;
    }

    if (Object.keys(updates).length > 0) {
        await rtdb.ref().update(updates);
        console.log(`  -> Migrated ${count} sub-documents to ${rtdbPath}.`);
    }
};


const run = async () => {
    try {
        console.log('Starting migration...');

        // List of top-level collections to migrate
        // Based on database.rules.json and typical structure
        const collections = [
            'users',
            'requests',
            'bids',
            'photographerProfiles',
            'reviews',
            'notifications',
            'contactSubmissions',
            'contentDeliveries',
            'chatRooms' // Handles 'messages' subcollection internally
        ];

        for (const col of collections) {
            // Special handling for users to preserve existing RTDB data
            let existingKeys = new Set();
            if (col === 'users') {
                console.log('Checking existing users in RTDB to prevent overwrite...');
                const snapshot = await rtdb.ref('users').once('value');
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    Object.keys(data).forEach(k => existingKeys.add(k));
                    console.log(`Found ${existingKeys.size} existing users in RTDB. These will be skipped.`);
                }
            }

            await migrateCollection(col, col, col === 'users' ? existingKeys : null);
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

run();
