

'use client';

import { useState } from 'react';
import { useStorage, useUser } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useToast } from './use-toast';
import type { ReferenceMedia } from '@/lib/types';
import { captureVideoFrame } from '@/lib/utils';

export const useRequestMediaUpload = () => {
    const { user } = useUser();
    const storage = useStorage();
    const { toast } = useToast();

    const [isUploading, setIsUploading] = useState(false);

    const uploadFiles = async (files: File[]): Promise<ReferenceMedia[]> => {
        if (files.length === 0) {
            return [];
        }

        if (!user || !storage) {
            toast({ variant: 'destructive', title: 'Error', description: 'User or Firebase Storage not available.' });
            return [];
        }

        setIsUploading(true);

        try {
            // Parallel upload of all files
            const uploadPromises = files.map(async (file) => {
                const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
                const storageRef = ref(storage, `request-media/${user.uid}/${Date.now()}_${file.name}`);
                
                // Upload file and generate thumbnail in parallel for videos
                const uploadPromise = uploadBytes(storageRef, file).then(result => getDownloadURL(result.ref));
                
                let thumbnailPromise: Promise<string | null> = Promise.resolve(null);
                if (mediaType === 'video') {
                    thumbnailPromise = captureVideoFrame(file, 'request').then(async (thumbnailBlob) => {
                        if (thumbnailBlob) {
                            const thumbnailRef = ref(storage, `request-media/${user.uid}/thumbnails/${Date.now()}_${file.name}.jpg`);
                            const thumbnailUploadResult = await uploadBytes(thumbnailRef, thumbnailBlob);
                            return getDownloadURL(thumbnailUploadResult.ref);
                        }
                        return null;
                    });
                }

                // Wait for both upload and thumbnail to complete
                const [downloadURL, thumbnailUrl] = await Promise.all([uploadPromise, thumbnailPromise]);

                return {
                    url: downloadURL,
                    thumbnailUrl,
                    type: mediaType,
                    name: file.name,
                } as ReferenceMedia;
            });

            const uploadedMedia = await Promise.all(uploadPromises);
            return uploadedMedia;
            
        } catch (error: any) {
            console.error("Request media upload failed:", error);
            toast({
                variant: 'destructive',
                title: 'Upload Failed',
                description: error.message || 'There was a problem uploading your files.',
            });
            return [];
        } finally {
            setIsUploading(false);
        }
    };

    return {
        isUploading,
        uploadFiles,
    };
};
