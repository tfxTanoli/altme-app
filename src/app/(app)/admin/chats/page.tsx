
'use client';

import * as React from 'react';
import { useDatabase, useMemoFirebase } from '@/firebase';
import { ref, onValue, get, query, orderByChild } from 'firebase/database';
import type { ChatRoom, User } from '@/lib/types';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader, MessageSquare, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChatView } from '@/components/chat/chat-view';
import { Input } from '@/components/ui/input';

const ChatListItem = React.memo(({ chatRoom, partners, isActive }: { chatRoom: ChatRoom; partners: User[], isActive: boolean }) => {

    const partnerNames = partners.map(p => p.name).join(', ');

    // For unified chats, the ID is the participant pair key
    const chatIdentifier = chatRoom.id;

    return (
        <Link href={`/admin/chats?chatId=${chatIdentifier}`} className="block" scroll={false}>
            <div className={cn(
                "flex items-start gap-4 rounded-lg p-3 transition-colors",
                isActive ? "bg-muted" : "hover:bg-muted/50"
            )}>
                <div className="flex -space-x-4 rtl:space-x-reverse">
                    {partners.slice(0, 2).map(p => (
                        <Avatar key={p.id} className="h-10 w-10 border-2 border-background">
                            <AvatarImage src={p.photoURL} alt={p.name} />
                            <AvatarFallback>{p.name?.charAt(0) || '?'}</AvatarFallback>
                        </Avatar>
                    ))}
                    {partners.length > 2 && (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground">
                            +{partners.length - 2}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between">
                        <p className="truncate font-semibold">{partnerNames}</p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {chatRoom.lastMessage?.timestamp
                                ? formatDistanceToNow(new Date(chatRoom.lastMessage.timestamp), { addSuffix: true })
                                : 'No messages'}
                        </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                        {chatRoom.lastMessage?.text || 'No messages yet'}
                    </p>
                </div>
            </div>
        </Link>
    );
});
ChatListItem.displayName = 'ChatListItem';


export default function AdminChatsPage() {
    const database = useDatabase();
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeChatId = searchParams.get('chatId');

    const [unifiedChatRooms, setUnifiedChatRooms] = React.useState<ChatRoom[]>([]);
    const [usersMap, setUsersMap] = React.useState<Map<string, User>>(new Map());
    const [isLoading, setIsLoading] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState('');

    // Fetch all chat rooms and unify them
    React.useEffect(() => {
        if (!database) return;

        // Listen to all chat rooms
        // If too many rooms, might need pagination or "active" filter.
        // For Admin, seeing all might be okay for now, or use limitToLast.
        const chatRoomsRef = query(ref(database, 'chatRooms'), orderByChild('lastMessage/timestamp'));

        const unsubscribe = onValue(chatRoomsRef, async (snapshot) => {
            setIsLoading(true);
            if (!snapshot.exists()) {
                setUnifiedChatRooms([]);
                setIsLoading(false);
                return;
            }

            const data = snapshot.val();
            const allRooms = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            })) as ChatRoom[];

            // 1. Fetch all users first
            const allParticipantIds = allRooms.flatMap(room => room.participantIds || []);
            const uniqueParticipantIds = [...new Set(allParticipantIds)];

            const newUsersMap = new Map<string, User>();
            if (uniqueParticipantIds.length > 0) {
                // Fetch users individually (or parallel) since RTDB doesn't have 'in' query
                // Optimization: Only fetch users not already in map if we were caching, 
                // but here we rebuild.
                // Batched fetch not native, so promise.all
                await Promise.all(uniqueParticipantIds.map(async (uid) => {
                    try {
                        const userSnap = await get(ref(database, `users/${uid}`));
                        if (userSnap.exists()) {
                            newUsersMap.set(uid, { id: uid, ...userSnap.val() } as User);
                        }
                    } catch (e) {
                        console.warn(`Failed to fetch user ${uid}`, e);
                    }
                }));
                setUsersMap(newUsersMap);
            }

            // 2. Process rooms after users are fetched
            const roomsWithMessages = allRooms.filter(room => !!room.lastMessage);
            const groupedRooms = new Map<string, ChatRoom[]>();

            for (const room of roomsWithMessages) {
                // Determine pair key safely
                if (!room.participantIds) continue;
                const pairKey = room.participantIds.sort().join('-');
                if (!groupedRooms.has(pairKey)) {
                    groupedRooms.set(pairKey, []);
                }
                groupedRooms.get(pairKey)!.push(room);
            }

            const unifiedRooms: ChatRoom[] = [];

            const getMillis = (t: any) => {
                if (!t) return 0;
                if (typeof t === 'number') return t;
                if (t instanceof Date) return t.getTime();
                if (typeof t?.toMillis === 'function') return t.toMillis();
                if (t?.seconds) return t.seconds * 1000;
                return new Date(t).getTime();
            };

            for (const [pairKey, roomsInGroup] of groupedRooms.entries()) {
                const latestRoom = roomsInGroup.reduce((latest, current) => {
                    const latestTime = getMillis(latest.lastMessage?.timestamp);
                    const currentTime = getMillis(current.lastMessage?.timestamp);
                    if (currentTime > latestTime) {
                        return current;
                    }
                    return latest;
                }, roomsInGroup[0]);

                unifiedRooms.push({
                    id: pairKey,
                    participantIds: latestRoom.participantIds,
                    user1Id: latestRoom.user1Id,
                    user2Id: latestRoom.user2Id,
                    lastMessage: latestRoom.lastMessage,
                    isProjectChat: false,
                    isUnified: true,
                    // @ts-ignore
                    sourceRoomIds: roomsInGroup.map(r => r.id),
                });
            }

            unifiedRooms.sort((a, b) => getMillis(b.lastMessage?.timestamp) - getMillis(a.lastMessage?.timestamp));
            setUnifiedChatRooms(unifiedRooms);
            setIsLoading(false);

        }, (error) => {
            console.error("Permission error (Chats):", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [database]);


    const filteredChatRooms = React.useMemo(() => {
        if (!searchQuery) return unifiedChatRooms;

        return unifiedChatRooms.filter(room => {
            const partnerNames = room.participantIds
                .map(id => usersMap.get(id)?.name || '')
                .join(' ');
            return partnerNames.toLowerCase().includes(searchQuery.toLowerCase());
        });
    }, [unifiedChatRooms, searchQuery, usersMap]);


    const activeChatRoom = React.useMemo(() => {
        if (activeChatId) {
            return unifiedChatRooms.find(room => room.id === activeChatId) || null;
        }
        return null;
    }, [activeChatId, unifiedChatRooms]);

    const activeChatPartners = React.useMemo(() => {
        if (!activeChatRoom) return [];
        return activeChatRoom.participantIds
            .map(id => usersMap.get(id))
            .filter((user): user is User => !!user);
    }, [activeChatRoom, usersMap]);


    return (
        <main className="flex flex-1 flex-col p-4 md:p-0">
            <div className="grid h-full flex-1 md:grid-cols-[400px_1fr]">
                <div className="hidden flex-col border-r md:flex">
                    <div className="p-4 space-y-4">
                        <h1 className="font-semibold text-lg md:text-2xl">All Chats</h1>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Search by name..."
                                className="pl-8 h-9"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                    {isLoading ? (
                        <div className="flex h-full items-center justify-center">
                            <Loader className="h-6 w-6 animate-spin" />
                        </div>
                    ) : filteredChatRooms.length > 0 ? (
                        <div className="flex-1 overflow-y-auto">
                            {filteredChatRooms.map(room => {
                                const partners = room.participantIds
                                    .map(id => usersMap.get(id))
                                    .filter((u): u is User => !!u);

                                return (
                                    <ChatListItem
                                        key={room.id}
                                        chatRoom={room}
                                        partners={partners}
                                        isActive={room.id === activeChatId}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex-1 p-4 text-center text-sm text-muted-foreground">
                            {searchQuery ? `No results for "${searchQuery}"` : 'No conversations have been started yet.'}
                        </div>
                    )}
                </div>
                <div className="flex flex-col">
                    {activeChatRoom && activeChatPartners.length > 0 ? (
                        <ChatView
                            partners={activeChatPartners}
                            chatRoom={activeChatRoom}
                            allUsersMap={usersMap}
                        />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                            {isLoading ? (
                                <>
                                    <Loader className="h-8 w-8 animate-spin" />
                                    <p>Loading conversations...</p>
                                </>
                            ) : (
                                <>
                                    <MessageSquare className="h-16 w-16 text-muted-foreground/50" />
                                    <h2 className="text-2xl font-semibold">Select a conversation</h2>
                                    <p className="text-muted-foreground">Choose a conversation from the list to view the messages.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
