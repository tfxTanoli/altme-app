import { getDatabase, ref, set, get, update, push, remove, onValue, query, orderByChild, equalTo, startAt, endAt, limitToLast, DataSnapshot } from 'firebase/database';
import { initializeFirebase } from '@/firebase';

// Helper to get the database instance
const getDb = () => {
    const { database } = initializeFirebase();
    return database;
};

// Generic read (one-time)
export const getFromDb = async <T>(path: string): Promise<T | null> => {
    try {
        const db = getDb();
        const snapshot = await get(ref(db, path));
        if (snapshot.exists()) {
            return snapshot.val() as T;
        }
        return null;
    } catch (error) {
        console.error(`Error reading from DB at ${path}:`, error);
        throw error;
    }
};

// Generic write (set)
export const writeToDb = async <T>(path: string, data: T): Promise<void> => {
    try {
        const db = getDb();
        await set(ref(db, path), data);
    } catch (error) {
        console.error(`Error writing to DB at ${path}:`, error);
        throw error;
    }
};

// Generic update
export const updateInDb = async (path: string, updates: object): Promise<void> => {
    try {
        const db = getDb();
        await update(ref(db, path), updates);
    } catch (error) {
        console.error(`Error updating DB at ${path}:`, error);
        throw error;
    }
};

// Generic push (add to list)
export const pushToDb = async <T>(path: string, data: T): Promise<string | null> => {
    try {
        const db = getDb();
        const newRef = push(ref(db, path));
        await set(newRef, data);
        return newRef.key;
    } catch (error) {
        console.error(`Error pushing to DB at ${path}:`, error);
        throw error;
    }
};

// Generic remove
export const removeFromDb = async (path: string): Promise<void> => {
    try {
        const db = getDb();
        await remove(ref(db, path));
    } catch (error) {
        console.error(`Error removing from DB at ${path}:`, error);
        throw error;
    }
};

// Flatten an array of snapshots
export const snapshotToArray = <T>(snapshot: DataSnapshot): T[] => {
    const items: T[] = [];
    snapshot.forEach((child) => {
        items.push({ id: child.key, ...child.val() });
    });
    return items;
};
