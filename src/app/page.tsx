

'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Zap, Users, Star, ArrowUpRight, Loader, Search } from 'lucide-react';
import Image from 'next/image';
import { Logo } from '@/components/logo';
import { useUser, useAuth, useFirestore, useFirebase } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import type { PhotographerProfile, User as AppUser, PortfolioItem, Review, ProjectRequest } from '@/lib/types';
import { collection, query, limit, where, orderBy, getDocs } from 'firebase/firestore';
import { ref, query as rtdbQuery, orderByChild, equalTo, get } from 'firebase/database';
import React from 'react';
import Autoplay from "embla-carousel-autoplay"
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from "@/components/ui/carousel"
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { countries } from '@/lib/countries';
import dynamic from 'next/dynamic';

const PhotographerCard = dynamic(() => import('@/components/photographers/photographer-card'), {
    loading: () => <Card className="h-[420px] animate-pulse bg-muted-foreground/20" />
});

const RequestCard = dynamic(() => import('@/components/requests/request-card'), {
    loading: () => <Card className="h-[300px] animate-pulse bg-muted-foreground/20" />
});


type EnrichedPhotographer = AppUser & {
    profile: PhotographerProfile;
    portfolioItems: PortfolioItem[];
    averageRating: number;
    reviewCount: number;
};


export default function LandingPage() {
    const { user, isUserLoading } = useUser();
    const auth = useAuth();
    const router = useRouter();
    const firestore = useFirestore();

    const [featuredPhotographers, setFeaturedPhotographers] = React.useState<EnrichedPhotographer[]>([]);
    const [latestProjects, setLatestProjects] = React.useState<ProjectRequest[]>([]);
    const [isLoadingProfiles, setIsLoadingProfiles] = React.useState(true);
    const [isLoadingProjects, setIsLoadingProjects] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [searchType, setSearchType] = React.useState('projects');
    const [selectedCountry, setSelectedCountry] = React.useState('all');


    const { database } = useFirebase();

    React.useEffect(() => {
        if (!isUserLoading && user) {
            if (database) {
                const { ref, get } = require('firebase/database');
                const userRef = ref(database, `users/${user.uid}`);
                get(userRef).then((snapshot: any) => {
                    if (snapshot.exists() && snapshot.val().role === 'admin') {
                        router.push('/dashboard');
                    } else {
                        router.push('/requests');
                    }
                }).catch((error: any) => {
                    console.error("Error fetching user role:", error);
                    router.push('/requests');
                });
            }
        }
    }, [isUserLoading, user, router, database]);

    React.useEffect(() => {
        if (!firestore || !database) return;

        const fetchFeatured = async () => {
            setIsLoadingProfiles(true);
            try {
                // 1. Fetch Profiles from RTDB
                let profiles: PhotographerProfile[] = [];
                try {
                    const profilesRef = rtdbQuery(ref(database, 'photographerProfiles'), orderByChild('isAcceptingRequests'), equalTo(true));
                    const profilesSnap = await get(profilesRef);
                    if (profilesSnap.exists()) {
                        profilesSnap.forEach(childSnap => {
                            profiles.push({ id: childSnap.key, ...childSnap.val() } as PhotographerProfile);
                        });
                    }
                } catch (err) {
                    console.error("Error fetching profiles:", err);
                    throw err; // Critical failure
                }

                if (profiles.length === 0) {
                    setFeaturedPhotographers([]);
                    setIsLoadingProfiles(false);
                    return;
                }

                // 2. Fetch Users from RTDB (Individually to avoid root read permissions/performance issues)
                const usersMap = new Map<string, AppUser>();
                // Limit to fetching users for the profiles we found
                const userPromises = profiles.map(async (p) => {
                    try {
                        const userRef = ref(database, `users/${p.userId}`);
                        const snap = await get(userRef);
                        if (snap.exists()) {
                            return { id: snap.key, ...snap.val() } as AppUser;
                        }
                    } catch (err) {
                        console.warn(`Error fetching user ${p.userId}:`, err);
                    }
                    return null;
                });

                const usersResults = await Promise.all(userPromises);
                usersResults.forEach(u => {
                    if (u && u.status !== 'deleted') {
                        usersMap.set(u.id, u);
                    }
                });

                // 3. Fetch Reviews from Firestore (Batched by revieweeId to avoid scanning entire collection)
                const reviewsMap = new Map<string, Review[]>();
                const profileUserIds = profiles.map(p => p.userId).filter(id => usersMap.has(id));

                // Firestore 'in' query supports max 30 items. chunking by 10 for safety.
                const chunkSize = 10;
                const chunks = [];
                for (let i = 0; i < profileUserIds.length; i += chunkSize) {
                    chunks.push(profileUserIds.slice(i, i + chunkSize));
                }

                const reviewPromises = chunks.map(chunk => {
                    const reviewsQuery = query(
                        collection(firestore, 'reviews'),
                        where('revieweeId', 'in', chunk)
                    );
                    return getDocs(reviewsQuery);
                });

                const reviewsSnaps = await Promise.all(reviewPromises);

                reviewsSnaps.forEach(snap => {
                    snap.forEach(doc => {
                        const review = doc.data() as Review;
                        if (!reviewsMap.has(review.revieweeId)) reviewsMap.set(review.revieweeId, []);
                        reviewsMap.get(review.revieweeId)!.push(review);
                    });
                });

                // 4. Create Enriched Data
                const enrichedData = profiles.map(profile => {
                    const user = usersMap.get(profile.userId);
                    if (!user) return null;

                    const userReviews = reviewsMap.get(profile.userId) || [];
                    const averageRating = userReviews.length > 0
                        ? userReviews.reduce((acc, r) => acc + r.rating, 0) / userReviews.length
                        : 0;

                    let portfolioItems: PortfolioItem[] = [];
                    // @ts-ignore
                    if (profile.portfolioItems) {
                        // @ts-ignore
                        portfolioItems = Object.entries(profile.portfolioItems).map(([key, value]: [string, any]) => ({
                            id: key,
                            ...value
                        }));
                    }

                    return {
                        ...user,
                        profile,
                        portfolioItems,
                        averageRating,
                        reviewCount: userReviews.length,
                    };
                });

                // Filter and Sort
                const validPhotographers = enrichedData
                    .filter((p): p is EnrichedPhotographer => p !== null && p.reviewCount > 0)
                    .sort((a, b) => b.reviewCount - a.reviewCount)
                    .slice(0, 8);

                setFeaturedPhotographers(validPhotographers);

            } catch (error) {
                console.error("Error fetching featured profiles:", error);
            } finally {
                setIsLoadingProfiles(false);
            }
        };

        const fetchLatestProjects = async () => {
            setIsLoadingProjects(true);
            try {
                const projectsQuery = query(
                    collection(firestore, 'requests'),
                    where('status', '==', 'Open'),
                    orderBy('createdAt', 'desc'),
                    limit(4)
                );
                const projectsSnap = await getDocs(projectsQuery);
                const projects = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectRequest));
                setLatestProjects(projects);
            } catch (error) {
                console.error("Error fetching latest projects:", error);
            } finally {
                setIsLoadingProjects(false);
            }
        };

        // Fetch both in parallel
        Promise.all([fetchFeatured(), fetchLatestProjects()]);
    }, [firestore, database]);



    const handleLogout = async () => {
        try {
            await signOut(auth);
            localStorage.removeItem('userRole');
            router.push('/');
        } catch (error) {
            console.error('Error signing out: ', error);
        }
    };

    const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const query = searchQuery.trim();
        const countryQuery = selectedCountry === 'all' ? '' : `&country=${'selectedCountry'}`;
        const url = searchType === 'projects'
            ? `/requests/browse?q=${encodeURIComponent(query)}${countryQuery}`
            : `/photographers?q=${encodeURIComponent(query)}${countryQuery}`;
        router.push(url);
    };

    if (isUserLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen w-full flex-col bg-background">
                <header className="sticky top-0 z-40 w-full bg-background/80 backdrop-blur-sm">
                    <div className="container flex h-14 items-center">
                        <Link href="/">
                            <Logo />
                        </Link>
                        <nav className="ml-auto flex items-center gap-4 sm:gap-6">
                            <Button variant="ghost" asChild className="hover:bg-white hover:text-black">
                                <Link href="/login">Login</Link>
                            </Button>
                            <Button asChild>
                                <Link href="/signup">Sign Up</Link>
                            </Button>
                        </nav>
                    </div>
                </header>
                <main className="flex-1">
                    {/* Hero Section */}
                    <section className="relative w-full py-20 md:py-32 lg:py-40">
                        <div className="absolute inset-0 z-0 vertical-fade bg-gradient-to-br from-purple-300 from-30% via-blue-300 via-50% to-rose-300 to-80% bg-[length:200%_200%] animate-gradient-xy"></div>
                        <div className="container relative z-10 mx-auto px-4 md:px-6">
                            <div className="flex flex-col items-center space-y-8 text-center">
                                <div className="space-y-4">
                                    <h1 className="text-4xl font-semibold tracking-tighter sm:text-5xl md:text-6xl">
                                        Unlock Your Creativity with Order-Made Content
                                    </h1>
                                    <p className="mx-auto max-w-[700px] text-white md:text-xl">
                                        Stop compromising with stock photos. Request custom photos and videos from creators worldwide, made just for you.
                                    </p>
                                </div>
                                <div className="w-full max-w-4xl">
                                    <form onSubmit={handleSearch} className="flex flex-col gap-2 md:flex-row md:items-center md:rounded-full md:bg-white md:p-2 md:shadow-lg">
                                        <div className="flex flex-1 gap-2 p-2 bg-white rounded-full shadow-lg md:p-0 md:bg-transparent md:shadow-none">
                                            <Select value={searchType} onValueChange={setSearchType}>
                                                <SelectTrigger className="flex-1 rounded-full border-none bg-transparent pl-4 pr-2 focus:ring-0">
                                                    <SelectValue placeholder="Select type" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="projects">Projects</SelectItem>
                                                    <SelectItem value="photographers">Photographers</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <div className="hidden h-6 w-px bg-slate-200 md:block"></div>
                                            <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                                                <SelectTrigger className="flex-1 rounded-full border-none bg-transparent pl-4 pr-2 focus:ring-0">
                                                    <SelectValue placeholder="All Countries" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Countries</SelectItem>
                                                    {countries.map((country) => (
                                                        <SelectItem key={country.value} value={country.value}>
                                                            {country.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="hidden h-6 w-px bg-slate-200 md:my-auto md:block"></div>
                                        <div className="flex flex-1 items-center rounded-full bg-white p-2 shadow-lg md:bg-transparent md:p-0 md:shadow-none">
                                            <Search className="ml-2 h-5 w-5 text-muted-foreground" />
                                            <Input
                                                type="search"
                                                placeholder={searchType === 'projects' ? 'Search for projects...' : 'Search for photographers...'}
                                                className="h-11 flex-1 border-none bg-transparent text-base focus-visible:ring-0"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                            />
                                            <Button type="submit" size="lg" className="rounded-full">
                                                Search
                                            </Button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Latest Projects Section */}
                    <section id="latest-projects" className="w-full py-12 md:py-24 lg:py-32">
                        <div className="container mx-auto px-4 md:px-6">
                            <div className="flex flex-col items-center justify-center space-y-4 text-center">
                                <div className="space-y-2">
                                    <h2 className="text-3xl font-semibold tracking-tighter sm:text-5xl">
                                        Latest Projects
                                    </h2>
                                    <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                                        Check out the most recent requests from clients around the world.
                                    </p>
                                </div>
                            </div>
                            <div className="py-12">
                                {isLoadingProjects ? (
                                    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
                                        {Array.from({ length: 4 }).map((_, i) => (
                                            <Card key={i} className="h-[300px] animate-pulse bg-muted-foreground/20" />
                                        ))}
                                    </div>
                                ) : latestProjects.length > 0 ? (
                                    <Carousel
                                        opts={{
                                            align: "start",
                                            loop: true,
                                        }}
                                        plugins={[
                                            Autoplay({
                                                delay: 3000,
                                                stopOnInteraction: true,
                                            }),
                                        ]}
                                        className="w-full"
                                    >
                                        <CarouselContent>
                                            {latestProjects.map(project => (
                                                <CarouselItem key={project.id} className="basis-2/3 sm:basis-1/2 lg:basis-1/4">
                                                    <div className="p-1">
                                                        <RequestCard request={project} />
                                                    </div>
                                                </CarouselItem>
                                            ))}
                                        </CarouselContent>
                                        <CarouselPrevious className="-left-4 hidden lg:flex" />
                                        <CarouselNext className="-right-4 hidden lg:flex" />
                                    </Carousel>
                                ) : (
                                    <div className="col-span-full text-center text-muted-foreground">
                                        No open projects right now. Check back soon!
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-center">
                                <Button asChild>
                                    <Link href="/requests/browse">
                                        Browse All Projects <ArrowUpRight className="ml-2 h-4 w-4" />
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </section>


                    {/* Featured Creators Section */}
                    <section id="featured-creators" className="w-full py-12 md:py-24 lg:py-32 relative">
                        <div className="absolute inset-0 z-0 vertical-fade bg-gradient-to-br from-purple-300 from-30% via-blue-300 via-50% to-rose-300 to-80% bg-[length:200%_200%] animate-gradient-xy"></div>
                        <div className="container relative z-10 mx-auto px-4 md:px-6">
                            <div className="flex flex-col items-center justify-center space-y-4 text-center">
                                <div className="space-y-2">
                                    <h2 className="text-3xl font-semibold tracking-tighter sm:text-5xl">
                                        Featured Creators
                                    </h2>
                                    <p className="max-w-[900px] text-white md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                                        Explore a curated selection of our most talented and sought-after photographers.
                                    </p>
                                </div>
                            </div>
                            <div className="py-12">
                                {isLoadingProfiles ? (
                                    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 lg:gap-8">
                                        {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-[420px] animate-pulse bg-muted-foreground/20" />)}
                                    </div>
                                ) : featuredPhotographers.length > 0 ? (
                                    <Carousel
                                        opts={{
                                            align: "start",
                                            loop: true,
                                        }}
                                        plugins={[
                                            Autoplay({
                                                delay: 3000,
                                                stopOnInteraction: true,
                                            }),
                                        ]}
                                        className="w-full"
                                    >
                                        <CarouselContent>
                                            {featuredPhotographers.map((photographer) => (
                                                <CarouselItem key={photographer.id} className="basis-2/3 sm:basis-1/2 md:basis-1/3 lg:basis-1/4">
                                                    <div className="p-1">
                                                        <PhotographerCard photographer={photographer} />
                                                    </div>
                                                </CarouselItem>
                                            ))}
                                        </CarouselContent>
                                        <CarouselPrevious className="hidden lg:flex" />
                                        <CarouselNext className="hidden lg:flex" />
                                    </Carousel>
                                ) : (
                                    <div className="text-center text-white">No photographers to feature yet.</div>
                                )}
                            </div>
                            <div className="flex justify-center">
                                <Button asChild>
                                    <Link href="/photographers">
                                        Browse All Photographers <ArrowUpRight className="ml-2 h-4 w-4" />
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </section>
                </main>

                {/* Footer */}
                <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t">
                    <p className="text-xs text-muted-foreground sm:order-1 order-2 mt-2 sm:mt-0">&copy; 2025 AltMe. All rights reserved.</p>
                    <nav className="sm:ml-auto flex gap-4 sm:gap-6 flex-wrap justify-center sm:order-2 order-1">
                        <Link href="/how-it-works" className="text-xs hover:underline underline-offset-4" prefetch={false}>
                            How it Works
                        </Link>
                        <Link href="/terms-of-service" className="text-xs hover:underline underline-offset-4" prefetch={false}>
                            Terms of Service
                        </Link>
                        <Link href="/privacy" className="text-xs hover:underline underline-offset-4" prefetch={false}>
                            Privacy
                        </Link>
                        <Link href="/contact" className="text-xs hover:underline underline-offset-4" prefetch={false}>
                            Contact
                        </Link>
                        <Link href="/legal/sct" className="text-xs hover:underline underline-offset-4" prefetch={false}>
                            Legal Notice
                        </Link>
                    </nav>
                </footer>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-full items-center justify-center">
            <Loader className="h-8 w-8 animate-spin" />
        </div>
    );
}
