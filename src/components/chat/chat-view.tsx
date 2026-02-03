
'use client';

import * as React from 'react';
import Image from 'next/image';
import { useUser, useDatabase } from '@/firebase';
import {
  ref,
  onValue,
  push,
  update,
  query,
  orderByChild,
  limitToLast,
  get,
  serverTimestamp
} from 'firebase/database';
import type { User, ChatRoom, ChatMessage } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader, Send, ArrowLeft, Paperclip, X, Video, FileImage, FileVideo } from 'lucide-react';
import { format } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, captureVideoFrame } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useChatMediaUpload } from '@/hooks/use-chat-media-upload';
import { sendNotification } from '@/services/notifications';

interface ChatViewProps {
  partner?: User;
  partners?: User[];
  chatRoom: ChatRoom | null;
  onBack?: () => void;
  allUsersMap?: Map<string, User>;
}

type Preview = {
  url: string;
  type: 'image' | 'video';
};

export const ChatView: React.FC<ChatViewProps> = ({
  partner,
  partners,
  chatRoom,
  onBack,
  allUsersMap,
}) => {
  const { user: currentUser } = useUser();
  const database = useDatabase();
  const { toast } = useToast();

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = React.useState(false);
  const [newMessage, setNewMessage] = React.useState('');
  const viewportRef = React.useRef<HTMLDivElement>(null);

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { uploadFiles, isUploading } = useChatMediaUpload();

  const finalPartners = partners || (partner ? [partner] : []);

  React.useEffect(() => {
    if (!chatRoom || !database) {
      setMessages([]);
      return;
    }

    const roomIds = chatRoom.isUnified ? chatRoom.sourceRoomIds : [chatRoom.id];
    if (!roomIds || roomIds.length === 0) {
      setMessages([]);
      return;
    }

    // Listen to messages for all involved rooms
    const unsubscribes = roomIds.map(roomId => {
      // Use 'messages' as the top-level node for flattened messages
      // structure: messages/{roomId}/{messageId}
      const messagesRef = query(
        ref(database, `chatMessages/${roomId}`),
        orderByChild('timestamp'),
        limitToLast(100) // Reasonable limit for chat view
      );

      return onValue(messagesRef, (snapshot) => {
        // When checking multiple rooms, we might want to consolidate.
        // But this simple approach triggers re-fetch or state update per room.
        // For a unified view, we need to merge.
        // Since onValue returns the whole list (or last 100), we can just update local state.
        // But if we have multiple rooms, we need to merge them carefully.
        // Let's assume for unified view we handle it by merging state.
        // However, the original code fetched *all* messages when *any* changed.
        // That's expensive.
        // Optimized approach: update a dictionary of messages.

        // Simplified: Just re-trigger a "refresh" if one changes?
        // No, let's just use the snapshot to update a map of messages.
        // But `chatRoom.isUnified` implies multiple source rooms.

        // To stay close to original logic without rewriting everything:
        // We'll read all messages from the snapshots.
        // But we can't easily "fetch all" inside a listener efficiently without just listening.

        // For now, let's listen to each room and merge the results.
        // We need a state that holds messages per roomId.
      });
    });

    // Better implementation for React:
    // Create a map of listeners that update a single state.

    // But wait, the original logic for unified chat was: "When any room has a new message, refetch all".
    // I will implement a simpler version where we listen to all rooms and merge.

    const messagesMap: Record<string, ChatMessage[]> = {};

    const listeners = roomIds.map(roomId => {
      const messagesRef = query(
        ref(database, `chatMessages/${roomId}`),
        orderByChild('timestamp'),
        limitToLast(100)
      );

      return onValue(messagesRef, (snapshot) => {
        const roomMsgs: ChatMessage[] = [];
        snapshot.forEach((child) => {
          roomMsgs.push({ id: child.key, ...child.val() } as ChatMessage);
        });
        messagesMap[roomId] = roomMsgs;

        // Merge and sort
        const allMessages = Object.values(messagesMap).flat();
        allMessages.sort((a, b) => {
          const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;
          const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;
          return timeA - timeB;
        });
        setMessages(allMessages);
      }, (error) => {
        console.error("Error listening to messages:", error);
      });
    });


    return () => listeners.forEach(unsub => unsub());
  }, [chatRoom, database, toast]);

  React.useEffect(() => {
    if (viewportRef.current) {
      setTimeout(() => {
        if (viewportRef.current) {
          viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [messages, preview]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessage.trim();
    if ((!text && !selectedFile) || !currentUser || !database || !chatRoom) return;

    const currentPartner = partner || (partners && partners.length > 0 ? partners[0] : null);
    if (!currentPartner) return;

    setIsSending(true);

    try {
      let targetRoomId: string | null;

      if (chatRoom.isProjectChat) {
        targetRoomId = chatRoom.id;
      } else {
        // Find or create direct chat
        // In RTDB, finding a chat by participants is scanning `chatRooms`.
        // To avoid full scan, we try to find one where current user is a participant?
        // Let's do a scan for now as volume is low, OR improvement:
        // Use a known ID if `chatRoom.id` is already valid.

        if (chatRoom.id && !chatRoom.isUnified) {
          targetRoomId = chatRoom.id;
        } else {
          // Need to find existing or create.
          // Simplified: Just query all chatRooms (expensive if many)
          // Better: `chatRooms` logic should be handled by a service or assume `chatRoom` passed is valid.
          // The prop `chatRoom` is passed. If it exists, use it.
          // The original logic checked for *direct* chat specifically inside `handleSendMessage` because `chatRoom` prop might be a placeholder?
          // "Find or create a non-project chat room to send the message"
          // This implies `chatRoom` passed might not be the right context if we are starting from a profile page?
          // If `chatRoom.id` exists, we trust it.
          targetRoomId = chatRoom.id;

          // If the chatRoom doesn't really exist in DB (e.g. optimistic UI), we create it.
          // Let's assume we need to verify existence or just blindly write to it?
          // RTDB allows blindly writing.

          // If we are "creating" a chat, we need an ID.
          if (!targetRoomId) {
            // Should not happen if chatRoom prop is typed safely, but let's handle.
            const newRef = push(ref(database, 'chatRooms'));
            targetRoomId = newRef.key!;
          }

          // Check if it exists to set initial data?
          const roomRef = ref(database, `chatRooms/${targetRoomId}`);
          const roomSnap = await get(roomRef);
          if (!roomSnap.exists()) {
            const participants = [currentUser.uid, currentPartner.id].sort();
            await update(roomRef, {
              id: targetRoomId,
              participantIds: participants,
              user1Id: participants[0],
              user2Id: participants[1],
              isProjectChat: false,
              updatedAt: serverTimestamp()
            }); // Use update instead of set to be safe
          }
        }
      }

      const uploadedMedia = await uploadFiles(selectedFile ? [selectedFile] : [], targetRoomId!);

      const messagesRef = ref(database, `chatMessages/${targetRoomId}`);
      const newMessageRef = push(messagesRef);
      const messageId = newMessageRef.key!;

      const messageData: any = {
        id: messageId,
        chatRoomId: targetRoomId,
        senderId: currentUser.uid,
        timestamp: serverTimestamp(),
      };

      if (text) messageData.message = text;
      if (uploadedMedia.length > 0) {
        const media = uploadedMedia[0];
        messageData.mediaType = media.type;
        messageData.mediaName = media.name;
        if (media.type === 'image') {
          messageData.imageUrl = media.url;
        } else {
          messageData.videoUrl = media.url;
          messageData.thumbnailUrl = media.thumbnailUrl || undefined;
        }
      }

      // Atomic update for message + room lastMessage
      const updates: Record<string, any> = {};
      updates[`chatMessages/${targetRoomId}/${messageId}`] = messageData;

      let lastMessageText = text;
      if (uploadedMedia.length > 0) {
        lastMessageText = uploadedMedia[0].type === 'image' ? 'Sent an image' : 'Sent a video';
        if (text) lastMessageText = text;
      }

      updates[`chatRooms/${targetRoomId}/lastMessage`] = {
        text: lastMessageText,
        timestamp: serverTimestamp(),
        senderId: currentUser.uid
      };

      updates[`chatRooms/${targetRoomId}/hasUnreadMessages/${currentUser.uid}`] = false;
      updates[`chatRooms/${targetRoomId}/hasUnreadMessages/${currentPartner.id}`] = true;

      await update(ref(database), updates);

      await sendNotification(currentPartner.id, {
        title: 'New Message',
        message: `You have a new message from ${currentUser.displayName || 'User'}`,
        type: chatRoom.isProjectChat ? 'project_chat' : 'direct_message',
        link: chatRoom.isProjectChat ? `/requests/${chatRoom.requestId}` : `/messages/${targetRoomId}`,
        relatedId: targetRoomId!
      });

      setNewMessage('');
      setSelectedFile(null);
      setPreview(null);

    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        variant: "destructive",
        title: "Error Sending Message",
        description: "Could not send your message. Please try again."
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedFile(file);

      const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
      let previewUrl = URL.createObjectURL(file);

      if (mediaType === 'video') {
        try {
          const thumbBlob = await captureVideoFrame(file, 'chat');
          if (thumbBlob) {
            previewUrl = URL.createObjectURL(thumbBlob);
          }
        } catch (error) {
          console.error("Could not generate video thumbnail for chat.", error);
        }
      }
      setPreview({ url: previewUrl, type: mediaType });
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const totalIsLoading = isUploading || isSending;

  const isCurrentUserParticipant = chatRoom?.participantIds.includes(currentUser?.uid || '') ?? false;
  const partnerName = finalPartners.map(p => p.name).join(' & ');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b p-4">
        {onBack && <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden"><ArrowLeft /></Button>}
        <div className="flex -space-x-2 rtl:space-x-reverse">
          {finalPartners.map(p => (
            <Avatar key={p.id} className="h-10 w-10 border">
              <AvatarImage src={p.photoURL} alt={p.name} />
              <AvatarFallback>{p.name?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="font-semibold truncate">{partnerName}</p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4" ref={viewportRef}>
            {messages.length === 0 && chatRoom ? (
              <div className="text-center text-muted-foreground pt-12">
                No messages yet. Say hello!
              </div>
            ) : messages.map((msg, index) => {
              const sender = allUsersMap?.get(msg.senderId);

              // In admin view (allUsersMap exists), align based on participant index. In user view, align based on current user.
              const isParticipant = chatRoom?.participantIds.includes(currentUser?.uid || '') ?? false;
              let alignRight;
              if (!isParticipant) { // Admin view
                alignRight = msg.senderId === chatRoom?.participantIds[1];
              } else { // Normal user view
                alignRight = msg.senderId === currentUser?.uid;
              }

              const showAvatar = (index === 0 || messages[index - 1].senderId !== msg.senderId);
              const mediaUrl = msg.imageUrl || msg.videoUrl;

              return (
                <div
                  key={msg.id}
                  className={cn(
                    'flex items-end gap-2',
                    alignRight ? 'justify-end' : 'justify-start'
                  )}
                >
                  {!alignRight && (
                    <div className="w-8 shrink-0">
                      {showAvatar && (
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={sender?.photoURL} />
                          <AvatarFallback>
                            {sender?.name?.charAt(0) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-xs rounded-lg p-2 text-sm lg:max-w-md space-y-2',
                      alignRight
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    {mediaUrl && msg.mediaName && (
                      <div className="space-y-2">
                        <a
                          href={mediaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "group relative block overflow-hidden rounded-lg border transition-all duration-200",
                            alignRight
                              ? "border-primary-foreground/20 hover:border-primary-foreground/40"
                              : "border-border hover:border-primary/40"
                          )}
                        >
                          {msg.mediaType === 'image' ? (
                            <div className="relative aspect-video w-full max-w-xs bg-muted/30">
                              <Image
                                src={msg.imageUrl!}
                                alt={msg.mediaName}
                                fill
                                className="object-cover transition-transform duration-200 group-hover:scale-105"
                                sizes="(max-width: 768px) 100vw, 400px"
                              />
                              <div className={cn(
                                "absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                              )} />
                              <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <div className="flex items-center gap-2 text-white">
                                  <FileImage className="h-4 w-4 shrink-0" />
                                  <span className="text-xs font-medium truncate">{msg.mediaName}</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              {msg.thumbnailUrl ? (
                                <div className="relative aspect-video w-full max-w-xs bg-muted/30">
                                  <Image
                                    src={msg.thumbnailUrl}
                                    alt={msg.mediaName}
                                    fill
                                    className="object-cover"
                                    sizes="(max-width: 768px) 100vw, 400px"
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                    <div className="rounded-full bg-white/90 p-3 shadow-lg">
                                      <Video className="h-6 w-6 text-primary" />
                                    </div>
                                  </div>
                                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                                    <div className="flex items-center gap-2 text-white">
                                      <FileVideo className="h-4 w-4 shrink-0" />
                                      <span className="text-xs font-medium truncate">{msg.mediaName}</span>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className={cn(
                                  "flex items-center gap-3 p-4 rounded-lg transition-colors",
                                  alignRight
                                    ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                                    : "bg-muted hover:bg-muted/80"
                                )}>
                                  <div className={cn(
                                    "rounded-lg p-2.5",
                                    alignRight ? "bg-primary-foreground/20" : "bg-primary/10"
                                  )}>
                                    <FileVideo className={cn(
                                      "h-5 w-5",
                                      alignRight ? "text-primary-foreground" : "text-primary"
                                    )} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{msg.mediaName}</p>
                                    <p className={cn(
                                      "text-xs mt-0.5",
                                      alignRight ? "text-primary-foreground/60" : "text-muted-foreground"
                                    )}>Video file</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </a>
                      </div>
                    )}
                    {msg.message && <p className="whitespace-pre-wrap break-words px-1">{msg.message}</p>}
                    <p className={cn("text-xs mt-1 text-right px-1", alignRight ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {msg.timestamp ? (
                        typeof msg.timestamp === 'number'
                          ? format(new Date(msg.timestamp), 'p')
                          : format(new Date(), 'p') // Fallback if serverTimestamp placeholder or unreadable
                      ) : ''}
                    </p>
                  </div>
                  {alignRight && (
                    <div className="w-8 shrink-0">
                      {showAvatar && (
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={sender?.photoURL} />
                          <AvatarFallback>
                            {sender?.name?.charAt(0) || currentUser?.displayName?.charAt(0) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
      <div className="border-t p-4">
        {preview && selectedFile && (
          <div className="mb-2 relative w-fit rounded-md border p-2 flex items-center gap-2">
            {preview.type === 'image' ? <FileImage className="h-5 w-5" /> : <Video className="h-5 w-5" />}
            <span className="text-sm truncate">{selectedFile.name}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={removeFile} >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <Input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,video/*"
            disabled={totalIsLoading}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={totalIsLoading || !!selectedFile}>
            <Paperclip />
          </Button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            autoComplete="off"
            disabled={!chatRoom || totalIsLoading || !isCurrentUserParticipant}
          />
          <Button type="submit" size="icon" disabled={(!newMessage.trim() && !selectedFile) || !chatRoom || totalIsLoading || !isCurrentUserParticipant}>
            {totalIsLoading ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
};
