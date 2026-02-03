
'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useDatabase, useUser } from '@/firebase';
import { ref, get, update, serverTimestamp } from 'firebase/database';
import type { User, ChatRoom } from '@/lib/types';
import { Loader } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function NewMessagePage() {
    const database = useDatabase();
    const { user: currentUser } = useUser();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();

    const [status, setStatus] = React.useState('Initializing...');
    const hasRun = React.useRef(false); // Ref to prevent double execution in development

    React.useEffect(() => {
        if (!currentUser || !database || hasRun.current) {
            return;
        }

        const partnerId = searchParams.get('partnerId'); // Changed from 'recipient' to match usages in other files if any, or stick to a convention. The grep showed 'partnerId' used in chat-list.

        // Fallback to 'recipient' if 'partnerId' is not found, to be safe.
        const recipientId = partnerId || searchParams.get('recipient');

        console.log("New Message Init. Partner:", recipientId);

        if (!recipientId) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No recipient specified.',
            });
            router.push('/messages');
            return;
        }

        if (recipientId === currentUser.uid) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'You cannot start a conversation with yourself.',
            });
            router.push('/messages');
            return;
        }

        const findOrCreateChat = async () => {
            setStatus('Finding existing conversation...');
            try {
                // Deterministic ID for 1-on-1 chats
                const participants = [currentUser.uid, recipientId].sort();
                const chatRoomId = participants.join('_');

                // Check existence via USER'S chat list first (to avoid 'Permission denied' on non-existent room read)
                // Use 'users/{uid}/chats/{chatId}' which current user can definitely read
                const userChatRef = ref(database, `users/${currentUser.uid}/chats/${chatRoomId}`);
                const userChatSnapshot = await get(userChatRef);

                if (userChatSnapshot.exists()) {
                    // Chat known to user, so room should exist and be readable
                    console.log("Chat exists:", chatRoomId);
                    router.push(`/messages/${chatRoomId}`);
                } else {
                    // Try to read the room directly just in case (e.g. invited but not in local list yet?)
                    // OR just assume create if not in our list. 
                    // To be robust, let's try creation. Update handles merging so it's safe-ish, 
                    // BUT we don't want to overwrite existing room data if it exists but just missing from our list.
                    // The safe path: check if room exists using a check that won't fail permissions? 
                    // Actually, if we use update() with standard data, we might wipe 'lastMessage'.

                    // Solution: Use a transaction or simply try to read it wrapper in catch.
                    // If read fails (permission) -> likely implies does not exist OR we are not participant.
                    // Since we are adding ourselves as participant, we can overwrite/ensure existence.

                    // Better approach: Check if we can read the room.
                    let roomExists = false;
                    try {
                        const roomSnap = await get(ref(database, `chatRooms/${chatRoomId}`));
                        roomExists = roomSnap.exists();
                    } catch (e) {
                        // Permission denied usually means it doesn't exist (due to our specific rule structure)
                        // OR we are genuinely blocked. Assuming doesn't exist for this flow.
                        roomExists = false;
                    }

                    if (roomExists) {
                        // It exists, so we just missed the link in our user profile? Or previous read failed?
                        // Just redirect.
                        router.push(`/messages/${chatRoomId}`);
                    } else {
                        // Create new chat
                        console.log("Creating new chat:", chatRoomId);
                        setStatus('Creating conversation...');

                        const newRoomData: any = {
                            id: chatRoomId,
                            participantIds: participants,
                            user1Id: participants[0],
                            user2Id: participants[1],
                            isProjectChat: false,
                            lastMessage: null,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        };

                        const updates: any = {};
                        // Only set room data if it doesn't exist to avoid wiping
                        // We can't easily conditional update without transaction.
                        // But since we are here, we assume it's new.
                        updates[`chatRooms/${chatRoomId}`] = newRoomData;
                        updates[`users/${currentUser.uid}/chats/${chatRoomId}`] = true;
                        updates[`users/${recipientId}/chats/${chatRoomId}`] = true;

                        await update(ref(database), updates);

                        setStatus('Redirecting to conversation...');
                        router.push(`/messages/${chatRoomId}`);
                    }
                }

            } catch (error) {
                console.error("Error finding or creating chat:", error);
                toast({
                    variant: 'destructive',
                    title: 'Error',
                    description: 'Could not start a new conversation. Please try again.',
                });
                router.push('/messages');
            }
        };

        hasRun.current = true;
        findOrCreateChat();

    }, [currentUser, database, router, searchParams, toast]);

    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Loader className="h-8 w-8 animate-spin" />
            <p className="text-muted-foreground">{status}</p>
        </div>
    );
}
