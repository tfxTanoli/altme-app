
'use client';

import { useState, useRef } from 'react';
import { useDatabase, useStorage, useUser } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ref as dbRef, update, push, serverTimestamp, get } from 'firebase/database';
import { useToast } from './use-toast';
import type { ProjectRequest, ContentDelivery, ReferenceMedia } from '@/lib/types';
import { captureVideoFrame } from '@/lib/utils';
import { sendNotification } from '@/services/notifications';

export const useContentDeliveryUpload = (
    request: ProjectRequest | null,
    deliveries: ContentDelivery[],
    setDeliveries: React.Dispatch<React.SetStateAction<ContentDelivery[]>>
) => {
    const { user } = useUser();
    const storage = useStorage();
    const database = useDatabase();
    const { toast } = useToast();

    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0 || !request) {
            return;
        }

        if (!user || !database || !storage) {
            toast({
                variant: 'destructive',
                title: 'Cannot upload media',
                description: 'Required services are not available.',
            });
            return;
        }

        setIsUploading(true);

        const requestId = request.id;
        let uploadSuccessCount = 0;

        try {
            const mediaToUpload: ReferenceMedia[] = [];

            for (const file of Array.from(files)) {
                try {
                    const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
                    const storageRef = ref(storage, `content-deliveries/${requestId}/${Date.now()}_${file.name}`);
                    const uploadResult = await uploadBytes(storageRef, file);
                    const downloadURL = await getDownloadURL(uploadResult.ref);

                    let thumbnailUrl: string | null = null;
                    if (mediaType === 'video') {
                        const thumbnailBlob = await captureVideoFrame(file, 'delivery');
                        if (thumbnailBlob) {
                            const thumbnailRef = ref(storage, `content-deliveries/${requestId}/thumbnails/${Date.now()}_${file.name}.jpg`);
                            const thumbnailUploadResult = await uploadBytes(thumbnailRef, thumbnailBlob);
                            thumbnailUrl = await getDownloadURL(thumbnailUploadResult.ref);
                        }
                    }

                    mediaToUpload.push({
                        url: downloadURL,
                        thumbnailUrl: thumbnailUrl,
                        type: mediaType,
                        name: file.name,
                    });
                    uploadSuccessCount++;
                } catch (uploadError) {
                    console.error(`Error uploading file ${file.name}:`, uploadError);
                    toast({
                        variant: 'destructive',
                        title: `Upload failed for ${file.name}`,
                        description: 'Please try again.',
                    });
                }
            }

            if (mediaToUpload.length > 0) {
                const existingDelivery = deliveries.length > 0 ? deliveries[0] : null;
                const updates: Record<string, any> = {};
                let deliveryId = existingDelivery?.id;

                if (existingDelivery) {
                    // Append to existing delivery
                    // In RTDB, to append to an array, we need to know the index or use push keys.
                    // If 'files' is an array, we need to read it first or replace it?
                    // Safe way: Read current files, append, write back.
                    // OR use map structure for files.
                    // Given explicit array type in ReferenceMedia[], let's assume array.
                    // But to avoid race conditions, we should ideally use transaction or push keys.
                    // For now, let's just append to the list using a new push key logic if we change structure, OR read-modify-write.
                    // Since we have `deliveries` prop, we know the *current* state (optimistically).
                    // But let's be safe and just write to a new index if it's an array?
                    // RTDB arrays are object with integer keys.
                    // To append: `contentDeliveries/.../files/${nextIndex}` = item.
                    // Finding `nextIndex` is hard without reading.

                    // Let's use `get` to safeguard.
                    const deliveryRef = dbRef(database, `contentDeliveries/${requestId}/${deliveryId}`);
                    const snap = await get(deliveryRef);
                    if (snap.exists()) {
                        const currentData = snap.val() as ContentDelivery;
                        const currentFiles = currentData.files || [];
                        const newFiles = [...currentFiles, ...mediaToUpload];
                        updates[`contentDeliveries/${requestId}/${deliveryId}/files`] = newFiles;
                    }
                } else {
                    // Create new delivery
                    const newDeliveryRef = push(dbRef(database, `contentDeliveries/${requestId}`));
                    deliveryId = newDeliveryRef.key!;

                    const deliveryData: ContentDelivery = {
                        id: deliveryId,
                        requestId: requestId,
                        files: mediaToUpload,
                        deliveryDate: serverTimestamp() as any, // RTDB timestamp placeholder
                        isApproved: false
                    };
                    updates[`contentDeliveries/${requestId}/${deliveryId}`] = deliveryData;
                }

                // Update request status to 'Delivered' if it's 'In Progress'
                if (request.status === 'In Progress') {
                    updates[`requests/${requestId}/status`] = 'Delivered';
                }

                await update(dbRef(database), updates);

                await sendNotification(request.userId, {
                    title: 'Delivery Submitted',
                    message: `${uploadSuccessCount} file(s) have been delivered for "${request.title}".`,
                    type: 'delivery_submitted',
                    link: `/requests/${requestId}`,
                    relatedId: requestId
                });
            }

            if (uploadSuccessCount > 0) {
                toast({
                    title: 'Upload Complete!',
                    description: `${uploadSuccessCount} file(s) have been delivered.`,
                });
            }

        } catch (error: any) {
            console.error("Error committing delivery batch:", error);
            toast({
                variant: 'destructive',
                title: 'Delivery Failed',
                description: 'There was an issue saving the delivery information.',
            });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    return {
        isUploading,
        fileInputRef,
        handleFileChange,
        triggerFileInput,
    };
};
