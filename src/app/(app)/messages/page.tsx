

'use client';

import * as React from 'react';
import { useUser, useDatabase, initializeFirebase } from '@/firebase';
import { ref, onValue, get, off } from 'firebase/database';
import type { ChatRoom, User } from '@/lib/types';
import { Loader, MessageSquare } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { ChatView } from '@/components/chat/chat-view';
import { ChatList } from '@/components/chat/chat-list';

export default function MessagesPage() {
    const database = useDatabase();
    const { user: currentUser } = useUser();
    const [chatRooms, setChatRooms] = React.useState<ChatRoom[]>([]);
    const [usersMap, setUsersMap] = React.useState<Map<string, User>>(new Map());
    const [isLoading, setIsLoading] = React.useState(true);

    const pathname = usePathname();
    const activeChatRoomId = pathname.split('/')[2];

    const activeChatRoom = React.useMemo(() => {
        return chatRooms.find(r => r.id === activeChatRoomId) || null;
    }, [chatRooms, activeChatRoomId]);

    React.useEffect(() => {
        if (!currentUser || !database) {
            setIsLoading(false);
            return;
        }

        const userChatsRef = ref(database, `users/${currentUser.uid}/chats`);

        const unsubscribe = onValue(userChatsRef, async (snapshot) => {
            if (snapshot.exists()) {
                const chatIds = Object.keys(snapshot.val());

                const loadedRooms: ChatRoom[] = [];
                // Fetch each room details
                await Promise.all(chatIds.map(async (chatId) => {
                    const roomRef = ref(database, `chatRooms/${chatId}`);
                    // For now, we use get() here, but ideally we might want to listen to updates for these rooms too
                    // To keep it simple, let's just fetch once on list update.
                    // If we want real-time ordering updates (new message), we need to listen to each room or a unified 'user_chats_metadata' path.
                    // Given the structure, we'll fetch once. Real-time message updates inside the chat view are handled separately.
                    // BUT for the list to reorder, we need real-time data or at least polling.
                    // A better structure in RTDB would be `users/{uid}/chats/{chatId} = { timestamp: ... }` to sort quickly.

                    try {
                        const roomSnap = await get(roomRef);
                        if (roomSnap.exists()) {
                            const roomData = roomSnap.val();
                            // Client-side filter for project chats if strictly separate, but here we show all?
                            // The original code filtered: where('isProjectChat', '==', false)
                            if (roomData.isProjectChat === false) {
                                loadedRooms.push({ id: chatId, ...roomData } as ChatRoom);
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to load room ${chatId}`, e);
                    }
                }));


                // Sort by last message timestamp
                loadedRooms.sort((a, b) => {
                    const getMillis = (t: any) => {
                        if (!t) return 0;
                        if (typeof t === 'number') return t;
                        if (t instanceof Date) return t.getTime();
                        if (typeof t?.toMillis === 'function') return t.toMillis();
                        if (t?.seconds) return t.seconds * 1000;
                        return new Date(t).getTime();
                    };
                    return getMillis(b.lastMessage?.timestamp) - getMillis(a.lastMessage?.timestamp);
                });

                setChatRooms(loadedRooms);

                // Fetch Users
                if (loadedRooms.length > 0) {
                    const partnerIds = new Set(loadedRooms.map(room => room.participantIds.find(id => id !== currentUser.uid)).filter(Boolean) as string[]);

                    const newUsersMap = new Map(usersMap);
                    const idsToFetch = Array.from(partnerIds).filter(id => !newUsersMap.has(id));

                    if (idsToFetch.length > 0) {
                        await Promise.all(idsToFetch.map(async (uid) => {
                            const userRef = ref(database, `users/${uid}`);
                            try {
                                const snapshot = await get(userRef);
                                if (snapshot.exists()) {
                                    newUsersMap.set(uid, { id: uid, ...snapshot.val() } as User);
                                }
                            } catch (err) {
                                console.error(`Failed to fetch user ${uid} from RTDB`, err);
                            }
                        }));
                        setUsersMap(newUsersMap);
                    }
                }
            } else {
                setChatRooms([]);
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error listening to user chats:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser, database]); // removed usersMap dependence to avoid loops

    const activePartner = React.useMemo(() => {
        if (!activeChatRoom || !currentUser) return null;
        const partnerId = activeChatRoom.participantIds.find(id => id !== currentUser.uid);
        return partnerId ? usersMap.get(partnerId) ?? null : null;
    }, [activeChatRoom, currentUser, usersMap]);


    if (isLoading) {
        return (
            <main className="flex flex-1 items-center justify-center">
                <Loader className="h-8 w-8 animate-spin" />
            </main>
        );
    }

    return (
        <main className="flex flex-1 flex-col p-4 md:p-0">
            {/* Mobile View: Show only the list */}
            <div className="md:hidden h-full">
                <ChatList
                    chatRooms={chatRooms}
                    usersMap={usersMap}
                    activeChatRoomId={activeChatRoomId}
                    currentUserId={currentUser?.uid}
                />
            </div>

            {/* Desktop View: Grid layout */}
            <div className="hidden h-full flex-1 md:grid md:grid-cols-[300px_1fr]">
                <div className="flex-col border-r flex">
                    <ChatList
                        chatRooms={chatRooms}
                        usersMap={usersMap}
                        activeChatRoomId={activeChatRoomId}
                        currentUserId={currentUser?.uid}
                    />
                </div>
                <div className="flex flex-col">
                    <div className="flex h-full flex-col">
                        {activePartner && activeChatRoom ? (
                            <ChatView partner={activePartner} chatRoom={activeChatRoom} allUsersMap={usersMap} />
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                                <MessageSquare className="h-16 w-16 text-muted-foreground/50" />
                                <h2 className="text-2xl font-semibold">Select a conversation</h2>
                                <p className="text-muted-foreground">Choose one of your existing conversations to get started.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
