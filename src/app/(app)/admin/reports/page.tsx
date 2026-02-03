
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useDatabase, useUser } from '@/firebase'; // Use useDatabase, removed Firestore imports
import { ref, get, query, orderByChild, update } from 'firebase/database'; // RTDB imports
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader, User, FileText } from 'lucide-react';
import { format } from 'date-fns';
import type { Report, User as AppUser } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type EnrichedReport = Report & {
    reporter?: AppUser;
    reportedUser?: AppUser;
};

const ReportList = ({ reports, type }: { reports: EnrichedReport[], type: 'user' | 'request' }) => {
    const { user: currentUser } = useUser();
    const database = useDatabase();

    const handleReportRead = useCallback(async (reportId: string) => {
        if (!currentUser || !database) return;

        const viewedReportKey = `viewed_report_${reportId}`;
        if (sessionStorage.getItem(viewedReportKey)) {
            return; // Already viewed in this session
        }

        try {
            const userRef = ref(database, `users/${currentUser.uid}`);
            // Fetch current count to decrement safely
            const snapshot = await get(userRef);
            if (snapshot.exists()) {
                const data = snapshot.val();
                const currentCount = data.openReportsCount || 0;
                if (currentCount > 0) {
                    await update(userRef, { openReportsCount: currentCount - 1 });
                }
            }
            sessionStorage.setItem(viewedReportKey, 'true');
        } catch (error) {
            console.error("Error marking report as read:", error);
        }

    }, [currentUser, database]);

    if (reports.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <p>There are no {type} reports in the inbox.</p>
            </div>
        );
    }

    const getContextLink = (report: EnrichedReport) => {
        if (report.context.type === 'user') {
            return `/photographers/${report.context.id}`;
        }
        if (report.context.type === 'request') {
            return `/requests/${report.context.id}`;
        }
        return '#';
    };

    return (
        <Accordion type="single" collapsible className="w-full" onValueChange={(value) => value && handleReportRead(value)}>
            {reports.map((report) => (
                <AccordionItem value={report.id} key={report.id}>
                    <AccordionTrigger>
                        <div className="flex justify-between items-center w-full pr-4">
                            <div className="flex flex-col text-left">
                                <Badge variant="destructive" className="w-fit mb-2">{report.reason}</Badge>
                                <div className="font-medium">
                                    <span className="text-muted-foreground">Reported:</span> {report.reportedUser?.name || 'Unknown User'}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    <span className="font-medium">By:</span> {report.reporter?.name || 'Unknown User'}
                                </div>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {typeof report.createdAt === 'number'
                                    ? format(new Date(report.createdAt), 'PPP p')
                                    : 'N/A'}
                            </div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                        <div>
                            <h4 className="font-semibold">Details:</h4>
                            <p className="whitespace-pre-wrap text-muted-foreground">{report.details || 'No additional details provided.'}</p>
                        </div>
                        <Button asChild variant="secondary">
                            <Link href={getContextLink(report)}>
                                {report.context.type === 'user' ? <User className="mr-2 h-4 w-4" /> : <FileText className="mr-2 h-4 w-4" />}
                                View Reported {report.context.type}
                            </Link>
                        </Button>
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    );
}


export default function ReportsPage() {
    const database = useDatabase();
    const [reports, setReports] = useState<EnrichedReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!database) return;

        const fetchReports = async () => {
            setIsLoading(true);
            try {
                // Fetch All Reports
                const reportsRef = ref(database, 'reports');
                // RTDB doesn't sort desc easily by default without quirks, so we fetch all and sort client side
                // For Scalability this should be limited by limitToLast() etc, but fine for now.
                const snapshot = await get(reportsRef);

                if (snapshot.exists()) {
                    const data = snapshot.val();
                    let reportsData = Object.keys(data).map(key => ({ id: key, ...data[key] } as Report));

                    // Sort desc
                    reportsData.sort((a, b) => {
                        const tA = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt as any).getTime();
                        const tB = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt as any).getTime();
                        return tB - tA;
                    });

                    if (reportsData.length > 0) {
                        const userIds = new Set<string>();
                        reportsData.forEach(r => {
                            if (r.reporterId) userIds.add(r.reporterId);
                            if (r.reportedUserId) userIds.add(r.reportedUserId);
                        });

                        const usersMap = new Map<string, AppUser>();

                        // Concurrent fetch for users
                        await Promise.all(Array.from(userIds).map(async (uid) => {
                            const userSnap = await get(ref(database, `users/${uid}`));
                            if (userSnap.exists()) {
                                usersMap.set(uid, { id: uid, ...userSnap.val() } as AppUser);
                            }
                        }));

                        const enriched = reportsData.map(r => ({
                            ...r,
                            reporter: usersMap.get(r.reporterId),
                            reportedUser: usersMap.get(r.reportedUserId),
                        }));
                        setReports(enriched);
                    } else {
                        setReports([]);
                    }
                } else {
                    setReports([]);
                }

            } catch (error) {
                console.error("Error fetching reports:", error);
                setReports([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchReports();
    }, [database]);

    const { userReports, jobReports } = useMemo(() => {
        const userReports = reports.filter(r => r.context.type === 'user');
        const jobReports = reports.filter(r => r.context.type === 'request');
        return { userReports, jobReports };
    }, [reports]);

    return (
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
            <div className="flex items-center">
                <h1 className="font-semibold text-lg md:text-2xl">Reports Inbox</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>User-Submitted Reports</CardTitle>
                    <CardDescription>Review reports submitted by users for moderation.</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-40">
                            <Loader className="h-8 w-8 animate-spin" />
                        </div>
                    ) : (
                        <Tabs defaultValue="user">
                            <TabsList>
                                <TabsTrigger value="user">User Reports ({userReports.length})</TabsTrigger>
                                <TabsTrigger value="job">Job Reports ({jobReports.length})</TabsTrigger>
                            </TabsList>
                            <TabsContent value="user">
                                <ReportList reports={userReports} type="user" />
                            </TabsContent>
                            <TabsContent value="job">
                                <ReportList reports={jobReports} type="request" />
                            </TabsContent>
                        </Tabs>
                    )}
                </CardContent>
            </Card>

        </main>
    );
}
