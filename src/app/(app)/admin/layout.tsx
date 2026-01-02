'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useDatabase } from '@/firebase';
import { ref, onValue } from 'firebase/database';
import { Loader } from 'lucide-react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser();
  const database = useDatabase();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (isUserLoading) return;

    if (!user) {
      // If not logged in, redirect to login or home
      router.push('/');
      return;
    }

    if (!database) return;

    const roleRef = ref(database, `users/${user.uid}/role`);
    const unsubscribe = onValue(roleRef, (snapshot) => {
      const role = snapshot.val();
      if (role === 'admin') {
        setIsAuthorized(true);
      } else {
        // Not an admin, redirect to user dashboard
        router.push('/requests');
      }
      setIsChecking(false);
    }, (error) => {
      console.error("Error checking admin role:", error);
      // Fallback to safe redirect on error
      router.push('/requests');
      setIsChecking(false);
    });

    return () => unsubscribe();
  }, [user, isUserLoading, database, router]);

  if (isUserLoading || isChecking) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-[50vh]">
        <Loader className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
