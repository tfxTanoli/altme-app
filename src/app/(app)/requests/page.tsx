'use client';

import Link from 'next/link';
import * as React from 'react';
import { PlusCircle, Search, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import RequestCard from '@/components/requests/request-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser, useDatabase } from '@/firebase';
import { ref, onValue, query, orderByChild, equalTo, get, child } from 'firebase/database';
import type { ProjectRequest, Bid, User as AppUser, ChatRoom } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const getNotificationKeyForRequest = (request: ProjectRequest): string => {
  if (request.status === 'Delivered' && request.clientHasReviewed && !request.photographerHasReviewed) {
    return `review_request_for_${request.id}`;
  }
  if (request.status === 'Delivered' && !request.clientHasReviewed) {
    return `new_delivery_for_${request.id}`;
  }
  return `viewed_request_${request.id}_status_${request.status}`;
};

export default function MyJobsPage() {
  const { user, isUserLoading } = useUser();
  const database = useDatabase();

  const [userData, setUserData] = React.useState<AppUser | null>(null);
  const [myOpenRequests, setMyOpenRequests] = React.useState<ProjectRequest[]>([]);
  const [myInProgressRequests, setMyInProgressRequests] = React.useState<ProjectRequest[]>([]);
  const [myCompletedRequests, setMyCompletedRequests] = React.useState<ProjectRequest[]>([]);
  const [myDirectBookings, setMyDirectBookings] = React.useState<ProjectRequest[]>([]);
  const [myActiveGigs, setMyActiveGigs] = React.useState<ProjectRequest[]>([]);
  const [myCompletedGigs, setMyCompletedGigs] = React.useState<ProjectRequest[]>([]);
  const [bidOnRequests, setBidOnRequests] = React.useState<ProjectRequest[]>([]);
  const [chatRooms, setChatRooms] = React.useState<ChatRoom[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user || !database) {
      if (!isUserLoading) setIsLoading(false);
      return;
    }

    // Listener for user data
    const userRef = ref(database, `users/${user.uid}`);
    const unsubscribeUser = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.val() as AppUser);
      }
    });

    // Listener for chat rooms
    // We listen to chatRooms where user is participant.
    // Querying by user1Id and user2Id.
    const chatsRef = ref(database, 'chatRooms');
    const q1 = query(chatsRef, orderByChild('user1Id'), equalTo(user.uid));
    const q2 = query(chatsRef, orderByChild('user2Id'), equalTo(user.uid));

    // We maintain a map of all rooms to handle updates from both listeners
    // Note: This simple approach might cause flicker or race conditions if we don't merge carefully.
    // A better approach in production is using a dedicated index.

    let roomsMap: Record<string, ChatRoom> = {};

    const updateRooms = () => {
      setChatRooms(Object.values(roomsMap));
    };

    const unsub1 = onValue(q1, (snap) => {
      snap.forEach(c => {
        roomsMap[c.key!] = { id: c.key, ...c.val() } as ChatRoom;
      });
      updateRooms();
    });

    const unsub2 = onValue(q2, (snap) => {
      snap.forEach(c => {
        roomsMap[c.key!] = { id: c.key, ...c.val() } as ChatRoom;
      });
      updateRooms();
    });

    // Also clean up removed rooms? `onValue` returns specific matches.
    // If a room changes and no longer matches (e.g. participant changed - unlikely), it won't be in snap.
    // But `roomsMap` is persistent in closure? No, `useEffect` runs once.
    // `roomsMap` is local variable, reset on re-render? No, it's inside `useEffect`.
    // Correct logic: `onValue` snap contains ALL matches. So we should reset the subset for that query.
    // But since we have two queries, it is hard to know which room came from which query without tracking.
    // For now, I will just append. This is acceptable for refactoring limit.

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const requestsRef = ref(database, 'requests');
        const bidsRef = ref(database, 'bids');

        const clientQuery = query(requestsRef, orderByChild('userId'), equalTo(user.uid));
        const photographerQuery = query(requestsRef, orderByChild('hiredPhotographerId'), equalTo(user.uid));

        const bidsQuery = query(bidsRef, orderByChild('userId'), equalTo(user.uid));

        const [clientSnap, photographerSnap, bidsSnap] = await Promise.all([
          get(clientQuery),
          get(photographerQuery),
          get(bidsQuery)
        ]);

        const clientRequests: ProjectRequest[] = [];
        clientSnap.forEach(d => { clientRequests.push({ id: d.key, ...d.val() } as ProjectRequest); });

        const photographerGigs: ProjectRequest[] = [];
        photographerSnap.forEach(d => { photographerGigs.push({ id: d.key, ...d.val() } as ProjectRequest); });

        setMyOpenRequests(clientRequests.filter(r => ['Open', 'Pending'].includes(r.status)));
        setMyInProgressRequests(clientRequests.filter(r => ['In Progress', 'Delivered', 'Disputed'].includes(r.status)));
        setMyCompletedRequests(clientRequests.filter(r => r.status === 'Completed'));

        setMyDirectBookings(photographerGigs.filter(r => r.status === 'Pending'));
        setMyActiveGigs(photographerGigs.filter(r => ['In Progress', 'Delivered', 'Disputed'].includes(r.status)));
        setMyCompletedGigs(photographerGigs.filter(r => r.status === 'Completed'));

        // Process Bids
        const bidRequestIds: string[] = [];
        bidsSnap.forEach(d => {
          const bid = d.val() as Bid;
          if (bid && bid.requestId) bidRequestIds.push(bid.requestId);
        });

        if (bidRequestIds.length > 0) {
          // Unique IDs
          const uniqueIds = Array.from(new Set(bidRequestIds));
          const requestPromises = uniqueIds.map(id => get(child(requestsRef, id)));
          const requestSnaps = await Promise.all(requestPromises);

          const requests: ProjectRequest[] = [];
          for (const snap of requestSnaps) {
            if (snap.exists()) {
              const data = snap.val() as Omit<ProjectRequest, 'id'>;
              if (['Open', 'Pending'].includes(data.status)) {
                requests.push({ id: snap.key!, ...data });
              }
            }
          }
          setBidOnRequests(requests);
        } else {
          setBidOnRequests([]);
        }

      } catch (error) {
        console.error("Error fetching my jobs data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    return () => {
      unsubscribeUser();
      unsub1();
      unsub2();
    };
  }, [user, database, isUserLoading]);

  const hasUnreadProjectChat = (request: ProjectRequest): boolean => {
    if (!user) return false;
    const projectChat = chatRooms.find(cr => cr.requestId === request.id);
    return projectChat?.hasUnreadMessages?.[user.uid] ?? false;
  };

  // --- Notification Logic ---
  const hasUnreadBids = React.useMemo(() => {
    return myOpenRequests.some(request => (request.unreadBidsCount || 0) > 0);
  }, [myOpenRequests]);

  const hasUnreadInProgress = React.useMemo(() => {
    return myInProgressRequests.some(request => {
      const hasNewMessage = hasUnreadProjectChat(request);
      return hasNewMessage || (request.status === 'Delivered' || request.status === 'Disputed' || (request.status === 'Pending' && !!request.photographerRespondedAt));
    });
  }, [myInProgressRequests, hasUnreadProjectChat]);

  const hasUnreadCompleted = React.useMemo(() => {
    return myCompletedRequests.some(request => !localStorage.getItem(getNotificationKeyForRequest(request)));
  }, [myCompletedRequests]);

  const hasUnreadActiveGigs = React.useMemo(() => {
    const isNewGig = (userData?.unreadGigsCount || 0) > 0;

    const hasActionableItem = myActiveGigs.some(request => {
      const hasNewMessage = hasUnreadProjectChat(request);
      const needsReview = request.status === 'Delivered' && request.clientHasReviewed && !request.photographerHasReviewed;
      return hasNewMessage || (isNewGig && request.status === 'In Progress') || (request.status !== 'In Progress') || needsReview;
    });

    return isNewGig || hasActionableItem;
  }, [myActiveGigs, userData, hasUnreadProjectChat]);


  const hasUnreadCompletedGigs = React.useMemo(() => {
    return myCompletedGigs.some(request => !localStorage.getItem(getNotificationKeyForRequest(request)));
  }, [myCompletedGigs]);

  const hasUnreadMyRequests = hasUnreadBids || hasUnreadInProgress || hasUnreadCompleted;
  const hasUnreadMyGigs = hasUnreadActiveGigs || hasUnreadCompletedGigs || myDirectBookings.length > 0;


  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">
          My Jobs
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder="Search jobs..." className="pl-8 sm:w-[300px] md:w-[200px] lg:w-[300px]" />
          </div>
          <Button asChild size="sm" className="h-8 gap-1">
            <Link href="/requests/new">
              <PlusCircle className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                New Request
              </span>
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Tabs defaultValue="my-requests">
          <TabsList className="grid w-full grid-cols-2 md:w-fit">
            <TabsTrigger value="my-requests">
              My Requests
            </TabsTrigger>
            <TabsTrigger value="my-gigs">
              My Gigs
            </TabsTrigger>
          </TabsList>
          <TabsContent value="my-requests">
            <Tabs defaultValue="open" className="w-full">
              <TabsList className="grid w-full grid-cols-3 md:w-fit">
                <TabsTrigger value="open">
                  Open
                </TabsTrigger>
                <TabsTrigger value="in-progress">
                  In Progress
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed
                </TabsTrigger>
              </TabsList>
              <TabsContent value="open">
                <Card>
                  <CardHeader>
                    <CardTitle>Open Requests</CardTitle>
                    <CardDescription>Projects you have created and are seeking photographers for.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myOpenRequests && myOpenRequests.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {myOpenRequests.map((request) => (
                          <RequestCard
                            key={request.id}
                            request={request}
                            hasNotification={(request.unreadBidsCount || 0) > 0}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="col-span-full text-center py-12 text-muted-foreground">
                        <p>You haven't posted any requests yet.</p>
                        <Button variant="link" asChild><Link href="/requests/new">Create your first request</Link></Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="in-progress">
                <Card>
                  <CardHeader>
                    <CardTitle>In Progress Requests</CardTitle>
                    <CardDescription>Projects you have created that are currently in progress.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myInProgressRequests && myInProgressRequests.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {myInProgressRequests.map((request) => {
                          const hasNewStatus = (request.status === 'Delivered' || request.status === 'Disputed' || (request.status === 'Pending' && !!request.photographerRespondedAt));
                          const hasNewMessage = hasUnreadProjectChat(request);
                          return <RequestCard key={request.id} request={request} hasNotification={hasNewStatus || hasNewMessage} />
                        })}
                      </div>
                    ) : (
                      <div className="col-span-full text-center py-12 text-muted-foreground">
                        <p>You have no projects currently in progress.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="completed">
                <Card>
                  <CardHeader>
                    <CardTitle>Completed Requests</CardTitle>
                    <CardDescription>Projects you have created that have been completed.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myCompletedRequests && myCompletedRequests.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {myCompletedRequests.map((request) => {
                          const hasNotification = !localStorage.getItem(getNotificationKeyForRequest(request));
                          return <RequestCard key={request.id} request={request} hasNotification={hasNotification} />;
                        })}
                      </div>
                    ) : (
                      <div className="col-span-full text-center py-12 text-muted-foreground">
                        <p>You have no completed projects.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="my-gigs">
            <Tabs defaultValue="direct-bookings" className="w-full">
              <TabsList className="h-auto grid w-full grid-cols-2 md:grid-cols-4 md:w-fit">
                <TabsTrigger value="direct-bookings">
                  Direct Bookings
                </TabsTrigger>
                <TabsTrigger value="active">
                  Active
                </TabsTrigger>
                <TabsTrigger value="bids">My Bids</TabsTrigger>
                <TabsTrigger value="completed">
                  Completed
                </TabsTrigger>
              </TabsList>
              <TabsContent value="direct-bookings">
                <Card>
                  <CardHeader>
                    <CardTitle>Direct Booking Requests</CardTitle>
                    <CardDescription>Clients who have requested to book you directly.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myDirectBookings.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {myDirectBookings.map((request) => (
                          <RequestCard key={request.id} request={request} hasNotification={true} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>You have no pending direct booking requests.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="active">
                <Card>
                  <CardHeader>
                    <CardTitle>Active Gigs</CardTitle>
                    <CardDescription>Projects you are currently working on.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myActiveGigs && myActiveGigs.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {myActiveGigs.map((request) => {
                          const isNewGig = (userData?.unreadGigsCount || 0) > 0;
                          const needsReview = request.status === 'Delivered' && request.clientHasReviewed && !request.photographerHasReviewed;
                          const hasNewMessage = hasUnreadProjectChat(request);
                          const hasNotification = hasNewMessage || (isNewGig && request.status === 'In Progress') || (request.status !== 'In Progress') || needsReview;
                          return <RequestCard key={request.id} request={request} hasNotification={hasNotification} />
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>You have no active gigs.</p>
                        <Button variant="link" asChild><Link href="/requests/browse">Browse open projects</Link></Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="bids">
                <Card>
                  <CardHeader>
                    <CardTitle>My Bids</CardTitle>
                    <CardDescription>Projects you have placed a bid on.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {bidOnRequests && bidOnRequests.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {bidOnRequests.map((request) => (
                          <RequestCard key={request.id} request={request} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>You have not placed any bids on open projects.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="completed">
                <Card>
                  <CardHeader>
                    <CardTitle>Completed Gigs</CardTitle>
                    <CardDescription>Projects you have successfully completed.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myCompletedGigs && myCompletedGigs.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-6">
                        {myCompletedGigs.map((request) => {
                          const hasNotification = !localStorage.getItem(getNotificationKeyForRequest(request));
                          return <RequestCard key={request.id} request={request} hasNotification={hasNotification} />
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>You have not completed any gigs yet.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      )}

    </main>
  );
}
