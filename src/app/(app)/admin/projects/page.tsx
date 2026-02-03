
'use client';

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { useUser, useDatabase } from '@/firebase';
import { ref, update, get, push, serverTimestamp } from 'firebase/database';
import type { ProjectRequest } from '@/lib/types';
import { Loader, MoreHorizontal, AlertCircle, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as React from 'react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { sendNotification } from '@/services/notifications';

const ProjectTable = ({
    projects,
    onDisableProject,
    onResolveDispute,
    onApproveProject
}: {
    projects: ProjectRequest[],
    onDisableProject: (project: ProjectRequest) => void,
    onResolveDispute: (project: ProjectRequest) => void,
    onApproveProject?: (project: ProjectRequest) => void,
}) => {

    const getStatusBadge = (status: ProjectRequest['status']) => {
        switch (status) {
            case 'Open': return <Badge variant="default">Open</Badge>;
            case 'In Progress': return <Badge variant="secondary">In Progress</Badge>;
            case 'Delivered': return <Badge className="bg-yellow-500 text-white">Delivered</Badge>;
            case 'Completed': return <Badge variant="outline">Completed</Badge>;
            case 'Pending': return <Badge className="bg-orange-500 text-white">Pending</Badge>;
            case 'Disabled': return <Badge variant="destructive">Disabled</Badge>;
            case 'Disputed': return <Badge variant="destructive">Disputed</Badge>;
            default: return <Badge variant="secondary">{status}</Badge>;
        }
    }

    if (projects.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <p>No projects in this category.</p>
            </div>
        );
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {projects?.map((request) => (
                    <TableRow key={request.id}>
                        <TableCell className="font-medium">
                            <Link
                                href={`/requests/${request.id}`}
                                className="hover:underline"
                            >
                                {request.title}
                            </Link>
                        </TableCell>
                        <TableCell>${request.budget.toLocaleString()}</TableCell>
                        <TableCell>
                            {getStatusBadge(request.status)}
                        </TableCell>
                        <TableCell>{request.dates?.join(', ') || 'N/A'}</TableCell>
                        <TableCell className="text-right">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    {request.status === 'Pending' && (
                                        <>
                                            <DropdownMenuItem onClick={() => onApproveProject?.(request)}>
                                                Approve & Start Project
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                        </>
                                    )}
                                    {request.status === 'Disputed' && (
                                        <>
                                            <DropdownMenuItem onClick={() => onResolveDispute(request)}>
                                                Resolve Dispute
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                        </>
                                    )}
                                    <DropdownMenuItem
                                        className="text-destructive"
                                        onClick={() => onDisableProject(request)}
                                        disabled={request.status === 'Disabled'}
                                    >
                                        Disable Project
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
};



export default function AdminProjectsPage() {
    const database = useDatabase();
    const { user } = useUser();
    const { toast } = useToast();
    const [projectToDisable, setProjectToDisable] = React.useState<ProjectRequest | null>(null);
    const [projectToResolve, setProjectToResolve] = React.useState<ProjectRequest | null>(null);
    const [allProjects, setAllProjects] = React.useState<ProjectRequest[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isDisabling, setIsDisabling] = React.useState(false);
    const [isResolving, setIsResolving] = React.useState(false);

    React.useEffect(() => {
        if (!database) return;
        const fetchProjects = async () => {
            setIsLoading(true);
            try {
                // Fetch projects from RTDB
                const requestsRef = ref(database, 'requests');
                // Use default ordering or orderByChild('createdAt') if indexed
                const snapshot = await get(requestsRef);

                if (snapshot.exists()) {
                    const data = snapshot.val();
                    const projectsData = Object.keys(data).map(key => ({
                        id: key,
                        ...data[key]
                    })) as ProjectRequest[];

                    // Sort client-side desc
                    projectsData.sort((a, b) => {
                        const getDate = (d: any) => {
                            if (!d) return 0;
                            if (d instanceof Date) return d.getTime();
                            if (typeof d === 'number') return d;
                            if (typeof d === 'object' && d.seconds) return d.seconds * 1000;
                            return new Date(d).getTime();
                        };
                        return getDate(b.createdAt) - getDate(a.createdAt);
                    });

                    setAllProjects(projectsData);

                    // Update disputed count
                    if (user) {
                        const disputedCount = projectsData.filter(p => p.status === 'Disputed').length;
                        const userRef = ref(database, `users/${user.uid}`);
                        update(userRef, { disputedProjectsCount: disputedCount }).catch(e => console.error("Error updating stats:", e));
                    }
                } else {
                    setAllProjects([]);
                }
            } catch (error) {
                console.error("Error fetching projects:", error);
                setAllProjects([]);
            } finally {
                setIsLoading(false);
            }
        }
        fetchProjects();
    }, [database, user]);


    const handleDisableProject = async () => {
        if (!database || !projectToDisable) return;
        setIsDisabling(true);

        const requiresRefund = projectToDisable.status === 'In Progress' || projectToDisable.status === 'Delivered' || projectToDisable.status === 'Disputed';
        const refundAmount = projectToDisable.acceptedBidAmount || projectToDisable.budget;

        try {
            const updates: Record<string, any> = {};
            updates[`requests/${projectToDisable.id}/status`] = 'Disabled';

            if (requiresRefund && projectToDisable.userId) {
                // We need to fetch current balance to increment it. 
                // RTDB doesn't have native 'increment' like Firestore unless we use transaction or fetch-then-update.
                // Using transaction on the user's balance is safer.
                // However, for consistency with 'updates' object we might need a separate transaction call or just use transaction for everything?
                // RTDB multi-path update doesn't support relative increments directly.
                // Let's use fetching current balance for simplicity in this migration context, or separate transaction for balance.

                // Better approach: Use transaction regarding balance, and update regarding project status.
                // But we want atomicity.
                // We'll trust fetching current balance and updating it in the multi-path update.
                // It's a slight race condition but unlikely to be hit in this admin panel context.

                const userBalanceRef = ref(database, `users/${projectToDisable.userId}/balance`);
                const balanceSnap = await get(userBalanceRef);
                const currentBalance = balanceSnap.val() || 0;
                updates[`users/${projectToDisable.userId}/balance`] = currentBalance + refundAmount;
            }

            await update(ref(database), updates);

            toast({
                title: 'Project Disabled',
                description: requiresRefund
                    ? `The project "${projectToDisable.title}" has been disabled and $${refundAmount} has been credited to the client's balance.`
                    : `The project "${projectToDisable.title}" has been disabled. No payment was processed.`,
            });
            setAllProjects(prev => prev.map(p => p.id === projectToDisable.id ? { ...p, status: 'Disabled' } : p));

        } catch (error: any) {
            console.error("Error disabling project:", error);
            toast({
                variant: 'destructive',
                title: 'Operation Failed',
                description: 'Could not disable the project.',
            });
        } finally {
            setIsDisabling(false);
            setProjectToDisable(null);
        }
    };

    const handleRefundClient = async () => {
        if (!database || !projectToResolve) return;
        setIsResolving(true);
        const refundAmount = projectToResolve.acceptedBidAmount || projectToResolve.budget;

        try {
            const updates: Record<string, any> = {};
            updates[`requests/${projectToResolve.id}/status`] = 'Completed';
            updates[`requests/${projectToResolve.id}/disputeResolution`] = 'refunded';
            updates[`requests/${projectToResolve.id}/disputeResolvedAt`] = serverTimestamp();

            // Handle Balance
            const userBalanceRef = ref(database, `users/${projectToResolve.userId}/balance`);
            const balanceSnap = await get(userBalanceRef);
            const currentBalance = balanceSnap.val() || 0;
            updates[`users/${projectToResolve.userId}/balance`] = currentBalance + refundAmount;

            await update(ref(database), updates);

            toast({
                title: 'Dispute Resolved: Client Refunded',
                description: `$${refundAmount} has been credited to the client's balance.`,
            });
            setAllProjects(prev => prev.map(p => p.id === projectToResolve.id ? { ...p, status: 'Completed' } : p));
        } catch (error) {
            console.error("Error refunding client:", error);
            toast({ variant: 'destructive', title: 'Refund Failed', description: 'Could not process the refund.' });
        } finally {
            setIsResolving(false);
            setProjectToResolve(null);
        }
    }

    const handlePayPhotographer = async () => {
        if (!database || !projectToResolve || !projectToResolve.hiredPhotographerId) return;
        setIsResolving(true);
        const paymentAmount = projectToResolve.acceptedBidAmount || projectToResolve.budget;

        try {
            const updates: Record<string, any> = {};
            updates[`requests/${projectToResolve.id}/status`] = 'Completed';
            updates[`requests/${projectToResolve.id}/disputeResolution`] = 'paid';
            updates[`requests/${projectToResolve.id}/disputeResolvedAt`] = serverTimestamp();

            // Handle Balance
            const phBalanceRef = ref(database, `users/${projectToResolve.hiredPhotographerId}/balance`);
            const balanceSnap = await get(phBalanceRef);
            const currentBalance = balanceSnap.val() || 0;
            updates[`users/${projectToResolve.hiredPhotographerId}/balance`] = currentBalance + paymentAmount;

            await update(ref(database), updates);

            toast({
                title: 'Dispute Resolved: Photographer Paid',
                description: `$${paymentAmount} has been released to the photographer's balance.`,
            });
            setAllProjects(prev => prev.map(p => p.id === projectToResolve.id ? { ...p, status: 'Completed' } : p));
        } catch (error) {
            console.error("Error paying photographer:", error);
            toast({ variant: 'destructive', title: 'Payment Failed', description: 'Could not release funds to the photographer.' });
        } finally {
            setIsResolving(false);
            setProjectToResolve(null);
        }
    }

    const handleApproveProject = async (project: ProjectRequest) => {
        if (!database || !project.hiredPhotographerId || !project.userId) return;

        try {
            // Create Project Chat Room Deterministically or uniquely? 
            // Previous code used doc(collection('chatRooms')).id which is unique.
            // Using push() for unique ID.
            const chatRoomsRef = ref(database, 'chatRooms');
            const newChatRef = push(chatRoomsRef); // Just to get ID
            const newChatId = newChatRef.key;

            if (!newChatId) throw new Error("Failed to generate chat ID");

            const updates: Record<string, any> = {};

            const chatRoomData = {
                id: newChatId,
                participantIds: [project.userId, project.hiredPhotographerId].sort(),
                user1Id: project.userId,
                user2Id: project.hiredPhotographerId,
                requestId: project.id,
                isProjectChat: true,
                lastMessage: null,
                createdAt: serverTimestamp()
            };

            updates[`chatRooms/${newChatId}`] = chatRoomData;
            updates[`requests/${project.id}/status`] = 'In Progress';
            updates[`requests/${project.id}/projectChatRoomId`] = newChatId;
            // Also need to link chat to users? 'users/{uid}/chats/{chatId}' = true
            updates[`users/${project.userId}/chats/${newChatId}`] = true;
            updates[`users/${project.hiredPhotographerId}/chats/${newChatId}`] = true;

            await update(ref(database), updates);

            // Send notification to photographer
            try {
                await sendNotification(project.hiredPhotographerId, {
                    title: 'Booking Approved!',
                    message: `Your direct booking for "${project.title}" has been approved. You can now start working on it.`,
                    type: 'job_approved',
                    link: `/requests/${project.id}`,
                    relatedId: project.id
                });
            } catch (err) {
                console.error("Failed to notify photographer:", err);
            }

            // Send notification to client
            try {
                await sendNotification(project.userId, {
                    title: 'Job Request Approved!',
                    message: `Your job request "${project.title}" has been approved and is now in progress.`,
                    type: 'job_approved',
                    link: `/requests/${project.id}`,
                    relatedId: project.id
                });
            } catch (err) {
                console.error("Failed to notify client:", err);
            }

            toast({
                title: 'Project Approved',
                description: `"${project.title}" is now in progress. Both parties have been notified.`,
            });

            setAllProjects(prev => prev.map(p => p.id === project.id ? { ...p, status: 'In Progress' } : p));
        } catch (error) {
            console.error("Error approving project:", error);
            toast({
                variant: 'destructive',
                title: 'Approval Failed',
                description: 'Could not approve the project.',
            });
        }
    }

    const disputedProjects = React.useMemo(() => allProjects.filter(p => p.status === 'Disputed'), [allProjects]);
    const activeProjects = React.useMemo(() => allProjects.filter(p => p.status !== 'Disabled'), [allProjects]);


    return (
        <>
            <AlertDialog
                open={!!projectToDisable}
                onOpenChange={(open) => !open && setProjectToDisable(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will disable the project. If a payment was made, the amount will be credited to the client's internal balance. This action is irreversible.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDisabling}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDisableProject} disabled={isDisabling}>
                            {isDisabling && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                            Disable Project
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={!!projectToResolve}
                onOpenChange={(open) => !open && setProjectToResolve(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Resolve Dispute</AlertDialogTitle>
                        <AlertDialogDescription>
                            Choose an action to resolve the dispute for the project "{projectToResolve?.title}". This action is irreversible and will complete the project.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4 space-y-4">
                        <p className="text-sm text-muted-foreground">Select one of the options below to close the dispute. The project status will be set to 'Completed'.</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Button variant="outline" onClick={handleRefundClient} disabled={isResolving}>
                                {isResolving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                Refund Client & Cancel
                            </Button>
                            <Button onClick={handlePayPhotographer} disabled={isResolving}>
                                {isResolving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                Pay Photographer & Complete
                            </Button>
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isResolving}>Close</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>


            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
                <div className="flex items-center">
                    <h1 className="font-semibold text-lg md:text-2xl">Manage Projects</h1>
                </div>

                {isLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <Loader className="h-8 w-8 animate-spin" />
                    </div>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle>All Project Requests</CardTitle>
                            <CardDescription>
                                View and manage all project requests across the platform.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Tabs defaultValue="active">
                                <TabsList className="grid w-full grid-cols-2 md:w-fit">
                                    <TabsTrigger value="active">All Active</TabsTrigger>
                                    <TabsTrigger value="disputed" className="relative">
                                        Disputed
                                        {disputedProjects.length > 0 && (
                                            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground">
                                                {disputedProjects.length}
                                            </span>
                                        )}
                                    </TabsTrigger>
                                </TabsList>
                                <TabsContent value="active" className="mt-4">
                                    <ProjectTable projects={activeProjects} onDisableProject={setProjectToDisable} onResolveDispute={setProjectToResolve} onApproveProject={handleApproveProject} />
                                </TabsContent>
                                <TabsContent value="disputed" className="mt-4">
                                    {disputedProjects.length > 0 && (
                                        <Alert variant="destructive" className="mb-4">
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertTitle>Action Required</AlertTitle>
                                            <AlertDescription>
                                                These projects have been flagged for review. Please investigate and take appropriate action.
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                    <ProjectTable projects={disputedProjects} onDisableProject={setProjectToDisable} onResolveDispute={setProjectToResolve} onApproveProject={handleApproveProject} />
                                </TabsContent>
                            </Tabs>
                        </CardContent>
                    </Card>
                )}

            </main>
        </>
    );
}
