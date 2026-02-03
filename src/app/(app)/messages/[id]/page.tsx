

'use client';

import * as React from 'react';
import { useUser, useDatabase } from '@/firebase';
import { ref, get, query, orderByChild, onValue, update } from 'firebase/database';
import type { ChatRoom, User } from '@/lib/types';
import { Loader, MessageSquare } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChatView } from '@/components/chat/chat-view';
import { ChatList } from '@/components/chat/chat-list';

export default function MessagesPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ partnerId?: string }> }) {
    const database = useDatabase();
    const { user: currentUser } = useUser();
    const router = useRouter();

    const [chatRooms, setChatRooms] = React.useState<ChatRoom[]>([]);
    const [usersMap, setUsersMap] = React.useState<Map<string, User>>(new Map());
    const [isLoading, setIsLoading] = React.useState(true);
    const [activeChatRoom, setActiveChatRoom] = React.useState<ChatRoom | null>(null);

    // For "new" chats
    const [tempPartner, setTempPartner] = React.useState<User | null>(null);

    // Unwrap params and searchParams using React.use()
    const unwrappedParams = React.use(params);
    const unwrappedSearchParams = React.use(searchParams);

    const activeChatRoomId = unwrappedParams.id;
    const newPartnerId = unwrappedSearchParams?.partnerId;

    // Fetch all chat rooms and users for the list
    React.useEffect(() => {
        if (!currentUser || !database) {
            if (!currentUser) setIsLoading(false);
            return;
        };

        // RTDB doesn't query array-contains easily.
        // We'll trust checking 'chatRooms' and filtering client-side or check 'users/{uid}/chats' index if available.
        // Since we didn't migrate old data to have 'users/{uid}/chats' index for ALL chats, querying all 'chatRooms' might be heavy eventually.
        // But for migration scope:
        // Optimization: Create index "chatRooms" ordered by "updatedAt" or "lastMessage/timestamp" and filtered relevant ones client side?
        // Or assume 'users/{uid}/chats' exists?
        // In AdminProjects/AdminChats we updated 'users/uid/chats/chatId = true'.
        // If we want to rely on that index:
        // const userChatsRef = ref(database, `users/${currentUser.uid}/chats`);
        // We will TRY to use 'users/{uid}/chats' index. If empty, maybe fallback or user just has no chats.
        // But let's check 'chatRooms' directly for now as a safer migration fallback if we didn't backfill "chats" index for everyone.
        // Actually, 'chatRooms' might be large.
        // Let's stick to querying 'chatRooms' but we can't filter by array-contains.
        // We can query by `user1Id` equalTo currentUser.uid OR `user2Id` equalTo currentUser.uid if structured that way.
        // But participants can be [uid1, uid2].
        // For MVP, fetch all chatRooms and filter. If huge, we need Index.
        // Let's assume we migrated 'users/{uid}/chats' index or iterate all 'chatRooms' for now (simplest for 100% correct data if small db).
        // Let's query `chatRooms` ordered by `lastMessage/timestamp`.

        // Fetch user's chats from 'users/{uid}/chats' index
        const userChatsRef = ref(database, `users/${currentUser.uid}/chats`);

        const unsubscribe = onValue(userChatsRef, async (userChatsSnapshot) => {
            if (userChatsSnapshot.exists()) {
                const chatIds = Object.keys(userChatsSnapshot.val());

                // Fetch actual room data for each ID
                // We can listen to them, or just fetch once? 
                // Requirement implies real-time list.
                // Ideally we listen to EACH, but that's many listeners.
                // OR we listen to 'chatRooms' but filter? No, can't read root.
                // We MUST listen to each room or fetch once.
                // For now, let's fetch once to render the list, and maybe set up listener for updates?
                // Simpler MVP: Fetch once. If real-time needed for "new messages" badge, we need listener.
                // Let's Promise.all fetch them for the list.

                const roomsData = await Promise.all(chatIds.map(async (id) => {
                    try {
                        const roomSnap = await get(ref(database, `chatRooms/${id}`));
                        if (roomSnap.exists()) {
                            return { id, ...roomSnap.val() } as ChatRoom;
                        }
                    } catch (err) {
                        console.warn(`Failed to fetch room ${id}`, err);
                    }
                    return null;
                }));

                const validRooms = roomsData.filter((r): r is ChatRoom => r !== null && !r.isProjectChat);

                // Sort by last message
                validRooms.sort((a, b) => {
                    const getMillis = (t: any) => {
                        if (typeof t === 'number') return t;
                        if (t?.seconds) return t.seconds * 1000;
                        return 0;
                    };
                    return getMillis(b.lastMessage?.timestamp) - getMillis(a.lastMessage?.timestamp);
                });

                setChatRooms(validRooms);

                // Fetch users for these rooms
                if (validRooms.length > 0) {
                    const partnerIds = new Set(validRooms.map(room => room.participantIds.find(id => id !== currentUser.uid)).filter(Boolean) as string[]);
                    const newUsersMap = new Map(usersMap);
                    const idsToFetch = Array.from(partnerIds).filter(id => !newUsersMap.has(id));

                    if (idsToFetch.length > 0) {
                        await Promise.all(idsToFetch.map(async (uid) => {
                            try {
                                const snap = await get(ref(database, `users/${uid}`));
                                if (snap.exists()) {
                                    newUsersMap.set(uid, { id: uid, ...snap.val() } as User);
                                }
                            } catch (e) { console.error(e) }
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
    }, [currentUser, database]);

    // Handle fetching the specific active chat room and its participants
    React.useEffect(() => {
        if (!currentUser || !database) return;

        if (activeChatRoomId === 'new') {
            if (newPartnerId && !tempPartner) {
                const fetchPartner = async () => {
                    const userRef = ref(database, `users/${newPartnerId}`);
                    try {
                        const snapshot = await get(userRef);
                        if (snapshot.exists()) {
                            const userData = { id: newPartnerId, ...snapshot.val() } as User;
                            setTempPartner(userData);
                            const newMap = new Map(usersMap);
                            newMap.set(newPartnerId, userData);
                            setUsersMap(newMap);
                        }
                    } catch (err) {
                        console.error("Error fetching partner", err);
                    }
                };
                fetchPartner();
            }
            return;
        }

        const roomRef = ref(database, `chatRooms/${activeChatRoomId}`);
        const unsubscribe = onValue(roomRef, async (snapshot) => {
            if (snapshot.exists()) {
                const room = { id: snapshot.key, ...snapshot.val() } as ChatRoom;
                if (room.isProjectChat) {
                    router.push(`/requests/${room.requestId}`);
                    return;
                }

                setActiveChatRoom(room);

                const partnerId = room.participantIds.find(id => id !== currentUser.uid);
                if (partnerId && !usersMap.has(partnerId)) {
                    const userRef = ref(database, `users/${partnerId}`);
                    try {
                        const snap = await get(userRef);
                        if (snap.exists()) {
                            const userData = { id: partnerId, ...snap.val() } as User;
                            setUsersMap(prev => {
                                const newMap = new Map(prev);
                                newMap.set(partnerId, userData);
                                return newMap;
                            });
                        }
                    } catch (err) { console.error(err) }
                }

                // Mark messages as read
                if (room.hasUnreadMessages && room.hasUnreadMessages[currentUser.uid]) {
                    const updates: any = {};
                    updates[`chatRooms/${activeChatRoomId}/hasUnreadMessages/${currentUser.uid}`] = false;
                    await update(ref(database), updates);
                }

            } else {
                router.push('/messages');
            }
        }, (error) => {
            console.error("Error fetching active chat room:", error);
        });

        return () => unsubscribe();
    }, [activeChatRoomId, currentUser, database, router, newPartnerId]);


    const partner = React.useMemo(() => {
        if (activeChatRoomId === 'new') return tempPartner;
        if (!activeChatRoom || !currentUser) return null;
        const partnerId = activeChatRoom.participantIds.find(id => id !== currentUser.uid);
        return partnerId ? usersMap.get(partnerId) ?? null : null;
    }, [activeChatRoom, currentUser, usersMap, activeChatRoomId, tempPartner]);

    // Construct a temporary chat room object for new chats
    const currentChatRoom = React.useMemo(() => {
        if (activeChatRoomId === 'new' && currentUser && tempPartner) {
            return {
                id: 'new',
                participantIds: [currentUser.uid, tempPartner.id],
                user1Id: currentUser.uid,
                user2Id: tempPartner.id,
                isProjectChat: false,
            } as ChatRoom;
        }
        return activeChatRoom;
    }, [activeChatRoomId, activeChatRoom, currentUser, tempPartner]);


    return (
        <main className="flex flex-1 flex-col p-4 md:p-0">
            <div className="grid h-full flex-1 md:grid-cols-[300px_1fr]">
                <div className="hidden flex-col border-r md:flex">
                    <ChatList
                        chatRooms={chatRooms}
                        usersMap={usersMap}
                        activeChatRoomId={activeChatRoomId}
                        currentUserId={currentUser?.uid}
                    />
                </div>
                <div className="flex flex-col">
                    {partner && currentChatRoom ? (
                        <ChatView partner={partner} chatRoom={currentChatRoom} allUsersMap={usersMap} />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                            {isLoading && activeChatRoomId !== 'new' ? (
                                <>
                                    <Loader className="h-8 w-8 animate-spin" />
                                    <p>Loading conversation...</p>
                                </>
                            ) : activeChatRoomId === 'new' && !partner ? (
                                <>
                                    <Loader className="h-8 w-8 animate-spin" />
                                    <p>Loading recipient...</p>
                                </>
                            ) : (
                                <>
                                    <MessageSquare className="h-16 w-16 text-muted-foreground/50" />
                                    <h2 className="text-2xl font-semibold">Select a conversation</h2>
                                    <p className="text-muted-foreground">Choose one of your existing conversations to get started.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
