
'use client';

import { useUser, useDatabase } from '@/firebase';
import { ref, update, query, orderByChild, get } from 'firebase/database';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader } from 'lucide-react';
import { format } from 'date-fns';
import React, { useState, useEffect } from 'react';

type ContactSubmission = {
  id: string;
  name: string;
  email: string;
  message: string;
  submittedAt: {
    seconds: number;
    nanoseconds: number;
  };
};

export default function InboxPage() {
  const database = useDatabase();
  const { user } = useUser();
  const [submissions, setSubmissions] = useState<ContactSubmission[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);


  useEffect(() => {
    if (!database) return;

    const fetchSubmissions = async () => {
      setIsLoading(true);
      try {
        const submissionsRef = query(ref(database, 'contactSubmissions'), orderByChild('submittedAt'));
        const snapshot = await get(submissionsRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          const submissionData = Object.keys(data).map(key => ({
            id: key,
            ...data[key]
          })) as ContactSubmission[];

          // Sort client side descending
          submissionData.sort((a, b) => {
            const getTime = (d: any) => d?.seconds ? d.seconds * 1000 : (typeof d === 'number' ? d : 0);
            return getTime(b.submittedAt) - getTime(a.submittedAt);
          });

          setSubmissions(submissionData);
        } else {
          setSubmissions([]);
        }

        // Reset notification count for admin (RTDB)
        if (user) {
          const userRef = ref(database, `users/${user.uid}`);
          update(userRef, { unreadContactSubmissionsCount: 0 }).catch(e => console.error("Error updating inbox stats:", e));
        }

      } catch (error) {
        console.error("Error fetching contact submissions:", error);
        setSubmissions([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSubmissions();
  }, [database, user]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">Inbox</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact Form Submissions</CardTitle>
          <CardDescription>
            Messages sent from the "Contact Us" page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <Loader className="h-8 w-8 animate-spin" />
            </div>
          ) : submissions && submissions.length > 0 ? (
            <Accordion type="single" collapsible className="w-full">
              {submissions.map((submission) => (
                <AccordionItem value={submission.id} key={submission.id}>
                  <AccordionTrigger>
                    <div className="flex justify-between w-full pr-4">
                      <div className="flex flex-col text-left">
                        <span className="font-medium">{submission.name}</span>
                        <span className="text-sm text-muted-foreground">{submission.email}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {submission.submittedAt?.seconds ? format(new Date(submission.submittedAt.seconds * 1000), 'PPP p') : 'N/A'}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="whitespace-pre-wrap">{submission.message}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>There are no messages in the inbox.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
