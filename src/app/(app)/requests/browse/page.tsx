

'use client';

import * as React from 'react';
import { ListFilter, Loader, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import RequestCard from '@/components/requests/request-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { countries } from '@/lib/countries';
import { useDatabase } from '@/firebase';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import type { ProjectRequest } from '@/lib/types';
import { useSearchParams } from 'next/navigation';


export default function BrowseRequestsPage() {
  const database = useDatabase();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialCountry = searchParams.get('country') || 'all';

  const [searchQuery, setSearchQuery] = React.useState(initialQuery);
  const [selectedCountry, setSelectedCountry] = React.useState(initialCountry);
  const [allOpenRequests, setAllOpenRequests] = React.useState<ProjectRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);


  React.useEffect(() => {
    if (!database) return;

    const fetchRequests = async () => {
      setIsLoading(true);
      try {
        // Query requests with status 'Open'
        const requestsRef = ref(database, 'requests');
        const openRequestsQuery = query(requestsRef, orderByChild('status'), equalTo('Open'));

        const snapshot = await get(openRequestsQuery);

        if (snapshot.exists()) {
          const requestsData: ProjectRequest[] = [];
          snapshot.forEach((childSnapshot) => {
            requestsData.push({ id: childSnapshot.key, ...childSnapshot.val() } as ProjectRequest);
          });
          setAllOpenRequests(requestsData);
        } else {
          setAllOpenRequests([]);
        }

      } catch (error) {
        console.error("Error fetching requests:", error);
        setAllOpenRequests([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchRequests();
  }, [database]); // Removed selectedCountry from dependency as filtering is now done client-side if needed, or we filter the result below

  const filteredRequests = React.useMemo(() => {
    if (!allOpenRequests) return [];

    return allOpenRequests.filter(request => {
      const matchesSearch = searchQuery
        ? request.title.toLowerCase().includes(searchQuery.toLowerCase())
        : true;

      const matchesCountry = selectedCountry && selectedCountry !== 'all'
        ? request.country === selectedCountry
        : true;

      return matchesSearch && matchesCountry;
    });

  }, [allOpenRequests, searchQuery, selectedCountry]);


  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">
          Browse Projects
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger className="h-9 w-auto gap-1">
              <ListFilter className="h-3.5 w-3.5" />
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
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search..."
              className="pl-8 h-9 sm:w-[200px] md:w-[200px] lg:w-[300px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm" >
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredRequests && filteredRequests.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-8">
          {filteredRequests.map((request) => (
            <RequestCard key={request.id} request={request} hideStatus={true} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm" >
          <div className="flex flex-col items-center gap-1 text-center">
            <h3 className="text-2xl font-bold tracking-tight">
              No matching projects
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

