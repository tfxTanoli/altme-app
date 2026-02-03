'use client';

import * as React from 'react';
import { useUser, useDatabase } from '@/firebase';
import { ref, get, onValue, query, orderByChild, equalTo } from 'firebase/database';
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

// Helper to batch generic array processing if needed (though RTDB usually handles parallel gets ok)
// We will just use Promise.all
export default function FavoritesPage() {
    const database = useDatabase();
    const { user: currentUser } = useUser();

    const [favoritedPhotographers, setFavoritedPhotographers] = React.useState<EnrichedPhotographer[]>([]);
    const [favoritedRequests, setFavoritedRequests] = React.useState<ProjectRequest[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        if (!currentUser || !database) {
            if (!currentUser && !isLoading) {
                setFavoritedPhotographers([]);
                setFavoritedRequests([]);
                setIsLoading(false);
            }
            return;
        }

        const userRef = ref(database, `users/${currentUser.uid}`);

        const unsubscribe = onValue(userRef, async (snapshot) => {
            if (!snapshot.exists()) {
                setIsLoading(false);
                setFavoritedPhotographers([]);
                setFavoritedRequests([]);
                return;
            }

            const userData = snapshot.val();
            // Handle array or map structure
            const favoritePhotographerIds: string[] = Array.isArray(userData.favoritePhotographerIds)
                ? userData.favoritePhotographerIds
                : userData.favoritePhotographerIds ? Object.keys(userData.favoritePhotographerIds) : [];

            const favoriteRequestIds: string[] = Array.isArray(userData.favoriteRequestIds)
                ? userData.favoriteRequestIds
                : userData.favoriteRequestIds ? Object.keys(userData.favoriteRequestIds) : [];

            // Fetch Photographers
            if (favoritePhotographerIds.length > 0) {
                const enriched: EnrichedPhotographer[] = [];
                await Promise.all(favoritePhotographerIds.map(async (uid) => {
                    try {
                        const userSnap = await get(ref(database, `users/${uid}`));
                        if (!userSnap.exists()) return;

                        const user = { id: uid, ...userSnap.val() } as User;

                        // Fetch Profile
                        const profilesQuery = query(ref(database, 'photographerProfiles'), orderByChild('userId'), equalTo(uid));
                        const profileSnap = await get(profilesQuery);
                        let profile: PhotographerProfile | null = null;
                        let portfolioItems: PortfolioItem[] = [];

                        if (profileSnap.exists()) {
                            const pData = profileSnap.val();
                            const pid = Object.keys(pData)[0];
                            const rawProfile = pData[pid];
                            profile = { id: pid, ...rawProfile };

                            if (rawProfile.portfolioItems) {
                                // @ts-ignore
                                portfolioItems = Object.entries(rawProfile.portfolioItems).map(([k, v]: [string, any]) => ({ id: k, ...v }));
                                // Sort by createdAt desc
                                portfolioItems.sort((a, b) => {
                                    // Handle timestamp if string or number
                                    const tA = typeof a.createdAt === 'number' ? a.createdAt : 0;
                                    const tB = typeof b.createdAt === 'number' ? b.createdAt : 0;
                                    return tB - tA;
                                });
                            }
                        }

                        // Fetch reviews for rating
                        const reviewsQuery = query(ref(database, 'reviews'), orderByChild('revieweeId'), equalTo(uid));
                        const reviewsSnap = await get(reviewsQuery);
                        let totalRating = 0;
                        let count = 0;
                        if (reviewsSnap.exists()) {
                            reviewsSnap.forEach(c => {
                                totalRating += c.val().rating;
                                count++;
                            });
                        }
                        const averageRating = count > 0 ? totalRating / count : 0;

                        if (profile) {
                            enriched.push({
                                ...user,
                                profile,
                                portfolioItems,
                                averageRating,
                                reviewCount: count
                            });
                        }
                    } catch (e) {
                        console.error(`Error fetching favored photographer ${uid}`, e);
                    }
                }));
                setFavoritedPhotographers(enriched);
            } else {
                setFavoritedPhotographers([]);
            }

            // Fetch Requests
            if (favoriteRequestIds.length > 0) {
                const requests: ProjectRequest[] = [];
                await Promise.all(favoriteRequestIds.map(async (rid) => {
                    try {
                        const rSnap = await get(ref(database, `requests/${rid}`));
                        if (rSnap.exists()) {
                            requests.push({ id: rid, ...rSnap.val() } as ProjectRequest);
                        }
                    } catch (e) {
                        console.error(`Error fetching favored request ${rid}`, e);
                    }
                }));
                setFavoritedRequests(requests);
            } else {
                setFavoritedRequests([]);
            }

            setIsLoading(false);

        }, (error) => {
            console.error("Error listening to favorites:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser, database]);

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
