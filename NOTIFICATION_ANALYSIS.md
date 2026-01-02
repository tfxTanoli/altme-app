# Notification System Analysis - Missing Implementations

## ✅ ALREADY IMPLEMENTED Notifications

### Client Notifications:
1. ✅ **When a photographer applies to a job** (bid_received)
   - File: `src/app/requests/[id]/page.tsx` - Line ~350
   - Trigger: When photographer submits a bid
   - Type: `bid_received`

2. ✅ **When a delivery is submitted** (new_delivery)
   - File: `src/hooks/use-content-delivery-upload.ts`
   - Trigger: When photographer uploads delivery files
   - Type: `new_delivery`

3. ❌ **When a job request is approved** - PARTIALLY IMPLEMENTED
   - File: `src/app/(app)/admin/projects/page.tsx` - Line ~280
   - Only sends to photographer, NOT to client
   - Type: `job_approved`

### Photographer Notifications:
1. ✅ **When they are hired** (hired)
   - File: `src/app/requests/[id]/page.tsx` - Line ~470
   - Trigger: When client accepts bid and completes payment
   - Type: `hired`

2. ✅ **When a delivery is approved and review is requested** (delivery_approved + review_request)
   - File: `src/app/requests/[id]/page.tsx` - Lines ~540-555
   - Sends TWO notifications: delivery_approved + review_request
   - Types: `delivery_approved`, `review_request`

3. ✅ **When they receive a direct request** (direct_booking_request)
   - File: `src/app/(app)/photographers/[id]/page.tsx` - Line ~280
   - Trigger: When client sends direct booking
   - Type: `direct_booking_request`

### Common Notifications:
1. ❌ **When a message is received** - NOT IMPLEMENTED
   - File: `src/components/chat/chat-view.tsx`
   - Currently sends notification but needs proper type
   - Type: Should be `message_received`

2. ❌ **When a job-related message is received** - NOT IMPLEMENTED
   - No distinction between direct message and project chat message
   - Should have separate handling

---

## ❌ MISSING NOTIFICATIONS

### 1. Client Notification: Job Request Approved (to CLIENT)
**Status:** Partially implemented - only notifies photographer

**Current Code:**
```typescript
// src/app/(app)/admin/projects/page.tsx - Line 280
await sendNotification(project.hiredPhotographerId, {
    title: 'Booking Approved!',
    message: `Your direct booking for "${project.title}" has been approved.`,
    type: 'job_approved',
    link: `/requests/${project.id}`,
    relatedId: project.id
});
```

**Missing:** Notification to CLIENT when admin approves their pending request

**Fix Required:** Add notification to `project.userId` (the client)

---

### 2. Message Received Notification (Direct Messages)
**Status:** NOT IMPLEMENTED

**Current Code:**
```typescript
// src/components/chat/chat-view.tsx - Line ~150
await sendNotification(currentPartner.id, {
    type: 'direct_message',
    title: 'New Message',
    message: `${currentUser.displayName || 'Someone'} sent you a message.`,
    link: `/messages/${chatRoom.id}`,
    relatedId: chatRoom.id
});
```

**Issue:** Type is `direct_message` but should be `message_received` for consistency

**Fix Required:** Change type to `message_received` OR keep `direct_message` but ensure it's in notification types

---

### 3. Job-Related Message Notification (Project Chat)
**Status:** NOT IMPLEMENTED

**Current Issue:** No distinction between:
- Direct messages (personal chat)
- Project chat messages (job-related)

**Fix Required:** 
- When `chatRoom.isProjectChat === true`, use type `project_chat`
- When `chatRoom.isProjectChat === false`, use type `message_received`

---

## 📧 EMAIL NOTIFICATIONS - NOT IMPLEMENTED

**Status:** COMPLETELY MISSING

**Requirement:** "Send an email every time a new notification is created"

**Current State:** 
- No email service integration
- No email templates
- No email sending logic

**What's Needed:**
1. Email service setup (SendGrid, AWS SES, Resend, etc.)
2. Email templates for each notification type
3. Email sending function in `sendNotification`
4. Admin email notifications for critical events

---

## 🔧 FIXES REQUIRED

### Priority 1: Add Missing Client Notification (Job Approved)

**File:** `src/app/(app)/admin/projects/page.tsx`

**Add after line 290:**
```typescript
// Also notify the client
await sendNotification(project.userId, {
    title: 'Your Booking Request Approved!',
    message: `Your booking request "${project.title}" has been approved and is now in progress.`,
    type: 'job_approved',
    link: `/requests/${project.id}`,
    relatedId: project.id
});
```

---

### Priority 2: Fix Message Notifications

**File:** `src/components/chat/chat-view.tsx`

**Replace current notification logic:**
```typescript
// Determine notification type based on chat type
const notificationType = chatRoom.isProjectChat ? 'project_chat' : 'message_received';
const notificationTitle = chatRoom.isProjectChat ? 'New Project Message' : 'New Message';

await sendNotification(currentPartner.id, {
    type: notificationType,
    title: notificationTitle,
    message: `${currentUser.displayName || 'Someone'} sent you a message.`,
    link: chatRoom.isProjectChat ? `/requests/${chatRoom.requestId}` : `/messages/${chatRoom.id}`,
    relatedId: chatRoom.isProjectChat ? chatRoom.requestId : chatRoom.id
});
```

---

### Priority 3: Implement Email Notifications

**File:** `src/services/notifications.ts`

**Add email service:**
```typescript
import { sendEmail } from './email-service'; // To be created

export const sendNotification = async (userId: string, notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => {
    if (!userId) return;

    try {
        // Send in-app notification
        const notificationsRef = ref(database, `notifications/${userId}`);
        const newNotificationRef = push(notificationsRef);

        await set(newNotificationRef, {
            ...notification,
            timestamp: serverTimestamp(),
            isRead: false,
        });

        // Send email notification
        if (notification.recipientEmail) {
            await sendEmail({
                to: notification.recipientEmail,
                subject: notification.title,
                body: notification.message,
                link: notification.link,
                type: notification.type
            });
        }
    } catch (error) {
        console.error("Error sending notification:", error);
    }
};
```

---

### Priority 4: Add Admin Email Notifications

**Events requiring admin email:**
1. Job creation (new request posted)
2. Delivery submission
3. Dispute raised
4. Payment issues
5. User reports

**Implementation:** Create `sendAdminEmail` function

---

## 📋 NOTIFICATION TYPES STATUS

| Type | Implemented | Email | Notes |
|------|-------------|-------|-------|
| `bid_received` | ✅ | ❌ | Client gets notified when photographer bids |
| `hired` | ✅ | ❌ | Photographer notified when hired |
| `delivery_submitted` | ✅ | ❌ | Via `new_delivery` type |
| `delivery_approved` | ✅ | ❌ | Client approves delivery |
| `review_request` | ✅ | ❌ | Sent with delivery approval |
| `direct_booking_request` | ✅ | ❌ | Photographer gets direct booking |
| `job_approved` | ⚠️ | ❌ | Only to photographer, missing client notification |
| `message_received` | ❌ | ❌ | Not properly implemented |
| `project_chat` | ❌ | ❌ | No distinction from direct message |
| `review_received` | ✅ | ❌ | When someone reviews you |
| `gig_hired` | ✅ | ❌ | Duplicate of `hired`? |

---

## 🎯 SUMMARY

### What's Working:
- ✅ In-app notifications display correctly
- ✅ Notifications sorted by newest first
- ✅ Notifications don't disappear after being read
- ✅ Most core user flows have notifications

### What's Missing:
1. ❌ **Client notification when admin approves job** (HIGH PRIORITY)
2. ❌ **Proper message notification types** (MEDIUM PRIORITY)
3. ❌ **Email notifications** (HIGH PRIORITY - REQUIRED)
4. ❌ **Admin email notifications** (HIGH PRIORITY - REQUIRED)

### What Needs Fixing:
1. Message notifications need proper type distinction
2. Email service needs to be implemented
3. Admin email alerts need to be added

---

## 📝 IMPLEMENTATION CHECKLIST

- [ ] Add client notification for job approval
- [ ] Fix message notification types (direct vs project)
- [ ] Set up email service (SendGrid/AWS SES/Resend)
- [ ] Create email templates
- [ ] Implement email sending in sendNotification
- [ ] Add admin email notifications
- [ ] Test all notification flows
- [ ] Update notification types in TypeScript

---

**Estimated Time:** 
- Missing notifications: 30 minutes
- Email service setup: 2-3 hours
- Email templates: 1-2 hours
- Admin emails: 1 hour
- Testing: 1 hour

**Total:** ~6 hours for complete implementation
