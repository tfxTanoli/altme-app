'use server';

import { auth } from '@/firebase/admin';

export async function deleteUserFromAuth(uid: string) {
    try {
        await auth.deleteUser(uid);
        return { success: true };
    } catch (error) {
        console.error('Error deleting user from Auth:', error);
        return { success: false, error: (error as Error).message };
    }
}
