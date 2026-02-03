'use client';

import * as React from 'react';
import { useDatabase } from '@/firebase';
import { ref, query as rtdbQuery, orderByChild, equalTo, get } from 'firebase/database';
import type { User, PhotographerProfile, Review, PortfolioItem } from '@/lib/types';
import { Loader, Search, ListFilter, Star } from 'lucide-react';
import PhotographerCard from '@/components/photographers/photographer-card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { countries } from '@/lib/countries';
import { Button } from '@/components/ui/button';
import { useSearchParams } from 'next/navigation';

type EnrichedPhotographer = User & {
  profile: PhotographerProfile;
  portfolioItems: PortfolioItem[];
  averageRating: number;
  reviewCount: number;
};

export default function PhotographersPage() {
  const database = useDatabase();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialCountry = searchParams.get('country') || 'all';

  const [searchQuery, setSearchQuery] = React.useState(initialQuery);
  const [selectedCountry, setSelectedCountry] = React.useState(initialCountry);
  const [selectedRating, setSelectedRating] = React.useState(0);
  const [allPhotographers, setAllPhotographers] = React.useState<EnrichedPhotographer[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchAndEnrichPhotographers = async () => {
      if (!database) return;
      setIsLoading(true);

      try {
        // 1. Fetch Profiles first (to know which users to fetch)
        const profilesRef = rtdbQuery(ref(database, 'photographerProfiles'), orderByChild('isAcceptingRequests'), equalTo(true));

        // Fetch reviews in parallel (assuming reviews are readable as per rules)
        // Note: For scalability, we should ideally query reviews per photographer or use a cloud function, 
        // but fetching all reviews is acceptable for smaller datasets if rules allow ".read": true
        const reviewsRef = ref(database, 'reviews');

        const [profilesSnap, reviewsSnap] = await Promise.all([
          get(profilesRef),
          get(reviewsRef)
        ]);

        // Process RTDB Profiles
        const profiles: PhotographerProfile[] = [];
        const userIds = new Set<string>();

        if (profilesSnap.exists()) {
          profilesSnap.forEach(childSnap => {
            const profile = { id: childSnap.key, ...childSnap.val() } as PhotographerProfile;
            profiles.push(profile);
            if (profile.userId) {
              userIds.add(profile.userId);
            }
          });
        }

        // 2. Fetch ONLY the Users we need (respects "users/$uid" rule)
        const usersMap = new Map<string, User>();
        await Promise.all(Array.from(userIds).map(async (uid) => {
          try {
            const userSnap = await get(ref(database, `users/${uid}`));
            if (userSnap.exists()) {
              const userData = userSnap.val();
              if (userData.status !== 'deleted') {
                usersMap.set(uid, { id: uid, ...userData } as User);
              }
            }
          } catch (err) {
            console.warn(`Failed to fetch user ${uid}:`, err);
          }
        }));

        // Process RTDB Reviews
        const reviewsByReviewee = new Map<string, Review[]>();
        if (reviewsSnap.exists()) {
          reviewsSnap.forEach(childSnap => {
            const review = childSnap.val() as Review;
            if (!reviewsByReviewee.has(review.revieweeId)) {
              reviewsByReviewee.set(review.revieweeId, []);
            }
            reviewsByReviewee.get(review.revieweeId)!.push(review);
          });
        }

        // 3. Enrich data
        const enrichedData = profiles.map(profile => {
          let user = usersMap.get(profile.userId);

          // Fallback for guests
          if (!user && profile.name) {
            user = {
              id: profile.userId,
              name: profile.name || 'Unknown Photographer',
              photoURL: profile.photoURL,
              role: 'photographer',
              status: 'active',
              email: '',
              balance: 0,
            } as User;
          }

          // Only show profile if user data was successfully fetched or fell back
          if (!user) return null;

          const userReviews = reviewsByReviewee.get(profile.userId) || [];
          const averageRating = userReviews.length > 0
            ? userReviews.reduce((acc, r) => acc + r.rating, 0) / userReviews.length
            : 0;

          // Extract portfolio items from the profile object (if nested in RTDB)
          let portfolioItems: PortfolioItem[] = [];
          // @ts-ignore: Accessing potential child node
          if (profile.portfolioItems) {
            // @ts-ignore
            portfolioItems = Object.entries(profile.portfolioItems).map(([key, value]: [string, any]) => ({
              id: key,
              ...value
            }));
          }

          // Sort portfolio items (newest first or by createdAt if available)
          portfolioItems.sort((a, b) => {
            // @ts-ignore
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (Number(a.createdAt) || 0);
            // @ts-ignore
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (Number(b.createdAt) || 0);
            return (timeB as number) - (timeA as number);
          });

          // Limit to 10 items for the card
          portfolioItems = portfolioItems.slice(0, 10);

          return {
            ...user,
            profile,
            portfolioItems,
            averageRating,
            reviewCount: userReviews.length,
          };
        }).filter((p): p is EnrichedPhotographer => p !== null);

        setAllPhotographers(enrichedData);

      } catch (error) {
        console.error("Error fetching photographers:", error);
        setAllPhotographers([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndEnrichPhotographers();
  }, [database]);

  const filteredPhotographers = React.useMemo(() => {
    return allPhotographers.filter(p => {
      const matchesCountry = selectedCountry === 'all' || p.profile?.serviceCountry === selectedCountry;
      const matchesSearch = !searchQuery || (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesRating = selectedRating === 0 || p.averageRating >= selectedRating;
      return matchesCountry && matchesSearch && matchesRating;
    });
  }, [allPhotographers, searchQuery, selectedCountry, selectedRating]);

  const handleClearFilters = () => {
    setSelectedCountry('all');
    setSearchQuery('');
    setSelectedRating(0);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <h1 className="font-semibold text-lg md:text-2xl">
          Browse Photographers
        </h1>
        <div className="flex-1 md:ml-auto md:flex-grow-0">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
            <div className="relative w-full md:w-auto">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by name..."
                className="pl-8 h-9 w-full md:w-[200px] lg:w-[250px]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={selectedCountry} onValueChange={setSelectedCountry}>
              <SelectTrigger className="h-9 w-full md:w-auto gap-1">
                <ListFilter className="h-3.5 w-3.5" />
                <SelectValue placeholder="Filter by country" />
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
            <Select value={String(selectedRating)} onValueChange={(val) => setSelectedRating(Number(val))}>
              <SelectTrigger className="h-9 w-full md:w-auto gap-1">
                <Star className="h-3.5 w-3.5" />
                <SelectValue placeholder="Filter by rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All Ratings</SelectItem>
                <SelectItem value="4">4.0+ stars</SelectItem>
                <SelectItem value="3">3.0+ stars</SelectItem>
                <SelectItem value="2">2.0+ stars</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={handleClearFilters}>Clear</Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm" >
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredPhotographers && filteredPhotographers.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-8">
          {filteredPhotographers.map((photographer) => (
            <PhotographerCard key={photographer.id} photographer={photographer} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm" >
          <div className="flex flex-col items-center gap-1 text-center">
            <h3 className="text-2xl font-bold tracking-tight">
              No Photographers Found
            </h3>
            <p className="text-sm text-muted-foreground">
              Try adjusting your filters or check back later!
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
