
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
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getImageUrl } from '@/lib/utils';
import { useFirestore, errorEmitter, FirestorePermissionError, useDatabase } from '@/firebase';
import { collection, deleteDoc, doc, getDocs, query, where, writeBatch, updateDoc } from 'firebase/firestore';
import { ref, get, update, remove } from 'firebase/database';
import type { User } from '@/lib/types';
import { Loader, MoreHorizontal, Pencil, Trash2, Ban, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as React from 'react';
import { useToast } from '@/hooks/use-toast';
import { deleteUserFromAuth } from './actions';

export default function AdminUsersPage() {
  const firestore = useFirestore();
  const database = useDatabase();
  const { toast } = useToast();
  const [userToDelete, setUserToDelete] = React.useState<User | null>(null); // For Disable/Enable
  const [userToHardDelete, setUserToHardDelete] = React.useState<User | null>(null); // For Permanent Delete
  const [userToEdit, setUserToEdit] = React.useState<User | null>(null);
  const [editForm, setEditForm] = React.useState({ name: '', email: '', role: 'user' as 'user' | 'admin' });
  const [allUsers, setAllUsers] = React.useState<User[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!database) return;
    const fetchUsers = async () => {
      setIsLoading(true);
      try {
        const usersRef = ref(database, 'users');
        const snapshot = await get(usersRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          // Convert map object to array
          const usersData = Object.keys(data).map(key => ({
            id: key,
            ...data[key]
          })) as User[];

          // Sort users by join date client-side
          usersData.sort((a, b) => {
            // Handle both Timestamp objects (from Firestore migration) or primitive numbers/strings from RTDB
            const timeA = a.joinDate ? (typeof a.joinDate === 'object' && 'seconds' in a.joinDate ? a.joinDate.seconds * 1000 : new Date(a.joinDate).getTime()) : 0;
            const timeB = b.joinDate ? (typeof b.joinDate === 'object' && 'seconds' in b.joinDate ? b.joinDate.seconds * 1000 : new Date(b.joinDate).getTime()) : 0;
            return timeB - timeA;
          });
          setAllUsers(usersData);
        } else {
          setAllUsers([]);
        }
      } catch (error) {
        console.error("Error fetching users from RTDB:", error);
        setAllUsers([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchUsers();
  }, [database]);

  // Show all users, not just active ones, so we can manage disabled users
  const activeUsers = allUsers;

  const getJoinDate = (user: any) => {
    if (user.joinDate && user.joinDate.seconds) {
      return format(new Date(user.joinDate.seconds * 1000), 'PPP');
    }
    // For users created before joinDate was added
    return 'N/A';
  };



  const handleEditClick = (user: User) => {
    setUserToEdit(user);
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role
    });
  };

  const handleSaveEdit = async () => {
    if (!database || !userToEdit) return;
    const userRef = ref(database, `users/${userToEdit.id}`);
    try {
      const updates: any = {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role
      };

      // 1. Update RTDB
      await update(userRef, updates).catch(e => {
        console.error("RTDB Update failed:", e);
        throw e; // Re-throw to trigger catch block if critical
      });

      // 2. Update Firestore (for Security Rules)
      if (firestore) {
        const firestoreUserRef = doc(firestore, 'users', userToEdit.id);
        // We use non-blocking or simple update. Using standard updateDoc here for consistency.
        await updateDoc(firestoreUserRef, updates).catch(err => console.error("Firestore sync error:", err));
      }

      setAllUsers(prev => prev.map(u => u.id === userToEdit.id ? { ...u, ...editForm } : u));
      toast({ title: 'User Updated', description: 'User details have been successfully updated.' });
      setUserToEdit(null);
    } catch (error) {
      console.error("Error updating user:", error);
      toast({ title: 'Error', description: `Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    }
  };

  const handleToggleDisable = async () => {
    if (!database || !userToDelete) return;

    // Path to the user in RTDB
    const userRef = ref(database, `users/${userToDelete.id}`);
    const newStatus = userToDelete.status === 'active' ? 'disabled' : 'active';
    const updateData = { status: newStatus };

    try {
      // 1. Update RTDB
      const rtdbPromise = update(userRef, updateData);

      // 2. Update Firestore
      let firestorePromise = Promise.resolve();
      if (firestore) {
        const firestoreUserRef = doc(firestore, 'users', userToDelete.id);
        firestorePromise = updateDoc(firestoreUserRef, updateData).then(() => void 0).catch(err => {
          console.error("Firestore status sync error:", err);
          // Return undefined to avoid breaking Promise.all
        });
      }

      await Promise.all([rtdbPromise, firestorePromise]);

      setAllUsers(prev => prev.map(u => u.id === userToDelete.id ? { ...u, status: newStatus as 'active' | 'deleted' } : u));

      toast({
        title: `User ${newStatus === 'active' ? 'Enabled' : 'Disabled'}`,
        description: `${userToDelete.name}'s account has been ${newStatus}.`,
      });
    } catch (error) {
      console.error("Error toggling user status:", error);
      toast({
        title: 'Error',
        description: `Failed to change status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive'
      });
    } finally {
      setUserToDelete(null);
    }
  };

  const handleHardDelete = async () => {
    if (!database || !userToHardDelete) return;
    const userRef = ref(database, `users/${userToHardDelete.id}`);
    const photographerProfileRef = ref(database, `photographerProfiles/${userToHardDelete.id}`);

    try {
      // 1. Remove from RTDB (users and photographerProfiles)
      const rtdbPromises = [remove(userRef)];

      // Check if photographer profile exists and delete it
      const profileSnapshot = await get(photographerProfileRef);
      if (profileSnapshot.exists()) {
        rtdbPromises.push(remove(photographerProfileRef));
      }

      await Promise.all(rtdbPromises);

      // 2. Remove from Firestore
      let firestorePromise = Promise.resolve();
      if (firestore) {
        const firestoreUserRef = doc(firestore, 'users', userToHardDelete.id);
        firestorePromise = deleteDoc(firestoreUserRef).then(() => void 0).catch(err => {
          console.error("Firestore delete error:", err);
        });
      }



      // 3. Remove from Authentication (Server Action)
      const authResult = await deleteUserFromAuth(userToHardDelete.id);
      if (!authResult.success) {
        console.warn("Could not delete from Auth (likely permission/setup issue):", authResult.error);
        toast({
          title: 'Warning',
          description: `User data deleted, but Auth deletion failed: ${authResult.error}. You may need to delete them from Firebase Console Authentication tab.`,
          variant: "destructive"
        });
      } else {
        toast({ title: 'User Deleted', description: 'User has been permanently deleted from Database, Photographer Profile (if existed), and Authentication.' });
      }

      setAllUsers(prev => prev.filter(u => u.id !== userToHardDelete.id));
    } catch (error) {
      console.error("Error deleting user:", error);
      toast({ title: 'Error', description: `Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    } finally {
      setUserToHardDelete(null);
    }
  };

  return (
    <>
      <AlertDialog
        open={!!userToDelete}
        onOpenChange={(open) => !open && setUserToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {userToDelete?.status === 'active' ? 'Disable User Account' : 'Enable User Account'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {userToDelete?.status === 'active'
                ? "This will disable the user's access. They won't be able to log in."
                : "This will reactivate the user's account."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleDisable}>
              {userToDelete?.status === 'active' ? 'Disable' : 'Enable'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!userToHardDelete} onOpenChange={(open) => !open && setUserToHardDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the user and their data from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleHardDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!userToEdit} onOpenChange={(open) => !open && setUserToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user details below.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">Name</Label>
              <Input id="name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">Email</Label>
              <Input id="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="role" className="text-right">Role</Label>
              <Select value={editForm.role} onValueChange={(val: 'user' | 'admin') => setEditForm({ ...editForm, role: val })}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="flex items-center">
          <h1 className="font-semibold text-lg md:text-2xl">Manage Users</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Active Users</CardTitle>
            <CardDescription>
              View and manage all active users on the platform.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center h-40">
                <Loader className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Join Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeUsers?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage
                              src={
                                user.photoURL ||
                                getImageUrl('avatar-placeholder')
                              }
                              alt={user.name}
                              data-ai-hint="person avatar"
                            />
                            <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{user.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            user.role === 'admin' ? 'destructive' : 'secondary'
                          }
                        >
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{getJoinDate(user)}</TableCell>
                      <TableCell className="text-right">
                        {user.role !== 'admin' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditClick(user)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setUserToDelete(user)}>
                                {user.status === 'active' ? (
                                  <>
                                    <Ban className="mr-2 h-4 w-4" /> Disable
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle className="mr-2 h-4 w-4" /> Enable
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setUserToHardDelete(user)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
