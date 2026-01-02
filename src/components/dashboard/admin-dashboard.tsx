
'use client';

import Link from 'next/link';
import {
    Activity,
    ArrowUpRight,
    Briefcase,
    DollarSign,
    Users,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useFirestore, errorEmitter, FirestorePermissionError, useUser, useDatabase } from '@/firebase';
import { collection, query, limit, orderBy, where, getDocs, Timestamp } from 'firebase/firestore';
import { ref, get, child } from 'firebase/database';
import type { User as AppUser, ProjectRequest, EscrowPayment } from '@/lib/types';
import { Loader } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';

const PLATFORM_FEE_PERCENTAGE = 0.15; // 15%

export default function AdminDashboard() {
    const firestore = useFirestore();
    const database = useDatabase();
    const { user: currentUser } = useUser();
    const [allUsers, setAllUsers] = useState<AppUser[]>([]);
    const [allProjects, setAllProjects] = useState<ProjectRequest[]>([]);
    const [releasedPayments, setReleasedPayments] = useState<EscrowPayment[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Wait for firestore and user to be available
        if (!firestore || !currentUser) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Parallel fetch: Check admin role and fetch users simultaneously
                const dbRef = ref(database);
                const [adminSnapshot, usersSnapshot] = await Promise.all([
                    get(child(dbRef, `users/${currentUser.uid}`)),
                    get(ref(database, 'users'))
                ]);

                const userData = adminSnapshot.val();
                if (!adminSnapshot.exists() || userData?.role !== 'admin') {
                    console.warn("Attempted to load admin dashboard without admin privileges.");
                    setIsLoading(false);
                    return;
                }

                // Process users data
                if (usersSnapshot.exists()) {
                    const data = usersSnapshot.val();
                    const usersArray = Object.keys(data).map(key => ({
                        id: key,
                        ...data[key]
                    })) as AppUser[];
                    usersArray.sort((a, b) => {
                        const timeA = a.joinDate ? (typeof a.joinDate === 'object' && 'seconds' in a.joinDate ? a.joinDate.seconds * 1000 : new Date(a.joinDate).getTime()) : 0;
                        const timeB = b.joinDate ? (typeof b.joinDate === 'object' && 'seconds' in b.joinDate ? b.joinDate.seconds * 1000 : new Date(b.joinDate).getTime()) : 0;
                        return timeB - timeA;
                    });
                    setAllUsers(usersArray);
                } else {
                    setAllUsers([]);
                }

                // Parallel Firestore queries
                const projectsQuery = query(collection(firestore, 'requests'), orderBy('createdAt', 'desc'));
                const releasedPaymentsQuery = query(collection(firestore, 'escrowPayments'), where('status', '==', 'released'));

                const [
                    projectsSnap,
                    paymentsSnap
                ] = await Promise.all([
                    getDocs(projectsQuery).catch(err => { errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'requests', operation: 'list' })); throw err; }),
                    getDocs(releasedPaymentsQuery).catch(err => { errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'escrowPayments', operation: 'list' })); throw err; }),
                ]);

                setAllProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectRequest)));
                setReleasedPayments(paymentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as EscrowPayment)));
            } catch (error) {
                if (!(error instanceof FirestorePermissionError)) {
                    console.error("Error fetching admin dashboard data:", error);
                }
            } finally {
                setIsLoading(false);
            }
        }

        fetchData();
    }, [firestore, database, currentUser]);

    const recentUsers = useMemo(() => allUsers.slice(0, 5), [allUsers]);
    const recentProjects = useMemo(() => allProjects.slice(0, 5), [allProjects]);

    const activeGigsCount = useMemo(() => allProjects.filter(p => p.status === 'In Progress').length, [allProjects]);
    const totalTransactionVolume = useMemo(() => releasedPayments.reduce((sum, payment) => sum + payment.amount, 0), [releasedPayments]);
    const platformRevenue = totalTransactionVolume * PLATFORM_FEE_PERCENTAGE;

    const generalUsers = useMemo(() => allUsers.filter(user => user.role !== 'admin'), [allUsers]);

    const newUsersThisMonth = useMemo(() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        return generalUsers.filter(user => {
            if (user.joinDate) {
                const joinTime = typeof user.joinDate === 'object' && 'seconds' in user.joinDate
                    ? user.joinDate.seconds * 1000
                    : new Date(user.joinDate).getTime();
                return joinTime >= startOfMonth.getTime();
            }
            return false;
        }).length;
    }, [generalUsers]);

    const newProjectsThisWeek = useMemo(() => {
        const now = new Date();
        const oneWeekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

        return allProjects.filter(project => {
            if (project.createdAt && project.createdAt instanceof Timestamp) {
                return project.createdAt.toDate() >= oneWeekAgo;
            }
            return false;
        }).length;
    }, [allProjects]);


    return (
        <>
            {isLoading ? (
                <div className="flex flex-1 items-center justify-center">
                    <Loader className="h-8 w-8 animate-spin" />
                </div>
            ) : (
                <>
                    <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                                <Users className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{generalUsers.length}</div>
                                <p className="text-xs text-muted-foreground">
                                    +{newUsersThisMonth} new users this month
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Projects
                                </CardTitle>
                                <Briefcase className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{allProjects.length}</div>
                                <p className="text-xs text-muted-foreground">
                                    +{newProjectsThisWeek} new projects this week
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Active Gigs
                                </CardTitle>
                                <Activity className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">+{activeGigsCount}</div>
                                <p className="text-xs text-muted-foreground">
                                    Currently in progress
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Platform Revenue
                                </CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">${platformRevenue.toFixed(2)}</div>
                                <p className="text-xs text-muted-foreground">
                                    Based on a {PLATFORM_FEE_PERCENTAGE * 100}% fee
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                    <div className="grid gap-4 md:gap-8 lg:grid-cols-2">
                        <Card>
                            <CardHeader className="flex flex-row items-center">
                                <div className="grid gap-2">
                                    <CardTitle>Recent Users</CardTitle>
                                    <CardDescription>
                                        Recently registered users on the platform.
                                    </CardDescription>
                                </div>
                                <Button asChild size="sm" className="ml-auto gap-1">
                                    <Link href="/admin/users">
                                        View All
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Link>
                                </Button>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>User</TableHead>
                                            <TableHead>Role</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {recentUsers?.map((user) => (
                                            <TableRow key={user.id}>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <Avatar>
                                                            <AvatarImage src={user.photoURL} alt={user.name} data-ai-hint="person avatar" />
                                                            <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <div>
                                                            <div className="font-medium">{user.name}</div>
                                                            <div className="text-sm text-muted-foreground">{user.email}</div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={user.role === 'admin' ? 'destructive' : 'secondary'}>
                                                        {user.role}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center">
                                <div className="grid gap-2">
                                    <CardTitle>Recent Projects</CardTitle>
                                    <CardDescription>
                                        Recently posted projects on the platform.
                                    </CardDescription>
                                </div>
                                <Button asChild size="sm" className="ml-auto gap-1">
                                    <Link href="/admin/projects">
                                        View All
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Link>
                                </Button>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Title</TableHead>
                                            <TableHead>Budget</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {recentProjects?.map((request) => (
                                            <TableRow key={request.id}>
                                                <TableCell className="font-medium">
                                                    <Link href={`/requests/${request.id}`} className="hover:underline">
                                                        {request.title}
                                                    </Link>
                                                </TableCell>
                                                <TableCell>${request.budget.toLocaleString()}</TableCell>
                                                <TableCell>
                                                    <Badge variant={request.status === 'Open' ? 'default' : 'secondary'}>
                                                        {request.status}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </>
    );
}
