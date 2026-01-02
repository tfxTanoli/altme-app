
'use client';

import { useUser, useDatabase } from '@/firebase';
import { ref, get, child } from 'firebase/database';
import { Loader, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { User as AppUser } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import dynamic from 'next/dynamic';

const AdminDashboard = dynamic(() => import('@/components/dashboard/admin-dashboard'), {
  loading: () => (
    <main className="flex flex-1 items-center justify-center">
      <Loader className="h-8 w-8 animate-spin" />
    </main>
  ),
  ssr: false,
});

export default function DashboardPage() {
  const { user, isUserLoading } = useUser();
  const database = useDatabase();
  const [userData, setUserData] = useState<AppUser | null>(null);
  const [isCheckingRole, setIsCheckingRole] = useState(true);

  useEffect(() => {
    if (!user || !database) {
      if (!isUserLoading) {
        setIsCheckingRole(false);
      }
      return;
    }

    const fetchUserRole = async () => {
      setIsCheckingRole(true);
      try {
        const dbRef = ref(database);
        const snapshot = await get(child(dbRef, `users/${user.uid}`));
        if (snapshot.exists()) {
          setUserData(snapshot.val() as AppUser);
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
      } finally {
        setIsCheckingRole(false);
      }
    };

    fetchUserRole();
  }, [user, database, isUserLoading]);


  if (isUserLoading || isCheckingRole) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader className="h-8 w-8 animate-spin" />
      </main>
    );
  }

  if (userData?.role === 'admin') {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="space-y-8">
          <AdminDashboard />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 md:gap-8 md:p-8">
      <div className="mx-auto grid w-full max-w-4xl items-center justify-center gap-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Shield className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">You do not have permission to view this page.</p>
        </div>
      </div>
    </main>
  )
}
