import { useState, useEffect, useCallback } from 'react';
import { useUser, useDatabase } from '@/firebase';
import { ref, onValue, set, get, child } from 'firebase/database';
import { useToast } from '@/hooks/use-toast';

type FavoriteType = 'photographer' | 'request';

export function useFavorites(itemId: string, type: FavoriteType) {
    const { user } = useUser();
    const database = useDatabase();
    const { toast } = useToast();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const fieldName = type === 'photographer' ? 'favoritePhotographerIds' : 'favoriteRequestIds';

    useEffect(() => {
        if (!user || !database) {
            setIsFavorite(false);
            setIsLoading(false);
            return;
        }

        const userRef = ref(database, `users/${user.uid}/${fieldName}`);

        const unsubscribe = onValue(userRef, (snapshot) => {
            if (snapshot.exists()) {
                const favorites = snapshot.val();
                // Handle both array and object-map structures for flexibility
                if (Array.isArray(favorites)) {
                    setIsFavorite(favorites.includes(itemId));
                } else if (typeof favorites === 'object') {
                    setIsFavorite(!!favorites[itemId]);
                } else {
                    setIsFavorite(false);
                }
            } else {
                setIsFavorite(false);
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [user, database, itemId, fieldName]);

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

        if (!database) return;

        try {
            const favoritesRef = ref(database, `users/${user.uid}/${fieldName}`);
            const snapshot = await get(favoritesRef);
            let currentFavorites: any = snapshot.exists() ? snapshot.val() : [];

            // Convert to array if it is an object map
            let favoritesArray: string[] = [];
            if (Array.isArray(currentFavorites)) {
                favoritesArray = currentFavorites;
            } else if (typeof currentFavorites === 'object') {
                favoritesArray = Object.keys(currentFavorites);
            }

            if (isFavorite) {
                // Remove
                favoritesArray = favoritesArray.filter(id => id !== itemId);
                toast({ description: "Removed from favorites" });
            } else {
                // Add
                if (!favoritesArray.includes(itemId)) {
                    favoritesArray.push(itemId);
                }
                toast({ description: "Added to favorites" });
            }

            // Write back as array
            await set(favoritesRef, favoritesArray);

        } catch (error) {
            console.error("Error toggling favorite:", error);
            toast({
                title: "Error",
                description: "Could not update favorites. Please try again.",
                variant: 'destructive',
            });
        }
    }, [user, database, isFavorite, itemId, fieldName, toast]);

    return { isFavorite, toggleFavorite, isLoading };
}
