'use client';

import { notFound, useRouter } from 'next/navigation';
import * as React from 'react';
import { useUser, useDatabase } from '@/firebase';
import { sendNotification } from '@/services/notifications';
import {
  ref,
  get,
  onValue,
  push,
  update,
  set,
  query,
  orderByChild,
  equalTo,
  serverTimestamp,
  runTransaction
} from 'firebase/database';
import type { PhotographerProfile, User, Review, ProjectRequest, PortfolioItem } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader, MapPin, Star, Heart, MessageSquare, Upload, Video, X, CalendarIcon, Check } from 'lucide-react';
import { cn, captureVideoFrame } from '@/lib/utils';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { PortfolioGallery } from '@/components/photographers/portfolio-gallery';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useRequestMediaUpload } from '@/hooks/use-request-media-upload';
import Image from 'next/image';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import CheckoutForm from '@/components/stripe/checkout-form';
import { useFavorites } from '@/hooks/use-favorites';

const MAX_REFERENCE_MEDIA = 10;
const PLATFORM_FEE_PERCENTAGE = 0.15;

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type Preview = {
  url: string;
  type: 'image' | 'video';
  name: string;
};

const DisplayReviewCard = ({ review, reviewer }: { review: Review, reviewer?: User | null }) => {
  if (!reviewer) {
    return <div className="p-4"><Loader className="h-4 w-4 animate-spin" /></div>;
  }
  return (
    <div className="flex items-start gap-4">
      <Avatar>
        <AvatarImage src={reviewer.photoURL} alt={reviewer.name} data-ai-hint="person avatar" />
        <AvatarFallback>{reviewer.name.charAt(0)}</AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <div>
          <p className="font-semibold">{reviewer.name}</p>
          <div className="flex items-center gap-1 mt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn(
                  "h-4 w-4",
                  i < review.rating ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"
                )}
              />
            ))}
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{review.comment}</p>
      </div>
    </div>
  );
};

const bookingFormSchema = z.object({
  budget: z.coerce.number().min(5, { message: "Budget must be at least $5." }).max(10000, { message: "Budget cannot exceed $10,000." }),
  description: z.string().min(10, { message: "Description must be at least 10 characters." }),
  copyrightOption: z.enum(['license', 'transfer']).default('license'),
  datePreference: z.enum(['flexible', 'set-dates']).default('flexible'),
  dateType: z.enum(['specific-date', 'delivery-deadline']).optional(),
  dates: z.array(z.date()).optional(),
});

const BookNowDialog = ({ photographer, open, onOpenChange }: { photographer: User, open: boolean, onOpenChange: (open: boolean) => void }) => {
  const { user: currentUser } = useUser();
  const database = useDatabase();
  const { toast } = useToast();
  const router = useRouter();

  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [previews, setPreviews] = React.useState<Preview[]>([]);
  const { uploadFiles, isUploading } = useRequestMediaUpload();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = React.useState(false);
  const [pendingBookingData, setPendingBookingData] = React.useState<any>(null);

  const form = useForm<z.infer<typeof bookingFormSchema>>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      budget: '' as any,
      description: "",
      copyrightOption: 'license',
      datePreference: 'flexible',
      dates: [],
    },
  });

  const datePreference = form.watch('datePreference');
  const totalIsLoading = isUploading || form.formState.isSubmitting;
  const canUploadMore = previews.length < MAX_REFERENCE_MEDIA;

  React.useEffect(() => {
    if (!open) {
      form.reset();
      setSelectedFiles([]);
      setPreviews([]);
      setClientSecret(null);
      setIsPaymentDialogOpen(false);
      setPendingBookingData(null);
    }
  }, [open, form]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      let files = Array.from(event.target.files);

      const currentCount = previews.length;
      const remainingSlots = MAX_REFERENCE_MEDIA - currentCount;

      if (remainingSlots <= 0) {
        toast({
          variant: 'destructive',
          title: 'Upload Limit Reached',
          description: `You can only upload a maximum of ${MAX_REFERENCE_MEDIA} files.`,
        });
        return;
      }

      if (files.length > remainingSlots) {
        toast({
          title: 'Upload Limit Exceeded',
          description: `You can only add ${remainingSlots} more file(s). The first ${remainingSlots} will be uploaded.`,
        });
        files = files.slice(0, remainingSlots);
      }

      setSelectedFiles(prev => [...prev, ...files]);

      const newPreviews = await Promise.all(files.map(async (file) => {
        const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
        let previewUrl = URL.createObjectURL(file);

        if (mediaType === 'video') {
          try {
            const thumbBlob = await captureVideoFrame(file, 'request');
            if (thumbBlob) {
              previewUrl = URL.createObjectURL(thumbBlob);
            }
          } catch (error) {
            console.error("Could not generate video thumbnail.", error);
          }
        }

        return {
          url: previewUrl,
          type: mediaType as 'image' | 'video',
          name: file.name
        };
      }));

      setPreviews(prev => [...prev, ...newPreviews]);
    }
  };

  const removeFile = (index: number) => {
    const newPreviews = [...previews];
    const removedPreview = newPreviews.splice(index, 1)[0];
    if (removedPreview.url.startsWith('blob:')) {
      URL.revokeObjectURL(removedPreview.url);
    }
    setPreviews(newPreviews);

    const newFiles = [...selectedFiles];
    newFiles.splice(index, 1);
    setSelectedFiles(newFiles);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }


  const onSubmit = async (values: z.infer<typeof bookingFormSchema>) => {
    if (!currentUser || !database) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to book a photographer.",
      });
      return;
    }

    const title = `Direct Booking with ${photographer.name}`;

    try {
      // Upload reference media first
      const referenceMediaUrls = await uploadFiles(selectedFiles);

      // Calculate total amount with service fee
      const serviceFee = values.budget * PLATFORM_FEE_PERCENTAGE;
      const totalAmount = values.budget + serviceFee;

      // Create payment intent
      const response = await fetch('/api/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: totalAmount }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error || 'Failed to create payment intent.');
      }

      const { clientSecret: newClientSecret } = await response.json();
      setClientSecret(newClientSecret);

      // Store pending booking data
      setPendingBookingData({
        title,
        description: values.description,
        budget: values.budget,
        copyrightOption: values.copyrightOption,
        datePreference: values.datePreference,
        dateType: values.dateType,
        dates: values.dates ? values.dates.map(date => format(date, 'PPP')) : [],
        referenceMedia: referenceMediaUrls,
      });

      // Open payment dialog
      setIsPaymentDialogOpen(true);

    } catch (error: any) {
      console.error("Error preparing booking:", error);
      toast({
        variant: "destructive",
        title: "Payment Error",
        description: error.message || "Could not prepare payment.",
      });
    }
  };

  const handlePaymentSuccess = async () => {
    if (!currentUser || !database || !pendingBookingData) return;

    try {
      const requestsRef = ref(database, 'requests');
      const newRequestRef = push(requestsRef);

      const newRequestData: Partial<ProjectRequest> = {
        id: newRequestRef.key as string,
        title: pendingBookingData.title,
        description: pendingBookingData.description,
        budget: pendingBookingData.budget,
        userId: currentUser.uid,
        postedBy: currentUser.displayName || currentUser.email || 'Unknown User',
        hiredPhotographerId: photographer.id,
        participantIds: [currentUser.uid, photographer.id].sort(),
        copyrightOption: pendingBookingData.copyrightOption,
        status: "Pending" as const,
        createdAt: serverTimestamp() as any,
        datePreference: pendingBookingData.datePreference,
        ...(pendingBookingData.dateType && { dateType: pendingBookingData.dateType }),
        dates: pendingBookingData.dates,
        referenceMedia: pendingBookingData.referenceMedia,
        location: '',
      };

      await set(newRequestRef, newRequestData);

      // Send notification to the photographer
      await sendNotification(photographer.id, {
        type: 'direct_booking_request',
        title: 'New Booking Request',
        message: `You have received a new booking request from ${currentUser.displayName || 'a client'} for "${pendingBookingData.title}".`,
        link: `/requests/${newRequestRef.key}`,
        relatedId: newRequestRef.key as string
      });

      toast({
        title: "Booking Request Sent!",
        description: `Your request has been sent to ${photographer.name}. Payment will be held in escrow.`,
      });
      setIsPaymentDialogOpen(false);
      onOpenChange(false);
      router.push(`/requests/${newRequestRef.key}`);

    } catch (error) {
      console.error("Error creating direct booking:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not create your booking request.",
      });
    }
  };

  const serviceFee = pendingBookingData ? pendingBookingData.budget * PLATFORM_FEE_PERCENTAGE : 0;
  const totalPayment = pendingBookingData ? pendingBookingData.budget + serviceFee : 0;

  return (
    <>
      {clientSecret && pendingBookingData && (
        <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Complete Payment</DialogTitle>
              <DialogDescription>
                You are booking <strong>{photographer.name}</strong> for <strong>${pendingBookingData.budget}</strong>. A {PLATFORM_FEE_PERCENTAGE * 100}% service fee will be added.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="p-4 rounded-lg bg-muted/50 text-sm">
                <div className="flex justify-between">
                  <span>Photographer's Rate</span>
                  <span>${pendingBookingData.budget.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Service Fee ({PLATFORM_FEE_PERCENTAGE * 100}%)</span>
                  <span>${serviceFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t">
                  <span>Total Due Today</span>
                  <span>${totalPayment.toFixed(2)}</span>
                </div>
              </div>
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CheckoutForm onSuccessfulPayment={handlePaymentSuccess} />
              </Elements>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>Book {photographer.name}</DialogTitle>
                <DialogDescription>
                  Send a direct booking request. They will confirm their availability.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <FormField
                  control={form.control}
                  name="budget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Budget ($)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe your project, desired date, location, etc."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="datePreference"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>Date Preference</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                            className="flex space-x-4"
                          >
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="flexible" />
                              </FormControl>
                              <FormLabel className="font-normal">Flexible / No deadline</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="set-dates" />
                              </FormControl>
                              <FormLabel className="font-normal">Set Dates</FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {datePreference === 'set-dates' && (
                    <div className="pl-2 space-y-4">
                      <FormField
                        control={form.control}
                        name="dateType"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Date Type</FormLabel>
                            <FormControl>
                              <RadioGroup
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                className="flex space-x-4"
                              >
                                <FormItem className="flex items-center space-x-2 space-y-0">
                                  <FormControl>
                                    <RadioGroupItem value="specific-date" />
                                  </FormControl>
                                  <FormLabel className="font-normal">Specific Date</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-2 space-y-0">
                                  <FormControl>
                                    <RadioGroupItem value="delivery-deadline" />
                                  </FormControl>
                                  <FormLabel className="font-normal">Delivery Deadline</FormLabel>
                                </FormItem>
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="dates"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant={'outline'}
                                    className={cn(
                                      'pl-3 text-left font-normal',
                                      !field.value?.length && 'text-muted-foreground'
                                    )}
                                  >
                                    {field.value && field.value.length > 0 ? (
                                      field.value.length > 1 ? `${field.value.length} dates selected` : format(field.value[0], 'PPP')
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="multiple"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  disabled={(date) =>
                                    date < new Date() || date < new Date('1900-01-01')
                                  }
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <FormLabel>Reference Media (optional)</FormLabel>
                  <FormDescription className="pb-2">
                    Add some images or videos to give photographers a better idea of what you're looking for. ({previews.length}/{MAX_REFERENCE_MEDIA})
                  </FormDescription>
                  <Input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    multiple
                    accept="image/*,video/*"
                    disabled={totalIsLoading || !canUploadMore}
                  />
                  {previews.length > 0 && (
                    <div className="grid grid-cols-3 gap-4 mt-2 md:grid-cols-5">
                      {previews.map((preview, index) => (
                        <div key={index} className="relative group aspect-square">
                          <Image
                            src={preview.url}
                            alt={preview.name}
                            fill
                            className="object-cover rounded-md"
                          />
                          {preview.type === 'video' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Video className="h-8 w-8 text-white" />
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {canUploadMore && (
                        <div
                          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input p-4 text-center hover:border-primary/50 transition-colors"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-8 w-8 text-muted-foreground" />
                          <p className="mt-2 text-sm text-muted-foreground">Add More</p>
                        </div>
                      )}
                    </div>
                  )}

                  {previews.length === 0 && canUploadMore && (
                    <div
                      className="mt-2 flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input p-12 text-center"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-sm text-muted-foreground">Click to upload media</p>
                    </div>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="copyrightOption"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Copyright & Usage Rights</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex flex-col space-y-2"
                        >
                          <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border p-4">
                            <FormControl>
                              <RadioGroupItem value="license" />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                Grant of License
                              </FormLabel>
                              <FormDescription>
                                The photographer retains copyright, but you get a license to use the content.
                              </FormDescription>
                            </div>
                          </FormItem>
                          <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border p-4">
                            <FormControl>
                              <RadioGroupItem value="transfer" />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                Transfer of Copyright
                              </FormLabel>
                              <FormDescription>
                                You acquire full ownership and copyright of the content. This is typically more expensive.
                              </FormDescription>
                            </div>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="sm:justify-end">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={totalIsLoading}>
                  {totalIsLoading && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                  Send Request
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
};


export default function PhotographerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const { user: currentUser } = useUser();
  const database = useDatabase();
  const router = useRouter();
  const { toast } = useToast();

  const [userData, setUserData] = React.useState<User | null>(null);
  const [photographerProfile, setPhotographerProfile] = React.useState<PhotographerProfile | null>(null);
  const [portfolioItems, setPortfolioItems] = React.useState<PortfolioItem[]>([]);
  const [allReviews, setAllReviews] = React.useState<Review[] | null>(null);
  const [reviewers, setReviewers] = React.useState<Record<string, User>>({});
  const [myOpenRequests, setMyOpenRequests] = React.useState<ProjectRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isBookNowOpen, setIsBookNowOpen] = React.useState(false);
  const [isStartingChat, setIsStartingChat] = React.useState(false);
  const [currentUserData, setCurrentUserData] = React.useState<User | null>(null); // Kept for other uses if needed, but favorites handled by hook

  const { isFavorite, toggleFavorite } = useFavorites(id, 'photographer');

  React.useEffect(() => {
    if (!database || !id) return;

    const fetchData = async () => {
      setIsLoading(true);

      try {
        const userRef = ref(database, `users/${id}`);
        // Query profile by userId
        const profilesQuery = query(ref(database, 'photographerProfiles'), orderByChild('userId'), equalTo(id));
        const reviewsQuery = query(ref(database, 'reviews'), orderByChild('revieweeId'), equalTo(id));

        const [userSnap, profilesSnap, reviewsSnap] = await Promise.all([
          get(userRef),
          get(profilesQuery),
          get(reviewsQuery)
        ]);

        if (userSnap.exists()) {
          setUserData({ id: id, ...userSnap.val() } as User);
        }

        if (profilesSnap.exists()) {
          // profilesSnap.val() is an object map of profiles
          const profilesMap = profilesSnap.val();
          const profileId = Object.keys(profilesMap)[0];
          const pData = profilesMap[profileId];

          setPhotographerProfile({ id: profileId, ...pData } as PhotographerProfile);

          let pItems: PortfolioItem[] = [];
          if (pData.portfolioItems) {
            pItems = Object.entries(pData.portfolioItems).map(([key, value]: [string, any]) => ({
              id: key,
              ...value
            }));
            // Sort by createdAt desc if available
            pItems.sort((a, b) => {
              const timeA = a.createdAt || 0;
              const timeB = b.createdAt || 0;
              return Number(timeB) - Number(timeA);
            });
          }
          setPortfolioItems(pItems);
        }

        const reviews: Review[] = [];
        if (reviewsSnap.exists()) {
          reviewsSnap.forEach(child => {
            reviews.push({ id: child.key, ...child.val() } as Review);
          });
        }
        setAllReviews(reviews);

        // Fetch reviewers (users)
        const reviewerIds = [...new Set(reviews.map(r => r.reviewerId))];
        if (reviewerIds.length > 0) {
          const reviewersMap: Record<string, User> = {};
          await Promise.all(reviewerIds.map(async (reviewerId) => {
            const rRef = ref(database, `users/${reviewerId}`);
            const rSnap = await get(rRef);
            if (rSnap.exists()) {
              reviewersMap[reviewerId] = { id: reviewerId, ...rSnap.val() } as User;
            }
          }));
          setReviewers(reviewersMap);
        }

        // Fetch My Open Requests
        if (currentUser) {
          const requestsQuery = query(ref(database, 'requests'), orderByChild('userId'), equalTo(currentUser.uid));
          // RTDB filtering limitations: can only filter by one key. 'userId' or 'status'.
          // We'll filter by userId and then filter for status='Open' in memory.
          const requestsSnap = await get(requestsQuery);
          const myRequests: ProjectRequest[] = [];
          if (requestsSnap.exists()) {
            requestsSnap.forEach(child => {
              const req = { id: child.key, ...child.val() } as ProjectRequest;
              if (req.status === 'Open') {
                myRequests.push(req);
              }
            });
          }
          setMyOpenRequests(myRequests);
        }

      } catch (error) {
        console.error("Error fetching photographer details:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Could not load photographer details.",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

  }, [database, id, currentUser]);


  const handleMessageUser = async () => {
    if (!currentUser || !userData || !database) return;
    setIsStartingChat(true);
    router.push(`/messages/new?recipient=${userData.id}`);
  };


  if (isLoading) {
    return (
      <div className="container py-8 flex items-center justify-center min-h-[50vh]">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="container py-8 text-center">
        <h1 className="text-2xl font-bold">User Not Found</h1>
        <Button className="mt-4" onClick={() => router.push('/photographers')}>Go Back</Button>
      </div>
    );
  }

  const isPhotographer = userData.role === 'photographer';
  // Fallback: If no dedicated profile found but user is photographer, show basics using user data
  const displayName = userData.displayName || userData.email?.split('@')[0] || 'User';
  const bio = photographerProfile?.bio || userData.bio || "No bio available.";
  const location = photographerProfile?.location || userData.location || "Location not specified";
  const rating = 0; // Calculate if needed, but usually derived from reviews in a better way (e.g. aggregate)
  const reviewCount = allReviews?.length || 0;
  const averageRating = reviewCount > 0 ? (allReviews!.reduce((acc, curr) => acc + curr.rating, 0) / reviewCount).toFixed(1) : "New";


  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative h-[300px] w-full bg-slate-900 overflow-hidden">
        {photographerProfile?.coverPhotoUrl ? (
          <Image
            src={photographerProfile.coverPhotoUrl}
            alt="Cover"
            fill
            className="object-cover opacity-60"
            priority
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900 to-purple-900 opacity-80" />
        )}
        <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black/80 to-transparent pt-20">
          <div className="container mx-auto flex flex-col md:flex-row items-end gap-6">
            <Avatar className="h-32 w-32 border-4 border-white shadow-lg">
              <AvatarImage src={userData.photoURL} alt={displayName} className="object-cover" />
              <AvatarFallback className="text-4xl">{displayName.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 text-white pb-2">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold">{displayName}</h1>
                {/* {isPhotographer && <Badge variant="secondary" className="bg-blue-500/20 text-blue-100 hover:bg-blue-500/30">Pro Photographer</Badge>} */}
              </div>
              <div className="flex items-center gap-4 mt-2 text-slate-200">
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>{location}</span>
                </div>
                {isPhotographer && (
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                    <span className="font-semibold">{averageRating}</span>
                    <span className="text-sm opacity-80">({reviewCount} reviews)</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 pb-2">
              {currentUser && currentUser.uid !== id && (
                <>
                  <Button
                    variant={isFavorite ? "destructive" : "secondary"}
                    size="icon"
                    className="rounded-full"
                    onClick={toggleFavorite}
                    title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Heart className={cn("h-5 w-5", isFavorite && "fill-current")} />
                  </Button>
                  <Button variant="secondary" className="gap-2" onClick={handleMessageUser}>
                    <MessageSquare className="h-4 w-4" />
                    Message
                  </Button>
                  {isPhotographer && (
                    <Button className="gap-2" onClick={() => setIsBookNowOpen(true)}>
                      Book Now
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto py-8 px-4 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Info & Portfolio */}
        <div className="lg:col-span-2 space-y-8">
          {/* About */}
          <section>
            <h2 className="text-xl font-bold mb-4">About</h2>
            <Card>
              <CardContent className="pt-6">
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {bio}
                </p>
                {photographerProfile?.equipment && (
                  <div className="mt-6">
                    <h3 className="font-semibold mb-2">Equipment</h3>
                    <div className="flex flex-wrap gap-2">
                      {photographerProfile.equipment.map((item, i) => (
                        <Badge key={i} variant="outline" className="px-3 py-1">{item}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {photographerProfile?.specialties && (
                  <div className="mt-6">
                    <h3 className="font-semibold mb-2">Specialties</h3>
                    <div className="flex flex-wrap gap-2">
                      {photographerProfile.specialties.map((item, i) => (
                        <Badge key={i} variant="secondary" className="px-3 py-1">{item}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Portfolio */}
          {(isPhotographer || photographerProfile) && (
            <section>
              <h2 className="text-xl font-bold mb-4">Portfolio</h2>
              {portfolioItems.length > 0 ? (
                <PortfolioGallery
                  items={portfolioItems}
                  setItems={setPortfolioItems}
                  profileId={photographerProfile?.id || ''}
                  isOwnProfile={false}
                  onUploadClick={() => { }}
                  isLoading={false}
                />
              ) : (
                <PortfolioGallery
                  items={[]}
                  setItems={setPortfolioItems}
                  profileId={photographerProfile?.id || ''}
                  isOwnProfile={false}
                  onUploadClick={() => { }}
                  isLoading={false}
                />
              )}
            </section>
          )}

          {/* Reviews */}
          <section>
            <h2 className="text-xl font-bold mb-4">Reviews</h2>
            <div className="space-y-4">
              {allReviews && allReviews.length > 0 ? (
                allReviews.map((review) => (
                  <Card key={review.id}>
                    <CardContent className="pt-6">
                      <DisplayReviewCard review={review} reviewer={reviewers[review.reviewerId]} />
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No reviews yet.
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Sidebar (Pricing / Availability / etc) */}
        <div className="space-y-6">
          {isPhotographer && photographerProfile && (
            <Card>
              <CardHeader>
                <CardTitle>Rates & Availability</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Hourly Rate</span>
                  <span className="font-semibold text-lg">
                    {photographerProfile.hourlyRate ? `$${photographerProfile.hourlyRate}/hr` : 'Contact for rates'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Availability</span>
                  <span className="font-medium flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${userData.isAvailable !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                    {userData.isAvailable !== false ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                {/* Could add calendar or more details here */}
                <Button className="w-full mt-4" onClick={() => setIsBookNowOpen(true)}>Book Now</Button>
              </CardContent>
            </Card>
          )}

          {/* Contact / Socials if public */}
        </div>
      </div>

      {userData && (
        <BookNowDialog
          photographer={userData}
          open={isBookNowOpen}
          onOpenChange={setIsBookNowOpen}
        />
      )}
    </div>
  );
}
