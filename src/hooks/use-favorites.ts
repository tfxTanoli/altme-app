import { useState, useEffect, useCallback } from 'react';
import { useUser, useFirestore } from '@/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove, onSnapshot } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

type FavoriteType = 'photographer' | 'request';

export function useFavorites(itemId: string, type: FavoriteType) {
    const { user } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const fieldName = type === 'photographer' ? 'favoritePhotographerIds' : 'favoriteRequestIds';

    useEffect(() => {
        if (!user || !firestore) {
            setIsFavorite(false);
            setIsLoading(false);
            return;
        }

        // Listen to the user document to keep state in sync
        const userRef = doc(firestore, 'users', user.uid);
        const unsubscribe = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                const userData = docSnap.data();
                const favorites = userData[fieldName] || [];
                setIsFavorite(favorites.includes(itemId));
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [user, firestore, itemId, fieldName]);

    const toggleFavorite = useCallback(async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (!user) {
            toast({
                title: "Sign in required",
                description: "Please sign in to save favorites.",
                variant: 'destructive',
            });
            return;
        }

        if (!firestore) return;

        try {
            const userRef = doc(firestore, 'users', user.uid);
            if (isFavorite) {
                await updateDoc(userRef, {
                    [fieldName]: arrayRemove(itemId)
                });
                toast({ description: "Removed from favorites" });
            } else {
                await updateDoc(userRef, {
                    [fieldName]: arrayUnion(itemId)
                });
                toast({ description: "Added to favorites" });
            }
        } catch (error) {
            console.error("Error toggling favorite:", error);
            toast({
                title: "Error",
                description: "Could not update favorites. Please try again.",
                variant: 'destructive',
            });
        }
    }, [user, firestore, isFavorite, itemId, fieldName, toast]);

    return { isFavorite, toggleFavorite, isLoading };
}
