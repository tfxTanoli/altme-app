
'use client';

import * as React from 'react';
import { useFirestore, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { collection, query, where, getDocs, onSnapshot, doc, limit, orderBy } from 'firebase/firestore';
import { getDatabase, ref, get, query as rtdbQuery, orderByChild, equalTo } from 'firebase/database';
import type { User, PhotographerProfile, Review, PortfolioItem, ProjectRequest } from '@/lib/types';
import { Loader, Heart } from 'lucide-react';
import PhotographerCard from '@/components/photographers/photographer-card';
import RequestCard from '@/components/requests/request-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type EnrichedPhotographer = User & {
    profile: PhotographerProfile;
    portfolioItems?: PortfolioItem[];
    averageRating: number;
    reviewCount: number;
};

function splitIntoChunks<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}


export default function FavoritesPage() {
    const firestore = useFirestore();
    const { user: currentUser, isUserLoading } = useUser();

    const [favoritedPhotographers, setFavoritedPhotographers] = React.useState<EnrichedPhotographer[]>([]);
    const [favoritedRequests, setFavoritedRequests] = React.useState<ProjectRequest[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    const fetchFavorites = React.useCallback(async (photographerIds: string[], requestIds: string[]) => {
        if (!firestore) return;
        setIsLoading(true);

        try {
            // Fetch photographers
            if (photographerIds.length > 0) {
                const idChunks = splitIntoChunks(photographerIds, 30);
                const database = getDatabase();

                const photographerPromises = idChunks.map(async (chunk) => {
                    console.log("Processing chunk of IDs:", chunk);
                    // Fetch Profiles from RTDB by userId
                    // Since profiles are keyed by a Push ID but we have the User ID (from favorites),
                    // we need to query for the profile where userId matches.
                    const profilePromises = chunk.map(id => {
                        const profilesRef = rtdbQuery(ref(database, 'photographerProfiles'), orderByChild('userId'), equalTo(id));
                        return get(profilesRef);
                    });

                    const userPromises = chunk.map(id => get(ref(database, `users/${id}`)));
                    const reviewsQuery = query(collection(firestore, 'reviews'), where('revieweeId', 'in', chunk));

                    const [profileSnaps, userSnaps, reviewsSnap] = await Promise.all([
                        Promise.all(profilePromises),
                        Promise.all(userPromises),
                        getDocs(reviewsQuery)
                    ]);

                    const usersMap = new Map();
                    userSnaps.forEach(snap => {
                        console.log(`User snap for ${snap.key}: exists=${snap.exists()}`);
                        if (snap.exists()) usersMap.set(snap.key, { id: snap.key, ...snap.val() });
                    });

                    const profilesMap = new Map();
                    profileSnaps.forEach((snap, index) => {
                        // fetch is by query, so snap is a map of matches.
                        // Since userId is unique per profile usually (1:1), we take the first.
                        const requestedUserId = chunk[index];
                        if (snap.exists()) {
                            const data = snap.val();
                            const profileId = Object.keys(data)[0];
                            // Add the ID to the object
                            profilesMap.set(requestedUserId, { id: profileId, ...data[profileId] });
                        } else {
                            console.log(`No profile found for user ${requestedUserId}`);
                        }
                    });

                    const reviewsMap = new Map<string, Review[]>();
                    reviewsSnap.forEach(d => {
                        const review = d.data() as Review;
                        if (!reviewsMap.has(review.revieweeId)) reviewsMap.set(review.revieweeId, []);
                        reviewsMap.get(review.revieweeId)!.push(review);
                    });

                    const enriched: EnrichedPhotographer[] = [];

                    for (const userId of chunk) {
                        const user = usersMap.get(userId);
                        const profile = profilesMap.get(userId);

                        if (user && profile) {
                            const userReviews = reviewsMap.get(userId) || [];
                            const averageRating = userReviews.length > 0 ? userReviews.reduce((acc, r) => acc + r.rating, 0) / userReviews.length : 0;

                            let portfolioItems: PortfolioItem[] = [];
                            if (profile.portfolioItems) {
                                // @ts-ignore
                                portfolioItems = Object.entries(profile.portfolioItems).map(([key, value]: [string, any]) => ({
                                    id: key,
                                    ...value
                                }));
                                // Sort by createdAt desc if possible
                                portfolioItems.sort((a: any, b: any) => {
                                    const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (Number(a.createdAt) || 0);
                                    const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (Number(b.createdAt) || 0);
                                    return timeB - timeA;
                                });
                            }

                            enriched.push({
                                ...user,
                                profile,
                                portfolioItems,
                                averageRating,
                                reviewCount: userReviews.length,
                            });
                        } else {
                            console.warn(`Missing data for ${userId}: User=${!!user}, Profile=${!!profile}`);
                        }
                    }
                    return enriched;
                });
                // Await all chunk promises and flatten the result
                const results = (await Promise.all(photographerPromises)).flat();
                console.log("Final favorited photographers:", results);
                setFavoritedPhotographers(results);
            } else {
                setFavoritedPhotographers([]);
            }

            // Fetch requests
            if (requestIds.length > 0) {
                const requests: ProjectRequest[] = [];
                const idChunks = splitIntoChunks(requestIds, 30);
                for (const chunk of idChunks) {
                    if (chunk.length === 0) continue;
                    const requestsQuery = query(collection(firestore, 'requests'), where('__name__', 'in', chunk));
                    const snapshot = await getDocs(requestsQuery);
                    snapshot.forEach(doc => requests.push({ id: doc.id, ...doc.data() } as ProjectRequest));
                }
                setFavoritedRequests(requests);
            } else {
                setFavoritedRequests([]);
            }
        } catch (error) {
            console.error("Error fetching favorites:", error);
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: 'users/photographerProfiles/reviews/requests',
                operation: 'list'
            }));
        } finally {
            setIsLoading(false);
        }
    }, [firestore]);

    React.useEffect(() => {
        if (isUserLoading || !firestore) {
            return;
        }
        if (!currentUser) {
            setIsLoading(false);
            setFavoritedPhotographers([]);
            setFavoritedRequests([]);
            return;
        }

        const userDocRef = doc(firestore, 'users', currentUser.uid);
        const unsubscribe = onSnapshot(userDocRef, (userDoc) => {
            if (userDoc.exists()) {
                const userData = userDoc.data() as User;
                const photographerIds = userData.favoritePhotographerIds || [];
                const requestIds = userData.favoriteRequestIds || [];
                fetchFavorites(photographerIds, requestIds);
            } else {
                setIsLoading(false);
                setFavoritedPhotographers([]);
                setFavoritedRequests([]);
            }
        },
            (error) => {
                console.error('Error listening to user favorites:', error);
                errorEmitter.emit('permission-error', new FirestorePermissionError({
                    path: `users/${currentUser.uid}`,
                    operation: 'get',
                }));
                setIsLoading(false);
            });

        return () => unsubscribe();
    }, [currentUser, firestore, isUserLoading, fetchFavorites]);

    const renderEmptyState = (title: string, description: string) => (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm h-64">
            <div className="flex flex-col items-center gap-2 text-center">
                <Heart className="h-12 w-12 text-muted-foreground" />
                <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
        </div>
    );

    return (
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
            <div className="flex items-center">
                <h1 className="font-semibold text-lg md:text-2xl">My Favorites</h1>
            </div>

            {isLoading ? (
                <div className="flex flex-1 items-center justify-center">
                    <Loader className="h-8 w-8 animate-spin" />
                </div>
            ) : (
                <Tabs defaultValue="photographers">
                    <TabsList>
                        <TabsTrigger value="photographers">Photographers ({favoritedPhotographers.length})</TabsTrigger>
                        <TabsTrigger value="projects">Projects ({favoritedRequests.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="photographers">
                        <Card>
                            <CardHeader>
                                <CardTitle>Favorite Photographers</CardTitle>
                                <CardDescription>Your saved list of talented photographers.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {favoritedPhotographers.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-8">
                                        {favoritedPhotographers.map((photographer) => (
                                            <PhotographerCard key={photographer.id} photographer={photographer} />
                                        ))}
                                    </div>
                                ) : (
                                    renderEmptyState("No Favorite Photographers", "Browse photographers and click the heart to save them.")
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="projects">
                        <Card>
                            <CardHeader>
                                <CardTitle>Favorite Projects</CardTitle>
                                <CardDescription>Your saved list of interesting project requests.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {favoritedRequests.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-8">
                                        {favoritedRequests.map((request) => (
                                            <RequestCard key={request.id} request={request} />
                                        ))}
                                    </div>
                                ) : (
                                    renderEmptyState("No Favorite Projects", "Browse projects and click the heart to save them.")
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}
        </main>
    );
}
